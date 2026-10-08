import {
  acquireLease,
  advanceDemoCursor,
  assertWritableLease,
  buildAuditEntry,
  buildIdempotencyRecord,
  demoCursorComplete,
  evaluateJobsTrust,
  jobsInvokePayload,
  markFailed,
  markSucceeded,
  payloadHash,
  publicJobView,
  renewLease,
  resumeJob,
  sanitizeAuditReason,
  saveCursor,
  type AuditEntry,
  type IdempotencyRecord,
  type JobCursor,
  type JobRecord,
  type JobsServerInvoke
} from "@mw/shared";
import type {
  AuditStore,
  IdempotencyStore,
  JobMutation,
  JobStore,
  ResumeMutation,
  ResumeSnapshot,
  TxBudget,
  WorkStore
} from "./job-stores.js";

export const DEFAULT_LEASE_MS = 40_000;
export const TX_BUDGET_LIMIT = 60;
export const JOBS_INVOKE_ACTOR = "mw-jobs";
export const JOBS_INVOKE_ACTION = "serverInvoke";

export type ResumeView = ReturnType<typeof publicJobView>;

export type ResumeOutcome = {
  ok: boolean;
  code?: string;
  reason?: string;
  replayed?: boolean;
  pending?: boolean;
  job?: ResumeView;
  beforeState?: string;
  auditWritten?: boolean;
};

export function budgetsWithinLimit(...budgets: TxBudget[]): { ok: boolean; total: number; elapsedMs: number } {
  const total = budgets.reduce((sum, item) => sum + item.total, 0);
  const elapsedMs = budgets.reduce((sum, item) => sum + item.elapsedMs, 0);
  return { ok: total <= TX_BUDGET_LIMIT, total, elapsedMs };
}

export async function readJob(store: JobStore, jobId: string) {
  const job = await store.get(jobId);
  return job ? publicJobView(job) : undefined;
}

export function applyDemoCommand(
  job: JobRecord | undefined,
  invoke: JobsServerInvoke,
  now: Date
): JobMutation<JobRecord | undefined> {
  const leaseMs = invoke.leaseMs ?? DEFAULT_LEASE_MS;
  const command = invoke.command || "acquire";

  if (command === "inspect") {
    return { result: job, error: job ? undefined : "NOT_FOUND" };
  }

  if (command === "acquire") {
    if (!job) return { error: "NOT_FOUND", result: undefined };
    const next = acquireLease(job, now, leaseMs);
    if (!next.ok) return { error: next.reason, result: undefined, job };
    return { job: next.job, result: next.job };
  }

  const token = invoke.fencingToken;
  if (typeof token !== "number") {
    return { error: "FENCING_TOKEN_REQUIRED", result: undefined, job };
  }
  if (!job) return { error: "NOT_FOUND", result: undefined };

  if (command === "saveCursor" || command === "interruptAfterCursor") {
    const next = saveCursor(job, token, invoke.cursor ?? advanceDemoCursor(job), now);
    if (!next.ok) return { error: next.reason, result: undefined, job };
    return { job: next.job, result: next.job };
  }
  if (command === "renew") {
    const next = renewLease(job, token, now, leaseMs);
    if (!next.ok) return { error: next.reason, result: undefined, job };
    return { job: next.job, result: next.job };
  }
  if (command === "succeed") {
    const next = markSucceeded(job, token, now);
    if (!next.ok) return { error: next.reason, result: undefined, job };
    return { job: next.job, result: next.job };
  }
  if (command === "fail") {
    const next = markFailed(job, token, now, { code: invoke.failCode || "DEMO_FAIL", message: "synthetic retry" });
    if (!next.ok) return { error: next.reason, result: undefined, job };
    return { job: next.job, result: next.job };
  }
  if (command === "continue") {
    const writable = assertWritableLease(job, token, now);
    if (!writable.ok) return { error: writable.reason, result: undefined, job };
    const cursor = advanceDemoCursor(job);
    const saved = saveCursor(job, token, cursor, now);
    if (!saved.ok) return { error: saved.reason, result: undefined, job };
    if (demoCursorComplete(cursor)) {
      const done = markSucceeded(saved.job, token, now);
      if (!done.ok) return { error: done.reason, result: undefined, job: saved.job };
      return { job: done.job, result: done.job };
    }
    return { job: saved.job, result: saved.job };
  }
  return { error: "UNKNOWN_COMMAND", result: undefined, job };
}

