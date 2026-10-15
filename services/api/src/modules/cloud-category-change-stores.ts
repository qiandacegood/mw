import {
  CATALOG_CHANGE_PREVIEW_COLLECTION,
  CATALOG_CHANGE_WORK_COLLECTION,
  CATALOG_DOC_ID,
  auditDocId,
  defaultMaintenanceConfig,
  emptyCatalog,
  type CategoryChangePreviewRecord,
  type CategoryChangeRef,
  type CatalogRecord,
  type CategoryUsageMap,
  type IdempotencyRecord,
  type JobRecord,
  type MaintenanceConfig,
  type PaperBestRecord,
  type ScoreMetricRecord
} from "@mw/shared";
import type {
  CatalogChangeCommitMutation,
  CatalogChangeCommitSnapshot,
  CatalogChangeStore,
  CatalogChangeWorkRecord
} from "./category-change-stores.js";
import type { TxBudget } from "./job-stores.js";

function cloudApp() {
  const cloudbase = require("@cloudbase/node-sdk") as {
    init: (opts: { env: unknown }) => { database: () => CloudDb };
    SYMBOL_CURRENT_ENV: unknown;
  };
  return cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
}

type CloudDb = {
  collection: (name: string) => {
    doc: (id: string) => {
      get: () => Promise<unknown>;
      set: (data: Record<string, unknown>) => Promise<unknown>;
      update: (data: Record<string, unknown>) => Promise<unknown>;
    };
    limit?: (n: number) => { get: () => Promise<unknown> };
    get?: () => Promise<unknown>;
  };
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
  return [];
}

async function listCollection(db: CloudDb, name: string): Promise<Record<string, unknown>[]> {
  const coll = db.collection(name);
  const snap = coll.limit ? await coll.limit(200).get() : coll.get ? await coll.get() : { data: [] };
  return unwrapList(snap);
}

function plain(value: unknown): Record<string, unknown> {
  const rec = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete rec._id;
  return rec;
}

async function txGet(tx: CloudDb, collection: string, id: string): Promise<Record<string, unknown> | undefined> {
  try {
    return unwrapDoc(await tx.collection(collection).doc(id).get());
  } catch {
    return undefined;
  }
}

async function readCatalogDoc(db: CloudDb): Promise<CatalogRecord> {
  const data = await txGet(db, "app_config", CATALOG_DOC_ID);
  if (!data) return emptyCatalog(new Date());
  return {
    treeVersion: typeof data.treeVersion === "number" ? data.treeVersion : 0,
    categoryMetricsGeneration: typeof data.categoryMetricsGeneration === "number" ? data.categoryMetricsGeneration : 0,
    seeded: data.seeded === true,
    seededAt: typeof data.seededAt === "string" ? data.seededAt : null,
    schemaVersion: 1,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
    structureUpdating: data.structureUpdating === true,
    structureJobId: typeof data.structureJobId === "string" ? data.structureJobId : "",
    categoryRankingStatus:
      data.categoryRankingStatus === "updating" || data.categoryRankingStatus === "pending_recovery"
        ? data.categoryRankingStatus
        : "ready",
    categoryRankingError: typeof data.categoryRankingError === "string" ? data.categoryRankingError : ""
  };
}

async function writeDoc(db: CloudDb, label: string, collection: string, id: string, data: Record<string, unknown>): Promise<void> {
  try {
    await db.collection(collection).doc(id).set(plain(data));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`commit_write_${label}: ${msg.replace(/[A-Za-z0-9+/]{24,}/g, "[redacted]").slice(0, 160)}`);
  }
}

