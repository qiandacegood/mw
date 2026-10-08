import {
  CATALOG_DOC_ID,
  CATEGORY_SCHEMA_VERSION,
  IN_USE_MIGRATION_NOTE,
  INITIAL_ROOT_SEEDS,
  PARENT_CHANGE_NOTE,
  auditDocId,
  buildAuditEntry,
  buildIdempotencyRecord,
  categoryNameId,
  checkMaintenanceGate,
  defaultMaintenanceConfig,
  effectiveEnabled,
  emptyCatalog,
  newCategoryId,
  paperMayHangOnCategory,
  parseCategoryCreateInput,
  parseCategoryDeleteInput,
  parseCategoryUpdateInput,
  payloadHash,
  replayOrConflict,
  seedCategoryId,
  sortCategoryNodes,
  toPublicNode,
  validateParentAssignment,
  type AdminCategoryNode,
  type CatalogRecord,
  type CategoryRecord,
  type IdempotencyRecord,
  type MaintenanceConfig,
  type PublicCategoryNode
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type {
  CategoryUsageStore,
  CategoryWorkStore,
  CategoryWriteMutation
} from "./category-stores.js";

export const CATEGORY_TX_MAX_ATTEMPTS = 3;
export const CATEGORY_WRITE_CONCURRENCY_FIELD = "expectedTreeVersion";

const RETRYABLE_TX =
  /TX_CONFLICT|TRANSACTION_CONFLICT|DATABASE_TRANSACTION_CONFLICT|DOCUMENT_VERSION_CONFLICT|TRANSACTION_CONFLICTED|optimistic.?lock|write.?conflict|contention|please retry|try again/i;

export type CategoryActionFailure = {
  ok: false;
  code: string;
  reason: string;
  issues?: string[];
  details?: Record<string, unknown>;
};

export type CategoryActionSuccess<T> = {
  ok: true;
  data: T;
  replayed?: boolean;
  created?: boolean;
  budget: TxBudget;
};

export type CategoryTreeView = {
  treeVersion: number;
  unchanged?: boolean;
  nodes: PublicCategoryNode[] | AdminCategoryNode[];
  writeConcurrency: typeof CATEGORY_WRITE_CONCURRENCY_FIELD;
};

export type CategoryMutationView = {
  categoryId: string;
  parentId: string | null;
  depth: number;
  name: string;
  sort: number;
  enabled: boolean;
  revision: number;
  treeVersion: number;
  seedKey?: string;
  idempotencyId: string;
  auditId?: string;
};

function emptyBudget(): TxBudget {
  return { reads: 0, writes: 0, total: 0, elapsedMs: 0 };
}

function fail(code: string, reason: string, extra?: { issues?: string[]; details?: Record<string, unknown> }): CategoryActionFailure {
  return {
    ok: false,
    code,
    reason,
    ...(extra?.issues ? { issues: extra.issues } : {}),
    ...(extra?.details ? { details: extra.details } : {})
  };
}

export function isRetryableCategoryTxError(error: unknown): boolean {
  if (error == null) return false;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/CRASH_AFTER_/i.test(text)) return false;
  return RETRYABLE_TX.test(text);
}

async function runWithTxRetry<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CATEGORY_TX_MAX_ATTEMPTS; attempt += 1) {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      lastError = error;
      if (!isRetryableCategoryTxError(error) || attempt === CATEGORY_TX_MAX_ATTEMPTS) {
        return { ok: false, error };
      }
    }
  }
  return { ok: false, error: lastError };
}

function bumpCatalog(catalog: CatalogRecord, now: Date, extra: Partial<CatalogRecord> = {}): CatalogRecord {
  return {
    ...catalog,
    ...extra,
    treeVersion: catalog.treeVersion + 1,
    updatedAt: now.toISOString()
  };
}

function asAdminNode(node: CategoryRecord, byId: Map<string, CategoryRecord>): AdminCategoryNode {
  return {
    ...toPublicNode(node),
    categoryId: node.categoryId,
    ancestorIds: [...node.ancestorIds],
    normalizedName: node.normalizedName,
    revision: node.revision,
    effectiveEnabled: effectiveEnabled(node, byId),
    ...(node.seedKey ? { seedKey: node.seedKey } : {})
  };
}