export async function claimJob(store: JobStore, jobId: string, now: Date, leaseMs = DEFAULT_LEASE_MS) {
  return store.transact(jobId, (job) => {
    if (!job) return { error: "NOT_FOUND", result: undefined };
    const next = acquireLease(job, now, leaseMs);
    if (!next.ok) return { error: next.reason, result: undefined, job };
    return { job: next.job, result: next.job };
  });
}

export async function writeWithToken(
  store: JobStore,
  jobId: string,
  token: number,
  now: Date,
  apply: (job: JobRecord) => ReturnType<typeof saveCursor>
) {
  return store.transact(jobId, (job) => {
    if (!job) return { error: "NOT_FOUND", result: undefined };
    const writable = assertWritableLease(job, token, now);
    if (!writable.ok) return { error: writable.reason, result: undefined, job };
    const next = apply(job);
    if (!next.ok) return { error: next.reason, result: undefined, job };
    return { job: next.job, result: next.job };
  });
}

export async function processDemoCommand(
  store: JobStore,
  invoke: JobsServerInvoke,
  now: Date
): Promise<{ ok: boolean; reason?: string; job?: JobRecord; budget: TxBudget; token?: number }> {
  const jobId = invoke.jobId || "";
  if ((invoke.command || "acquire") === "inspect") {
    const started = Date.now();
    const job = await store.get(jobId);
    return {
      ok: Boolean(job),
      reason: job ? undefined : "NOT_FOUND",
      job,
      budget: { reads: 1, writes: 0, total: 1, elapsedMs: Date.now() - started }
    };
  }
  const written = await store.transact(jobId, (job) => applyDemoCommand(job, invoke, now));
  return {
    ok: !written.mutation.error,
    reason: written.mutation.error,
    job: written.mutation.result,
    token: written.mutation.result?.fencingToken,
    budget: written.budget
  };
}

export function jobsNonceId(nonce: string): string {
  return buildIdempotencyRecord({
    actorId: JOBS_INVOKE_ACTOR,
    action: JOBS_INVOKE_ACTION,
    idempotencyKey: nonce,
    payload: { nonce },
    requestId: "nonce"
  }).id;
}

export async function processSignedJobsCommand(input: {
  jobStore: JobStore;
  idempotencyStore?: IdempotencyStore;
  workStore?: WorkStore;
  invoke: JobsServerInvoke;
  requestId: string;
  now: Date;
}): Promise<{
  ok: boolean;
  reason?: string;
  job?: JobRecord;
  budget: TxBudget;
  token?: number;
  replayed?: boolean;
  code?: string;
}> {
  const invoke = input.invoke;
  const nonceId = jobsNonceId(invoke.nonce);
  const jobId = invoke.jobId || nonceId;
  const incoming = buildIdempotencyRecord({
    actorId: JOBS_INVOKE_ACTOR,
    action: JOBS_INVOKE_ACTION,
    idempotencyKey: invoke.nonce,
    payload: jobsInvokePayload(invoke),
    requestId: input.requestId
  });

  const finish = (
    applied: JobMutation<JobRecord | undefined>,
    budget: TxBudget,
    replayed = false
  ) => ({
    ok: !applied.error,
    reason: applied.error,
    job: applied.result,
    token: applied.result?.fencingToken,
    budget,
    replayed
  });

  if (!input.workStore) {
    return {
      ok: false,
      reason: "WORK_STORE_REQUIRED",
      code: "INTERNAL_ERROR",
      budget: { reads: 0, writes: 0, total: 0, elapsedMs: 0 }
    };
  }

  const ran = await input.workStore.transactNonceJob<{
    applied: JobMutation<JobRecord | undefined>;
    replayed: boolean;
  }>(jobId, nonceId, ({ job, nonce }) => {
    if (nonce && nonce.payloadHash !== incoming.payloadHash) {
      return {
        error: "IDEMPOTENCY_CONFLICT",
        result: { applied: { error: "IDEMPOTENCY_CONFLICT", result: undefined }, replayed: false }
      };
    }
    if (nonce && (nonce.status === "succeeded" || nonce.status === "failed") && nonce.resultRef) {
      const stored = nonce.resultRef as JobMutation<JobRecord | undefined>;
      return { nonce, result: { applied: stored, replayed: true } };
    }
    const applied = applyDemoCommand(job, invoke, input.now);
    return {
      job: applied.job,
      nonce: {
        ...incoming,
        status: applied.error ? "failed" : "succeeded",
        resultRef: { error: applied.error, result: applied.result, job: applied.job }
      },
      result: { applied, replayed: false }
    };
  });
  if (ran.mutation.error === "IDEMPOTENCY_CONFLICT") {
    return { ok: false, reason: "IDEMPOTENCY_CONFLICT", code: "IDEMPOTENCY_CONFLICT", budget: ran.budget };
  }
  return finish(ran.mutation.result.applied, ran.budget, ran.mutation.result.replayed);
}

