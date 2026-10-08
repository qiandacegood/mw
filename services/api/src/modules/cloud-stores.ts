import {
  defaultMaintenanceConfig,
  emptyMaintenanceFlag,
  type AuditEntry,
  type IdempotencyRecord,
  type JobCursor,
  type JobError,
  type JobRecord,
  type JobState,
  type MaintenanceConfig,
  type MaintenanceFlag,
  type MaintenanceGate
} from "@mw/shared";
import type {
  AuditStore,
  IdempotencyMutation,
  IdempotencyStore,
  JobMutation,
  JobStore,
  MaintenanceStore,
  NonceJobMutation,
  NonceJobSnapshot,
  ResumeMutation,
  ResumeSnapshot,
  TxBudget,
  WorkStore
} from "./job-stores.js";

export const MW06_COLLECTIONS = {
  jobs: "jobs",
  idempotency: "idempotency",
  auditLogs: "audit_logs",
  appConfig: "app_config"
} as const;

export const MAINTENANCE_DOC_ID = "maintenance";

function cloudApp() {
  const cloudbase = require("@cloudbase/node-sdk") as {
    init: (opts: { env: unknown }) => {
      database: () => CloudDb;
    };
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
    add: (data: Record<string, unknown>) => Promise<{ id?: string; _id?: string }>;
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

function asIso(value: unknown, fallback: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return fallback;
}

function asCursor(value: unknown): JobCursor {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const done = typeof rec.done === "number" ? rec.done : 0;
  const total = typeof rec.total === "number" ? rec.total : 3;
  return { done, total };
}

function asJob(id: string, data: Record<string, unknown>): JobRecord {
  const now = new Date().toISOString();
  return {
    jobId: typeof data.jobId === "string" ? data.jobId : id,
    type: typeof data.type === "string" ? data.type : "",
    businessKey: typeof data.businessKey === "string" ? data.businessKey : "",
    state: (typeof data.state === "string" ? data.state : "queued") as JobState,
    cursor: asCursor(data.cursor),
    leaseUntil: !data.leaseUntil ? null : asIso(data.leaseUntil, now),
    fencingToken: typeof data.fencingToken === "number" ? data.fencingToken : 0,
    attempts: typeof data.attempts === "number" ? data.attempts : 0,
    maxAttempts: typeof data.maxAttempts === "number" ? data.maxAttempts : 3,
    resumeCount: typeof data.resumeCount === "number" ? data.resumeCount : 0,
    totalAttempts: typeof data.totalAttempts === "number" ? data.totalAttempts : 0,
    lastResumeHash: typeof data.lastResumeHash === "string" ? data.lastResumeHash : "",
    nextRunAt: asIso(data.nextRunAt, now),
    lastError: asJobError(data.lastError),
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now),
    updatedAt: asIso(data.updatedAt, now),
    revision: typeof data.revision === "number" ? data.revision : 1
  };
}

function asJobError(value: unknown): JobError | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.code !== "string" || typeof rec.message !== "string" || !rec.code) return null;
  return { code: rec.code, message: rec.message };
}

