import {
  CATALOG_DOC_ID,
  emptyCatalog,
  type AuditEntry,
  type CatalogRecord,
  type CategoryNameRecord,
  type CategoryRecord,
  type IdempotencyRecord
} from "@mw/shared";
import { auditDocId } from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { CategoryReadStore, CategoryUsageStore, CategoryWorkStore, CategoryWriteSnapshot } from "./category-stores.js";

export const MW09_COLLECTIONS = {
  categories: "categories",
  categoryNames: "category_names",
  appConfig: "app_config",
  idempotency: "idempotency",
  auditLogs: "audit_logs"
} as const;

function cloudApp() {
  const cloudbase = require("@cloudbase/node-sdk") as {
    init: (opts: { env: unknown }) => {
      database: () => CloudDb;
    };
    SYMBOL_CURRENT_ENV: unknown;
  };
  return cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
}

type CloudColl = {
  doc: (id: string) => {
    get: () => Promise<unknown>;
    set: (data: Record<string, unknown>) => Promise<unknown>;
    update: (data: Record<string, unknown>) => Promise<unknown>;
    remove?: () => Promise<unknown>;
  };
  limit?: (n: number) => { get: () => Promise<unknown> };
  get?: () => Promise<unknown>;
  add?: (data: Record<string, unknown>) => Promise<unknown>;
};

type CloudDb = {
  collection: (name: string) => CloudColl;
  runTransaction: <T>(fn: (tx: CloudDb) => Promise<T>) => Promise<T>;
};