export function buildPublicTree(nodes: CategoryRecord[], knownVersion?: number): CategoryTreeView {
  const byId = new Map(nodes.map((row) => [row.categoryId, row]));
  const treeVersion = nodes.reduce((max, row) => Math.max(max, row.treeVersion), 0);
  if (knownVersion !== undefined && knownVersion === treeVersion) {
    return { treeVersion, unchanged: true, nodes: [], writeConcurrency: CATEGORY_WRITE_CONCURRENCY_FIELD };
  }
  const visible = sortCategoryNodes(
    nodes
      .filter((row) => !row.deletedAt && effectiveEnabled(row, byId))
      .map((row) => toPublicNode(row))
  );
  return { treeVersion, nodes: visible, writeConcurrency: CATEGORY_WRITE_CONCURRENCY_FIELD };
}

export function buildAdminTree(nodes: CategoryRecord[], catalog: CatalogRecord): CategoryTreeView {
  const byId = new Map(nodes.map((row) => [row.categoryId, row]));
  const visible = sortCategoryNodes(nodes.filter((row) => !row.deletedAt).map((row) => asAdminNode(row, byId)));
  return {
    treeVersion: catalog.treeVersion,
    nodes: visible,
    writeConcurrency: CATEGORY_WRITE_CONCURRENCY_FIELD
  };
}

export async function readCategoryTree(
  store: CategoryWorkStore | undefined,
  input: { knownVersion?: unknown; publicView: boolean }
): Promise<CategoryActionSuccess<CategoryTreeView>> {
  if (!store) {
    return {
      ok: true,
      data: { treeVersion: 0, nodes: [], writeConcurrency: CATEGORY_WRITE_CONCURRENCY_FIELD },
      budget: emptyBudget()
    };
  }
  const knownVersion = typeof input.knownVersion === "number" ? input.knownVersion : undefined;
  const [catalog, nodes] = await Promise.all([store.getCatalog(), store.listActive()]);
  const tree = input.publicView ? buildPublicTree(nodes, knownVersion) : buildAdminTree(nodes, catalog);
  if (!input.publicView) {
    tree.treeVersion = catalog.treeVersion;
  } else if (!nodes.length) {
    tree.treeVersion = catalog.treeVersion;
  } else {
    tree.treeVersion = catalog.treeVersion;
  }
  if (input.publicView && knownVersion !== undefined && knownVersion === catalog.treeVersion) {
    return {
      ok: true,
      data: { treeVersion: catalog.treeVersion, unchanged: true, nodes: [], writeConcurrency: CATEGORY_WRITE_CONCURRENCY_FIELD },
      budget: emptyBudget()
    };
  }
  return { ok: true, data: { ...tree, treeVersion: catalog.treeVersion }, budget: emptyBudget() };
}

export function contentWritesBlocked(config: MaintenanceConfig | undefined): CategoryActionFailure | undefined {
  const checked = checkMaintenanceGate(config || defaultMaintenanceConfig(new Date()), "contentWrites");
  if (checked.allowed) return undefined;
  return fail("CONTENT_UPDATING", checked.reason || "CONTENT_WRITES_CLOSED", {
    details: { gate: "contentWrites", jobId: checked.jobId }
  });
}

function replayView(resultRef: unknown): CategoryMutationView | undefined {
  if (!resultRef || typeof resultRef !== "object") return undefined;
  const rec = resultRef as CategoryMutationView;
  if (typeof rec.categoryId !== "string") return undefined;
  return rec;
}

function seedRows(now: Date, treeVersion: number): { categories: CategoryRecord[]; names: NonNullable<CategoryWriteMutation<unknown>["extraNameSlots"]> } {
  const at = now.toISOString();
  const categories: CategoryRecord[] = [];
  const names: { nameId: string; parentId: string; normalizedName: string; categoryId: string }[] = [];
  INITIAL_ROOT_SEEDS.forEach((seed, index) => {
    const categoryId = seedCategoryId(seed.seedKey);
    const normalizedName = seed.name;
    categories.push({
      categoryId,
      parentId: null,
      depth: 1,
      ancestorIds: [],
      name: seed.name,
      normalizedName,
      sort: (index + 1) * 10,
      enabled: true,
      deletedAt: null,
      revision: 1,
      treeVersion,
      seedKey: seed.seedKey,
      schemaVersion: CATEGORY_SCHEMA_VERSION,
      createdAt: at,
      updatedAt: at
    });
    names.push({
      nameId: categoryNameId(null, normalizedName),
      parentId: "",
      normalizedName,
      categoryId
    });
  });
  return { categories, names };
}

