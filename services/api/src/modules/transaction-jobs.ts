import {
  acquireLease,
  advanceDemoCursor,
  assertWritableLease,
  buildAuditEntry,
  buildIdempotencyRecord,
  demoCursorComplete,
  evaluateJobsTrust,
  markFailed,
  markSucceeded,
  payloadHash,
  publicJobView,
  renewLease,
  replayOrConflict,
  resumeJob,
  saveCursor,
  type AuditEntry,
  type IdempotencyRecord,
  type JobCursor,
  type JobRecord,
  type JobsServerInvoke
} from "@mw/shared";
import type { AuditStore, IdempotencyStore, JobStore, TxBudget } from "./job-stores.js";

export const DEFAULT_LEASE_MS = 40_000;
export const TX_BUDGET_LIMIT = 60;

export function budgetsWithinLimit(...budgets: TxBudget[]): { ok: boolean; total: number; elapsedMs: number } {
  const total = budgets.reduce((sum, item) => sum + item.total, 0);
  const elapsedMs = budgets.reduce((sum, item) => sum + item.elapsedMs, 0);
  return { ok: total <= TX_BUDGET_LIMIT, total, elapsedMs };
}

export async function readJob(store: JobStore, jobId: string) {
  const job = await store.get(jobId);
  return job ? publicJobView(job) : undefined;
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
  const leaseMs = invoke.leaseMs ?? DEFAULT_LEASE_MS;
  const command = invoke.command || "acquire";

  if (command === "inspect") {
    const started = Date.now();
    const job = await store.get(jobId);
    return {
      ok: Boolean(job),
      reason: job ? undefined : "NOT_FOUND",
      job,
      budget: { reads: 1, writes: 0, total: 1, elapsedMs: Date.now() - started }
    };
  }

  if (command === "acquire") {
    const claimed = await claimJob(store, jobId, now, leaseMs);
    return {
      ok: !claimed.mutation.error,
      reason: claimed.mutation.error,
      job: claimed.mutation.result,
      token: claimed.mutation.result?.fencingToken,
      budget: claimed.budget
    };
  }

  const token = invoke.fencingToken;
  if (typeof token !== "number") {
    return { ok: false, reason: "FENCING_TOKEN_REQUIRED", budget: { reads: 0, writes: 0, total: 0, elapsedMs: 0 } };
  }

  if (command === "saveCursor" || command === "interruptAfterCursor") {
    const cursor = invoke.cursor;
    const written = await writeWithToken(store, jobId, token, now, (job) =>
      saveCursor(job, token, cursor ?? advanceDemoCursor(job), now)
    );
    return {
      ok: !written.mutation.error,
      reason: written.mutation.error,
      job: written.mutation.result,
      token,
      budget: written.budget
    };
  }

  if (command === "renew") {
    const written = await writeWithToken(store, jobId, token, now, (job) => renewLease(job, token, now, leaseMs));
    return {
      ok: !written.mutation.error,
      reason: written.mutation.error,
      job: written.mutation.result,
      token,
      budget: written.budget
    };
  }

  if (command === "succeed") {
    const written = await writeWithToken(store, jobId, token, now, (job) => markSucceeded(job, token, now));
    return {
      ok: !written.mutation.error,
      reason: written.mutation.error,
      job: written.mutation.result,
      token,
      budget: written.budget
    };
  }

  if (command === "fail") {
    const written = await writeWithToken(store, jobId, token, now, (job) =>
      markFailed(job, token, now, { code: invoke.failCode || "DEMO_FAIL", message: "synthetic retry" })
    );
    return {
      ok: !written.mutation.error,
      reason: written.mutation.error,
      job: written.mutation.result,
      token,
      budget: written.budget
    };
  }

  return { ok: false, reason: "UNKNOWN_COMMAND", budget: { reads: 0, writes: 0, total: 0, elapsedMs: 0 } };
}