function jobWrite(job: JobRecord): Record<string, unknown> {
  return {
    jobId: job.jobId,
    type: job.type,
    businessKey: job.businessKey,
    state: job.state,
    cursor: job.cursor,
    leaseUntil: job.leaseUntil || "",
    fencingToken: job.fencingToken,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    resumeCount: job.resumeCount ?? 0,
    totalAttempts: job.totalAttempts ?? 0,
    lastResumeHash: job.lastResumeHash || "",
    nextRunAt: job.nextRunAt,
    ...(job.lastError ? { lastError: job.lastError } : {}),
    schemaVersion: job.schemaVersion,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    revision: job.revision
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

function asFlag(value: unknown): MaintenanceFlag {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    enabled: rec.enabled !== false,
    reason: typeof rec.reason === "string" ? rec.reason : "",
    jobId: typeof rec.jobId === "string" ? rec.jobId : "",
    revision: typeof rec.revision === "number" ? rec.revision : 1
  };
}

function asMaintenance(data: Record<string, unknown> | undefined): MaintenanceConfig {
  const fallback = defaultMaintenanceConfig(new Date());
  if (!data) return fallback;
  const gates: MaintenanceGate[] = [
    "contentWrites",
    "attemptStart",
    "attemptSubmit",
    "purchaseCreate",
    "entitlementApply"
  ];
  const out = { ...fallback };
  for (const gate of gates) {
    out[gate] = data[gate] ? asFlag(data[gate]) : emptyMaintenanceFlag();
  }
  out.schemaVersion = typeof data.schemaVersion === "number" ? data.schemaVersion : 1;
  out.revision = typeof data.revision === "number" ? data.revision : 1;
  out.updatedAt = asIso(data.updatedAt, fallback.updatedAt);
  return out;
}

export function cloudJobStore(): JobStore {
  return {
    async get(jobId) {
      const snap = await cloudApp().database().collection(MW06_COLLECTIONS.jobs).doc(jobId).get();
      const data = unwrapDoc(snap);
      return data ? asJob(jobId, data) : undefined;
    },
    async put(job) {
      await cloudApp().database().collection(MW06_COLLECTIONS.jobs).doc(job.jobId).set(jobWrite(job));
    },
    async transact<T>(jobId: string, mutate: (job: JobRecord | undefined) => JobMutation<T>) {
      const started = Date.now();
      let reads = 0;
      let writes = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        reads += 1;
        const snap = await tx.collection(MW06_COLLECTIONS.jobs).doc(jobId).get();
        const data = unwrapDoc(snap);
        const current = data ? asJob(jobId, data) : undefined;
        const next = mutate(current);
        if (next.job) {
          writes += 1;
          if (current) {
            await tx.collection(MW06_COLLECTIONS.jobs).doc(jobId).update(jobWrite(next.job));
          } else {
            await tx.collection(MW06_COLLECTIONS.jobs).doc(jobId).set(jobWrite(next.job));
          }
        }
        return next;
      });
      const budget: TxBudget = { reads, writes, total: reads + writes, elapsedMs: Date.now() - started };
      return { mutation: mutation as JobMutation<T>, budget };
    }
  };
}

export function cloudIdempotencyStore(): IdempotencyStore {
  return {
    async get(id) {
      const snap = await cloudApp().database().collection(MW06_COLLECTIONS.idempotency).doc(id).get();
      const data = unwrapDoc(snap);
      return data ? asIdem(id, data) : undefined;
    },
    async transact<T>(id: string, mutate: (row: IdempotencyRecord | undefined) => IdempotencyMutation<T>) {
      const started = Date.now();
      let reads = 0;
      let writes = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        reads += 1;
        const snap = await tx.collection(MW06_COLLECTIONS.idempotency).doc(id).get();
        const data = unwrapDoc(snap);
        const current = data ? asIdem(id, data) : undefined;
        const next = mutate(current);
        if (next.record) {
          writes += 1;
          const body = {
            actorId: next.record.actorId,
            action: next.record.action,
            idempotencyKey: next.record.idempotencyKey,
            payloadHash: next.record.payloadHash,
            status: next.record.status,
            resultRef: next.record.resultRef,
            requestId: next.record.requestId,
            schemaVersion: 1,
            updatedAt: new Date().toISOString()
          };
          if (current) {
            await tx.collection(MW06_COLLECTIONS.idempotency).doc(id).update(body);
          } else {
            await tx.collection(MW06_COLLECTIONS.idempotency).doc(id).set({
              ...body,
              createdAt: new Date().toISOString()
            });
          }
        }
        return next;
      });
      return {
        mutation: mutation as IdempotencyMutation<T>,
        budget: { reads, writes, total: reads + writes, elapsedMs: Date.now() - started }
      };
    }
  };
}

export function cloudAuditStore(): AuditStore {
  return {
    async append(entry: AuditEntry) {
      const added = await cloudApp().database().collection(MW06_COLLECTIONS.auditLogs).add({
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        target: entry.target,
        reason: entry.reason,
        requestId: entry.requestId,
        beforeHash: entry.beforeHash,
        afterHash: entry.afterHash,
        createdAt: entry.createdAt,
        schemaVersion: entry.schemaVersion
      });
      return String(added.id || added._id || "");
    }
  };
}

function idemWrite(record: IdempotencyRecord, existing: boolean): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    actorId: record.actorId,
    action: record.action,
    idempotencyKey: record.idempotencyKey,
    payloadHash: record.payloadHash,
    status: record.status,
    resultRef: record.resultRef,
    requestId: record.requestId,
    schemaVersion: 1,
    updatedAt: now,
    ...(existing ? {} : { createdAt: now })
  };
}

