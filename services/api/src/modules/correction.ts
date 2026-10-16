import {
  CORRECTION_DRAIN_MS,
  CORRECTION_JOB_TYPE,
  CORRECTION_PREVIEW_TTL_MS,
  buildAuditEntry,
  buildIdempotencyRecord,
  closeCorrectionGates,
  correctionJobId,
  correctionPlanHash,
  correctionPreviewId,
  createJobRecord,
  emptyCorrectionCursor,
  paperStructureEqual,
  paperStructureHash,
  paperStructureOf,
  parseCorrectionCommitInput,
  parseCorrectionPreviewInput,
  parseCorrectionStatusInput,
  payloadHash,
  publicJobView,
  replayOrConflict,
  type CorrectionPreviewRecord,
  type JobRecord
} from "@mw/shared";
import type { CorrectionStore, CorrectionWorkRecord } from "./correction-stores.js";
import type { TxBudget } from "./job-stores.js";

const TX_ATTEMPTS = 3;
const RETRYABLE_TX = /TX_CONFLICT|TRANSACTION_CONFLICT|DOCUMENT_VERSION_CONFLICT|contention|please retry|try again/i;

export type CorrectionFailure = {
  ok: false;
  code: string;
  reason: string;
  issues?: string[];
  details?: Record<string, unknown>;
};
export type CorrectionSuccess<T> = { ok: true; data: T; replayed?: boolean; budget: TxBudget };