export async function continueDemoJob(store: JobStore, jobId: string, token: number, now: Date) {
  return writeWithToken(store, jobId, token, now, (job) => {
    const cursor = advanceDemoCursor(job);
    const saved = saveCursor(job, token, cursor, now);
    if (!saved.ok) return saved;
    if (demoCursorComplete(cursor)) {
      return markSucceeded(saved.job, token, now);
    }
    return saved;
  });
}

export async function resumeDefinedJob(input: {
  jobStore: JobStore;
  idempotencyStore: IdempotencyStore;
  auditStore: AuditStore;
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
  job?: ReturnType<typeof publicJobView>;
  budget: TxBudget;
  audit?: AuditEntry;
}> {
  const payload = { jobId: input.jobId, reason: input.reason };
  const record = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "job.resume",
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  });

  const existing = await input.idempotencyStore.transact(record.id, (row) => {
    const decision = replayOrConflict(row, record.payloadHash, () => null);
    if (!decision.ok) {
      return { error: "IDEMPOTENCY_CONFLICT", result: row, record: row };
    }
    if (row && decision.replayed) {
      return { result: row, record: row };
    }
    return { record: { ...record, status: "pending" }, result: undefined };
  });

  if (existing.mutation.error === "IDEMPOTENCY_CONFLICT") {
    return { ok: false, code: "IDEMPOTENCY_CONFLICT", budget: existing.budget };
  }

  const stored = existing.mutation.record;
  if (stored?.status === "succeeded") {
    const job = await input.jobStore.get(input.jobId);
    return {
      ok: true,
      replayed: true,
      job: job ? publicJobView(job) : (stored.resultRef as ReturnType<typeof publicJobView> | undefined),
      budget: existing.budget
    };
  }

  if (stored?.status === "pending" && existing.mutation.result) {
    const job = await input.jobStore.get(input.jobId);
    return {
      ok: true,
      replayed: true,
      pending: true,
      reason: "UNKNOWN_RESULT_QUERIED",
      job: job ? publicJobView(job) : undefined,
      budget: existing.budget
    };
  }

  const resumed = await input.jobStore.transact(input.jobId, (job) => {
    if (!job) return { error: "NOT_FOUND", result: undefined };
    const next = resumeJob(job, input.now);
    if (!next.ok) return { error: next.reason, result: undefined, job };
    return { job: next.job, result: next.job };
  });
  if (resumed.mutation.error) {
    return {
      ok: false,
      code: resumed.mutation.error === "NOT_FOUND" ? "NOT_FOUND" : "VERSION_CONFLICT",
      reason: resumed.mutation.error,
      budget: {
        reads: existing.budget.reads + resumed.budget.reads,
        writes: existing.budget.writes + resumed.budget.writes,
        total: existing.budget.total + resumed.budget.total,
        elapsedMs: existing.budget.elapsedMs + resumed.budget.elapsedMs
      }
    };
  }

  const view = publicJobView(resumed.mutation.result as JobRecord);
  await input.idempotencyStore.transact(record.id, (row) => ({
    record: {
      ...(row ?? record),
      status: "succeeded",
      resultRef: { jobId: view.jobId, state: view.state },
      requestId: input.requestId
    },
    result: view
  }));
  const audit = buildAuditEntry({
    actorType: "admin",
    actorId: input.actorId,
    action: "job.resume",
    target: `jobs/${input.jobId}`,
    reason: input.reason,
    requestId: input.requestId,
    before: { state: "needsReview" },
    after: { state: view.state, cursor: view.cursor },
    now: input.now
  });
  await input.auditStore.append(audit);
  return {
    ok: true,
    replayed: false,
    job: view,
    audit,
    budget: {
      reads: existing.budget.reads + resumed.budget.reads,
      writes: existing.budget.writes + resumed.budget.writes + 2,
      total: existing.budget.total + resumed.budget.total + 2,
      elapsedMs: existing.budget.elapsedMs + resumed.budget.elapsedMs
    }
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
      const decision = replayOrConflict(row, record.payloadHash, () => record.resultRef);
      if (!decision.ok) {
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
