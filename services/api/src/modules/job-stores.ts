import {
  defaultMaintenanceConfig,
  type AuditEntry,
  type IdempotencyRecord,
  type JobRecord,
  type MaintenanceConfig
} from "@mw/shared";

export interface TxBudget {
  reads: number;
  writes: number;
  total: number;
  elapsedMs: number;
}

export interface JobMutation<T> {
  job?: JobRecord;
  result: T;
  error?: string;
}

export interface IdempotencyMutation<T> {
  record?: IdempotencyRecord;
  result: T;
  error?: string;
}

export interface JobStore {
  get(jobId: string): Promise<JobRecord | undefined>;
  put(job: JobRecord): Promise<void>;
  transact<T>(jobId: string, mutate: (job: JobRecord | undefined) => JobMutation<T>): Promise<{
    mutation: JobMutation<T>;
    budget: TxBudget;
  }>;
}

export interface IdempotencyStore {
  get(id: string): Promise<IdempotencyRecord | undefined>;
  transact<T>(id: string, mutate: (row: IdempotencyRecord | undefined) => IdempotencyMutation<T>): Promise<{
    mutation: IdempotencyMutation<T>;
    budget: TxBudget;
  }>;
}

export interface AuditStore {
  append(entry: AuditEntry): Promise<string>;
}

export interface MaintenanceStore {
  get(): Promise<MaintenanceConfig>;
  save(config: MaintenanceConfig): Promise<void>;
}

export function emptyBudget(elapsedMs = 0): TxBudget {
  return { reads: 0, writes: 0, total: 0, elapsedMs };
}