function fail(code: string, reason: string, extra?: { issues?: string[]; details?: Record<string, unknown> }): CorrectionFailure {
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

export type CorrectionPreviewView = {
  previewId: string;
  planHash: string;
  expiresAt: string;
  paperId: string;
  fromVersionId: string;
  toVersionId: string;
  affectedAttemptCount: number;
  affectedMemberCount: number;
  drainMs: number;
  warnings: string[];
};

export type CorrectionCommitView = {
  jobId: string;
  previewId: string;
  planHash: string;
  closedAt: string;
  notBefore: string;
  nextRunAt: string;
  paperId: string;
  state: string;
};

export type CorrectionStatusView = {
  updating: boolean;
  jobId: string;
  job?: ReturnType<typeof publicJobView>;
  work?: CorrectionWorkRecord;
  submitClosed: boolean;
};

async function countAffected(store: CorrectionStore, paperId: string, fromVersionId: string) {
  const members = new Set<string>();
  let afterAttemptId: string | undefined;
  let attemptCount = 0;
  for (;;) {
    const page = await store.listSubmittedAttempts({ paperId, fromVersionId, afterAttemptId, limit: 50 });
    if (!page.length) break;
    for (const row of page) {
      attemptCount += 1;
      members.add(row.memberId);
      afterAttemptId = row.attemptId;
    }
    if (page.length < 50) break;
  }
  return { attemptCount, memberCount: members.size };
}

export async function previewCorrection(input: {
  store: CorrectionStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<CorrectionSuccess<CorrectionPreviewView> | CorrectionFailure> {
  const parsed = parseCorrectionPreviewInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_PREVIEW", { issues: parsed.issues });
  const paper = await input.store.getPaper(parsed.paperId);
  if (!paper) return fail("NOT_FOUND", "PAPER_NOT_FOUND");
  if (paper.status !== "withdrawn") {
    return fail("INVALID_ARGUMENT", "PAPER_NOT_WITHDRAWN", { details: { status: paper.status } });
  }
  const fromVersion = await input.store.getVersion(parsed.fromVersionId);
  const toVersion = await input.store.getVersion(parsed.toVersionId);
  if (!fromVersion || fromVersion.paperId !== paper.paperId) return fail("NOT_FOUND", "FROM_VERSION_NOT_FOUND");
  if (!toVersion || toVersion.paperId !== paper.paperId) return fail("NOT_FOUND", "TO_VERSION_NOT_FOUND");
  const [fromChunks, toChunks] = await Promise.all([input.store.getChunks(fromVersion), input.store.getChunks(toVersion)]);
  const fromStructure = paperStructureOf(fromVersion, fromChunks);
  const toStructure = paperStructureOf(toVersion, toChunks);
  if (!paperStructureEqual(fromStructure, toStructure)) {
    return fail("INVALID_ARGUMENT", "STRUCTURAL_CHANGE", {
      details: { note: "题数或分值结构变化不擅自换算旧卷，当作新卷" }
    });
  }
  const affected = await countAffected(input.store, paper.paperId, parsed.fromVersionId);
  const plan = {
    paperId: paper.paperId,
    fromVersionId: parsed.fromVersionId,
    toVersionId: parsed.toVersionId,
    fromStructureHash: paperStructureHash(fromStructure),
    toStructureHash: paperStructureHash(toStructure),
    affectedAttemptCount: affected.attemptCount,
    affectedMemberCount: affected.memberCount,
    warnings: affected.attemptCount === 0 ? ["NO_SUBMITTED_ATTEMPTS"] : []
  };
  const previewId = correctionPreviewId(input.actorId, input.idempotencyKey);
  const planHash = correctionPlanHash(plan);
  const expiresAt = new Date(input.now.getTime() + CORRECTION_PREVIEW_TTL_MS).toISOString();
  const record: CorrectionPreviewRecord = {
    previewId,
    planHash,
    actorId: input.actorId,
    paperId: paper.paperId,
    fromVersionId: parsed.fromVersionId,
    toVersionId: parsed.toVersionId,
    plan,
    expiresAt,
    createdAt: input.now.toISOString(),
    consumedAt: null
  };
  await input.store.savePreview(record);
  return {
    ok: true,
    data: {
      previewId,
      planHash,
      expiresAt,
      paperId: paper.paperId,
      fromVersionId: parsed.fromVersionId,
      toVersionId: parsed.toVersionId,
      affectedAttemptCount: plan.affectedAttemptCount,
      affectedMemberCount: plan.affectedMemberCount,
      drainMs: CORRECTION_DRAIN_MS,
      warnings: plan.warnings
    },
    budget: { reads: 6, writes: 1, total: 7, elapsedMs: 0 }
  };
}

export async function commitCorrection(input: {
  store: CorrectionStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<CorrectionSuccess<CorrectionCommitView> | CorrectionFailure> {
  const parsed = parseCorrectionCommitInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_COMMIT", { issues: parsed.issues });
  const preview = await input.store.getPreview(parsed.previewId);
  if (!preview) return fail("NOT_FOUND", "PREVIEW_NOT_FOUND");
  const jobId = correctionJobId(preview.paperId, parsed.planHash);
  const payload = { previewId: parsed.previewId, planHash: parsed.planHash, reason: parsed.reason };
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "correction.commit",
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  });
  const dummy: CorrectionCommitView = {
    jobId,
    previewId: parsed.previewId,
    planHash: parsed.planHash,
    closedAt: "",
    notBefore: "",
    nextRunAt: "",
    paperId: preview.paperId,
    state: "queued"
  };
  const retried = await runWithTxRetry(() =>
    input.store.transactCommit({
      previewId: parsed.previewId,
      jobId,
      idempotencyId: idemRecord.id,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, payloadHash(payload), () => null);
        if (!replay.ok) {
          return { result: dummy, error: { code: "IDEMPOTENCY_CONFLICT", reason: "IDEMPOTENCY_CONFLICT" } };
        }
        if (replay.replayed && snap.idem?.resultRef && typeof snap.idem.resultRef === "object") {
          return { result: snap.idem.resultRef as CorrectionCommitView };
        }
        if (!snap.preview) return { result: dummy, error: { code: "NOT_FOUND", reason: "PREVIEW_NOT_FOUND" } };
        if (snap.preview.planHash !== parsed.planHash) {
          return { result: dummy, error: { code: "VERSION_CONFLICT", reason: "PLAN_HASH_MISMATCH" } };
        }
        if (Date.parse(snap.preview.expiresAt) <= input.now.getTime()) {
          return { result: dummy, error: { code: "VERSION_CONFLICT", reason: "PREVIEW_EXPIRED" } };
        }
        if (snap.work && snap.job && snap.work.planHash === parsed.planHash) {
          const existing: CorrectionCommitView = {
            jobId: snap.job.jobId,
            previewId: snap.work.previewId,
            planHash: snap.work.planHash,
            closedAt: snap.work.closedAt,
            notBefore: snap.work.notBefore,
            nextRunAt: snap.job.nextRunAt,
            paperId: snap.work.paperId,
            state: snap.job.state
          };
          return {
            preview: { ...snap.preview, consumedAt: snap.preview.consumedAt || snap.work.closedAt },
            idem: { ...idemRecord, status: "succeeded", resultRef: existing },
            result: existing
          };
        }
        if (snap.maintenance.attemptSubmit.enabled === false && snap.maintenance.attemptSubmit.jobId && snap.maintenance.attemptSubmit.jobId !== jobId) {
          return { result: dummy, error: { code: "CONTENT_UPDATING", reason: "SUBMIT_GATE_HELD", details: { jobId: snap.maintenance.attemptSubmit.jobId } } };
        }
        const closedAt = input.now.toISOString();
        const notBefore = new Date(input.now.getTime() + CORRECTION_DRAIN_MS).toISOString();
        const job = createJobRecord({
          jobId,
          type: CORRECTION_JOB_TYPE,
          businessKey: `${preview.paperId}:${parsed.planHash}`,
          now: input.now,
          maxAttempts: 8,
          cursor: emptyCorrectionCursor(),
          nextRunAt: notBefore
        });
        const work: CorrectionWorkRecord = {
          jobId,
          previewId: snap.preview.previewId,
          planHash: parsed.planHash,
          actorId: input.actorId,
          reason: parsed.reason,
          paperId: snap.preview.paperId,
          fromVersionId: snap.preview.fromVersionId,
          toVersionId: snap.preview.toVersionId,
          closedAt,
          notBefore,
          processedMemberIds: [],
          opened: false,
          rankingStatus: "pending",
          rankingError: "",
          sourceCategoryGeneration: snap.catalog.categoryMetricsGeneration,
          schemaVersion: 1,
          updatedAt: closedAt
        };
        const view: CorrectionCommitView = {
          jobId,
          previewId: snap.preview.previewId,
          planHash: parsed.planHash,
          closedAt,
          notBefore,
          nextRunAt: notBefore,
          paperId: snap.preview.paperId,
          state: "queued"
        };
        const audit = buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: "correction.commit",
          target: snap.preview.paperId,
          reason: parsed.reason,
          requestId: input.requestId,
          before: { previewId: snap.preview.previewId, planHash: parsed.planHash },
          after: { jobId, notBefore },
          now: input.now
        });
        return {
          preview: { ...snap.preview, consumedAt: closedAt },
          job,
          work,
          maintenance: closeCorrectionGates(snap.maintenance, jobId, "grade correction drain", input.now),
          idem: { ...idemRecord, status: "succeeded", resultRef: view },
          audit: { ...audit, schemaVersion: audit.schemaVersion },
          result: view
        };
      }
    })
  );
  if (!retried.ok) return fail("SERVICE_BUSY", "CORRECTION_TX_RETRY_EXHAUSTED");
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  return {
    ok: true,
    data: retried.value.mutation.result,
    replayed: Boolean(retried.value.mutation.idem && retried.value.mutation.job === undefined && retried.value.mutation.work === undefined),
    budget: retried.value.budget
  };
}

export async function readCorrectionStatus(input: {
  store: CorrectionStore;
  job?: JobRecord;
  data: Record<string, unknown>;
  submitClosed?: boolean;
}): Promise<CorrectionSuccess<CorrectionStatusView> | CorrectionFailure> {
  const parsed = parseCorrectionStatusInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_STATUS", { issues: parsed.issues });
  const jobId = parsed.jobId || input.job?.jobId || "";
  const work = jobId ? await input.store.getWork(jobId) : undefined;
  const submitClosed =
    input.submitClosed === true ||
    (input.store as { maintenance?: import("@mw/shared").MaintenanceConfig }).maintenance?.attemptSubmit.enabled === false;
  return {
    ok: true,
    data: {
      updating: Boolean(work && !work.opened),
      jobId,
      ...(input.job ? { job: publicJobView(input.job) } : {}),
      ...(work ? { work } : {}),
      submitClosed
    },
    budget: { reads: 2, writes: 0, total: 2, elapsedMs: 0 }
  };
}