export async function continueDemoJob(store: JobStore, jobId: string, token: number, now: Date) {
  return store.transact(jobId, (job) => applyDemoCommand(job, {
    action: "jobs.process",
    issuedAt: now.toISOString(),
    nonce: "continue",
    jobId,
    command: "continue",
    fencingToken: token,
    mac: ""
  }, now));
}

export function planResume(
  snap: ResumeSnapshot,
  input: {
    actorId: string;
    jobId: string;
    reason: string;
    requestId: string;
    idempotencyKey: string;
    now: Date;
  }
): ResumeMutation<ResumeOutcome> {
  const reason = sanitizeAuditReason(input.reason);
  const payload = { jobId: input.jobId, reason };
  const record = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "job.resume",
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  });

  if (snap.idem && snap.idem.payloadHash !== record.payloadHash) {
    return { error: "IDEMPOTENCY_CONFLICT", result: { ok: false, code: "IDEMPOTENCY_CONFLICT" } };
  }

  const terminal = snap.idem && (snap.idem.status === "succeeded" || snap.idem.status === "failed");
  if (terminal && snap.idem) {
    const stored = (snap.idem.resultRef || {}) as ResumeOutcome;
    const needsAudit = snap.idem.status === "succeeded" && stored.ok === true && stored.auditWritten !== true && snap.job;
    if (needsAudit && snap.job) {
      const audit = buildResumeAudit(input, reason, stored.beforeState || snap.job.state, snap.job);
      return {
        idem: {
          ...snap.idem,
          resultRef: { ...stored, replayed: true, auditWritten: true }
        },
        audit,
        result: { ...stored, ok: stored.ok !== false, replayed: true, auditWritten: true, pending: false }
      };
    }
    return {
      result: {
        ok: stored.ok !== false && snap.idem.status !== "failed",
        code: stored.code,
        reason: stored.reason,
        replayed: true,
        pending: false,
        job: stored.job,
        beforeState: stored.beforeState
      }
    };
  }

  const pendingRecovery =
    snap.idem?.status === "pending" &&
    snap.job &&
    snap.job.lastResumeHash === record.payloadHash;

  if (pendingRecovery && snap.job) {
    const view = publicJobView(snap.job);
    const beforeState = (snap.idem?.resultRef as ResumeOutcome | undefined)?.beforeState || "queued";
    const audit = buildResumeAudit(input, reason, beforeState, snap.job);
    return {
      job: snap.job,
      idem: {
        ...record,
        status: "succeeded",
        resultRef: { ok: true, job: view, beforeState, auditWritten: true, pending: false }
      },
      audit,
      result: { ok: true, job: view, replayed: true, pending: false, beforeState, auditWritten: true }
    };
  }

  if (!snap.job) {
    return {
      idem: {
        ...record,
        status: "failed",
        resultRef: { ok: false, code: "NOT_FOUND", reason: "NOT_FOUND", pending: false }
      },
      result: { ok: false, code: "NOT_FOUND", reason: "NOT_FOUND", pending: false }
    };
  }

  if (snap.job.state === "succeeded" || snap.job.state === "cancelled" || snap.job.state === "running") {
    return {
      idem: {
        ...record,
        status: "failed",
        resultRef: { ok: false, code: "VERSION_CONFLICT", reason: "JOB_NOT_RESUMABLE", pending: false }
      },
      result: { ok: false, code: "VERSION_CONFLICT", reason: "JOB_NOT_RESUMABLE", pending: false }
    };
  }

  const beforeState = snap.job.state;
  const next = resumeJob(snap.job, input.now, record.payloadHash);
  if (!next.ok) {
    return {
      idem: {
        ...record,
        status: "failed",
        resultRef: { ok: false, code: "VERSION_CONFLICT", reason: next.reason, pending: false }
      },
      result: { ok: false, code: "VERSION_CONFLICT", reason: next.reason, pending: false }
    };
  }

  const view = publicJobView(next.job);
  const audit = buildResumeAudit(input, reason, beforeState, next.job);
  return {
    job: next.job,
    idem: {
      ...record,
      status: "succeeded",
      resultRef: { ok: true, job: view, beforeState, auditWritten: true, pending: false }
    },
    audit,
    result: { ok: true, job: view, replayed: false, pending: false, beforeState, auditWritten: true }
  };
}

