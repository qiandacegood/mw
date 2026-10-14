import {
  DEFAULT_GROWTH_NOTE,
  MEDAL_GRANT_SOURCE_RECOMPUTE,
  MEDAL_GRANT_SOURCE_REGISTER,
  MEDAL_GRANT_SOURCE_SUBMIT,
  defaultGrowthLevels,
  normalizeGrowthLevels,
  type AuditEntry,
  type GrowthConfigRecord,
  type IdempotencyRecord,
  type MedalGrantRecord
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { MemberStatsRecord } from "./member-stores.js";
import {
  GROWTH_COLLECTIONS,
  GROWTH_CONFIG_DOC_ID,
  type GrowthPublishInput,
  type GrowthPublishMutation,
  type GrowthWorkStore
} from "./growth-stores.js";

function cloudApp() {
  const cloudbase = require("@cloudbase/node-sdk") as {
    init: (opts: { env: unknown }) => { database: () => CloudDb };
    SYMBOL_CURRENT_ENV: unknown;
  };
  return cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
}

type CloudSnap = unknown;

type CloudQuery = {
  where: (query: Record<string, unknown>) => CloudQuery;
  orderBy: (field: string, direction: "asc" | "desc") => CloudQuery;
  limit: (n: number) => CloudQuery;
  skip: (n: number) => CloudQuery;
  get: () => Promise<CloudSnap>;
};

type CloudColl = {
  doc: (id: string) => {
    get: () => Promise<CloudSnap>;
    set: (data: Record<string, unknown>) => Promise<unknown>;
    update: (data: Record<string, unknown>) => Promise<unknown>;
  };
  where?: (query: Record<string, unknown>) => CloudQuery;
  orderBy?: (field: string, direction: "asc" | "desc") => CloudQuery;
  limit?: (n: number) => CloudQuery;
  skip?: (n: number) => CloudQuery;
  get?: () => Promise<CloudSnap>;
  add: (data: Record<string, unknown>) => Promise<{ id?: string; _id?: string }>;
};

type CloudDb = {
  collection: (name: string) => CloudColl;
  runTransaction: <T>(fn: (tx: CloudDb) => Promise<T>) => Promise<T>;
};

export function unwrapDoc(snap: unknown): Record<string, unknown> | undefined {
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
  const data = rec.data;
  if (Array.isArray(data)) return data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  if (data && typeof data === "object") {
    const inner = data as Record<string, unknown>;
    if (Array.isArray(inner.data)) {
      return inner.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    }
  }
  return [];
}

function asIso(value: unknown, fallback: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return fallback;
}

function idOf(doc: Record<string, unknown>): string {
  if (typeof doc._id === "string") return doc._id;
  if (typeof doc.id === "string") return doc.id;
  return "";
}

export function asGrowthConfig(data: Record<string, unknown> | undefined): GrowthConfigRecord | undefined {
  if (!data) return undefined;
  const normalized = normalizeGrowthLevels(data.levels);
  const now = new Date().toISOString();
  return {
    configVersion: typeof data.configVersion === "number" ? data.configVersion : 0,
    levels: normalized.ok ? normalized.levels : defaultGrowthLevels(),
    publishedAt: asIso(data.publishedAt, now),
    publishedBy: typeof data.publishedBy === "string" ? data.publishedBy : "",
    reason: typeof data.reason === "string" ? data.reason : "",
    note: typeof data.note === "string" ? data.note : DEFAULT_GROWTH_NOTE,
    placeholder: data.placeholder === true,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    updatedAt: asIso(data.updatedAt, now)
  };
}

export function growthConfigWrite(config: GrowthConfigRecord): Record<string, unknown> {
  return {
    kind: "growth",
    configVersion: config.configVersion,
    levels: config.levels.map((row) => ({ ...row })),
    publishedAt: config.publishedAt,
    publishedBy: config.publishedBy,
    reason: config.reason,
    note: config.note,
    placeholder: config.placeholder,
    schemaVersion: config.schemaVersion,
    updatedAt: config.updatedAt
  };
}

export function asGrant(id: string, data: Record<string, unknown>): MedalGrantRecord {
  const now = new Date().toISOString();
  const source = typeof data.sourceType === "string" ? data.sourceType : "";
  return {
    grantId: typeof data.grantId === "string" ? data.grantId : id,
    memberId: typeof data.memberId === "string" ? data.memberId : "",
    medalId: typeof data.medalId === "string" ? data.medalId : "",
    levelId: typeof data.levelId === "string" ? data.levelId : "",
    medalName: typeof data.medalName === "string" ? data.medalName : "",
    sourceType:
      source === MEDAL_GRANT_SOURCE_REGISTER || source === MEDAL_GRANT_SOURCE_SUBMIT || source === MEDAL_GRANT_SOURCE_RECOMPUTE
        ? source
        : MEDAL_GRANT_SOURCE_RECOMPUTE,
    sourceId: typeof data.sourceId === "string" ? data.sourceId : "",
    configVersion: typeof data.configVersion === "number" ? data.configVersion : 0,
    awardedAt: asIso(data.awardedAt, now),
    revokedAt: typeof data.revokedAt === "string" ? data.revokedAt : "",
    reason: typeof data.reason === "string" ? data.reason : "",
    revision: typeof data.revision === "number" ? data.revision : 1,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now),
    updatedAt: asIso(data.updatedAt, now)
  };
}

