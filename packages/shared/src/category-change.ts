import { hashNamedFields } from "./canonical.js";
import { MAX_CATEGORY_DEPTH, categoryNameId, encodeParentId, validateParentAssignment, type CatalogRecord, type CategoryRecord } from "./category.js";
import { METRIC_GENERATION_BASE } from "./scoring.js";
import { rejectUnknownKeys } from "./validate.js";

/** CloudBase 事务上限 30 秒；本项目排空约定关闭成功后再等 35 秒。 */
export const CATALOG_CHANGE_DRAIN_MS = 35_000;
export const CATALOG_CHANGE_PREVIEW_TTL_MS = 10 * 60 * 1000;
export const CATALOG_CHANGE_JOB_TYPE = "catalog.change";
export const RANKING_REFRESH_CATEGORY_JOB_TYPE = "ranking.refresh.category";
export const CATALOG_CHANGE_PREVIEW_COLLECTION = "catalog_change_previews";
export const CATALOG_CHANGE_WORK_COLLECTION = "catalog_change_jobs";

export const CATEGORY_CHANGE_PREVIEW_FIELDS = ["expectedTreeVersion", "operations"] as const;
export const CATEGORY_CHANGE_COMMIT_FIELDS = ["previewId", "planHash", "reason", "confirmed"] as const;
export const CATEGORY_CHANGE_OP_TYPES = ["move", "relocatePapers", "relocateQuestions", "delete"] as const;

export type CategoryChangeOpType = (typeof CATEGORY_CHANGE_OP_TYPES)[number];

export type CategoryChangeOp =
  | { type: "move"; categoryId: string; parentId: string | null }
  | { type: "relocatePapers"; fromCategoryId: string; toCategoryId: string }
  | { type: "relocateQuestions"; fromCategoryId: string; toCategoryId: string }
  | { type: "delete"; categoryId: string };

export type CategoryChangeRef = { id: string; title: string; categoryId: string };

export type CategoryRankingStatus = "ready" | "updating" | "pending_recovery";

export type CatalogChangeStage =
  | "drain"
  | "apply"
  | "metrics"
  | "switch"
  | "open"
  | "ranking"
  | "done";

export type CatalogChangeCursor = {
  done: number;
  total: number;
  stage: CatalogChangeStage;
  offset: number;
};

export type CategoryChangePlan = {
  expectedTreeVersion: number;
  operations: CategoryChangeOp[];
  moves: Array<{
    categoryId: string;
    fromParentId: string | null;
    toParentId: string | null;
    fromDepth: number;
    toDepth: number;
    descendantIds: string[];
  }>;
  relocatedQuestions: CategoryChangeRef[];
  relocatedPapers: CategoryChangeRef[];
  deletes: string[];
  affectedMemberEstimate: number;
  rebuildCategoryIds: string[];
  warnings: string[];
};

export type CategoryChangePreviewRecord = {
  previewId: string;
  planHash: string;
  actorId: string;
  expectedTreeVersion: number;
  operations: CategoryChangeOp[];
  plan: CategoryChangePlan;
  expiresAt: string;
  createdAt: string;
  consumedAt: string | null;
};

/**
 * 方案 A：catalog.categoryMetricsGeneration === 0 时分类指标兼容读取 base；
 * 切换到正整数新代后必须用该代字符串，禁止缺行回退 base。
 */
export function categoryMetricGenerationKey(generation: number | null | undefined): string {
  if (generation == null || generation <= 0) return METRIC_GENERATION_BASE;
  return String(generation);
}

export function nextCategoryMetricsGeneration(current: number | null | undefined): number {
  return (current == null || current <= 0 ? 0 : current) + 1;
}

export function isLegacyCategoryGeneration(generation: number | null | undefined): boolean {
  return generation == null || generation <= 0;
}

/** 分类指标用当前代际键；总分/周/月永远是 base。 */
export function metricGenerationForScope(scope: string, categoryGeneration: number | null | undefined): string {
  return scope === "category" ? categoryMetricGenerationKey(categoryGeneration) : METRIC_GENERATION_BASE;
}

export function catalogChangeJobId(actorId: string, previewId: string): string {
  return hashNamedFields({ kind: "catalog.change", actorId, previewId }, ["kind", "actorId", "previewId"]);
}

export function categoryChangePreviewId(actorId: string, idempotencyKey: string): string {
  return hashNamedFields({ kind: "catalog.change.preview", actorId, idempotencyKey }, ["kind", "actorId", "idempotencyKey"]);
}

