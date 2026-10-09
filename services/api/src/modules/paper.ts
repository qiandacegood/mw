import {
  PAPER_SCHEMA_VERSION,
  PUBLIC_PAPER_SCAN_LIMIT,
  HOME_SHELF_LIMIT,
  applyPublishFault,
  assemblePaperSnapshot,
  assertSnapshotClosed,
  auditDocId,
  buildAuditEntry,
  buildIdempotencyRecord,
  categoryUsableForQuestion,
  collectAssetIds,
  decodePaperListCursor,
  draftMaxScoreOf,
  effectiveEnabled,
  encodePaperListCursor,
  overlappingPaperIds,
  paperIdFor,
  paperListCursorFilterOf,
  paperListCursorMatches,
  paperNewStartGate,
  parseHomeGetInput,
  parsePaperGetInput,
  parsePaperListInput,
  parsePaperPreviewInput,
  parsePaperPublishInput,
  parsePaperSaveInput,
  parsePaperUnpublishInput,
  parsePaperWithdrawInput,
  parsePublicPaperDetailInput,
  payloadHash,
  replayOrConflict,
  toAdminPaperView,
  toPublicPaperDetail,
  toPublicPaperSummary,
  type CategoryRecord,
  type PaperDraftItem,
  type PaperRecord,
  type PaperVersionRecord,
  type PublicCategoryNode,
  type QuestionRecord,
  type QuestionVersionRecord
} from "@mw/shared";
import { readCategoryTree } from "./category.js";
import type { CategoryReadStore, CategoryUsageStore, CategoryWorkStore } from "./category-stores.js";
import type { PolicyStore } from "./member-stores.js";
import { readCurrentPolicies } from "./member.js";
import type { TxBudget } from "./job-stores.js";
import { isCommittedImport, type ImportVisibilityStore } from "./import-stores.js";
import type { QuestionUsageStore, QuestionWorkStore } from "./question-stores.js";
import type { PaperQuestionLookup, PaperWorkStore } from "./paper-stores.js";

const RETRYABLE_TX =
  /TX_CONFLICT|TRANSACTION_CONFLICT|DATABASE_TRANSACTION_CONFLICT|DOCUMENT_VERSION_CONFLICT|PAPER_VERSION_IMMUTABLE|optimistic.?lock|write.?conflict|contention|please retry|try again/i;

export type PaperActionFailure = {
  ok: false;
  code: string;
  reason: string;
  issues?: string[];
  details?: Record<string, unknown>;
};

export type PaperActionSuccess<T> = {
  ok: true;
  data: T;
  replayed?: boolean;
  budget: TxBudget;
};

function emptyBudget(): TxBudget {
  return { reads: 0, writes: 0, total: 0, elapsedMs: 0 };
}

function fail(code: string, reason: string, extra?: { issues?: string[]; details?: Record<string, unknown> }): PaperActionFailure {
  return { ok: false, code, reason, ...(extra?.issues ? { issues: extra.issues } : {}), ...(extra?.details ? { details: extra.details } : {}) };
}

export function isRetryablePaperTxError(error: unknown): boolean {
  if (error == null) return false;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return RETRYABLE_TX.test(text);
}

async function runWithTxRetry<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      lastError = error;
      if (!isRetryablePaperTxError(error) || attempt === 3) return { ok: false, error };
    }
  }
  return { ok: false, error: lastError };
}

async function categoryPathOf(store: CategoryReadStore | undefined, categoryId: string): Promise<string[]> {
  if (!store) return [];
  const names: string[] = [];
  let current = await store.getCategory(categoryId);
  const seen = new Set<string>();
  while (current && !seen.has(current.categoryId)) {
    seen.add(current.categoryId);
    names.unshift(current.name);
    if (!current.parentId) break;
    current = await store.getCategory(current.parentId);
  }
  return names;
}

function lookupFromQuestionStore(store?: QuestionWorkStore): PaperQuestionLookup | undefined {
  if (!store) return undefined;
  return {
    getQuestion: (id) => store.getQuestion(id),
    getQuestionVersion: (id) => store.getVersion(id),
    getAsset: (id) => store.getAsset(id)
  };
}

async function resolveDraftItems(
  lookup: PaperQuestionLookup,
  items: PaperDraftItem[],
  imports?: ImportVisibilityStore
): Promise<{ ok: true; items: PaperDraftItem[] } | { ok: false; code: string; reason: string; details?: Record<string, unknown> }> {
  const resolved: PaperDraftItem[] = [];
  for (const item of items) {
    const question = await lookup.getQuestion(item.questionId);
    if (!question) return { ok: false, code: "NOT_FOUND", reason: "QUESTION_NOT_FOUND", details: { questionId: item.questionId } };
    if (!(await isCommittedImport(imports, question.importBatchId))) {
      return { ok: false, code: "NOT_FOUND", reason: "QUESTION_NOT_FOUND", details: { questionId: item.questionId } };
    }
    if (question.status !== "active") {
      return { ok: false, code: "INVALID_ARGUMENT", reason: "QUESTION_DISABLED", details: { questionId: item.questionId } };
    }
    const versionId = item.versionId || question.currentVersionId;
    const version = await lookup.getQuestionVersion(versionId);
    if (!version) return { ok: false, code: "NOT_FOUND", reason: "QUESTION_VERSION_NOT_FOUND", details: { versionId } };
    resolved.push({
      questionId: item.questionId,
      versionId,
      points: item.points,
      ord: item.ord
    });
  }
  return { ok: true, items: resolved };
}

