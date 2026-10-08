import { hashNamedFields } from "./canonical.js";
import { rejectUnknownKeys } from "./validate.js";

export const MAX_CATEGORY_DEPTH = 3;
export const CATEGORY_SCHEMA_VERSION = 1;
export const CATEGORY_NAME_MAX_CHARS = 32;
export const CATEGORY_SORT_MIN = 0;
export const CATEGORY_SORT_MAX = 100000;
export const CATALOG_DOC_ID = "catalog";
export const ROOT_PARENT_ID = "";

export const CATEGORY_WRITE_CONCURRENCY = "expectedTreeVersion" as const;

export const IN_USE_MIGRATION_NOTE = "有引用的迁移/改父级是 MW18，本轮不做";
export const PARENT_CHANGE_NOTE = "改父级必须走 category.change.preview / commit，那是 MW18，本轮不做";

export const INITIAL_ROOT_SEEDS = [
  { seedKey: "logical", name: "逻辑思维" },
  { seedKey: "reverse", name: "逆向思维" },
  { seedKey: "divergent", name: "发散思维" },
  { seedKey: "convergent", name: "聚合思维" },
  { seedKey: "imagery", name: "形象思维" },
  { seedKey: "abstract", name: "抽象思维" },
  { seedKey: "creative", name: "创造性思维" },
  { seedKey: "critical", name: "批判性思维" },
  { seedKey: "game", name: "博弈思维" },
  { seedKey: "open", name: "开放性思维" }
] as const;

export const INITIAL_ROOT_NAMES = INITIAL_ROOT_SEEDS.map((item) => item.name);

export const CATEGORY_CREATE_FIELDS = ["name", "parentId", "sort", "enabled", "expectedTreeVersion"] as const;
export const CATEGORY_UPDATE_FIELDS = ["categoryId", "name", "sort", "enabled", "expectedTreeVersion"] as const;
export const CATEGORY_DELETE_FIELDS = ["categoryId", "expectedTreeVersion", "reason"] as const;
export const CATEGORY_TREE_FIELDS = ["knownVersion"] as const;
export const CATEGORY_SEED_FIELDS = ["expectedTreeVersion"] as const;
export const CATEGORY_CLIENT_FORBIDDEN_FIELDS = [
  "ancestorIds",
  "depth",
  "treeVersion",
  "normalizedName",
  "deletedAt",
  "revision",
  "categoryId"
] as const;

export const CATEGORY_PUBLIC_NODE_FIELDS = ["id", "parentId", "depth", "name", "sort", "enabled"] as const;

export type CategorySeed = (typeof INITIAL_ROOT_SEEDS)[number];