export function categoryChangePlanHash(plan: CategoryChangePlan): string {
  return hashNamedFields(
    {
      expectedTreeVersion: plan.expectedTreeVersion,
      operations: plan.operations,
      moves: plan.moves,
      relocatedQuestionIds: plan.relocatedQuestions.map((row) => row.id),
      relocatedPaperIds: plan.relocatedPapers.map((row) => row.id),
      deletes: plan.deletes,
      rebuildCategoryIds: plan.rebuildCategoryIds
    },
    [
      "expectedTreeVersion",
      "operations",
      "moves",
      "relocatedQuestionIds",
      "relocatedPaperIds",
      "deletes",
      "rebuildCategoryIds"
    ]
  );
}

export function emptyCatalogChangeCursor(): CatalogChangeCursor {
  return { done: 0, total: 6, stage: "drain", offset: 0 };
}

export function catalogChangeDrainUntil(closedAt: Date): Date {
  return new Date(closedAt.getTime() + CATALOG_CHANGE_DRAIN_MS);
}

export function drainReady(notBeforeIso: string, now: Date): boolean {
  const ms = Date.parse(notBeforeIso);
  return Number.isFinite(ms) && now.getTime() >= ms;
}

export function descendantsOf(categoryId: string, nodes: readonly CategoryRecord[]): CategoryRecord[] {
  return nodes.filter((row) => !row.deletedAt && (row.ancestorIds.includes(categoryId) || row.parentId === categoryId));
}

export function subtreeMaxDepthAfterMove(
  node: Pick<CategoryRecord, "depth">,
  descendants: readonly Pick<CategoryRecord, "depth">[],
  newDepth: number
): number {
  const extra = descendants.reduce((max, row) => Math.max(max, row.depth - node.depth), 0);
  return newDepth + extra;
}

export function parseCategoryChangeOperations(input: unknown):
  | { ok: true; operations: CategoryChangeOp[] }
  | { ok: false; issues: string[] } {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, issues: ["operations required"] };
  }
  const operations: CategoryChangeOp[] = [];
  const issues: string[] = [];
  input.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push(`operations[${index}] must be object`);
      return;
    }
    const rec = raw as Record<string, unknown>;
    const type = rec.type;
    if (type === "move") {
      const extra = rejectUnknownKeys(rec, ["type", "categoryId", "parentId"]);
      if (extra.length) issues.push(`operations[${index}] unknown fields: ${extra.join(",")}`);
      if (typeof rec.categoryId !== "string" || !rec.categoryId.trim()) issues.push(`operations[${index}].categoryId required`);
      if (rec.parentId !== null && rec.parentId !== undefined && typeof rec.parentId !== "string") {
        issues.push(`operations[${index}].parentId must be string or null`);
      }
      operations.push({
        type: "move",
        categoryId: String(rec.categoryId || "").trim(),
        parentId: typeof rec.parentId === "string" && rec.parentId.trim() ? rec.parentId.trim() : null
      });
      return;
    }
    if (type === "relocatePapers" || type === "relocateQuestions") {
      const extra = rejectUnknownKeys(rec, ["type", "fromCategoryId", "toCategoryId"]);
      if (extra.length) issues.push(`operations[${index}] unknown fields: ${extra.join(",")}`);
      if (typeof rec.fromCategoryId !== "string" || !rec.fromCategoryId.trim()) {
        issues.push(`operations[${index}].fromCategoryId required`);
      }
      if (typeof rec.toCategoryId !== "string" || !rec.toCategoryId.trim()) {
        issues.push(`operations[${index}].toCategoryId required`);
      }
      operations.push({
        type,
        fromCategoryId: String(rec.fromCategoryId || "").trim(),
        toCategoryId: String(rec.toCategoryId || "").trim()
      });
      return;
    }
    if (type === "delete") {
      const extra = rejectUnknownKeys(rec, ["type", "categoryId"]);
      if (extra.length) issues.push(`operations[${index}] unknown fields: ${extra.join(",")}`);
      if (typeof rec.categoryId !== "string" || !rec.categoryId.trim()) issues.push(`operations[${index}].categoryId required`);
      operations.push({ type: "delete", categoryId: String(rec.categoryId || "").trim() });
      return;
    }
    issues.push(`operations[${index}].type must be one of ${CATEGORY_CHANGE_OP_TYPES.join(",")}`);
  });
  if (issues.length) return { ok: false, issues };
  return { ok: true, operations };
}