function availableCategoryMap(nodes: CategoryRecord[]): {
  byId: Map<string, CategoryRecord>;
  available: Set<string>;
} {
  const byId = new Map(nodes.map((row) => [row.categoryId, row]));
  const available = new Set(
    nodes.filter((row) => !row.deletedAt && effectiveEnabled(row, byId)).map((row) => row.categoryId)
  );
  return { byId, available };
}

function descendantIdsOf(rootId: string, nodes: CategoryRecord[], available: Set<string>): string[] {
  const ids = new Set<string>();
  if (available.has(rootId)) ids.add(rootId);
  for (const node of nodes) {
    if (!available.has(node.categoryId)) continue;
    if (node.categoryId === rootId || node.ancestorIds.includes(rootId) || node.parentId === rootId) {
      ids.add(node.categoryId);
    }
  }
  return [...ids];
}

function sortPaperRows(rows: PaperRecord[], sort: "latest" | "recommended"): PaperRecord[] {
  return [...rows].sort((left, right) => {
    if (sort === "recommended") {
      if (left.sort !== right.sort) return left.sort - right.sort;
      return left.paperId.localeCompare(right.paperId);
    }
    const leftAt = left.publishedAt || "";
    const rightAt = right.publishedAt || "";
    if (leftAt !== rightAt) return rightAt.localeCompare(leftAt);
    return left.paperId.localeCompare(right.paperId);
  });
}

function cursorAfterKey(row: PaperRecord, sort: "latest" | "recommended"): string {
  return sort === "recommended" ? String(row.sort).padStart(8, "0") : row.publishedAt || "";
}

function afterCursor(rows: PaperRecord[], sort: "latest" | "recommended", afterKey: string, afterId: string): PaperRecord[] {
  return rows.filter((row) => {
    const key = cursorAfterKey(row, sort);
    if (sort === "recommended") {
      if (key !== afterKey) return key > afterKey;
      return row.paperId > afterId;
    }
    if (key !== afterKey) return key < afterKey;
    return row.paperId > afterId;
  });
}

export async function listPapers(input: {
  store?: PaperWorkStore;
  imports?: ImportVisibilityStore;
  categoryStore?: CategoryReadStore;
  data: Record<string, unknown>;
  publicView: boolean;
}): Promise<
  PaperActionSuccess<{ items: ReturnType<typeof toPublicPaperSummary>[]; nextCursor: string | null; complete: boolean }> | PaperActionFailure