export function grantWrite(grant: MedalGrantRecord): Record<string, unknown> {
  return {
    grantId: grant.grantId,
    memberId: grant.memberId,
    medalId: grant.medalId,
    levelId: grant.levelId,
    medalName: grant.medalName,
    sourceType: grant.sourceType,
    sourceId: grant.sourceId,
    configVersion: grant.configVersion,
    awardedAt: grant.awardedAt,
    revokedAt: grant.revokedAt,
    reason: grant.reason,
    revision: grant.revision,
    schemaVersion: grant.schemaVersion,
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt
  };
}

function asStats(memberId: string, data: Record<string, unknown>): MemberStatsRecord {
  const now = new Date().toISOString();
  return {
    memberId: typeof data.memberId === "string" ? data.memberId : memberId,
    totalScore: typeof data.totalScore === "number" ? data.totalScore : 0,
    scoreSeq: typeof data.scoreSeq === "number" ? data.scoreSeq : 0,
    levelId: typeof data.levelId === "string" ? data.levelId : "L1",
    growthVersion: typeof data.growthVersion === "number" ? data.growthVersion : 0,
    revision: typeof data.revision === "number" ? data.revision : 1,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now),
    updatedAt: asIso(data.updatedAt, now)
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

async function pagedList(
  collection: string,
  input: { limit: number; pageSize: number }
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const coll = cloudApp().database().collection(collection);
  const pageSize = Math.max(1, Math.min(input.pageSize, input.limit));
  const rows: Record<string, unknown>[] = [];
  let truncated = false;
  for (let offset = 0; offset < input.limit; offset += pageSize) {
    let query: CloudQuery | undefined;
    if (typeof coll.where === "function") query = coll.where({});
    else if (typeof coll.orderBy === "function") query = coll.orderBy("_id", "asc");
    if (!query) break;
    if (typeof query.orderBy === "function") query = query.orderBy("_id", "asc");
    query = query.limit(pageSize);
    if (typeof query.skip === "function") query = query.skip(offset);
    const page = unwrapList(await query.get());
    for (const doc of page) rows.push(doc);
    if (page.length < pageSize) break;
    if (rows.length >= input.limit) {
      truncated = true;
      break;
    }
  }
  return { rows: rows.slice(0, input.limit), truncated };
}

export function cloudGrowthStore(): GrowthWorkStore {
  return {
    async getConfig() {
      const snap = await cloudApp().database().collection(GROWTH_COLLECTIONS.appConfig).doc(GROWTH_CONFIG_DOC_ID).get();
      return asGrowthConfig(unwrapDoc(snap));
    },
    async listMemberGrants(memberId) {
      const coll = cloudApp().database().collection(GROWTH_COLLECTIONS.medalGrants);
      if (typeof coll.where !== "function") return [];
      const filtered = coll.where({ memberId });
      const query = typeof filtered.orderBy === "function" ? filtered.orderBy("awardedAt", "asc") : filtered;
      const docs = unwrapList(await query.limit(50).get());
      return docs.map((doc) => asGrant(idOf(doc), doc));
    },
    async scanMemberStats(input) {
      const { rows, truncated } = await pagedList(GROWTH_COLLECTIONS.memberStats, input);
      return {
        rows: rows.map((doc) => ({
          memberId: typeof doc.memberId === "string" ? doc.memberId : idOf(doc),
          totalScore: typeof doc.totalScore === "number" ? doc.totalScore : 0,
          levelId: typeof doc.levelId === "string" ? doc.levelId : "L1",
          growthVersion: typeof doc.growthVersion === "number" ? doc.growthVersion : 0
        })),
        truncated
      };
    },
    async scanGrants(input) {
      const { rows, truncated } = await pagedList(GROWTH_COLLECTIONS.medalGrants, input);
      return { rows: rows.map((doc) => asGrant(idOf(doc), doc)), truncated };
    },
    async transactPublish(input: GrowthPublishInput) {
      const started = Date.now();
      let reads = 0;
      let writes = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        reads += 2;
        const configSnap = await tx.collection(GROWTH_COLLECTIONS.appConfig).doc(GROWTH_CONFIG_DOC_ID).get();
        const idemSnap = await tx.collection(GROWTH_COLLECTIONS.idempotency).doc(input.idempotencyId).get();
        const configData = unwrapDoc(configSnap);
        const idemData = unwrapDoc(idemSnap);
        const current = asGrowthConfig(configData);
        const next: GrowthPublishMutation = { result: undefined };
        if (idemData) {
          const existing = asIdem(input.idempotencyId, idemData);
          if (existing.payloadHash !== input.idempotency.payloadHash) {
            next.error = "IDEMPOTENCY_CONFLICT";
            return next;
          }
          if (existing.status === "succeeded") {
            next.replayed = true;
            next.result = existing.resultRef;
            next.idem = existing;
            next.config = current;
            return next;
          }
        }
        if ((current?.configVersion ?? 0) !== input.expectedConfigVersion) {
          next.error = "VERSION_CONFLICT";
          return next;
        }
        writes += 1;
        await tx.collection(GROWTH_COLLECTIONS.appConfig).doc(GROWTH_CONFIG_DOC_ID).set(growthConfigWrite(input.config));
        const succeeded: IdempotencyRecord = { ...input.idempotency, status: "succeeded", resultRef: input.config };
        writes += 1;
        const body = idemWrite(succeeded, Boolean(idemData));
        if (idemData) {
          await tx.collection(GROWTH_COLLECTIONS.idempotency).doc(input.idempotencyId).update(body);
        } else {
          await tx.collection(GROWTH_COLLECTIONS.idempotency).doc(input.idempotencyId).set(body);
        }
        if (input.audit) {
          writes += 1;
          await tx.collection(GROWTH_COLLECTIONS.auditLogs).add(auditWrite(input.audit));
        }
        next.config = input.config;
        next.idem = succeeded;
        next.audit = input.audit;
        next.result = input.config;
        return next;
      });
      const budget: TxBudget = { reads, writes, total: reads + writes, elapsedMs: Date.now() - started };
      return { mutation, budget };
    },
    async transactMemberGrowth<T>(input: {
      memberId: string;
      grantIds: string[];
      mutate: (snap: import("./growth-stores.js").GrowthMemberSnapshot) => import("./growth-stores.js").GrowthMemberMutation<T>;
    }) {
      const started = Date.now();
      let reads = 0;
      let writes = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        reads += 1;
        const statsSnap = await tx.collection(GROWTH_COLLECTIONS.memberStats).doc(input.memberId).get();
        const statsData = unwrapDoc(statsSnap);
        const grantRows: MedalGrantRecord[] = [];
        for (const grantId of input.grantIds) {
          reads += 1;
          const grantSnap = await tx.collection(GROWTH_COLLECTIONS.medalGrants).doc(grantId).get();
          const grantData = unwrapDoc(grantSnap);
          if (grantData) grantRows.push(asGrant(grantId, grantData));
        }
        const next = input.mutate({
          stats: statsData ? asStats(input.memberId, statsData) : undefined,
          grants: grantRows
        });
        if (next.error) return next;
        if (next.stats) {
          writes += 1;
          await tx.collection(GROWTH_COLLECTIONS.memberStats).doc(next.stats.memberId).set({ ...next.stats });
        }
        for (const grant of next.grants || []) {
          writes += 1;
          await tx.collection(GROWTH_COLLECTIONS.medalGrants).doc(grant.grantId).set(grantWrite(grant));
        }
        return next;
      });
      const budget: TxBudget = { reads, writes, total: reads + writes, elapsedMs: Date.now() - started };
      return { mutation, budget };
    }
  };
}