export function parseCategoryChangePreviewInput(data: Record<string, unknown>):
  | { ok: true; expectedTreeVersion: number; operations: CategoryChangeOp[] }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...CATEGORY_CHANGE_PREVIEW_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (typeof data.expectedTreeVersion !== "number" || !Number.isInteger(data.expectedTreeVersion) || data.expectedTreeVersion < 0) {
    issues.push("expectedTreeVersion required");
  }
  const ops = parseCategoryChangeOperations(data.operations);
  if (!ops.ok) issues.push(...ops.issues);
  if (issues.length) return { ok: false, issues };
  return { ok: true, expectedTreeVersion: data.expectedTreeVersion as number, operations: ops.ok ? ops.operations : [] };
}

export function parseCategoryChangeCommitInput(data: Record<string, unknown>):
  | { ok: true; previewId: string; planHash: string; reason: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...CATEGORY_CHANGE_COMMIT_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (typeof data.previewId !== "string" || !data.previewId.trim()) issues.push("previewId required");
  if (typeof data.planHash !== "string" || !data.planHash.trim()) issues.push("planHash required");
  if (typeof data.reason !== "string" || !data.reason.trim()) issues.push("reason required");
  if (data.confirmed !== true) issues.push("confirmed must be true");
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    previewId: String(data.previewId).trim(),
    planHash: String(data.planHash).trim(),
    reason: String(data.reason).trim()
  };
}

export type CategoryUsageMap = {
  questions: Record<string, CategoryChangeRef[]>;
  papers: Record<string, CategoryChangeRef[]>;
};

export type PlannedTreeIssue = {
  code: "CATEGORY_DEPTH_LIMIT" | "CATEGORY_CYCLE" | "PARENT_MISSING" | "NAME_CONFLICT" | "CATEGORY_IN_USE" | "NOT_FOUND" | "INVALID_ARGUMENT";
  reason: string;
  details?: Record<string, unknown>;
};

/**
 * 在内存中应用操作并校验最终树：第四级、自父、循环、移入后代、缺父、同级重名、
 * 有引用却未指定有效迁移目标、有子节点却未先处理。
 */