> {
  const parsed = parsePaperListInput(input.data, input.publicView);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_LIST", { issues: parsed.issues });
  if (!input.store) return fail("INTERNAL_ERROR", "PAPER_STORE_UNAVAILABLE");

  let gen = 0;
  let allowedIds: string[] | undefined;
  if (input.publicView) {
    if (!input.categoryStore) return fail("INTERNAL_ERROR", "CATEGORY_STORE_UNAVAILABLE");
    const [catalog, nodes] = await Promise.all([input.categoryStore.getCatalog(), input.categoryStore.listActive()]);
    gen = catalog.treeVersion;
    const { byId, available } = availableCategoryMap(nodes);
    if (parsed.categoryId) {
      const category = (await input.categoryStore.getCategory(parsed.categoryId)) || byId.get(parsed.categoryId);
      if (!category || category.deletedAt || !effectiveEnabled(category, byId)) {
        return fail("CATEGORY_UNAVAILABLE", "CATEGORY_UNAVAILABLE");
      }
      allowedIds = parsed.includeDescendants ? descendantIdsOf(parsed.categoryId, nodes, available) : [parsed.categoryId];
    } else {
      allowedIds = [...available];
    }
  }

  const filter = paperListCursorFilterOf({
    sort: parsed.sort,
    categoryId: parsed.categoryId,
    includeDescendants: parsed.includeDescendants,
    difficulty: parsed.difficulty,
    access: parsed.access,
    progress: parsed.progress,
    gen
  });
  let startAfter: { afterKey: string; afterId: string } | undefined;
  if (parsed.cursor) {
    const decoded = decodePaperListCursor(parsed.cursor);
    if (!decoded.ok || !paperListCursorMatches(decoded.payload, filter)) {
      return fail("INVALID_ARGUMENT", "CURSOR_FILTER_MISMATCH", { issues: ["change filters must restart paging"] });
    }
    startAfter = { afterKey: decoded.payload.afterKey, afterId: decoded.payload.afterId };
  }

  if (input.publicView && parsed.progress === "done") {
    return { ok: true, data: { items: [], nextCursor: null, complete: true }, budget: emptyBudget() };
  }

  const scanLimit = input.publicView ? Math.max(parsed.limit + 1, PUBLIC_PAPER_SCAN_LIMIT) : parsed.limit;
  const papers = await input.store.listPapers({
    categoryId: input.publicView ? undefined : parsed.categoryId,
    categoryIds: input.publicView ? allowedIds : undefined,
    status: input.publicView ? "published" : parsed.status,
    difficulty: parsed.difficulty,
    access: parsed.access,
    sort: parsed.sort,
    limit: scanLimit
  });

  const unique = new Map<string, PaperRecord>();
  for (const paper of papers) {
    if (unique.has(paper.paperId)) continue;
    if (!(await isCommittedImport(input.imports, paper.importBatchId))) continue;
    if (input.publicView && (paper.status !== "published" || !paper.activeVersionId)) continue;
    if (input.publicView && allowedIds && !allowedIds.includes(paper.categoryId)) continue;
    unique.set(paper.paperId, paper);
  }
  let rows = sortPaperRows([...unique.values()], parsed.sort);
  if (startAfter) {
    rows = afterCursor(rows, parsed.sort, startAfter.afterKey, startAfter.afterId);
  }
  const page = rows.slice(0, parsed.limit);
  const complete = page.length >= rows.length;
  const last = page[page.length - 1];
  const nextCursor =
    !complete && last
      ? encodePaperListCursor({
          ...filter,
          afterKey: cursorAfterKey(last, parsed.sort),
          afterId: last.paperId
        })
      : null;
  const items = [];
  for (const paper of page) {
    const version = paper.activeVersionId ? await input.store.getVersion(paper.activeVersionId) : undefined;
    items.push(toPublicPaperSummary(paper, version));
  }
  return { ok: true, data: { items, nextCursor, complete }, budget: emptyBudget() };
}

export async function getPublicPaper(input: {
  store?: PaperWorkStore;
  imports?: ImportVisibilityStore;
  categoryStore?: CategoryReadStore;
  data: Record<string, unknown>;
}): Promise<PaperActionSuccess<{ paper: ReturnType<typeof toPublicPaperDetail> }> | PaperActionFailure> {
  const parsed = parsePublicPaperDetailInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_GET", { issues: parsed.issues });
  if (!input.store) return fail("INTERNAL_ERROR", "PAPER_STORE_UNAVAILABLE");
  const paper = await input.store.getPaper(parsed.paperId);
  if (!paper) return fail("NOT_FOUND", "PAPER_NOT_FOUND");
  if (!(await isCommittedImport(input.imports, paper.importBatchId))) {
    return fail("NOT_FOUND", "PAPER_NOT_FOUND");
  }
  if (paper.status === "withdrawn") return fail("PAPER_WITHDRAWN", "PAPER_WITHDRAWN");
  if (paper.status === "unpublished") return fail("NOT_FOUND", "PAPER_UNPUBLISHED");
  if (paper.status !== "published" || !paper.activeVersionId) {
    return fail("NOT_FOUND", "PAPER_NOT_FOUND");
  }
  if (input.categoryStore) {
    const [category, nodes] = await Promise.all([
      input.categoryStore.getCategory(paper.categoryId),
      input.categoryStore.listActive()
    ]);
    const { byId } = availableCategoryMap(nodes);
    if (!category || category.deletedAt || !effectiveEnabled(category, byId)) {
      return fail("CATEGORY_UNAVAILABLE", "CATEGORY_UNAVAILABLE");
    }
  }
  const version = await input.store.getVersion(paper.activeVersionId);
  if (!version) return fail("NOT_FOUND", "PAPER_VERSION_NOT_FOUND");
  return { ok: true, data: { paper: toPublicPaperDetail(paper, version) }, budget: emptyBudget() };
}

export async function getHome(input: {
  paperStore?: PaperWorkStore;
  categoryStore?: CategoryWorkStore;
  importStore?: ImportVisibilityStore;
  policyStore?: PolicyStore;
  now: Date;
  data: Record<string, unknown>;
}): Promise<
  | PaperActionSuccess<{
      roots: PublicCategoryNode[];
      recommended: ReturnType<typeof toPublicPaperSummary>[];
      latest: ReturnType<typeof toPublicPaperSummary>[];
      catalogVersion: number;
      configVersion: { catalogVersion: number; agreementVersion: string; privacyVersion: string };
    }>
  | PaperActionFailure