export async function seedInitialCategories(input: {
  store: CategoryWorkStore;
  actorId: string;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<CategoryActionSuccess<{ seeded: boolean; created: number; treeVersion: number; seedIds: string[] }> | CategoryActionFailure> {
  const payload = { action: "category.seed" };
  const idempotencyId = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "category.seed",
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  }).id;
  const retried = await runWithTxRetry(() =>
    input.store.transactWrite({
      idempotencyId,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, payloadHash(payload), () => null);
        if (!replay.ok) {
          return { result: null, error: { code: replay.code, reason: "IDEMPOTENCY_CONFLICT" } };
        }
        if (replay.replayed && snap.idem?.resultRef && typeof snap.idem.resultRef === "object") {
          return {
            result: snap.idem.resultRef as { seeded: boolean; created: number; treeVersion: number; seedIds: string[] },
            error: undefined
          };
        }
        const created: CategoryRecord[] = [];
        const names = [];
        const planned = seedRows(input.now, snap.catalog.treeVersion + 1);
        return finishSeed(snap, planned, input, payload);
      }
    })
  );
  if (!retried.ok) {
    return fail("SERVICE_BUSY", "CATEGORY_TX_RETRY_EXHAUSTED");
  }
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  const data = retried.value.mutation.result as {
    seeded: boolean;
    created: number;
    treeVersion: number;
    seedIds: string[];
  };
  return { ok: true, data, replayed: false, created: data.created > 0, budget: retried.value.budget };
}

function finishSeed(
  snap: {
    catalog: CatalogRecord;
    all: CategoryRecord[];
    names: { nameId: string; categoryId: string }[];
    idem?: IdempotencyRecord;
  },
  planned: ReturnType<typeof seedRows>,
  input: { actorId: string; requestId: string; now: Date; idempotencyKey: string },
  payload: unknown
): CategoryWriteMutation<{ seeded: boolean; created: number; treeVersion: number; seedIds: string[] }> {
  const existingIds = new Set(snap.all.map((row) => row.categoryId));
  const extraCategories: CategoryRecord[] = [];
  const extraNameSlots: { nameId: string; parentId: string; normalizedName: string; categoryId: string }[] = [];
  if (!snap.catalog.seeded) {
    for (const row of planned.categories) {
      if (existingIds.has(row.categoryId)) continue;
      extraCategories.push(row);
    }
    const usedNames = new Set(snap.names.map((row) => row.nameId));
    for (const row of planned.names) {
      if (existingIds.has(row.categoryId) || usedNames.has(row.nameId)) continue;
      extraNameSlots.push(row);
    }
  }
  const already = snap.catalog.seeded || extraCategories.length === 0 && planned.categories.every((row) => existingIds.has(row.categoryId));
  const catalog = already && snap.catalog.seeded
    ? snap.catalog
    : bumpCatalog(snap.catalog, input.now, {
        seeded: true,
        seededAt: snap.catalog.seededAt || input.now.toISOString()
      });
  for (const row of extraCategories) {
    row.treeVersion = catalog.treeVersion;
  }
  const result = {
    seeded: true,
    created: extraCategories.length,
    treeVersion: catalog.treeVersion,
    seedIds: planned.categories.map((row) => row.categoryId)
  };
  return {
    ...(catalog === snap.catalog ? {} : { catalog }),
    extraCategories: extraCategories.length ? extraCategories : undefined,
    extraNameSlots: extraNameSlots.length ? extraNameSlots : undefined,
    idem: buildIdempotencyRecord({
      actorId: input.actorId,
      action: "category.seed",
      idempotencyKey: input.idempotencyKey,
      payload,
      requestId: input.requestId,
      status: "succeeded",
      resultRef: result
    }),
    ...(extraCategories.length || !snap.catalog.seeded
      ? {
          audit: buildAuditEntry({
            actorType: "admin",
            actorId: input.actorId,
            action: "category.seed",
            target: CATALOG_DOC_ID,
            reason: "seed initial roots",
            requestId: input.requestId,
            before: { seeded: snap.catalog.seeded, treeVersion: snap.catalog.treeVersion },
            after: { seeded: true, created: extraCategories.length, treeVersion: catalog.treeVersion },
            now: input.now
          })
        }
      : {}),
    result
  };
}