export type CategoryRecord = {
  categoryId: string;
  parentId: string | null;
  depth: number;
  ancestorIds: string[];
  name: string;
  normalizedName: string;
  sort: number;
  enabled: boolean;
  deletedAt: string | null;
  revision: number;
  treeVersion: number;
  seedKey?: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type CategoryNameRecord = {
  nameId: string;
  parentId: string;
  normalizedName: string;
  categoryId: string;
};

export type CatalogRecord = {
  treeVersion: number;
  categoryMetricsGeneration: number;
  seeded: boolean;
  seededAt: string | null;
  schemaVersion: number;
  updatedAt: string;
};

export type PublicCategoryNode = {
  id: string;
  parentId: string | null;
  depth: number;
  name: string;
  sort: number;
  enabled: boolean;
};

export type AdminCategoryNode = PublicCategoryNode & {
  categoryId: string;
  ancestorIds: string[];
  normalizedName: string;
  revision: number;
  effectiveEnabled: boolean;
  seedKey?: string;
};

export type FictionalPaperHang = {
  paperId: string;
  categoryId: string;
  title: string;
};

export function depthFromAncestors(ancestorIds: string[]): number {
  return ancestorIds.length + 1;
}

export function normalizeCategoryName(input: string): string {
  return input.normalize("NFC").trim();
}

export function encodeParentId(parentId: string | null | undefined): string {
  return parentId && parentId.trim() ? parentId.trim() : ROOT_PARENT_ID;
}

export function decodeParentId(parentId: string | null | undefined): string | null {
  const encoded = encodeParentId(parentId);
  return encoded === ROOT_PARENT_ID ? null : encoded;
}

export function seedCategoryId(seedKey: string): string {
  return hashNamedFields({ kind: "categorySeed", seedKey }, ["kind", "seedKey"]);
}

export function newCategoryId(actorId: string, idempotencyKey: string): string {
  return hashNamedFields({ kind: "category", actorId, idempotencyKey }, ["kind", "actorId", "idempotencyKey"]);
}

export function categoryNameId(parentId: string | null | undefined, normalizedName: string): string {
  return hashNamedFields(
    { parentId: encodeParentId(parentId), normalizedName },
    ["parentId", "normalizedName"]
  );
}

export function seedCategoryIds(): string[] {
  return INITIAL_ROOT_SEEDS.map((item) => seedCategoryId(item.seedKey));
}

export function isSeedCategoryId(categoryId: string): boolean {
  return seedCategoryIds().includes(categoryId);
}

export function paperMayHangOnCategory(input: { depth: number; deletedAt?: string | null }): boolean {
  return (
    (input.depth === 1 || input.depth === 2 || input.depth === 3) &&
    (input.deletedAt == null || input.deletedAt === "")
  );
}

export function emptyCatalog(now: Date): CatalogRecord {
  return {
    treeVersion: 0,
    categoryMetricsGeneration: 0,
    seeded: false,
    seededAt: null,
    schemaVersion: CATEGORY_SCHEMA_VERSION,
    updatedAt: now.toISOString()
  };
}

export function validateCategoryName(input: unknown): { ok: true; name: string; normalizedName: string } | { ok: false; issues: string[] } {
  if (typeof input !== "string") {
    return { ok: false, issues: ["name must be string"] };
  }
  const name = normalizeCategoryName(input);
  if (!name) {
    return { ok: false, issues: ["name required"] };
  }
  if (Array.from(name).length > CATEGORY_NAME_MAX_CHARS) {
    return { ok: false, issues: ["name too long"] };
  }
  return { ok: true, name, normalizedName: name };
}

export function validateCategorySort(input: unknown): { ok: true; sort: number } | { ok: false; issues: string[] } {
  if (input === undefined) {
    return { ok: true, sort: 10 };
  }
  if (typeof input !== "number" || !Number.isInteger(input)) {
    return { ok: false, issues: ["sort must be integer"] };
  }
  if (input < CATEGORY_SORT_MIN || input > CATEGORY_SORT_MAX) {
    return { ok: false, issues: ["sort out of range"] };
  }
  return { ok: true, sort: input };
}

export function validateExpectedTreeVersion(
  input: unknown
): { ok: true; expectedTreeVersion: number } | { ok: false; issues: string[] } {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0) {
    return { ok: false, issues: ["expectedTreeVersion required"] };
  }
  return { ok: true, expectedTreeVersion: input };
}

export function validateCategoryMove(input: {
  ancestorIds: string[];
  parentId: string | null;
  categoryId?: string;
}): { ok: true; depth: number } | { ok: false; code: "CATEGORY_DEPTH_LIMIT" | "CATEGORY_CYCLE" } {
  if (input.parentId && input.categoryId && input.parentId === input.categoryId) {
    return { ok: false, code: "CATEGORY_CYCLE" };
  }
  if (input.categoryId && input.ancestorIds.includes(input.categoryId)) {
    return { ok: false, code: "CATEGORY_CYCLE" };
  }
  const depth = depthFromAncestors(input.ancestorIds);
  if (depth < 1 || depth > MAX_CATEGORY_DEPTH) {
    return { ok: false, code: "CATEGORY_DEPTH_LIMIT" };
  }
  return { ok: true, depth };
}