> {
  const parsed = parseHomeGetInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_HOME", { issues: parsed.issues });
  const tree = await readCategoryTree(input.categoryStore, { publicView: true });
  const nodes = (tree.data.nodes || []) as PublicCategoryNode[];
  const roots = nodes.filter((node) => node.depth === 1);
  const emptyShelf = { ok: true as const, data: { items: [], nextCursor: null, complete: true }, budget: emptyBudget() };
  const recommended =
    input.paperStore && input.categoryStore
      ? await listPapers({
          store: input.paperStore,
          imports: input.importStore,
          categoryStore: input.categoryStore,
          data: { sort: "recommended", limit: HOME_SHELF_LIMIT },
          publicView: true
        })
      : emptyShelf;
  if (!recommended.ok) return recommended;
  const latest =
    input.paperStore && input.categoryStore
      ? await listPapers({
          store: input.paperStore,
          imports: input.importStore,
          categoryStore: input.categoryStore,
          data: { sort: "latest", limit: HOME_SHELF_LIMIT },
          publicView: true
        })
      : emptyShelf;
  if (!latest.ok) return latest;
  const policies = await readCurrentPolicies(input.policyStore, input.now);
  return {
    ok: true,
    data: {
      roots,
      recommended: recommended.data.items,
      latest: latest.data.items,
      catalogVersion: tree.data.treeVersion,
      configVersion: {
        catalogVersion: tree.data.treeVersion,
        agreementVersion: policies.agreementVersion,
        privacyVersion: policies.privacyVersion
      }
    },
    budget: emptyBudget()
  };
}

export async function getAdminPaper(input: {
  store?: PaperWorkStore;
  imports?: ImportVisibilityStore;
  data: Record<string, unknown>;
}): Promise<PaperActionSuccess<{ paper: ReturnType<typeof toAdminPaperView>; version?: PaperVersionRecord }> | PaperActionFailure> {
  const parsed = parsePaperGetInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_GET", { issues: parsed.issues });
  if (!input.store) return fail("INTERNAL_ERROR", "PAPER_STORE_UNAVAILABLE");
  const paper = await input.store.getPaper(parsed.paperId);
  if (!paper) return fail("NOT_FOUND", "PAPER_NOT_FOUND");
  if (!(await isCommittedImport(input.imports, paper.importBatchId))) {
    return fail("NOT_FOUND", "PAPER_NOT_FOUND");
  }
  const versionId = parsed.versionId || paper.activeVersionId;
  const version = versionId ? await input.store.getVersion(versionId) : undefined;
  return { ok: true, data: { paper: toAdminPaperView(paper, version), version }, budget: emptyBudget() };
}

async function loadSnapshotView(
  store: PaperWorkStore,
  version: PaperVersionRecord,
  includeSecrets: boolean
) {
  const items = [];
  for (const chunkId of version.chunkIds) {
    const chunk = await store.getChunk(chunkId);
    if (!chunk) continue;
    for (const item of chunk.items) {
      items.push({
        ord: item.ord,
        questionId: item.questionId,
        questionVersionId: item.questionVersionId,
        type: item.type,
        stem: item.stem,
        options: item.options,
        points: item.points
      });
    }
  }
  if (!includeSecrets) return { items, answers: [] as unknown[] };
  const answers = [];
  for (const chunkId of version.answerChunkIds) {
    const row = await store.getAnswer(chunkId);
    if (!row) continue;
    answers.push(...row.items);
  }
  return { items, answers };
}

export async function previewPaper(input: {
  store?: PaperWorkStore;
  questions?: QuestionWorkStore;
  imports?: ImportVisibilityStore;
  data: Record<string, unknown>;
  includeSecrets: boolean;
}): Promise<
  | PaperActionSuccess<{
      paper: ReturnType<typeof toAdminPaperView> | ReturnType<typeof toPublicPaperSummary>;
      draftPreview?: { items: unknown[]; maxScore: number; questionCount: number };
      publishedPreview?: { items: unknown[]; answers?: unknown[]; maxScore: number; questionCount: number; versionId: string };
    }>
  | PaperActionFailure
> {
  const parsed = parsePaperPreviewInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_PREVIEW", { issues: parsed.issues });
  if (!input.store) return fail("INTERNAL_ERROR", "PAPER_STORE_UNAVAILABLE");
  const paper = await input.store.getPaper(parsed.paperId);
  if (!paper) return fail("NOT_FOUND", "PAPER_NOT_FOUND");
  if (!(await isCommittedImport(input.imports, paper.importBatchId))) {
    return fail("NOT_FOUND", "PAPER_NOT_FOUND");
  }
  const lookup = lookupFromQuestionStore(input.questions);
  let draftPreview;
  if (lookup && input.includeSecrets) {
    const items = [];
    for (const item of paper.draftItems) {
      const version = await lookup.getQuestionVersion(item.versionId);
      if (!version) continue;
      items.push({
        ord: item.ord,
        questionId: item.questionId,
        questionVersionId: item.versionId,
        type: version.type,
        stem: version.stem,
        options: version.options,
        points: item.points,
        answer: version.answer,
        analysis: version.analysis
      });
    }
    draftPreview = { items, maxScore: paper.draftMaxScore, questionCount: paper.draftQuestionCount };
  }
  let publishedPreview;
  if (paper.activeVersionId) {
    const version = await input.store.getVersion(paper.activeVersionId);
    if (version) {
      const loaded = await loadSnapshotView(input.store, version, input.includeSecrets);
      publishedPreview = {
        items: loaded.items,
        ...(input.includeSecrets ? { answers: loaded.answers } : {}),
        maxScore: version.maxScore,
        questionCount: version.questionCount,
        versionId: version.versionId
      };
    }
  }
  return {
    ok: true,
    data: {
      paper: input.includeSecrets ? toAdminPaperView(paper) : toPublicPaperSummary(paper),
      ...(draftPreview ? { draftPreview } : {}),
      ...(publishedPreview ? { publishedPreview } : {})
    },
    budget: emptyBudget()
  };
}

