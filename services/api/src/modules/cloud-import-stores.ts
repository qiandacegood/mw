import {
  sourceKeyDocId,
  type AuditEntry,
  type IdempotencyRecord,
  type ImportBatchRecord,
  type ImportIssue,
  type ImportKind,
  type ImportRowRecord,
  type ImportState,
  type SourceKeyRecord,
  type SourceKeyState
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { ImportWorkStore, ImportWriteSnapshot } from "./import-stores.js";

export const MW12_COLLECTIONS = {
  batches: "import_batches",
  rows: "import_rows",
  sourceKeys: "source_keys",
  idempotency: "idempotency",
  auditLogs: "audit_logs"
} as const;

function cloudApp() {
  const cloudbase = require("@cloudbase/node-sdk") as {
    init: (opts: { env: unknown }) => { database: () => CloudDb };
    SYMBOL_CURRENT_ENV: unknown;
  };
  return cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
}

type CloudColl = {
  doc: (id: string) => {
    get: () => Promise<unknown>;
    set: (data: Record<string, unknown>) => Promise<unknown>;
    update: (data: Record<string, unknown>) => Promise<unknown>;
  };
  where?: (query: Record<string, unknown>) => {
    orderBy?: (field: string, dir: string) => {
      limit: (n: number) => { get: () => Promise<unknown> };
    };
    limit: (n: number) => { get: () => Promise<unknown> };
  };
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

function asState(value: unknown): ImportState {
  if (value === "uploaded" || value === "validated" || value === "staging" || value === "committed" || value === "failed") {
    return value;
  }
  return "uploaded";
}

function asBatch(id: string, data: Record<string, unknown>): ImportBatchRecord {
  const now = new Date().toISOString();
  return {
    batchId: typeof data.batchId === "string" ? data.batchId : id,
    fileHash: typeof data.fileHash === "string" ? data.fileHash : "",
    kind: data.kind === "paper" ? "paper" : "question",
    state: asState(data.state),
    rowCount: typeof data.rowCount === "number" ? data.rowCount : 0,
    validationHash: typeof data.validationHash === "string" ? data.validationHash : "",
    catalogVersion: typeof data.catalogVersion === "number" ? data.catalogVersion : 0,
    columnSpec: typeof data.columnSpec === "string" ? data.columnSpec : "",
    previewHash: typeof data.previewHash === "string" ? data.previewHash : "",
    ticketId: typeof data.ticketId === "string" ? data.ticketId : "",
    assetId: typeof data.assetId === "string" ? data.assetId : "",
    errorCount: typeof data.errorCount === "number" ? data.errorCount : 0,
    warningCount: typeof data.warningCount === "number" ? data.warningCount : 0,
    targetCount: typeof data.targetCount === "number" ? data.targetCount : 0,
    leaseToken: typeof data.leaseToken === "string" ? data.leaseToken : "",
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now),
    updatedAt: asIso(data.updatedAt, now),
    committedAt: typeof data.committedAt === "string" ? data.committedAt : null
  };
}

function asRow(id: string, data: Record<string, unknown>): ImportRowRecord {
  return {
    rowId: typeof data.rowId === "string" ? data.rowId : id,
    batchId: typeof data.batchId === "string" ? data.batchId : "",
    rowNo: typeof data.rowNo === "number" ? data.rowNo : 0,
    sourceKey: typeof data.sourceKey === "string" ? data.sourceKey : "",
    targetId: typeof data.targetId === "string" ? data.targetId : "",
    normalizedData: data.normalizedData && typeof data.normalizedData === "object" ? (data.normalizedData as Record<string, unknown>) : {},
    errors: Array.isArray(data.errors) ? (data.errors as ImportIssue[]) : [],
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1
  };
}

function asKey(id: string, data: Record<string, unknown>): SourceKeyRecord {
  const state: SourceKeyState =
    data.state === "committed" || data.state === "failed" || data.state === "staging" ? data.state : "staging";
  return {
    sourceKeyId: typeof data.sourceKeyId === "string" ? data.sourceKeyId : id,
    kind: data.kind === "paper" ? "paper" : "question",
    sourceKey: typeof data.sourceKey === "string" ? data.sourceKey : "",
    targetId: typeof data.targetId === "string" ? data.targetId : "",
    batchId: typeof data.batchId === "string" ? data.batchId : "",
    state,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, new Date().toISOString())
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

async function queryList(collection: string, query: Record<string, unknown>, limit = 1000): Promise<Record<string, unknown>[]> {
  const coll = cloudApp().database().collection(collection);
  if (!coll.where) return [];
  try {
    const filtered = coll.where(query);
    const useRowOrder = collection === MW12_COLLECTIONS.rows && typeof filtered.orderBy === "function";
    const snap = useRowOrder
      ? await filtered.orderBy!("rowNo", "asc").limit(limit).get()
      : await filtered.limit(limit).get();
    return unwrapList(snap);
  } catch {
    return [];
  }
}

export function cloudImportWorkStore(): ImportWorkStore {
  return {
    async getBatch(batchId) {
      const snap = await cloudApp().database().collection(MW12_COLLECTIONS.batches).doc(batchId).get();
      const data = unwrapDoc(snap);
      return data ? asBatch(batchId, data) : undefined;
    },
    async getBatchByFileHash(kind, fileHash) {
      const rows = await queryList(MW12_COLLECTIONS.batches, { kind, fileHash }, 1);
      const first = rows[0];
      return first ? asBatch(typeof first._id === "string" ? first._id : String(first.batchId || ""), first) : undefined;
    },
    async getSourceKey(kind, sourceKey) {
      const id = sourceKeyDocId(kind, sourceKey);
      const snap = await cloudApp().database().collection(MW12_COLLECTIONS.sourceKeys).doc(id).get();
      const data = unwrapDoc(snap);
      return data ? asKey(id, data) : undefined;
    },
    async listRows(batchId) {
      const rows = await queryList(MW12_COLLECTIONS.rows, { batchId }, 1000);
      return rows
        .map((row) => asRow(typeof row._id === "string" ? row._id : String(row.rowId || ""), row))
        .sort((a, b) => a.rowNo - b.rowNo);
    },
    async listSourceKeys(batchId) {
      const rows = await queryList(MW12_COLLECTIONS.sourceKeys, { batchId }, 1000);
      return rows.map((row) => asKey(typeof row._id === "string" ? row._id : String(row.sourceKeyId || ""), row));
    },
    async listCommittedSourceKeys(kind: ImportKind) {
      const rows = await queryList(MW12_COLLECTIONS.sourceKeys, { kind, state: "committed" }, 1000);
      return rows.map((row) => asKey(typeof row._id === "string" ? row._id : String(row.sourceKeyId || ""), row));
    },
    async transactWrite(input) {
      const started = Date.now();
      let reads = 0;
      let writes = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        const batchSnap = input.batchId ? await tx.collection(MW12_COLLECTIONS.batches).doc(input.batchId).get() : undefined;
        if (input.batchId) reads += 1;
        const rowSnap = input.rowId ? await tx.collection(MW12_COLLECTIONS.rows).doc(input.rowId).get() : undefined;
        if (input.rowId) reads += 1;
        const keySnap = input.sourceKeyId
          ? await tx.collection(MW12_COLLECTIONS.sourceKeys).doc(input.sourceKeyId).get()
          : undefined;
        if (input.sourceKeyId) reads += 1;
        const idemSnap = await tx.collection(MW12_COLLECTIONS.idempotency).doc(input.idempotencyId).get();
        reads += 1;
        const snap: ImportWriteSnapshot = {
          batch: batchSnap && input.batchId && unwrapDoc(batchSnap) ? asBatch(input.batchId, unwrapDoc(batchSnap)!) : undefined,
          row: rowSnap && input.rowId && unwrapDoc(rowSnap) ? asRow(input.rowId, unwrapDoc(rowSnap)!) : undefined,
          sourceKey:
            keySnap && input.sourceKeyId && unwrapDoc(keySnap) ? asKey(input.sourceKeyId, unwrapDoc(keySnap)!) : undefined,
          idem: unwrapDoc(idemSnap) ? asIdem(input.idempotencyId, unwrapDoc(idemSnap)!) : undefined
        };
        const next = input.mutate(snap);
        if (next.batch) {
          writes += 1;
          await tx.collection(MW12_COLLECTIONS.batches).doc(next.batch.batchId).set({ ...next.batch });
        }
        if (next.row) {
          writes += 1;
          await tx.collection(MW12_COLLECTIONS.rows).doc(next.row.rowId).set({ ...next.row });
        }
        if (next.sourceKey) {
          writes += 1;
          await tx.collection(MW12_COLLECTIONS.sourceKeys).doc(next.sourceKey.sourceKeyId).set({ ...next.sourceKey });
        }
        if (next.idem) {
          writes += 1;
          await tx.collection(MW12_COLLECTIONS.idempotency).doc(input.idempotencyId).set({ ...next.idem, id: next.idem.id });
        }
        if (next.audit) {
          writes += 1;
          const { auditDocId } = await import("@mw/shared");
          await tx.collection(MW12_COLLECTIONS.auditLogs).doc(auditDocId(next.audit)).set({
            actorType: next.audit.actorType,
            actorId: next.audit.actorId,
            action: next.audit.action,
            target: next.audit.target,
            reason: next.audit.reason,
            requestId: next.audit.requestId,
            beforeHash: next.audit.beforeHash,
            afterHash: next.audit.afterHash,
            createdAt: next.audit.createdAt,
            schemaVersion: next.audit.schemaVersion
          } as Record<string, unknown>);
        }
        return next;
      });
      const budget: TxBudget = { reads, writes, total: reads + writes, elapsedMs: Date.now() - started };
      return { mutation, budget };
    }
  };
}
