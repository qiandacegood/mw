import {
  CATALOG_CHANGE_DRAIN_MS,
  CATALOG_CHANGE_JOB_TYPE,
  CATALOG_CHANGE_PREVIEW_TTL_MS,
  auditDocId,
  buildAuditEntry,
  buildIdempotencyRecord,
  catalogChangeDrainUntil,
  catalogChangeJobId,
  catalogStructureUpdating,
  categoryChangePlanHash,
  categoryChangePreviewId,
  closeCatalogChangeGates,
  createJobRecord,
  emptyCatalogChangeCursor,
  nextCategoryMetricsGeneration,
  parseCategoryChangeCommitInput,
  parseCategoryChangePreviewInput,
  payloadHash,
  planCategoryChange,
  replayOrConflict,
  type CategoryChangePreviewRecord,
  type CategoryRecord,
  type CatalogRecord,
  type JobRecord
} from "@mw/shared";
import type { CategoryWorkStore } from "./category-stores.js";
import type { CatalogChangeStore, CatalogChangeWorkRecord } from "./category-change-stores.js";
import type { TxBudget } from "./job-stores.js";

const TX_ATTEMPTS = 3;
const RETRYABLE_TX = /TX_CONFLICT|TRANSACTION_CONFLICT|DOCUMENT_VERSION_CONFLICT|contention|please retry|try again/i;

export type ChangeFailure = {
  ok: false;
  code: string;
  reason: string;
  issues?: string[];
  details?: Record<string, unknown>;
};
export type ChangeSuccess<T> = { ok: true; data: T; replayed?: boolean; budget: TxBudget };

function fail(code: string, reason: string, extra?: { issues?: string[]; details?: Record<string, unknown> }): ChangeFailure {
  return { ok: false, code, reason, ...(extra?.issues ? { issues: extra.issues } : {}), ...(extra?.details ? { details: extra.details } : {}) };
}

async function runWithTxRetry<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= TX_ATTEMPTS; attempt += 1) {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_TX.test(error instanceof Error ? error.message : String(error)) || attempt === TX_ATTEMPTS) {
        return { ok: false, error };
      }
    }
  }
  return { ok: false, error: lastError };
}

export type CategoryChangePreviewView = {
  previewId: string;
  planHash: string;
  expiresAt: string;
  expectedTreeVersion: number;
  treeDiff: CategoryChangePreviewRecord["plan"]["moves"];
  relocatedQuestions: CategoryChangePreviewRecord["plan"]["relocatedQuestions"];
  relocatedPapers: CategoryChangePreviewRecord["plan"]["relocatedPapers"];
  deletes: string[];
  affectedMemberEstimate: number;
  rebuildCategoryIds: string[];
  drainMs: number;
  warnings: string[];
};

export type CategoryChangeCommitView = {
  jobId: string;
  previewId: string;
  planHash: string;
  closedAt: string;
  notBefore: string;
  nextRunAt: string;
  sourceTreeVersion: number;
  targetCategoryGeneration: number;
  state: string;
};

export type CategoryChangeStatusView = {
  updating: boolean;
  jobId: string;
  job?: ReturnType<typeof import("@mw/shared").publicJobView>;
  work?: CatalogChangeWorkRecord;
  catalog: {
    treeVersion: number;
    categoryMetricsGeneration: number;
    structureUpdating: boolean;
    categoryRankingStatus: string;
    categoryRankingError: string;
  };
};

