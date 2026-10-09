import type {
  AuditEntry,
  IdempotencyRecord,
  ImportBatchRecord,
  ImportKind,
  ImportRowRecord,
  SourceKeyRecord
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";

export type ImportWriteSnapshot = {
  batch?: ImportBatchRecord;
  row?: ImportRowRecord;
  sourceKey?: SourceKeyRecord;
  idem?: IdempotencyRecord;
};

export type ImportWriteMutation<T> = {
  batch?: ImportBatchRecord;
  row?: ImportRowRecord;
  sourceKey?: SourceKeyRecord;
  removeRowId?: string;
  removeSourceKeyId?: string;
  removeQuestionId?: string;
  removePaperId?: string;
  idem?: IdempotencyRecord;
  audit?: AuditEntry;
  result: T;
  error?: { code: string; reason: string; issues?: string[]; details?: Record<string, unknown> };
};

export interface ImportVisibilityStore {
  getBatch(batchId: string): Promise<ImportBatchRecord | undefined>;
  getSourceKey(kind: ImportKind, sourceKey: string): Promise<SourceKeyRecord | undefined>;
}

export interface ImportWorkStore extends ImportVisibilityStore {
  getBatchByFileHash(kind: ImportKind, fileHash: string): Promise<ImportBatchRecord | undefined>;
  listRows(batchId: string): Promise<ImportRowRecord[]>;
  listSourceKeys(batchId: string): Promise<SourceKeyRecord[]>;
  listCommittedSourceKeys(kind: ImportKind): Promise<SourceKeyRecord[]>;
  transactWrite<T>(input: {
    batchId?: string;
    rowId?: string;
    sourceKeyId?: string;
    idempotencyId: string;
    mutate: (snap: ImportWriteSnapshot) => ImportWriteMutation<T>;
  }): Promise<{ mutation: ImportWriteMutation<T>; budget: TxBudget }>;
}

function cloneBatch(row: ImportBatchRecord): ImportBatchRecord {
  return { ...row };
}

function cloneRow(row: ImportRowRecord): ImportRowRecord {
  return { ...row, normalizedData: { ...row.normalizedData }, errors: row.errors.map((item) => ({ ...item })) };
}

function cloneKey(row: SourceKeyRecord): SourceKeyRecord {
  return { ...row };
}

export async function isCommittedImport(
  store: ImportVisibilityStore | undefined,
  batchId?: string
): Promise<boolean> {
  if (!batchId) return true;
  if (!store) return false;
  const batch = await store.getBatch(batchId);
  return batch?.state === "committed";
}

export function memoryImportStore(seed: {
  batches?: ImportBatchRecord[];
  rows?: ImportRowRecord[];
  sourceKeys?: SourceKeyRecord[];
} = {}): ImportWorkStore & {
  batches: Map<string, ImportBatchRecord>;
  rows: Map<string, ImportRowRecord>;
  sourceKeys: Map<string, SourceKeyRecord>;
  idem: Map<string, IdempotencyRecord>;
  audits: AuditEntry[];
} {
  const batches = new Map((seed.batches || []).map((row) => [row.batchId, cloneBatch(row)]));
  const rows = new Map((seed.rows || []).map((row) => [row.rowId, cloneRow(row)]));
  const sourceKeys = new Map((seed.sourceKeys || []).map((row) => [row.sourceKeyId, cloneKey(row)]));
  const idem = new Map<string, IdempotencyRecord>();
  const audits: AuditEntry[] = [];
  let queue: Promise<unknown> = Promise.resolve();

  const store: ImportWorkStore & {
    batches: Map<string, ImportBatchRecord>;
    rows: Map<string, ImportRowRecord>;
    sourceKeys: Map<string, SourceKeyRecord>;
    idem: Map<string, IdempotencyRecord>;
    audits: AuditEntry[];
  } = {
    batches,
    rows,
    sourceKeys,
    idem,
    audits,
    async getBatch(batchId) {
      const row = batches.get(batchId);
      return row ? cloneBatch(row) : undefined;
    },
    async getBatchByFileHash(kind, fileHash) {
      const row = [...batches.values()].find((item) => item.kind === kind && item.fileHash === fileHash);
      return row ? cloneBatch(row) : undefined;
    },
    async getSourceKey(kind, sourceKey) {
      const row = [...sourceKeys.values()].find((item) => item.kind === kind && item.sourceKey === sourceKey);
      return row ? cloneKey(row) : undefined;
    },
    async listRows(batchId) {
      return [...rows.values()]
        .filter((row) => row.batchId === batchId)
        .sort((a, b) => a.rowNo - b.rowNo)
        .map(cloneRow);
    },
    async listSourceKeys(batchId) {
      return [...sourceKeys.values()].filter((row) => row.batchId === batchId).map(cloneKey);
    },
    async listCommittedSourceKeys(kind) {
      return [...sourceKeys.values()].filter((row) => row.kind === kind && row.state === "committed").map(cloneKey);
    },
    transactWrite(input) {
      const run = queue.then(() => {
        const started = Date.now();
        const mutation = input.mutate({
          batch: input.batchId && batches.has(input.batchId) ? cloneBatch(batches.get(input.batchId)!) : undefined,
          row: input.rowId && rows.has(input.rowId) ? cloneRow(rows.get(input.rowId)!) : undefined,
          sourceKey:
            input.sourceKeyId && sourceKeys.has(input.sourceKeyId)
              ? cloneKey(sourceKeys.get(input.sourceKeyId)!)
              : undefined,
          idem: input.idempotencyId && idem.has(input.idempotencyId) ? { ...idem.get(input.idempotencyId)! } : undefined
        });
        let writes = 0;
        if (mutation.batch) {
          batches.set(mutation.batch.batchId, cloneBatch(mutation.batch));
          writes += 1;
        }
        if (mutation.row) {
          rows.set(mutation.row.rowId, cloneRow(mutation.row));
          writes += 1;
        }
        if (mutation.sourceKey) {
          sourceKeys.set(mutation.sourceKey.sourceKeyId, cloneKey(mutation.sourceKey));
          writes += 1;
        }
        if (mutation.removeRowId) {
          rows.delete(mutation.removeRowId);
          writes += 1;
        }
        if (mutation.removeSourceKeyId) {
          sourceKeys.delete(mutation.removeSourceKeyId);
          writes += 1;
        }
        if (mutation.idem) {
          idem.set(mutation.idem.id, { ...mutation.idem });
          writes += 1;
        }
        if (mutation.audit) {
          audits.push(mutation.audit);
          writes += 1;
        }
        return { mutation, budget: { reads: 4, writes, total: 4 + writes, elapsedMs: Date.now() - started } };
      });
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  };
  return store;
}