export function validateParentAssignment(input: {
  categoryId?: string;
  parentId: string | null;
  parent?: Pick<CategoryRecord, "categoryId" | "depth" | "ancestorIds" | "deletedAt">;
}):
  | { ok: true; depth: number; ancestorIds: string[] }
  | { ok: false; code: "CATEGORY_DEPTH_LIMIT" | "CATEGORY_CYCLE" | "PARENT_MISSING" } {
  if (input.parentId == null) {
    return { ok: true, depth: 1, ancestorIds: [] };
  }
  if (!input.parent || input.parent.deletedAt) {
    return { ok: false, code: "PARENT_MISSING" };
  }
  if (input.categoryId && input.parentId === input.categoryId) {
    return { ok: false, code: "CATEGORY_CYCLE" };
  }
  if (input.categoryId && (input.parent.ancestorIds.includes(input.categoryId) || input.parent.categoryId === input.categoryId)) {
    return { ok: false, code: "CATEGORY_CYCLE" };
  }
  const ancestorIds = [...input.parent.ancestorIds, input.parent.categoryId];
  const checked = validateCategoryMove({
    ancestorIds,
    parentId: input.parentId,
    categoryId: input.categoryId
  });
  if (!checked.ok) return checked;
  if (input.parent.depth >= MAX_CATEGORY_DEPTH) {
    return { ok: false, code: "CATEGORY_DEPTH_LIMIT" };
  }
  return { ok: true, depth: input.parent.depth + 1, ancestorIds };
}

export function effectiveEnabled(
  node: Pick<CategoryRecord, "enabled" | "deletedAt" | "ancestorIds">,
  byId: Map<string, Pick<CategoryRecord, "enabled" | "deletedAt">>
): boolean {
  if (!node.enabled || node.deletedAt) return false;
  for (const ancestorId of node.ancestorIds) {
    const ancestor = byId.get(ancestorId);
    if (!ancestor || !ancestor.enabled || ancestor.deletedAt) return false;
  }
  return true;
}

export function toPublicNode(node: CategoryRecord): PublicCategoryNode {
  return {
    id: node.categoryId,
    parentId: node.parentId,
    depth: node.depth,
    name: node.name,
    sort: node.sort,
    enabled: node.enabled
  };
}

export function sortCategoryNodes<T extends { parentId: string | null; sort: number; id?: string; categoryId?: string }>(
  nodes: T[]
): T[] {
  return [...nodes].sort((left, right) => {
    const leftParent = left.parentId || "";
    const rightParent = right.parentId || "";
    if (leftParent !== rightParent) return leftParent.localeCompare(rightParent);
    if (left.sort !== right.sort) return left.sort - right.sort;
    const leftId = left.id || left.categoryId || "";
    const rightId = right.id || right.categoryId || "";
    return leftId.localeCompare(rightId);
  });
}