function buildResumeAudit(
  input: { actorId: string; jobId: string; requestId: string; now: Date },
  reason: string,
  beforeState: string,
  job: JobRecord
): AuditEntry {
  return buildAuditEntry({
    actorType: "admin",
    actorId: input.actorId,
    action: "job.resume",
    target: `jobs/${input.jobId}`,
    reason,
    requestId: input.requestId,
    before: { state: beforeState },
    after: { state: job.state, cursor: job.cursor },
    now: input.now
  });
}

export async function resumeDefinedJob(input: {
  jobStore: JobStore;
  idempotencyStore: IdempotencyStore;
  auditStore: AuditStore;
  workStore?: WorkStore;
  actorId: string;
  jobId: string;
  reason: string;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<{
  ok: boolean;
  code?: string;
  reason?: string;
  replayed?: boolean;
  pending?: boolean;
  job?: ResumeView;
  budget: TxBudget;
  audit?: AuditEntry;
  beforeState?: string;
}> {
  const planInput = {
    actorId: input.actorId,
    jobId: input.jobId,
    reason: input.reason,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    now: input.now
  };
  const record = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "job.resume",
    idempotencyKey: input.idempotencyKey,
    payload: { jobId: input.jobId, reason: sanitizeAuditReason(input.reason) },
    requestId: input.requestId
  });

  if (!input.workStore) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      reason: "WORK_STORE_REQUIRED",
      pending: false,
      budget: { reads: 0, writes: 0, total: 0, elapsedMs: 0 }
    };
  }

  const ran = await input.workStore.transactResume(input.jobId, record.id, (snap) => planResume(snap, planInput));
  return {
    ...ran.mutation.result,
    pending: false,
    budget: ran.budget,
    audit: ran.mutation.audit
  };
}

export async function probeIdempotency(
  store: IdempotencyStore,
  input: { actorId: string; action: string; idempotencyKey: string; payload: unknown; requestId: string }
) {
  if (!input.actorId.startsWith("mw06/test") || !input.action.startsWith("mw06.test")) {
    return { ok: false, code: "FORBIDDEN", reason: "TEST_PREFIX_REQUIRED" };
  }
  const record = buildIdempotencyRecord({
    actorId: input.actorId,
    action: input.action,
    idempotencyKey: input.idempotencyKey,
    payload: input.payload,
    requestId: input.requestId,
    status: "succeeded",
    resultRef: { accepted: true, echo: payloadHash(input.payload) }
  });
  const result = await store.transact<{ replayed: boolean; resultRef: unknown } | IdempotencyRecord | undefined>(
    record.id,
    (row) => {
      if (row && row.payloadHash !== record.payloadHash) {
        return { error: "IDEMPOTENCY_CONFLICT", result: row, record: row };
      }
      if (row) {
        return { result: { replayed: true, resultRef: row.resultRef }, record: row };
      }
      return { record, result: { replayed: false, resultRef: record.resultRef } };
    }
  );
  if (result.mutation.error === "IDEMPOTENCY_CONFLICT") {
    return { ok: false, code: "IDEMPOTENCY_CONFLICT", budget: result.budget };
  }
  return { ok: true, data: result.mutation.result, budget: result.budget };
}

export function jobsTrustFromEvent(input: {
  event: unknown;
  fromAppId?: string;
  fromOpenId?: string;
  authUid?: string;
  secret?: string;
  now: Date;
}) {
  return evaluateJobsTrust(input);
}

export type { JobCursor };