export async function previewCategoryChange(input: {
  store: CategoryWorkStore;
  change: CatalogChangeStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<ChangeSuccess<CategoryChangePreviewView> | ChangeFailure> {
  const parsed = parseCategoryChangePreviewInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_PREVIEW", { issues: parsed.issues });
  const [catalog, nodes, usage] = await Promise.all([
    input.store.getCatalog(),
    input.store.listActive(),
    input.change.listUsage()
  ]);
  if (catalog.treeVersion !== parsed.expectedTreeVersion) {
    return fail("VERSION_CONFLICT", "TREE_VERSION_MISMATCH", { details: { serverTreeVersion: catalog.treeVersion } });
  }
  const planned = planCategoryChange({
    expectedTreeVersion: parsed.expectedTreeVersion,
    catalog,
    nodes,
    operations: parsed.operations,
    usage
  });
  if (!planned.ok) {
    return fail(planned.issue.code, planned.issue.reason, { details: planned.issue.details });
  }
  const previewId = categoryChangePreviewId(input.actorId, input.idempotencyKey);
  const planHash = categoryChangePlanHash(planned.plan);
  const expiresAt = new Date(input.now.getTime() + CATALOG_CHANGE_PREVIEW_TTL_MS).toISOString();
  const record: CategoryChangePreviewRecord = {
    previewId,
    planHash,
    actorId: input.actorId,
    expectedTreeVersion: parsed.expectedTreeVersion,
    operations: parsed.operations,
    plan: planned.plan,
    expiresAt,
    createdAt: input.now.toISOString(),
    consumedAt: null
  };
  await input.change.savePreview(record);
  return {
    ok: true,
    data: {
      previewId,
      planHash,
      expiresAt,
      expectedTreeVersion: parsed.expectedTreeVersion,
      treeDiff: planned.plan.moves,
      relocatedQuestions: planned.plan.relocatedQuestions,
      relocatedPapers: planned.plan.relocatedPapers,
      deletes: planned.plan.deletes,
      affectedMemberEstimate: planned.plan.affectedMemberEstimate,
      rebuildCategoryIds: planned.plan.rebuildCategoryIds,
      drainMs: CATALOG_CHANGE_DRAIN_MS,
      warnings: planned.plan.warnings
    },
    budget: { reads: 3, writes: 1, total: 4, elapsedMs: 0 }
  };
}

export async function commitCategoryChange(input: {
  store: CategoryWorkStore;
  change: CatalogChangeStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<ChangeSuccess<CategoryChangeCommitView> | ChangeFailure> {
  const parsed = parseCategoryChangeCommitInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_COMMIT", { issues: parsed.issues });
  const jobId = catalogChangeJobId(input.actorId, parsed.previewId);
  const payload = { previewId: parsed.previewId, planHash: parsed.planHash, reason: parsed.reason };
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "category.change.commit",
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  });
  if (input.change.setCatalog) {
    input.change.setCatalog(await input.store.getCatalog());
  }
  const catalogNow = await input.store.getCatalog();
  if (catalogNow.structureUpdating && catalogNow.structureJobId && catalogNow.structureJobId !== jobId) {
    const held = await input.change.getWork(catalogNow.structureJobId);
    if (held && held.planHash === parsed.planHash && held.actorId === input.actorId) {
      return {
        ok: true,
        replayed: true,
        data: {
          jobId: held.jobId,
          previewId: held.previewId,
          planHash: held.planHash,
          closedAt: held.closedAt,
          notBefore: held.notBefore,
          nextRunAt: held.notBefore,
          sourceTreeVersion: held.sourceTreeVersion,
          targetCategoryGeneration: held.targetCategoryGeneration,
          state: "queued"
        },
        budget: { reads: 2, writes: 0, total: 2, elapsedMs: 0 }
      };
    }
  }
  const dummy: CategoryChangeCommitView = {
    jobId,
    previewId: parsed.previewId,
    planHash: parsed.planHash,
    closedAt: "",
    notBefore: "",
    nextRunAt: "",
    sourceTreeVersion: 0,
    targetCategoryGeneration: 0,
    state: "queued"
  };
  const retried = await runWithTxRetry(() =>
    input.change.transactCommit({
      previewId: parsed.previewId,
      jobId,
      idempotencyId: idemRecord.id,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, payloadHash(payload), () => null);
        if (!replay.ok) {
          return { result: dummy, error: { code: "IDEMPOTENCY_CONFLICT", reason: "IDEMPOTENCY_CONFLICT" } };
        }
        if (replay.replayed && snap.idem?.resultRef && typeof snap.idem.resultRef === "object") {
          return { result: snap.idem.resultRef as CategoryChangeCommitView };
        }
        if (snap.work && snap.job && snap.work.planHash === parsed.planHash) {
          const existing: CategoryChangeCommitView = {
            jobId: snap.job.jobId,
            previewId: snap.work.previewId,
            planHash: snap.work.planHash,
            closedAt: snap.work.closedAt,
            notBefore: snap.work.notBefore,
            nextRunAt: snap.job.nextRunAt,
            sourceTreeVersion: snap.work.sourceTreeVersion,
            targetCategoryGeneration: snap.work.targetCategoryGeneration,
            state: snap.job.state
          };
          return {
            preview: snap.preview ? { ...snap.preview, consumedAt: snap.preview.consumedAt || snap.work.closedAt } : undefined,
            idem: { ...idemRecord, status: "succeeded", resultRef: existing },
            result: existing
          };
        }
        const preview = snap.preview;
        if (!preview) return { result: dummy, error: { code: "NOT_FOUND", reason: "PREVIEW_NOT_FOUND" } };
        if (preview.actorId !== input.actorId) {
          return { result: dummy, error: { code: "FORBIDDEN", reason: "PREVIEW_ACTOR_MISMATCH" } };
        }
        if (preview.planHash !== parsed.planHash) {
          return { result: dummy, error: { code: "VERSION_CONFLICT", reason: "PLAN_HASH_MISMATCH" } };
        }
        if (Date.parse(preview.expiresAt) <= input.now.getTime()) {
          return { result: dummy, error: { code: "VERSION_CONFLICT", reason: "PREVIEW_EXPIRED" } };
        }
        if (preview.consumedAt) {
          return { result: dummy, error: { code: "VERSION_CONFLICT", reason: "PREVIEW_CONSUMED" } };
        }
        if (snap.catalog.treeVersion !== preview.expectedTreeVersion) {
          return {
            result: dummy,
            error: { code: "VERSION_CONFLICT", reason: "TREE_VERSION_MISMATCH", details: { serverTreeVersion: snap.catalog.treeVersion } }
          };
        }
        if (snap.catalog.structureUpdating && snap.catalog.structureJobId && snap.catalog.structureJobId !== jobId) {
          return { result: dummy, error: { code: "CONTENT_UPDATING", reason: "STRUCTURE_JOB_HELD", details: { jobId: snap.catalog.structureJobId } } };
        }
        const closedAt = input.now;
        const notBefore = catalogChangeDrainUntil(closedAt);
        const job: JobRecord = createJobRecord({
          jobId,
          type: CATALOG_CHANGE_JOB_TYPE,
          businessKey: `catalog.change/${preview.expectedTreeVersion}/${preview.planHash}`,
          now: closedAt,
          maxAttempts: 8,
          total: 6,
          cursor: emptyCatalogChangeCursor(),
          nextRunAt: notBefore.toISOString()
        });
        const targetGeneration = nextCategoryMetricsGeneration(snap.catalog.categoryMetricsGeneration);
        const work: CatalogChangeWorkRecord = {
          jobId,
          previewId: preview.previewId,
          planHash: preview.planHash,
          actorId: input.actorId,
          reason: parsed.reason,
          closedAt: closedAt.toISOString(),
          notBefore: notBefore.toISOString(),
          sourceTreeVersion: snap.catalog.treeVersion,
          targetTreeVersion: snap.catalog.treeVersion + 1,
          sourceCategoryGeneration: snap.catalog.categoryMetricsGeneration,
          targetCategoryGeneration: targetGeneration,
          switched: false,
          opened: false,
          rankingRegistered: false,
          rankingStatus: "pending",
          rankingError: "",
          beforeSummary: {
            treeVersion: snap.catalog.treeVersion,
            categoryMetricsGeneration: snap.catalog.categoryMetricsGeneration,
            moves: preview.plan.moves.length,
            papers: preview.plan.relocatedPapers.length,
            questions: preview.plan.relocatedQuestions.length,
            deletes: preview.plan.deletes.length
          },
          afterSummary: {},
          schemaVersion: 1,
          updatedAt: closedAt.toISOString()
        };
        const view: CategoryChangeCommitView = {
          jobId,
          previewId: preview.previewId,
          planHash: preview.planHash,
          closedAt: work.closedAt,
          notBefore: work.notBefore,
          nextRunAt: job.nextRunAt,
          sourceTreeVersion: work.sourceTreeVersion,
          targetCategoryGeneration: targetGeneration,
          state: job.state
        };
        const catalog: CatalogRecord = {
          ...snap.catalog,
          structureUpdating: true,
          structureJobId: jobId,
          categoryRankingStatus: "updating",
          categoryRankingError: "",
          updatedAt: closedAt.toISOString()
        };
        const audit = buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: "category.change.commit",
          target: jobId,
          reason: parsed.reason,
          requestId: input.requestId,
          before: { treeVersion: snap.catalog.treeVersion },
          after: { jobId, notBefore: work.notBefore, planHash: preview.planHash },
          now: input.now
        });
        return {
          catalog,
          preview: { ...preview, consumedAt: closedAt.toISOString() },
          job,
          work,
          maintenance: closeCatalogChangeGates(snap.maintenance, jobId, parsed.reason, closedAt),
          idem: { ...idemRecord, status: "succeeded", resultRef: view },
          audit,
          result: view
        };
      }
    })
  );
  if (!retried.ok) {
    const raw = retried.error instanceof Error ? retried.error.message : String(retried.error);
    const note = raw.replace(/[A-Za-z0-9+/]{24,}/g, "[redacted]").slice(0, 180);
    return fail("SERVICE_BUSY", `CATEGORY_CHANGE_TX_RETRY_EXHAUSTED ${note}`, { details: { note } });
  }
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  if (retried.value.mutation.catalog) {
    try {
      await input.store.transactWrite({
        idempotencyId: `${idemRecord.id}:sync-catalog`,
        mutate: () => ({ catalog: retried.value.mutation.catalog, result: true })
      });
    } catch {
      /* occupancy already persisted by transactCommit */
    }
  }
  return { ok: true, data: retried.value.mutation.result, budget: retried.value.budget };
}

