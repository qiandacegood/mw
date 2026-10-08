export const JOB_STATES = [
  "queued",
  "running",
  "retryable",
  "needsReview",
  "succeeded",
  "cancelled"
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const MW06_DEMO_JOB_TYPE = "mw06.demo.cursor";

export interface JobCursor {
  done: number;
  total: number;
}

export interface JobError {
  code: string;
  message: string;
}

export interface JobRecord {
  jobId: string;
  type: string;
  businessKey: string;
  state: JobState;
  cursor: JobCursor;
  leaseUntil: string | null;
  fencingToken: number;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  lastError: JobError | null;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface JobPublicView {
  jobId: string;
  type: string;
  businessKey: string;
  state: JobState;
  cursor: JobCursor;
  leaseUntil: string | null;
  fencingToken: number;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  lastError: JobError | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export type JobDecision =
  | { ok: true; job: JobRecord }
  | { ok: false; reason: string };

const ACQUIRE_STATES: JobState[] = ["queued", "retryable"];

function iso(now: Date): string {
  return now.toISOString();
}

export function isJobState(value: string): value is JobState {
  return (JOB_STATES as readonly string[]).includes(value);
}

export function publicJobView(job: JobRecord): JobPublicView {
  return {
    jobId: job.jobId,
    type: job.type,
    businessKey: job.businessKey,
    state: job.state,
    cursor: { ...job.cursor },
    leaseUntil: job.leaseUntil,
    fencingToken: job.fencingToken,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    nextRunAt: job.nextRunAt,
    lastError: job.lastError ? { ...job.lastError } : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    revision: job.revision
  };
}

export function createJobRecord(input: {
  jobId: string;
  type: string;
  businessKey: string;
  now: Date;
  maxAttempts?: number;
  total?: number;
}): JobRecord {
  const stamp = iso(input.now);
  return {
    jobId: input.jobId,
    type: input.type,
    businessKey: input.businessKey,
    state: "queued",
    cursor: { done: 0, total: input.total ?? 3 },
    leaseUntil: null,
    fencingToken: 0,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    nextRunAt: stamp,
    lastError: null,
    schemaVersion: 1,
    createdAt: stamp,
    updatedAt: stamp,
    revision: 1
  };
}

export function leaseExpired(job: JobRecord, now: Date): boolean {
  if (!job.leaseUntil) return true;
  return Date.parse(job.leaseUntil) <= now.getTime();
}

export function canAcquireLease(job: JobRecord, now: Date): JobDecision {
  if (job.state === "succeeded" || job.state === "cancelled") {
    return { ok: false, reason: "JOB_NOT_ACQUIRABLE" };
  }
  if (job.state === "needsReview") {
    return { ok: false, reason: "JOB_NEEDS_REVIEW" };
  }
  if (job.state === "running" && !leaseExpired(job, now)) {
    return { ok: false, reason: "LEASE_HELD" };
  }
  if (!ACQUIRE_STATES.includes(job.state) && !(job.state === "running" && leaseExpired(job, now))) {
    return { ok: false, reason: "JOB_NOT_ACQUIRABLE" };
  }
  if (job.attempts >= job.maxAttempts) {
    return { ok: false, reason: "MAX_ATTEMPTS_REACHED" };
  }
  return { ok: true, job };
}

export function acquireLease(job: JobRecord, now: Date, leaseMs: number): JobDecision {
  const allowed = canAcquireLease(job, now);
  if (!allowed.ok) return allowed;
  const next: JobRecord = {
    ...job,
    state: "running",
    fencingToken: job.fencingToken + 1,
    attempts: job.attempts + 1,
    leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
    nextRunAt: iso(now),
    lastError: null,
    updatedAt: iso(now),
    revision: job.revision + 1
  };
  return { ok: true, job: next };
}

export function assertWritableLease(job: JobRecord, token: number, now: Date): JobDecision {
  if (job.state !== "running") {
    return { ok: false, reason: "JOB_NOT_RUNNING" };
  }
  if (job.fencingToken !== token) {
    return { ok: false, reason: "STALE_FENCING_TOKEN" };
  }
  if (leaseExpired(job, now)) {
    return { ok: false, reason: "LEASE_EXPIRED" };
  }
  return { ok: true, job };
}

export function saveCursor(job: JobRecord, token: number, cursor: JobCursor, now: Date): JobDecision {
  const allowed = assertWritableLease(job, token, now);
  if (!allowed.ok) return allowed;
  return {
    ok: true,
    job: {
      ...job,
      cursor: { done: cursor.done, total: cursor.total },
      updatedAt: iso(now),
      revision: job.revision + 1
    }
  };
}

export function renewLease(job: JobRecord, token: number, now: Date, leaseMs: number): JobDecision {
  const allowed = assertWritableLease(job, token, now);
  if (!allowed.ok) return allowed;
  return {
    ok: true,
    job: {
      ...job,
      leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
      updatedAt: iso(now),
      revision: job.revision + 1
    }
  };
}

export function markSucceeded(job: JobRecord, token: number, now: Date): JobDecision {
  const allowed = assertWritableLease(job, token, now);
  if (!allowed.ok) return allowed;
  return {
    ok: true,
    job: {
      ...job,
      state: "succeeded",
      leaseUntil: null,
      lastError: null,
      updatedAt: iso(now),
      revision: job.revision + 1
    }
  };
}

export function markFailed(
  job: JobRecord,
  token: number,
  now: Date,
  error: JobError,
  backoffMs = 1000
): JobDecision {
  const allowed = assertWritableLease(job, token, now);
  if (!allowed.ok) return allowed;
  const exhausted = job.attempts >= job.maxAttempts;
  return {
    ok: true,
    job: {
      ...job,
      state: exhausted ? "needsReview" : "retryable",
      leaseUntil: null,
      lastError: { code: error.code, message: error.message },
      nextRunAt: exhausted ? iso(now) : new Date(now.getTime() + backoffMs).toISOString(),
      updatedAt: iso(now),
      revision: job.revision + 1
    }
  };
}

export function resumeJob(job: JobRecord, now: Date): JobDecision {
  if (job.state !== "needsReview" && job.state !== "retryable") {
    return { ok: false, reason: "JOB_NOT_RESUMABLE" };
  }
  return {
    ok: true,
    job: {
      ...job,
      state: "queued",
      leaseUntil: null,
      nextRunAt: iso(now),
      lastError: job.lastError,
      updatedAt: iso(now),
      revision: job.revision + 1
    }
  };
}

export function advanceDemoCursor(job: JobRecord): JobCursor {
  const total = job.cursor.total;
  const done = Math.min(job.cursor.done + 1, total);
  return { done, total };
}

export function demoCursorComplete(cursor: JobCursor): boolean {
  return cursor.done >= cursor.total;
}