function unwrapDoc(snap: unknown): Record<string, unknown> | undefined {
  if (!snap || typeof snap !== "object") return undefined;
  const rec = snap as Record<string, unknown>;
  if (rec.data && typeof rec.data === "object" && !Array.isArray(rec.data)) {
    const inner = rec.data as Record<string, unknown>;
    if (Array.isArray(inner.data)) {
      const first = inner.data[0];
      return first && typeof first === "object" ? (first as Record<string, unknown>) : undefined;
    }
    if (Object.keys(inner).length === 0) return undefined;
    return inner;
  }
  if (Array.isArray(rec.data)) {
    const first = rec.data[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : undefined;
  }
  return undefined;
}

function unwrapList(snap: unknown): Record<string, unknown>[] {
  if (!snap || typeof snap !== "object") return [];
  const rec = snap as Record<string, unknown>;
  if (Array.isArray(rec.data)) {
    return rec.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (rec.data && typeof rec.data === "object") {
    const inner = rec.data as Record<string, unknown>;
    if (Array.isArray(inner.data)) {
      return inner.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    }
  }
  return [];
}

function asIso(value: unknown, fallback: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return fallback;
}

function asCatalog(data: Record<string, unknown> | undefined, now: Date): CatalogRecord {
  const fallback = emptyCatalog(now);
  if (!data) return fallback;
  return {
    treeVersion: typeof data.treeVersion === "number" ? data.treeVersion : fallback.treeVersion,
    categoryMetricsGeneration:
      typeof data.categoryMetricsGeneration === "number" ? data.categoryMetricsGeneration : 0,
    seeded: data.seeded === true,
    seededAt: typeof data.seededAt === "string" ? data.seededAt : null,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    updatedAt: asIso(data.updatedAt, fallback.updatedAt)
  };
}

function asCategory(id: string, data: Record<string, unknown>): CategoryRecord {
  const now = new Date().toISOString();
  const ancestors = Array.isArray(data.ancestorIds)
    ? data.ancestorIds.filter((item): item is string => typeof item === "string")
    : [];
  return {
    categoryId: typeof data.categoryId === "string" ? data.categoryId : id,
    parentId: typeof data.parentId === "string" && data.parentId.length > 0 ? data.parentId : null,
    depth: typeof data.depth === "number" ? data.depth : 1,
    ancestorIds: ancestors,
    name: typeof data.name === "string" ? data.name : "",
    normalizedName: typeof data.normalizedName === "string" ? data.normalizedName : "",
    sort: typeof data.sort === "number" ? data.sort : 10,
    enabled: data.enabled !== false,
    deletedAt: typeof data.deletedAt === "string" && data.deletedAt ? data.deletedAt : null,
    revision: typeof data.revision === "number" ? data.revision : 1,
    treeVersion: typeof data.treeVersion === "number" ? data.treeVersion : 0,
    seedKey: typeof data.seedKey === "string" ? data.seedKey : undefined,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now),
    updatedAt: asIso(data.updatedAt, now)
  };
}

function asName(id: string, data: Record<string, unknown>): CategoryNameRecord {
  return {
    nameId: typeof data.nameId === "string" ? data.nameId : id,
    parentId: typeof data.parentId === "string" ? data.parentId : "",
    normalizedName: typeof data.normalizedName === "string" ? data.normalizedName : "",
    categoryId: typeof data.categoryId === "string" ? data.categoryId : ""
  };
}

function asIdem(id: string, data: Record<string, unknown>): IdempotencyRecord {
  return {
    id,
    actorId: typeof data.actorId === "string" ? data.actorId : "",
    action: typeof data.action === "string" ? data.action : "",
    idempotencyKey: typeof data.idempotencyKey === "string" ? data.idempotencyKey : "",
    payloadHash: typeof data.payloadHash === "string" ? data.payloadHash : "",
    status:
      data.status === "succeeded" || data.status === "conflict" || data.status === "pending" || data.status === "failed"
        ? data.status
        : "pending",
    resultRef: data.resultRef ?? null,
    requestId: typeof data.requestId === "string" ? data.requestId : ""
  };
}

function categoryWrite(row: CategoryRecord): Record<string, unknown> {
  return {
    categoryId: row.categoryId,
    parentId: row.parentId,
    depth: row.depth,
    ancestorIds: row.ancestorIds,
    name: row.name,
    normalizedName: row.normalizedName,
    sort: row.sort,
    enabled: row.enabled,
    deletedAt: row.deletedAt,
    revision: row.revision,
    treeVersion: row.treeVersion,
    ...(row.seedKey ? { seedKey: row.seedKey } : {}),
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function nameWrite(row: CategoryNameRecord): Record<string, unknown> {
  return {
    nameId: row.nameId,
    parentId: row.parentId,
    normalizedName: row.normalizedName,
    categoryId: row.categoryId
  };
}

function catalogWrite(row: CatalogRecord): Record<string, unknown> {
  return {
    kind: "catalog",
    treeVersion: row.treeVersion,
    categoryMetricsGeneration: row.categoryMetricsGeneration,
    seeded: row.seeded,
    seededAt: row.seededAt,
    schemaVersion: row.schemaVersion,
    updatedAt: row.updatedAt
  };
}

function idemWrite(record: IdempotencyRecord, existing: boolean): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    actorId: record.actorId,
    action: record.action,
    idempotencyKey: record.idempotencyKey,
    payloadHash: record.payloadHash,
    status: record.status,
    resultRef: record.resultRef,
    requestId: record.requestId,
    schemaVersion: 1,
    updatedAt: now,
    ...(existing ? {} : { createdAt: now })
  };
}

function auditWrite(entry: AuditEntry): Record<string, unknown> {
  return {
    actorType: entry.actorType,
    actorId: entry.actorId,
    action: entry.action,
    target: entry.target,
    reason: entry.reason,
    requestId: entry.requestId,
    beforeHash: entry.beforeHash,
    afterHash: entry.afterHash,
    createdAt: entry.createdAt,
    schemaVersion: entry.schemaVersion
  };
}

async function listCollection(db: CloudDb, name: string): Promise<Record<string, unknown>[]> {
  const coll = db.collection(name);
  const snap = coll.limit ? await coll.limit(200).get() : coll.get ? await coll.get() : { data: [] };
  return unwrapList(snap);
}

export function cloudCategoryUsageStore(): CategoryUsageStore {
  return {
    refsFor() {
      return { questionRefs: 0, paperRefs: 0 };
    },
    setPaperRefs() {
      /* MW09 does not persist papers */
    },
    setQuestionRefs() {
      /* MW09 does not persist questions */
    }
  };
}

export function cloudCategoryReadStore(): CategoryReadStore {
  return {
    async getCatalog() {
      const snap = await cloudApp().database().collection(MW09_COLLECTIONS.appConfig).doc(CATALOG_DOC_ID).get();
      return asCatalog(unwrapDoc(snap), new Date());
    },
    async getCategory(categoryId) {
      const snap = await cloudApp().database().collection(MW09_COLLECTIONS.categories).doc(categoryId).get();
      const data = unwrapDoc(snap);
      return data ? asCategory(categoryId, data) : undefined;
    },
    async listActive() {
      const rows = await listCollection(cloudApp().database(), MW09_COLLECTIONS.categories);
      return rows
        .map((row) => asCategory(typeof row._id === "string" ? row._id : String(row.categoryId || ""), row))
        .filter((row) => !row.deletedAt);
    }
  };
}

export function cloudCategoryWorkStore(): CategoryWorkStore {
  const reads = cloudCategoryReadStore();
  return {
    getCatalog: reads.getCatalog,
    getCategory: reads.getCategory,
    listActive: reads.listActive,
    async transactWrite(input) {
      const started = Date.now();
      let readCount = 0;
      let writeCount = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        const catalogSnap = await tx.collection(MW09_COLLECTIONS.appConfig).doc(CATALOG_DOC_ID).get();
        const idemSnap = await tx.collection(MW09_COLLECTIONS.idempotency).doc(input.idempotencyId).get();
        readCount += 2;
        const categorySnap = input.categoryId
          ? await tx.collection(MW09_COLLECTIONS.categories).doc(input.categoryId).get()
          : undefined;
        const parentSnap =
          input.parentId && input.parentId.length > 0
            ? await tx.collection(MW09_COLLECTIONS.categories).doc(input.parentId).get()
            : undefined;
        const nameSnap = input.nameId
          ? await tx.collection(MW09_COLLECTIONS.categoryNames).doc(input.nameId).get()
          : undefined;
        const nextNameSnap = input.nextNameId
          ? await tx.collection(MW09_COLLECTIONS.categoryNames).doc(input.nextNameId).get()
          : undefined;
        if (input.categoryId) readCount += 1;
        if (input.parentId) readCount += 1;
        if (input.nameId) readCount += 1;
        if (input.nextNameId) readCount += 1;
        const allRows = await listCollection(tx, MW09_COLLECTIONS.categories);
        const nameRows = await listCollection(tx, MW09_COLLECTIONS.categoryNames);
        readCount += allRows.length + nameRows.length;
        const all = allRows.map((row) =>
          asCategory(typeof row._id === "string" ? row._id : String(row.categoryId || ""), row)
        );
        const names = nameRows.map((row) =>
          asName(typeof row._id === "string" ? row._id : String(row.nameId || ""), row)
        );
        const categoryData = categorySnap ? unwrapDoc(categorySnap) : undefined;
        const parentData = parentSnap ? unwrapDoc(parentSnap) : undefined;
        const nameData = nameSnap ? unwrapDoc(nameSnap) : undefined;
        const nextNameData = nextNameSnap ? unwrapDoc(nextNameSnap) : undefined;
        const idemData = unwrapDoc(idemSnap);
        const snap: CategoryWriteSnapshot = {
          catalog: asCatalog(unwrapDoc(catalogSnap), new Date()),
          category: categoryData && input.categoryId ? asCategory(input.categoryId, categoryData) : undefined,
          parent: parentData && input.parentId ? asCategory(input.parentId, parentData) : undefined,
          nameSlot: nameData && input.nameId ? asName(input.nameId, nameData) : undefined,
          nextNameSlot: nextNameData && input.nextNameId ? asName(input.nextNameId, nextNameData) : undefined,
          children: input.categoryId
            ? all.filter((row) => row.parentId === input.categoryId && !row.deletedAt)
            : [],
          all,
          names,
          idem: idemData ? asIdem(input.idempotencyId, idemData) : undefined
        };
        const next = input.mutate(snap);
        if (next.catalog) {
          writeCount += 1;
          await tx.collection(MW09_COLLECTIONS.appConfig).doc(CATALOG_DOC_ID).set(catalogWrite(next.catalog));
        }
        if (next.category) {
          writeCount += 1;
          await tx.collection(MW09_COLLECTIONS.categories).doc(next.category.categoryId).set(categoryWrite(next.category));
        }
        for (const extra of next.extraCategories || []) {
          writeCount += 1;
          await tx.collection(MW09_COLLECTIONS.categories).doc(extra.categoryId).set(categoryWrite(extra));
        }
        if (next.removeNameId) {
          writeCount += 1;
          const doc = tx.collection(MW09_COLLECTIONS.categoryNames).doc(next.removeNameId);
          if (doc.remove) await doc.remove();
          else await doc.set({ removed: true, nameId: next.removeNameId });
        }
        if (next.nameSlot) {
          writeCount += 1;
          await tx.collection(MW09_COLLECTIONS.categoryNames).doc(next.nameSlot.nameId).set(nameWrite(next.nameSlot));
        }
        for (const extra of next.extraNameSlots || []) {
          writeCount += 1;
          await tx.collection(MW09_COLLECTIONS.categoryNames).doc(extra.nameId).set(nameWrite(extra));
        }
        if (next.idem) {
          writeCount += 1;
          const body = idemWrite(next.idem, Boolean(idemData));
          if (idemData) {
            await tx.collection(MW09_COLLECTIONS.idempotency).doc(input.idempotencyId).update(body);
          } else {
            await tx.collection(MW09_COLLECTIONS.idempotency).doc(input.idempotencyId).set(body);
          }
        }
        if (next.audit) {
          writeCount += 1;
          await tx.collection(MW09_COLLECTIONS.auditLogs).doc(auditDocId(next.audit)).set(auditWrite(next.audit));
        }
        return next;
      });
      const budget: TxBudget = {
        reads: readCount,
        writes: writeCount,
        total: readCount + writeCount,
        elapsedMs: Date.now() - started
      };
      return { mutation, budget };
    }
  };
}