export async function savePaper(input: {
  store: PaperWorkStore;
  questions?: QuestionWorkStore;
  categories?: CategoryReadStore;
  categoryUsage?: CategoryUsageStore;
  imports?: ImportVisibilityStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<PaperActionSuccess<ReturnType<typeof toAdminPaperView> & { paperId: string; revision: number; idempotencyId: string }> | PaperActionFailure> {
  const parsed = parsePaperSaveInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_SAVE", { issues: parsed.issues });
  const category = input.categories
    ? await input.categories.getCategory(parsed.categoryId)
    : ({ categoryId: parsed.categoryId, enabled: true, deletedAt: null } as CategoryRecord);
  const usable = categoryUsableForQuestion(category);
  if (!usable.ok) return fail(usable.code, usable.reason);
  const lookup = lookupFromQuestionStore(input.questions);
  let draftItems = parsed.items;
  if (parsed.items) {
    if (!lookup) return fail("INTERNAL_ERROR", "QUESTION_STORE_UNAVAILABLE");
    const resolved = await resolveDraftItems(lookup, parsed.items, input.imports);
    if (!resolved.ok) return fail(resolved.code, resolved.reason, { details: resolved.details });
    draftItems = resolved.items;
  }
  const paperId = parsed.paperId || paperIdFor(input.actorId, input.requestId);
  if (!parsed.paperId && parsed.expectedRevision !== 0) {
    return fail("INVALID_ARGUMENT", "CREATE_EXPECTED_REVISION_ZERO");
  }
  const payload = {
    paperId,
    expectedRevision: parsed.expectedRevision,
    title: parsed.title,
    summary: parsed.summary,
    goal: parsed.goal,
    categoryId: parsed.categoryId,
    access: parsed.access,
    difficulty: parsed.difficulty,
    sort: parsed.sort,
    suggestedMinutes: parsed.suggestedMinutes,
    items: draftItems
  };
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "paper.save",
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  });
  const retried = await runWithTxRetry(() =>
    input.store.transactWrite({
      paperId,
      idempotencyId: idemRecord.id,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, payloadHash(payload), () => null);
        if (!replay.ok) return { result: null as never, error: { code: replay.code, reason: "IDEMPOTENCY_CONFLICT" } };
        if (replay.replayed) {
          const view = replay.result as ReturnType<typeof toAdminPaperView> & { paperId: string; revision: number; idempotencyId: string };
          if (view) return { result: view };
        }
        if (parsed.paperId && !snap.paper) {
          return { result: null as never, error: { code: "NOT_FOUND", reason: "PAPER_NOT_FOUND" } };
        }
        if (!parsed.paperId && snap.paper) {
          return { result: null as never, error: { code: "VERSION_CONFLICT", reason: "PAPER_ID_TAKEN" } };
        }
        const currentRevision = snap.paper?.revision ?? 0;
        if (currentRevision !== parsed.expectedRevision) {
          return { result: null as never, error: { code: "VERSION_CONFLICT", reason: "EXPECTED_REVISION_MISMATCH" } };
        }
        if (snap.paper && snap.paper.categoryId !== parsed.categoryId) {
          return {
            result: null as never,
            error: { code: "INVALID_ARGUMENT", reason: "CATEGORY_CHANGE_REQUIRES_MW18" }
          };
        }
        if (snap.paper?.accessLocked && snap.paper.access !== parsed.access) {
          return { result: null as never, error: { code: "INVALID_ARGUMENT", reason: "ACCESS_FROZEN" } };
        }
        const nextItems = draftItems ?? snap.paper?.draftItems ?? [];
        if (!nextItems.length) {
          return { result: null as never, error: { code: "INVALID_ARGUMENT", reason: "ITEMS_REQUIRED" } };
        }
        const nextRevision = currentRevision + 1;
        const paper: PaperRecord = {
          paperId,
          title: parsed.title,
          summary: parsed.summary,
          goal: parsed.goal,
          categoryId: parsed.categoryId,
          access: parsed.access,
          difficulty: parsed.difficulty,
          sort: parsed.sort,
          suggestedMinutes: parsed.suggestedMinutes,
          publishedAt: snap.paper?.publishedAt ?? null,
          status: snap.paper?.status || "draft",
          activeVersionId: snap.paper?.activeVersionId ?? null,
          revision: nextRevision,
          draftItems: nextItems,
          draftQuestionCount: nextItems.length,
          draftMaxScore: draftMaxScoreOf(nextItems),
          accessLocked: snap.paper?.accessLocked === true,
          withdrawReason: snap.paper?.withdrawReason ?? null,
          schemaVersion: PAPER_SCHEMA_VERSION,
          createdAt: snap.paper?.createdAt || input.now.toISOString(),
          updatedAt: input.now.toISOString()
        };
        const view = {
          ...toAdminPaperView(paper, snap.activeVersion),
          paperId,
          revision: nextRevision,
          idempotencyId: idemRecord.id
        };
        const audit = buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: "paper.save",
          target: paperId,
          reason: parsed.paperId ? "update paper draft" : "create paper draft",
          requestId: input.requestId,
          before: snap.paper ? { revision: currentRevision, title: snap.paper.title, sort: snap.paper.sort } : null,
          after: { revision: nextRevision, title: paper.title, sort: paper.sort, questionCount: paper.draftQuestionCount },
          now: input.now
        });
        return {
          paper,
          idem: { ...idemRecord, status: "succeeded", resultRef: view },
          audit,
          result: { ...view, auditId: auditDocId(audit) }
        };
      }
    })
  );
  if (!retried.ok) return fail("SERVICE_BUSY", "PAPER_TX_RETRY_EXHAUSTED");
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  return { ok: true, data: retried.value.mutation.result, replayed: Boolean(retried.value.mutation.idem && retried.value.mutation.result), budget: retried.value.budget };
}