export async function createCategory(input: {
  store: CategoryWorkStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<CategoryActionSuccess<CategoryMutationView> | CategoryActionFailure> {
  const parsed = parseCategoryCreateInput(input.data);
  if (!parsed.ok) {
    return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_CREATE", { issues: parsed.issues });
  }
  const categoryId = newCategoryId(input.actorId, input.idempotencyKey);
  const nameId = categoryNameId(parsed.parentId, parsed.normalizedName);
  const payload = {
    name: parsed.name,
    parentId: parsed.parentId,
    sort: parsed.sort,
    enabled: parsed.enabled,
    expectedTreeVersion: parsed.expectedTreeVersion
  };
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "category.create",
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  });
  const retried = await runWithTxRetry(() =>
    input.store.transactWrite({
      categoryId,
      parentId: parsed.parentId,
      nameId,
      idempotencyId: idemRecord.id,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, payloadHash(payload), () => null);
        if (!replay.ok) {
          return { result: null as unknown as CategoryMutationView, error: { code: replay.code, reason: "IDEMPOTENCY_CONFLICT" } };
        }
        if (replay.replayed) {
          const view = replayView(snap.idem?.resultRef);
          if (view) return { result: view };
        }
        if (snap.catalog.treeVersion !== parsed.expectedTreeVersion) {
          return {
            result: null as unknown as CategoryMutationView,
            error: { code: "VERSION_CONFLICT", reason: "TREE_VERSION_MISMATCH" }
          };
        }
        const assigned = validateParentAssignment({
          categoryId,
          parentId: parsed.parentId,
          parent: snap.parent
        });
        if (!assigned.ok) {
          const code = assigned.code === "PARENT_MISSING" ? "INVALID_ARGUMENT" : assigned.code;
          return {
            result: null as unknown as CategoryMutationView,
            error: { code, reason: assigned.code }
          };
        }
        if (snap.nameSlot) {
          return {
            result: null as unknown as CategoryMutationView,
            error: { code: "INVALID_ARGUMENT", reason: "NAME_CONFLICT" }
          };
        }
        const at = input.now.toISOString();
        const catalog = bumpCatalog(snap.catalog, input.now);
        const category: CategoryRecord = {
          categoryId,
          parentId: parsed.parentId,
          depth: assigned.depth,
          ancestorIds: assigned.ancestorIds,
          name: parsed.name,
          normalizedName: parsed.normalizedName,
          sort: parsed.sort,
          enabled: parsed.enabled,
          deletedAt: null,
          revision: 1,
          treeVersion: catalog.treeVersion,
          schemaVersion: CATEGORY_SCHEMA_VERSION,
          createdAt: at,
          updatedAt: at
        };
        const view: CategoryMutationView = {
          categoryId,
          parentId: category.parentId,
          depth: category.depth,
          name: category.name,
          sort: category.sort,
          enabled: category.enabled,
          revision: category.revision,
          treeVersion: catalog.treeVersion,
          idempotencyId: idemRecord.id
        };
        const audit = buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: "category.create",
          target: categoryId,
          reason: "create category",
          requestId: input.requestId,
          before: null,
          after: { categoryId, depth: category.depth, name: category.name },
          now: input.now
        });
        view.auditId = auditDocId(audit);
        return {
          catalog,
          category,
          nameSlot: {
            nameId,
            parentId: parsed.parentId || "",
            normalizedName: parsed.normalizedName,
            categoryId
          },
          idem: { ...idemRecord, status: "succeeded", resultRef: view },
          audit,
          result: view
        };
      }
    })
  );
  if (!retried.ok) return fail("SERVICE_BUSY", "CATEGORY_TX_RETRY_EXHAUSTED");
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  return {
    ok: true,
    data: retried.value.mutation.result,
    replayed: false,
    created: true,
    budget: retried.value.budget
  };
}