async function persistCommitWrites(db: CloudDb, next: CatalogChangeCommitMutation<unknown>): Promise<void> {
  if (next.catalog) {
    await writeDoc(db, "catalog", "app_config", CATALOG_DOC_ID, {
      kind: "catalog",
      treeVersion: next.catalog.treeVersion,
      categoryMetricsGeneration: next.catalog.categoryMetricsGeneration,
      structureUpdating: next.catalog.structureUpdating === true,
      structureJobId: next.catalog.structureJobId || "",
      categoryRankingStatus: next.catalog.categoryRankingStatus || "ready",
      categoryRankingError: next.catalog.categoryRankingError || "",
      seeded: next.catalog.seeded === true,
      seededAt: next.catalog.seededAt,
      schemaVersion: next.catalog.schemaVersion,
      updatedAt: next.catalog.updatedAt
    });
  }
  if (next.maintenance) {
    await writeDoc(db, "maintenance", "app_config", "maintenance", next.maintenance as unknown as Record<string, unknown>);
  }
  if (next.job) {
    await writeDoc(db, "job", "jobs", next.job.jobId, {
      jobId: next.job.jobId,
      type: next.job.type,
      businessKey: next.job.businessKey,
      state: next.job.state,
      cursor: next.job.cursor,
      leaseUntil: next.job.leaseUntil || "",
      fencingToken: next.job.fencingToken,
      attempts: next.job.attempts,
      maxAttempts: next.job.maxAttempts,
      resumeCount: next.job.resumeCount ?? 0,
      totalAttempts: next.job.totalAttempts ?? 0,
      lastResumeHash: next.job.lastResumeHash || "",
      nextRunAt: next.job.nextRunAt,
      ...(next.job.lastError ? { lastError: next.job.lastError } : {}),
      schemaVersion: next.job.schemaVersion,
      createdAt: next.job.createdAt,
      updatedAt: next.job.updatedAt,
      revision: next.job.revision
    });
  }
  if (next.work) {
    await writeDoc(db, "work", CATALOG_CHANGE_WORK_COLLECTION, next.work.jobId, next.work as unknown as Record<string, unknown>);
  }
  if (next.preview) {
    await writeDoc(db, "preview", CATALOG_CHANGE_PREVIEW_COLLECTION, next.preview.previewId, next.preview as unknown as Record<string, unknown>);
  }
  if (next.idem) {
    await writeDoc(db, "idem", "idempotency", next.idem.id, {
      actorId: next.idem.actorId,
      action: next.idem.action,
      idempotencyKey: next.idem.idempotencyKey,
      payloadHash: next.idem.payloadHash,
      status: next.idem.status,
      resultRef: next.idem.resultRef,
      requestId: next.idem.requestId,
      schemaVersion: 1,
      createdAt: next.idem.id,
      updatedAt: new Date().toISOString()
    });
  }
  if (next.audit) {
    await writeDoc(db, "audit", "audit_logs", auditDocId(next.audit), {
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
    });
  }
}