export function memoryJobStore(seed: JobRecord[] = []): JobStore {
  const docs = new Map(seed.map((job) => [job.jobId, { ...job, cursor: { ...job.cursor } }]));
  let queue: Promise<unknown> = Promise.resolve();
  return {
    async get(jobId) {
      const row = docs.get(jobId);
      return row ? cloneJob(row) : undefined;
    },
    async put(job) {
      docs.set(job.jobId, cloneJob(job));
    },
    transact(jobId, mutate) {
      const run = queue.then(() => {
        const started = Date.now();
        const current = docs.get(jobId);
        const mutation = mutate(current ? cloneJob(current) : undefined);
        let writes = 0;
        if (mutation.job) {
          docs.set(jobId, cloneJob(mutation.job));
          writes = 1;
        }
        return {
          mutation,
          budget: { reads: 1, writes, total: 1 + writes, elapsedMs: Date.now() - started }
        };
      });
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  };
}

export function memoryIdempotencyStore(seed: IdempotencyRecord[] = []): IdempotencyStore {
  const docs = new Map(seed.map((row) => [row.id, { ...row }]));
  let queue: Promise<unknown> = Promise.resolve();
  return {
    async get(id) {
      const row = docs.get(id);
      return row ? { ...row } : undefined;
    },
    transact(id, mutate) {
      const run = queue.then(() => {
        const started = Date.now();
        const current = docs.get(id);
        const mutation = mutate(current ? { ...current } : undefined);
        let writes = 0;
        if (mutation.record) {
          docs.set(id, { ...mutation.record });
          writes = 1;
        }
        return {
          mutation,
          budget: { reads: 1, writes, total: 1 + writes, elapsedMs: Date.now() - started }
        };
      });
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  };
}

export function memoryAuditStore(): AuditStore & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  return {
    entries,
    async append(entry) {
      entries.push({ ...entry });
      return `audit_${entries.length}`;
    }
  };
}

export function memoryMaintenanceStore(seed?: MaintenanceConfig): MaintenanceStore {
  let current = seed ?? defaultMaintenanceConfig(new Date("2026-10-08T12:00:00.000Z"));
  return {
    async get() {
      return { ...current };
    },
    async save(config) {
      current = { ...config };
    }
  };
}

export type ResumeCrashPoint = "idempotency" | "job" | "audit";

export interface ResumeSnapshot {
  job?: JobRecord;
  idem?: IdempotencyRecord;
}

export interface ResumeMutation<T> {
  job?: JobRecord;
  idem?: IdempotencyRecord;
  audit?: AuditEntry;
  result: T;
  error?: string;
}

export interface NonceJobSnapshot {
  job?: JobRecord;
  nonce?: IdempotencyRecord;
}

export interface NonceJobMutation<T> {
  job?: JobRecord;
  nonce?: IdempotencyRecord;
  result: T;
  error?: string;
}

export interface WorkStore {
  crashAfter: ResumeCrashPoint | null;
  transactResume<T>(
    jobId: string,
    idempotencyId: string,
    mutate: (snap: ResumeSnapshot) => ResumeMutation<T>
  ): Promise<{ mutation: ResumeMutation<T>; budget: TxBudget }>;
  transactNonceJob<T>(
    jobId: string,
    nonceId: string,
    mutate: (snap: NonceJobSnapshot) => NonceJobMutation<T>
  ): Promise<{ mutation: NonceJobMutation<T>; budget: TxBudget }>;
}

export function memoryMw06Stores(seed: JobRecord[] = []) {
  const jobs = new Map(seed.map((job) => [job.jobId, cloneJob(job)]));
  const idem = new Map<string, IdempotencyRecord>();
  const auditEntries: AuditEntry[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  const workStore: WorkStore = {
    crashAfter: null,
    transactResume(jobId, idempotencyId, mutate) {
      const run = queue.then(() => applyResume(jobId, idempotencyId, mutate));
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
    transactNonceJob(jobId, nonceId, mutate) {
      const run = queue.then(() => {
        const started = Date.now();
        const mutation = mutate({
          job: jobs.get(jobId) ? cloneJob(jobs.get(jobId) as JobRecord) : undefined,
          nonce: idem.get(nonceId) ? { ...(idem.get(nonceId) as IdempotencyRecord) } : undefined
        });
        let reads = 2;
        let writes = 0;
        if (mutation.job) {
          jobs.set(jobId, cloneJob(mutation.job));
          writes += 1;
        }
        if (mutation.nonce) {
          idem.set(nonceId, { ...mutation.nonce });
          writes += 1;
        }
        return {
          mutation,
          budget: { reads, writes, total: reads + writes, elapsedMs: Date.now() - started }
        };
      });
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  };

  function applyResume<T>(
    jobId: string,
    idempotencyId: string,
    mutate: (snap: ResumeSnapshot) => ResumeMutation<T>
  ) {
    const started = Date.now();
    const snap: ResumeSnapshot = {
      job: jobs.get(jobId) ? cloneJob(jobs.get(jobId) as JobRecord) : undefined,
      idem: idem.get(idempotencyId) ? { ...(idem.get(idempotencyId) as IdempotencyRecord) } : undefined
    };
    const mutation = mutate(snap);
    let reads = 2;
    let writes = 0;
    const crash = workStore.crashAfter;
    if (crash === "idempotency") {
      const pending = mutation.idem
        ? { ...mutation.idem, status: "pending" as const, resultRef: null }
        : snap.idem
          ? { ...snap.idem, status: "pending" as const }
          : undefined;
      if (pending) {
        idem.set(idempotencyId, pending);
        writes += 1;
      }
      throw Object.assign(new Error("INJECTED_FAIL_AFTER_IDEMPOTENCY"), { injected: true, writes });
    }
    if (mutation.job) {
      jobs.set(jobId, cloneJob(mutation.job));
      writes += 1;
    }
    if (crash === "job") {
      if (!snap.idem && mutation.idem) {
        const before =
          mutation.result && typeof mutation.result === "object"
            ? (mutation.result as { beforeState?: string }).beforeState
            : undefined;
        idem.set(idempotencyId, {
          ...mutation.idem,
          status: "pending",
          resultRef: before ? { beforeState: before } : null
        });
        writes += 1;
      }
      throw Object.assign(new Error("INJECTED_FAIL_AFTER_JOB"), { injected: true, writes });
    }
    if (mutation.idem) {
      const row =
        crash === "audit"
          ? {
              ...mutation.idem,
              resultRef:
                mutation.idem.resultRef && typeof mutation.idem.resultRef === "object"
                  ? { ...(mutation.idem.resultRef as Record<string, unknown>), auditWritten: false }
                  : mutation.idem.resultRef
            }
          : mutation.idem;
      idem.set(idempotencyId, row);
      writes += 1;
    }
    if (crash === "audit") {
      throw Object.assign(new Error("INJECTED_FAIL_AFTER_AUDIT"), { injected: true, writes });
    }
    if (mutation.audit) {
      auditEntries.push({ ...mutation.audit });
      writes += 1;
    }
    return {
      mutation,
      budget: { reads, writes, total: reads + writes, elapsedMs: Date.now() - started }
    };
  }

  const jobStore: JobStore = {
    async get(jobId) {
      const row = jobs.get(jobId);
      return row ? cloneJob(row) : undefined;
    },
    async put(job) {
      jobs.set(job.jobId, cloneJob(job));
    },
    transact(jobId, mutate) {
      const run = queue.then(() => {
        const started = Date.now();
        const current = jobs.get(jobId);
        const mutation = mutate(current ? cloneJob(current) : undefined);
        let writes = 0;
        if (mutation.job) {
          jobs.set(jobId, cloneJob(mutation.job));
          writes = 1;
        }
        return {
          mutation,
          budget: { reads: 1, writes, total: 1 + writes, elapsedMs: Date.now() - started }
        };
      });
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  };

  const idempotencyStore: IdempotencyStore = {
    async get(id) {
      const row = idem.get(id);
      return row ? { ...row } : undefined;
    },
    transact(id, mutate) {
      const run = queue.then(() => {
        const started = Date.now();
        const current = idem.get(id);
        const mutation = mutate(current ? { ...current } : undefined);
        let writes = 0;
        if (mutation.record) {
          idem.set(id, { ...mutation.record });
          writes = 1;
        }
        return {
          mutation,
          budget: { reads: 1, writes, total: 1 + writes, elapsedMs: Date.now() - started }
        };
      });
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  };

  const auditStore: AuditStore & { entries: AuditEntry[] } = {
    entries: auditEntries,
    async append(entry) {
      auditEntries.push({ ...entry });
      return `audit_${auditEntries.length}`;
    }
  };

  return { jobStore, idempotencyStore, auditStore, workStore, jobs, idem };
}

function cloneJob(job: JobRecord): JobRecord {
  return {
    ...job,
    cursor: { ...job.cursor },
    lastError: job.lastError ? { ...job.lastError } : null
  };
}