function auditWrite(entry: AuditEntry): Record<string, unknown> {
  return {
    actorType: entry.actorType,
    actorId: entry.actorId,
    action: entry.action,
    target: entry.target,
    reason: entry.reason,
    requestId: entry.requestId,
    beforeHash: entry.beforeHash,
    afterHash: entry.afterHash,
    createdAt: entry.createdAt,
    schemaVersion: entry.schemaVersion
  };
}

export function cloudWorkStore(): WorkStore {
  return {
    crashAfter: null,
    async transactResume<T>(jobId: string, idempotencyId: string, mutate: (snap: ResumeSnapshot) => ResumeMutation<T>) {
      const started = Date.now();
      let reads = 0;
      let writes = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        reads += 2;
        const idemSnap = await tx.collection(MW06_COLLECTIONS.idempotency).doc(idempotencyId).get();
        const jobSnap = await tx.collection(MW06_COLLECTIONS.jobs).doc(jobId).get();
        const idemData = unwrapDoc(idemSnap);
        const jobData = unwrapDoc(jobSnap);
        const next = mutate({
          job: jobData ? asJob(jobId, jobData) : undefined,
          idem: idemData ? asIdem(idempotencyId, idemData) : undefined
        });
        if (next.job) {
          writes += 1;
          if (jobData) {
            await tx.collection(MW06_COLLECTIONS.jobs).doc(jobId).update(jobWrite(next.job));
          } else {
            await tx.collection(MW06_COLLECTIONS.jobs).doc(jobId).set(jobWrite(next.job));
          }
        }
        if (next.idem) {
          writes += 1;
          const body = idemWrite(next.idem, Boolean(idemData));
          if (idemData) {
            await tx.collection(MW06_COLLECTIONS.idempotency).doc(idempotencyId).update(body);
          } else {
            await tx.collection(MW06_COLLECTIONS.idempotency).doc(idempotencyId).set(body);
          }
        }
        if (next.audit) {
          writes += 1;
          await tx.collection(MW06_COLLECTIONS.auditLogs).add(auditWrite(next.audit));
        }
        return next;
      });
      return {
        mutation: mutation as ResumeMutation<T>,
        budget: { reads, writes, total: reads + writes, elapsedMs: Date.now() - started }
      };
    },
    async transactNonceJob<T>(jobId: string, nonceId: string, mutate: (snap: NonceJobSnapshot) => NonceJobMutation<T>) {
      const started = Date.now();
      let reads = 0;
      let writes = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        reads += 2;
        const nonceSnap = await tx.collection(MW06_COLLECTIONS.idempotency).doc(nonceId).get();
        const jobSnap = await tx.collection(MW06_COLLECTIONS.jobs).doc(jobId).get();
        const nonceData = unwrapDoc(nonceSnap);
        const jobData = unwrapDoc(jobSnap);
        const next = mutate({
          job: jobData ? asJob(jobId, jobData) : undefined,
          nonce: nonceData ? asIdem(nonceId, nonceData) : undefined
        });
        if (next.job) {
          writes += 1;
          if (jobData) {
            await tx.collection(MW06_COLLECTIONS.jobs).doc(jobId).update(jobWrite(next.job));
          } else {
            await tx.collection(MW06_COLLECTIONS.jobs).doc(jobId).set(jobWrite(next.job));
          }
        }
        if (next.nonce) {
          writes += 1;
          const body = idemWrite(next.nonce, Boolean(nonceData));
          if (nonceData) {
            await tx.collection(MW06_COLLECTIONS.idempotency).doc(nonceId).update(body);
          } else {
            await tx.collection(MW06_COLLECTIONS.idempotency).doc(nonceId).set(body);
          }
        }
        return next;
      });
      return {
        mutation: mutation as NonceJobMutation<T>,
        budget: { reads, writes, total: reads + writes, elapsedMs: Date.now() - started }
      };
    }
  };
}

export function cloudMaintenanceStore(): MaintenanceStore {
  return {
    async get() {
      const snap = await cloudApp().database().collection(MW06_COLLECTIONS.appConfig).doc(MAINTENANCE_DOC_ID).get();
      return asMaintenance(unwrapDoc(snap));
    },
    async save(config) {
      await cloudApp().database().collection(MW06_COLLECTIONS.appConfig).doc(MAINTENANCE_DOC_ID).set({
        ...config,
        kind: "maintenance"
      });
    }
  };
}