export async function updateCategory(input: {
  store: CategoryWorkStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<CategoryActionSuccess<CategoryMutationView> | CategoryActionFailure> {
  const parsed = parseCategoryUpdateInput(input.data);
  if (!parsed.ok) {
    return fail("INVALID_ARGUMENT", parsed.reason || parsed.issues[0] || "INVALID_UPDATE", {
      issues: parsed.issues,
      details: parsed.reason ? { reason: parsed.reason, note: PARENT_CHANGE_NOTE } : undefined
    });
  }
  const payload = {
    categoryId: parsed.categoryId,
    name: parsed.name,
    sort: parsed.sort,
    enabled: parsed.enabled,
    expectedTreeVersion: parsed.expectedTreeVersion
  };
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "category.update",
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  });
  const retried = await runWithTxRetry(() =>
    input.store.transactWrite({
      categoryId: parsed.categoryId,
      idempotencyId: idemRecord.id,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, payloadHash(payload), () => null);
        if (!replay.ok) {
          return { result: null as unknown as CategoryMutationView, error: { code: replay.code, reason: "IDEMPOTENCY_CONFLICT" } };
        }
        if (replay.replayed) {
          const view = replayView(snap.idem?.resultRef);
          if (view) return { result: view };
        }
        if (!snap.category || snap.category.deletedAt) {
          return { result: null as unknown as CategoryMutationView, error: { code: "NOT_FOUND", reason: "CATEGORY_NOT_FOUND" } };
        }
        if (snap.catalog.treeVersion !== parsed.expectedTreeVersion) {
          return { result: null as unknown as CategoryMutationView, error: { code: "VERSION_CONFLICT", reason: "TREE_VERSION_MISMATCH" } };
        }
        const nextNameId =
          parsed.normalizedName && parsed.normalizedName !== snap.category.normalizedName
            ? categoryNameId(snap.category.parentId, parsed.normalizedName)
            : undefined;
        const occupied = nextNameId ? snap.names.find((row) => row.nameId === nextNameId) : undefined;
        if (occupied && occupied.categoryId !== snap.category.categoryId) {
          return { result: null as unknown as CategoryMutationView, error: { code: "INVALID_ARGUMENT", reason: "NAME_CONFLICT" } };
        }
        const catalog = bumpCatalog(snap.catalog, input.now);
        const next: CategoryRecord = {
          ...snap.category,
          name: parsed.name ?? snap.category.name,
          normalizedName: parsed.normalizedName ?? snap.category.normalizedName,
          sort: parsed.sort ?? snap.category.sort,
          enabled: parsed.enabled ?? snap.category.enabled,
          revision: snap.category.revision + 1,
          treeVersion: catalog.treeVersion,
          updatedAt: input.now.toISOString()
        };
        const view: CategoryMutationView = {
          categoryId: next.categoryId,
          parentId: next.parentId,
          depth: next.depth,
          name: next.name,
          sort: next.sort,
          enabled: next.enabled,
          revision: next.revision,
          treeVersion: catalog.treeVersion,
          ...(next.seedKey ? { seedKey: next.seedKey } : {}),
          idempotencyId: idemRecord.id
        };
        const audit = buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: "category.update",
          target: next.categoryId,
          reason: "update category",
          requestId: input.requestId,
          before: { name: snap.category.name, sort: snap.category.sort, enabled: snap.category.enabled },
          after: { name: next.name, sort: next.sort, enabled: next.enabled },
          now: input.now
        });
        view.auditId = auditDocId(audit);
        const oldNameId =
          parsed.normalizedName && parsed.normalizedName !== snap.category.normalizedName
            ? categoryNameId(snap.category.parentId, snap.category.normalizedName)
            : undefined;
        return {
          catalog,
          category: next,
          removeNameId: oldNameId,
          nameSlot: nextNameId
            ? {
                nameId: nextNameId,
                parentId: next.parentId || "",
                normalizedName: next.normalizedName,
                categoryId: next.categoryId
              }
            : undefined,
          idem: { ...idemRecord, status: "succeeded", resultRef: view },
          audit,
          result: view
        };
      }
    })
  );
  if (!retried.ok) return fail("SERVICE_BUSY", "CATEGORY_TX_RETRY_EXHAUSTED");
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  return { ok: true, data: retried.value.mutation.result, budget: retried.value.budget };
}