async function publishChecks(input: {
  paper: PaperRecord;
  lookup: PaperQuestionLookup;
  categories?: CategoryReadStore;
  imports?: ImportVisibilityStore;
}): Promise<
  | { ok: true; versions: QuestionVersionRecord[]; questions: QuestionRecord[]; categoryPath: string[] }
  | PaperActionFailure
> {
  const category = input.categories ? await input.categories.getCategory(input.paper.categoryId) : undefined;
  const usable = categoryUsableForQuestion(category || { categoryId: input.paper.categoryId, enabled: true, deletedAt: null });
  if (!usable.ok) return fail(usable.code, usable.reason);
  const versions: QuestionVersionRecord[] = [];
  const questions: QuestionRecord[] = [];
  for (const item of input.paper.draftItems) {
    const question = await input.lookup.getQuestion(item.questionId);
    if (!question) return fail("NOT_FOUND", "QUESTION_NOT_FOUND", { details: { questionId: item.questionId } });
    if (!(await isCommittedImport(input.imports, question.importBatchId))) {
      return fail("NOT_FOUND", "QUESTION_NOT_FOUND", { details: { questionId: item.questionId } });
    }
    if (question.status !== "active") {
      return fail("INVALID_ARGUMENT", "QUESTION_DISABLED", { details: { questionId: item.questionId } });
    }
    if (question.currentVersionId !== item.versionId) {
      return fail("INVALID_ARGUMENT", "QUESTION_VERSION_STALE", {
        details: { questionId: item.questionId, expected: item.versionId, current: question.currentVersionId }
      });
    }
    const version = await input.lookup.getQuestionVersion(item.versionId);
    if (!version) return fail("NOT_FOUND", "QUESTION_VERSION_NOT_FOUND", { details: { versionId: item.versionId } });
    const assetIds = collectAssetIds(version);
    for (const assetId of assetIds) {
      const asset = await input.lookup.getAsset(assetId);
      if (!asset || asset.state !== "ready") {
        return fail("INVALID_ARGUMENT", "ASSET_NOT_READY", { details: { assetId } });
      }
    }
    questions.push(question);
    versions.push(version);
  }
  const categoryPath = await categoryPathOf(input.categories, input.paper.categoryId);
  return { ok: true, versions, questions, categoryPath };
}