export function planCategoryChange(input: {
  expectedTreeVersion: number;
  catalog: CatalogRecord;
  nodes: readonly CategoryRecord[];
  operations: CategoryChangeOp[];
  usage: CategoryUsageMap;
}): { ok: true; plan: CategoryChangePlan } | { ok: false; issue: PlannedTreeIssue } {
  if (input.catalog.treeVersion !== input.expectedTreeVersion) {
    return { ok: false, issue: { code: "VERSION_CONFLICT" as PlannedTreeIssue["code"], reason: "TREE_VERSION_MISMATCH" } };
  }
  const live = input.nodes.filter((row) => !row.deletedAt).map((row) => ({ ...row, ancestorIds: [...row.ancestorIds] }));
  const byId = new Map(live.map((row) => [row.categoryId, row]));
  const moves: CategoryChangePlan["moves"] = [];
  const relocatedQuestions: CategoryChangeRef[] = [];
  const relocatedPapers: CategoryChangeRef[] = [];
  const deletes: string[] = [];
  const questionLeft = new Map<string, CategoryChangeRef[]>(
    Object.entries(input.usage.questions).map(([key, rows]) => [key, [...rows]])
  );
  const paperLeft = new Map<string, CategoryChangeRef[]>(
    Object.entries(input.usage.papers).map(([key, rows]) => [key, [...rows]])
  );
  const warnings: string[] = [];

  for (const op of input.operations) {
    if (op.type === "move") {
      const node = byId.get(op.categoryId);
      if (!node) return { ok: false, issue: { code: "NOT_FOUND", reason: "CATEGORY_NOT_FOUND", details: { categoryId: op.categoryId } } };
      const parent = op.parentId ? byId.get(op.parentId) : undefined;
      const assigned = validateParentAssignment({
        categoryId: op.categoryId,
        parentId: op.parentId,
        parent
      });
      if (!assigned.ok) {
        return { ok: false, issue: { code: assigned.code, reason: assigned.code } };
      }
      const descendants = descendantsOf(op.categoryId, [...byId.values()]);
      const maxDepth = subtreeMaxDepthAfterMove(node, descendants, assigned.depth);
      if (maxDepth > MAX_CATEGORY_DEPTH) {
        return { ok: false, issue: { code: "CATEGORY_DEPTH_LIMIT", reason: "SUBTREE_DEPTH_LIMIT", details: { maxDepth } } };
      }
      const siblingName = categoryNameId(op.parentId, node.normalizedName);
      const conflict = [...byId.values()].find(
        (row) =>
          row.categoryId !== node.categoryId &&
          !row.deletedAt &&
          categoryNameId(row.parentId, row.normalizedName) === siblingName
      );
      if (conflict) {
        return { ok: false, issue: { code: "NAME_CONFLICT" as PlannedTreeIssue["code"], reason: "NAME_CONFLICT" } };
      }
      const fromParentId = node.parentId;
      const fromDepth = node.depth;
      node.parentId = op.parentId;
      node.depth = assigned.depth;
      node.ancestorIds = assigned.ancestorIds;
      for (const child of descendants) {
        const idx = child.ancestorIds.indexOf(op.categoryId);
        const tail = idx >= 0 ? child.ancestorIds.slice(idx) : [op.categoryId, ...child.ancestorIds.filter((id) => id !== op.categoryId)];
        child.ancestorIds = [...assigned.ancestorIds, ...tail.filter((id, i) => tail.indexOf(id) === i)];
        child.depth = child.ancestorIds.length + 1;
        if (child.depth > MAX_CATEGORY_DEPTH) {
          return { ok: false, issue: { code: "CATEGORY_DEPTH_LIMIT", reason: "SUBTREE_DEPTH_LIMIT" } };
        }
      }
      moves.push({
        categoryId: op.categoryId,
        fromParentId,
        toParentId: op.parentId,
        fromDepth,
        toDepth: assigned.depth,
        descendantIds: descendants.map((row) => row.categoryId)
      });
    } else if (op.type === "relocatePapers" || op.type === "relocateQuestions") {
      const from = byId.get(op.fromCategoryId);
      const to = byId.get(op.toCategoryId);
      if (!from || !to) return { ok: false, issue: { code: "NOT_FOUND", reason: "CATEGORY_NOT_FOUND" } };
      if (!to.enabled || to.deletedAt) {
        return { ok: false, issue: { code: "INVALID_ARGUMENT", reason: "TARGET_CATEGORY_UNAVAILABLE" } };
      }
      const bag = op.type === "relocatePapers" ? paperLeft : questionLeft;
      const rows = bag.get(op.fromCategoryId) || [];
      if (!rows.length) {
        warnings.push(`${op.type} ${op.fromCategoryId} has no current refs`);
      }
      const moved = rows.map((row) => ({ ...row, categoryId: op.toCategoryId }));
      if (op.type === "relocatePapers") relocatedPapers.push(...moved);
      else relocatedQuestions.push(...moved);
      const dest = bag.get(op.toCategoryId) || [];
      bag.set(op.toCategoryId, [...dest, ...moved]);
      bag.set(op.fromCategoryId, []);
    } else if (op.type === "delete") {
      const node = byId.get(op.categoryId);
      if (!node) return { ok: false, issue: { code: "NOT_FOUND", reason: "CATEGORY_NOT_FOUND" } };
      const children = [...byId.values()].filter((row) => row.parentId === op.categoryId && !row.deletedAt);
      if (children.length) {
        return {
          ok: false,
          issue: {
            code: "CATEGORY_IN_USE",
            reason: "CATEGORY_HAS_CHILDREN",
            details: { hasChildren: true, childIds: children.map((row) => row.categoryId) }
          }
        };
      }
      const qRefs = questionLeft.get(op.categoryId) || [];
      const pRefs = paperLeft.get(op.categoryId) || [];
      if (qRefs.length || pRefs.length) {
        return {
          ok: false,
          issue: {
            code: "CATEGORY_IN_USE",
            reason: "CATEGORY_IN_USE",
            details: { hasQuestionRefs: qRefs.length > 0, hasPaperRefs: pRefs.length > 0 }
          }
        };
      }
      node.deletedAt = "pending";
      deletes.push(op.categoryId);
    }
  }

  const rebuild = new Set<string>();
  for (const move of moves) {
    rebuild.add(move.categoryId);
    for (const id of move.descendantIds) rebuild.add(id);
    if (move.toParentId) rebuild.add(move.toParentId);
  }
  for (const row of [...relocatedPapers, ...relocatedQuestions]) rebuild.add(row.categoryId);
  for (const id of deletes) rebuild.add(id);

  return {
    ok: true,
    plan: {
      expectedTreeVersion: input.expectedTreeVersion,
      operations: input.operations,
      moves,
      relocatedQuestions,
      relocatedPapers,
      deletes,
      affectedMemberEstimate: 0,
      rebuildCategoryIds: [...rebuild],
      warnings
    }
  };
}

export function catalogStructureUpdating(catalog: Pick<CatalogRecord, "treeVersion"> & { structureUpdating?: boolean; structureJobId?: string }): boolean {
  return catalog.structureUpdating === true && Boolean(catalog.structureJobId);
}

export function encodeParentForName(parentId: string | null | undefined): string {
  return encodeParentId(parentId);
}