export async function deleteCategory(input: {
  store: CategoryWorkStore;
  usage: CategoryUsageStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<CategoryActionSuccess<CategoryMutationView> | CategoryActionFailure> {
  const parsed = parseCategoryDeleteInput(input.data);
  if (!parsed.ok) {
    return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_DELETE", { issues: parsed.issues });
  }
  const refs = input.usage.refsFor(parsed.categoryId);
  const payload = {
    categoryId: parsed.categoryId,
    expectedTreeVersion: parsed.expectedTreeVersion
  };
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "category.delete",
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  });
  const retried = await runWithTxRetry(() =>
    input.store.transactWrite({
      categoryId: parsed.categoryId,
      idempotencyId: idemRecord.id,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, payloadHash(payload), () => null);
        if (!replay.ok) {
          return { result: null as unknown as CategoryMutationView, error: { code: replay.code, reason: "IDEMPOTENCY_CONFLICT" } };
        }
        if (replay.replayed) {
          const view = replayView(snap.idem?.resultRef);
          if (view) return { result: view };
        }
        if (!snap.category || snap.category.deletedAt) {
          return { result: null as unknown as CategoryMutationView, error: { code: "NOT_FOUND", reason: "CATEGORY_NOT_FOUND" } };
        }
        if (snap.catalog.treeVersion !== parsed.expectedTreeVersion) {
          return { result: null as unknown as CategoryMutationView, error: { code: "VERSION_CONFLICT", reason: "TREE_VERSION_MISMATCH" } };
        }
        const hasChildren = snap.children.length > 0;
        if (hasChildren || refs.paperRefs > 0 || refs.questionRefs > 0) {
          return {
            result: null as unknown as CategoryMutationView,
            error: {
              code: "CATEGORY_IN_USE",
              reason: "CATEGORY_IN_USE",
              details: {
                hasChildren,
                hasQuestionRefs: refs.questionRefs > 0,
                hasPaperRefs: refs.paperRefs > 0,
                note: IN_USE_MIGRATION_NOTE
              }
            }
          };
        }
        const catalog = bumpCatalog(snap.catalog, input.now);
        const next: CategoryRecord = {
          ...snap.category,
          deletedAt: input.now.toISOString(),
          revision: snap.category.revision + 1,
          treeVersion: catalog.treeVersion,
          updatedAt: input.now.toISOString()
        };
        const view: CategoryMutationView = {
          categoryId: next.categoryId,
          parentId: next.parentId,
          depth: next.depth,
          name: next.name,
          sort: next.sort,
          enabled: next.enabled,
          revision: next.revision,
          treeVersion: catalog.treeVersion,
          idempotencyId: idemRecord.id
        };
        const audit = buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: "category.delete",
          target: next.categoryId,
          reason: parsed.reason,
          requestId: input.requestId,
          before: { deletedAt: null, name: snap.category.name },
          after: { deletedAt: next.deletedAt },
          now: input.now
        });
        view.auditId = auditDocId(audit);
        return {
          catalog,
          category: next,
          removeNameId: categoryNameId(snap.category.parentId, snap.category.normalizedName),
          idem: { ...idemRecord, status: "succeeded", resultRef: view },
          audit,
          result: view
        };
      }
    })
  );
  if (!retried.ok) return fail("SERVICE_BUSY", "CATEGORY_TX_RETRY_EXHAUSTED");
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  return { ok: true, data: retried.value.mutation.result, budget: retried.value.budget };
}

export function hangablePaperFixture(
  nodes: CategoryRecord[]
): { ok: true; papers: ReturnType<typeof import("@mw/shared").fictionalPapersOnEachLevel> } | { ok: false } {
  const l1 = nodes.find((row) => row.depth === 1 && !row.deletedAt);
  const l2 = nodes.find((row) => row.depth === 2 && !row.deletedAt);
  const l3 = nodes.find((row) => row.depth === 3 && !row.deletedAt);
  if (!l1 || !l2 || !l3) return { ok: false };
  if (!paperMayHangOnCategory(l1) || !paperMayHangOnCategory(l2) || !paperMayHangOnCategory(l3)) {
    return { ok: false };
  }
  return {
    ok: true,
    papers: [
      { paperId: "paper_fict_logic_l1", categoryId: l1.categoryId, title: "逻辑入门练习（虚构）" },
      { paperId: "paper_fict_logic_l2", categoryId: l2.categoryId, title: "演绎推理练习（虚构）" },
      { paperId: "paper_fict_logic_l3", categoryId: l3.categoryId, title: "条件判断练习（虚构）" }
    ]
  };
}