export function parseCategoryCreateInput(data: Record<string, unknown>):
  | {
      ok: true;
      name: string;
      normalizedName: string;
      parentId: string | null;
      sort: number;
      enabled: boolean;
      expectedTreeVersion: number;
    }
  | { ok: false; issues: string[]; code?: "INVALID_ARGUMENT" } {
  const extra = rejectUnknownKeys(data, [...CATEGORY_CREATE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  for (const key of CATEGORY_CLIENT_FORBIDDEN_FIELDS) {
    if (key in data && key !== "categoryId") {
      issues.push(`client must not send ${key}`);
    }
  }
  if ("categoryId" in data) {
    issues.push("client must not send categoryId");
  }
  const name = validateCategoryName(data.name);
  if (!name.ok) issues.push(...name.issues);
  const sort = validateCategorySort(data.sort);
  if (!sort.ok) issues.push(...sort.issues);
  const version = validateExpectedTreeVersion(data.expectedTreeVersion);
  if (!version.ok) issues.push(...version.issues);
  if (data.enabled !== undefined && typeof data.enabled !== "boolean") {
    issues.push("enabled must be boolean");
  }
  if (data.parentId !== undefined && data.parentId !== null && typeof data.parentId !== "string") {
    issues.push("parentId must be string or null");
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    name: name.ok ? name.name : "",
    normalizedName: name.ok ? name.normalizedName : "",
    parentId: decodeParentId(typeof data.parentId === "string" ? data.parentId : null),
    sort: sort.ok ? sort.sort : 10,
    enabled: data.enabled === undefined ? true : data.enabled === true,
    expectedTreeVersion: version.ok ? version.expectedTreeVersion : 0
  };
}

export function parseCategoryUpdateInput(data: Record<string, unknown>):
  | {
      ok: true;
      categoryId: string;
      expectedTreeVersion: number;
      name?: string;
      normalizedName?: string;
      sort?: number;
      enabled?: boolean;
    }
  | { ok: false; issues: string[]; code?: "INVALID_ARGUMENT"; reason?: string } {
  if ("parentId" in data) {
    return { ok: false, issues: [PARENT_CHANGE_NOTE], reason: "PARENT_CHANGE_REQUIRES_MW18" };
  }
  const extra = rejectUnknownKeys(data, [...CATEGORY_UPDATE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (typeof data.categoryId !== "string" || !data.categoryId.trim()) {
    issues.push("categoryId required");
  }
  const version = validateExpectedTreeVersion(data.expectedTreeVersion);
  if (!version.ok) issues.push(...version.issues);
  let name: string | undefined;
  let normalizedName: string | undefined;
  if (data.name !== undefined) {
    const checked = validateCategoryName(data.name);
    if (!checked.ok) issues.push(...checked.issues);
    else {
      name = checked.name;
      normalizedName = checked.normalizedName;
    }
  }
  let sort: number | undefined;
  if (data.sort !== undefined) {
    const checked = validateCategorySort(data.sort);
    if (!checked.ok) issues.push(...checked.issues);
    else sort = checked.sort;
  }
  if (data.enabled !== undefined && typeof data.enabled !== "boolean") {
    issues.push("enabled must be boolean");
  }
  if (name === undefined && sort === undefined && data.enabled === undefined) {
    issues.push("name, sort or enabled required");
  }
  if (issues.length) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    categoryId: String(data.categoryId).trim(),
    expectedTreeVersion: version.ok ? version.expectedTreeVersion : 0,
    ...(name !== undefined ? { name, normalizedName } : {}),
    ...(sort !== undefined ? { sort } : {}),
    ...(data.enabled !== undefined ? { enabled: data.enabled === true } : {})
  };
}

export function parseCategoryDeleteInput(data: Record<string, unknown>):
  | { ok: true; categoryId: string; expectedTreeVersion: number; reason: string }
  | { ok: false; issues: string[] } {
  if ("parentId" in data) {
    return { ok: false, issues: [PARENT_CHANGE_NOTE] };
  }
  const extra = rejectUnknownKeys(data, [...CATEGORY_DELETE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (typeof data.categoryId !== "string" || !data.categoryId.trim()) {
    issues.push("categoryId required");
  }
  const version = validateExpectedTreeVersion(data.expectedTreeVersion);
  if (!version.ok) issues.push(...version.issues);
  if (data.reason !== undefined && typeof data.reason !== "string") {
    issues.push("reason must be string");
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    categoryId: String(data.categoryId).trim(),
    expectedTreeVersion: version.ok ? version.expectedTreeVersion : 0,
    reason: typeof data.reason === "string" ? data.reason : "delete unused"
  };
}

export function fictionalPapersOnEachLevel(categoryIds: {
  depth1: string;
  depth2: string;
  depth3: string;
}): FictionalPaperHang[] {
  return [
    { paperId: "paper_fict_logic_l1", categoryId: categoryIds.depth1, title: "逻辑入门练习（虚构）" },
    { paperId: "paper_fict_logic_l2", categoryId: categoryIds.depth2, title: "演绎推理练习（虚构）" },
    { paperId: "paper_fict_logic_l3", categoryId: categoryIds.depth3, title: "条件判断练习（虚构）" }
  ];
}