export function cloudCatalogChangeStore(): CatalogChangeStore {
  return {
    async getPreview(previewId) {
      const snap = await cloudApp().database().collection(CATALOG_CHANGE_PREVIEW_COLLECTION).doc(previewId).get();
      const data = unwrapDoc(snap);
      return data ? (data as unknown as CategoryChangePreviewRecord) : undefined;
    },
    async savePreview(row) {
      await cloudApp().database().collection(CATALOG_CHANGE_PREVIEW_COLLECTION).doc(row.previewId).set(plain(row));
    },
    async getWork(jobId) {
      const snap = await cloudApp().database().collection(CATALOG_CHANGE_WORK_COLLECTION).doc(jobId).get();
      const data = unwrapDoc(snap);
      return data ? (data as unknown as CatalogChangeWorkRecord) : undefined;
    },
    async saveWork(row) {
      await cloudApp().database().collection(CATALOG_CHANGE_WORK_COLLECTION).doc(row.jobId).set(plain(row));
    },
    async listUsage() {
      const db = cloudApp().database();
      const questions = await listCollection(db, "questions");
      const papers = await listCollection(db, "papers");
      const q: CategoryUsageMap["questions"] = {};
      const p: CategoryUsageMap["papers"] = {};
      for (const row of questions) {
        if (row.status === "deleted") continue;
        const id = typeof row._id === "string" ? row._id : String(row.questionId || "");
        const categoryId = typeof row.categoryId === "string" ? row.categoryId : "";
        if (!id || !categoryId) continue;
        const ref: CategoryChangeRef = { id, title: typeof row.stem === "string" ? row.stem : id, categoryId };
        q[categoryId] = [...(q[categoryId] || []), ref];
      }
      for (const row of papers) {
        const id = typeof row._id === "string" ? row._id : String(row.paperId || "");
        const categoryId = typeof row.categoryId === "string" ? row.categoryId : "";
        if (!id || !categoryId) continue;
        const ref: CategoryChangeRef = { id, title: typeof row.title === "string" ? row.title : id, categoryId };
        p[categoryId] = [...(p[categoryId] || []), ref];
      }
      return { questions: q, papers: p };
    },
    async listPaperBests() {
      const rows = await listCollection(cloudApp().database(), "paper_bests");
      return rows
        .map((row) => ({
          memberId: String(row.memberId || ""),
          paperId: String(row.paperId || ""),
          bestScore: typeof row.bestScore === "number" ? row.bestScore : 0,
          bestAttemptId: String(row.bestAttemptId || ""),
          firstReachedAt: typeof row.firstReachedAt === "string" ? row.firstReachedAt : "",
          revision: typeof row.revision === "number" ? row.revision : 1,
          schemaVersion: 1,
          createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
          updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : ""
        }))
        .filter((row) => row.memberId && row.paperId) as PaperBestRecord[];
    },
    async getPaperCategory(paperId) {
      const snap = await cloudApp().database().collection("papers").doc(paperId).get();
      const data = unwrapDoc(snap);
      if (!data) return undefined;
      return { paperId, categoryId: typeof data.categoryId === "string" ? data.categoryId : "" };
    },
    async relocateQuestion(questionId, categoryId) {
      await cloudApp().database().collection("questions").doc(questionId).update({ categoryId });
    },
    async relocatePaper(paperId, categoryId) {
      await cloudApp().database().collection("papers").doc(paperId).update({ categoryId });
    },
    async writeCategoryMetrics(rows: ScoreMetricRecord[]) {
      const db = cloudApp().database();
      for (const row of rows) {
        await db.collection("score_metrics").doc(row.metricId).set({ ...row });
      }
    },
    async listDueJobIds(input) {
      const rows = await listCollection(cloudApp().database(), "jobs");
      return rows
        .filter((row) => {
          const type = typeof row.type === "string" ? row.type : "";
          const state = typeof row.state === "string" ? row.state : "";
          const nextRunAt = typeof row.nextRunAt === "string" ? Date.parse(row.nextRunAt) : 0;
          return (
            input.types.includes(type) &&
            nextRunAt <= input.now.getTime() &&
            (state === "queued" || state === "retryable")
          );
        })
        .map((row) => String(row.jobId || row._id || ""));
    },
    async transactCommit(input) {
      const started = Date.now();
      const db = cloudApp().database();
      const snap = {
        catalog: await readCatalogDoc(db),
        preview: (await txGet(db, CATALOG_CHANGE_PREVIEW_COLLECTION, input.previewId)) as CategoryChangePreviewRecord | undefined,
        job: (await txGet(db, "jobs", input.jobId)) as JobRecord | undefined,
        work: (await txGet(db, CATALOG_CHANGE_WORK_COLLECTION, input.jobId)) as CatalogChangeWorkRecord | undefined,
        maintenance: ((await txGet(db, "app_config", "maintenance")) as unknown as MaintenanceConfig | undefined) || defaultMaintenanceConfig(new Date()),
        idem: (await txGet(db, "idempotency", input.idempotencyId)) as IdempotencyRecord | undefined
      };
      const mutation = input.mutate(snap);
      if (!mutation.error) {
        await persistCommitWrites(db, mutation);
      }
      return {
        mutation,
        budget: { reads: 6, writes: mutation.error ? 0 : 7, total: mutation.error ? 6 : 13, elapsedMs: Date.now() - started } satisfies TxBudget
      };
    }
  };
}