export async function publishPaper(input: {
  store: PaperWorkStore;
  questions?: QuestionWorkStore;
  categories?: CategoryReadStore;
  questionUsage?: QuestionUsageStore;
  imports?: ImportVisibilityStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<
  | PaperActionSuccess<ReturnType<typeof toAdminPaperView> & { versionId: string; revision: number; idempotencyId: string; startGate: ReturnType<typeof paperNewStartGate> }>
  | PaperActionFailure
> {
  const parsed = parsePaperPublishInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_PUBLISH", { issues: parsed.issues });
  const paper = await input.store.getPaper(parsed.paperId);
  if (!paper) return fail("NOT_FOUND", "PAPER_NOT_FOUND");
  if (!(await isCommittedImport(input.imports, paper.importBatchId))) {
    return fail("NOT_FOUND", "PAPER_NOT_FOUND");
  }
  const lookup = lookupFromQuestionStore(input.questions);
  if (!lookup) return fail("INTERNAL_ERROR", "QUESTION_STORE_UNAVAILABLE");
  const checked = await publishChecks({ paper, lookup, categories: input.categories, imports: input.imports });
  if (!checked.ok) return checked;
  const others = (await input.store.listPublishedVersions()).filter((row) => row.paperId !== paper.paperId);
  const overlap = overlappingPaperIds(
    paper.draftItems.map((item) => item.questionId),
    others.map((row) => ({ paperId: row.paperId, questionIds: row.questionIds }))
  );
  if (overlap.length && !parsed.confirmOverlap) {
    return fail("INVALID_ARGUMENT", "OVERLAP_CONFIRM_REQUIRED", { details: { overlapCount: overlap.length } });
  }
  const assembled = assemblePaperSnapshot({
    paperId: paper.paperId,
    revision: paper.revision + 1,
    items: paper.draftItems,
    versions: checked.versions,
    categoryPathSnapshot: checked.categoryPath,
    createdAt: input.now.toISOString(),
    createdBy: input.actorId
  });
  if (!assembled.ok) return fail("INVALID_ARGUMENT", assembled.issues[0] || "SNAPSHOT_INVALID", { issues: assembled.issues });
  const faulty = applyPublishFault(assembled, parsed.injectPublishFault);
  const closed = assertSnapshotClosed(faulty.version, faulty.chunks, faulty.answers);
  if (!closed.ok) {
    return fail("INVALID_ARGUMENT", closed.issues[0] || "SNAPSHOT_NOT_CLOSED", { issues: closed.issues });
  }
  const sameActive =
    paper.activeVersionId &&
    paper.status === "unpublished" &&
    assembled.version.questionVersionIds.join(",") === (await input.store.getVersion(paper.activeVersionId))?.questionVersionIds.join(",") &&
    assembled.version.maxScore === (await input.store.getVersion(paper.activeVersionId))?.maxScore;
  const payload = {
    paperId: parsed.paperId,
    expectedRevision: parsed.expectedRevision,
    confirmOverlap: parsed.confirmOverlap,
    injectPublishFault: parsed.injectPublishFault || "",
    manifestHash: assembled.version.manifestHash
  };
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "paper.publish",
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  });
  const retried = await runWithTxRetry(() =>
    input.store.transactWrite({
      paperId: parsed.paperId,
      versionId: sameActive ? undefined : assembled.version.versionId,
      idempotencyId: idemRecord.id,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, payloadHash(payload), () => null);
        if (!replay.ok) return { result: null as never, error: { code: replay.code, reason: "IDEMPOTENCY_CONFLICT" } };
        if (replay.replayed) {
          const view = replay.result as ReturnType<typeof toAdminPaperView> & { versionId: string; revision: number; idempotencyId: string; startGate: ReturnType<typeof paperNewStartGate> };
          if (view) return { result: view };
        }
        if (!snap.paper) return { result: null as never, error: { code: "NOT_FOUND", reason: "PAPER_NOT_FOUND" } };
        if (snap.paper.revision !== parsed.expectedRevision) {
          return { result: null as never, error: { code: "VERSION_CONFLICT", reason: "EXPECTED_REVISION_MISMATCH" } };
        }
        const nextRevision = snap.paper.revision + 1;
        const versionId = sameActive && snap.paper.activeVersionId ? snap.paper.activeVersionId : assembled.version.versionId;
        if (!sameActive && snap.versions.some((row) => row.versionId === assembled.version.versionId)) {
          return { result: null as never, error: { code: "INVALID_ARGUMENT", reason: "PAPER_VERSION_IMMUTABLE" } };
        }
        const next: PaperRecord = {
          ...snap.paper,
          status: "published",
          activeVersionId: versionId,
          publishedAt: snap.paper.publishedAt || input.now.toISOString(),
          accessLocked: true,
          withdrawReason: null,
          revision: nextRevision,
          updatedAt: input.now.toISOString()
        };
        const publishedVersion = sameActive ? snap.activeVersion : assembled.version;
        const view = {
          ...toAdminPaperView(next, publishedVersion),
          versionId,
          revision: nextRevision,
          idempotencyId: idemRecord.id,
          startGate: paperNewStartGate(next.status)
        };
        const audit = buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: "paper.publish",
          target: next.paperId,
          reason: sameActive ? "republish existing snapshot" : "publish immutable snapshot",
          requestId: input.requestId,
          before: { status: snap.paper.status, activeVersionId: snap.paper.activeVersionId },
          after: { status: "published", activeVersionId: versionId, questionCount: next.draftQuestionCount },
          now: input.now
        });
        return {
          paper: next,
          version: sameActive ? undefined : assembled.version,
          chunks: sameActive ? undefined : assembled.chunks,
          answers: sameActive ? undefined : assembled.answers,
          idem: { ...idemRecord, status: "succeeded", resultRef: view },
          audit,
          result: view
        };
      }
    })
  );
  if (!retried.ok) return fail("SERVICE_BUSY", "PAPER_TX_RETRY_EXHAUSTED");
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  if (input.questionUsage) {
    for (const item of paper.draftItems) {
      const current = input.questionUsage.paperRefsFor(item.questionId);
      const next = await Promise.resolve(current);
      if (!next.includes(paper.paperId)) input.questionUsage.setPaperRefs(item.questionId, [...next, paper.paperId]);
    }
  }
  return { ok: true, data: retried.value.mutation.result, budget: retried.value.budget };
}