export async function readCategoryChangeStatus(input: {
  store?: CategoryWorkStore;
  change?: CatalogChangeStore;
  job?: JobRecord;
}): Promise<ChangeSuccess<CategoryChangeStatusView>> {
  const catalog = input.store ? await input.store.getCatalog() : undefined;
  const jobId = catalog?.structureJobId || input.job?.jobId || "";
  const work = jobId && input.change ? await input.change.getWork(jobId) : undefined;
  return {
    ok: true,
    data: {
      updating: catalog ? catalogStructureUpdating(catalog) : false,
      jobId,
      job: input.job ? (await import("@mw/shared")).publicJobView(input.job) : undefined,
      work,
      catalog: {
        treeVersion: catalog?.treeVersion ?? 0,
        categoryMetricsGeneration: catalog?.categoryMetricsGeneration ?? 0,
        structureUpdating: catalog?.structureUpdating === true,
        categoryRankingStatus: catalog?.categoryRankingStatus || "ready",
        categoryRankingError: catalog?.categoryRankingError || ""
      }
    },
    budget: { reads: 2, writes: 0, total: 2, elapsedMs: 0 }
  };
}

export function treeHiddenForStructureUpdate(catalog: CatalogRecord | undefined): boolean {
  return Boolean(catalog && catalogStructureUpdating(catalog));
}

export function listNodesForRead(nodes: CategoryRecord[], catalog: CatalogRecord | undefined): CategoryRecord[] {
  if (treeHiddenForStructureUpdate(catalog)) return [];
  return nodes;
}
