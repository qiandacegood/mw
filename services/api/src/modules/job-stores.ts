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

function cloneJob(job: JobRecord): JobRecord {
  return {
    ...job,
    cursor: { ...job.cursor },
    lastError: job.lastError ? { ...job.lastError } : null
  };
}