export async function unpublishPaper(input: {
  store: PaperWorkStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<PaperActionSuccess<ReturnType<typeof toAdminPaperView> & { startGate: ReturnType<typeof paperNewStartGate> }> | PaperActionFailure> {
  const parsed = parsePaperUnpublishInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_UNPUBLISH", { issues: parsed.issues });
  return mutateStatus({
    ...input,
    paperId: parsed.paperId,
    expectedRevision: parsed.expectedRevision,
    action: "paper.unpublish",
    reason: "ordinary unpublish blocks new starts",
    nextStatus: "unpublished",
    allowFrom: ["published"]
  });
}

export async function withdrawPaper(input: {
  store: PaperWorkStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<PaperActionSuccess<ReturnType<typeof toAdminPaperView> & { startGate: ReturnType<typeof paperNewStartGate> }> | PaperActionFailure> {
  const parsed = parsePaperWithdrawInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_WITHDRAW", { issues: parsed.issues });
  return mutateStatus({
    ...input,
    paperId: parsed.paperId,
    expectedRevision: parsed.expectedRevision,
    action: "paper.withdraw",
    reason: parsed.reason,
    nextStatus: "withdrawn",
    allowFrom: ["published", "unpublished"],
    withdrawReason: parsed.reason
  });
}

async function mutateStatus(input: {
  store: PaperWorkStore;
  actorId: string;
  requestId: string;
  idempotencyKey: string;
  now: Date;
  paperId: string;
  expectedRevision: number;
  action: "paper.unpublish" | "paper.withdraw";
  reason: string;
  nextStatus: "unpublished" | "withdrawn";
  allowFrom: Array<PaperRecord["status"]>;
  withdrawReason?: string;
}): Promise<PaperActionSuccess<ReturnType<typeof toAdminPaperView> & { startGate: ReturnType<typeof paperNewStartGate> }> | PaperActionFailure> {
  const payload = { paperId: input.paperId, expectedRevision: input.expectedRevision, status: input.nextStatus };
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: input.action,
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  });
  const retried = await runWithTxRetry(() =>
    input.store.transactWrite({
      paperId: input.paperId,
      idempotencyId: idemRecord.id,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, payloadHash(payload), () => null);
        if (!replay.ok) return { result: null as never, error: { code: replay.code, reason: "IDEMPOTENCY_CONFLICT" } };
        if (replay.replayed) {
          const view = replay.result as ReturnType<typeof toAdminPaperView> & { startGate: ReturnType<typeof paperNewStartGate> };
          if (view) return { result: view };
        }
        if (!snap.paper) return { result: null as never, error: { code: "NOT_FOUND", reason: "PAPER_NOT_FOUND" } };
        if (snap.paper.revision !== input.expectedRevision) {
          return { result: null as never, error: { code: "VERSION_CONFLICT", reason: "EXPECTED_REVISION_MISMATCH" } };
        }
        if (!input.allowFrom.includes(snap.paper.status)) {
          return { result: null as never, error: { code: "INVALID_ARGUMENT", reason: "PAPER_STATUS_NOT_ALLOWED" } };
        }
        const next: PaperRecord = {
          ...snap.paper,
          status: input.nextStatus,
          withdrawReason: input.withdrawReason ?? snap.paper.withdrawReason,
          revision: snap.paper.revision + 1,
          updatedAt: input.now.toISOString()
        };
        const view = {
          ...toAdminPaperView(next, snap.activeVersion),
          startGate: paperNewStartGate(next.status),
          idempotencyId: idemRecord.id
        };
        const audit = buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: input.action,
          target: next.paperId,
          reason: input.reason,
          requestId: input.requestId,
          before: { status: snap.paper.status },
          after: { status: next.status },
          now: input.now
        });
        return {
          paper: next,
          idem: { ...idemRecord, status: "succeeded", resultRef: view },
          audit,
          result: view
        };
      }
    })
  );
  if (!retried.ok) return fail("SERVICE_BUSY", "PAPER_TX_RETRY_EXHAUSTED");
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  return { ok: true, data: retried.value.mutation.result, budget: retried.value.budget };
}
