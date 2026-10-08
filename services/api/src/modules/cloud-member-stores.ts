import {
  auditDocId,
  defaultPolicyRecord,
  type AuditEntry,
  type ConsentVersions,
  type IdempotencyRecord,
  type MemberStatus
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type {
  IdentityRecord,
  MemberProfileMutation,
  MemberProfileSnapshot,
  MemberReadStore,
  MemberRecord,
  MemberRegisterMutation,
  MemberRegisterSnapshot,
  MemberStatsRecord,
  MemberWorkStore,
  PolicyRecord,
  PolicyStore
} from "./member-stores.js";

export const MW08_COLLECTIONS = {
  identities: "identities",
  members: "members",
  memberStats: "member_stats",
  appConfig: "app_config",
  idempotency: "idempotency",
  auditLogs: "audit_logs"
} as const;

export const POLICIES_DOC_ID = "policies";

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

function asConsent(value: unknown, fallback: ConsentVersions): ConsentVersions {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    agreementVersion: typeof rec.agreementVersion === "string" ? rec.agreementVersion : fallback.agreementVersion,
    privacyVersion: typeof rec.privacyVersion === "string" ? rec.privacyVersion : fallback.privacyVersion,
    acceptedAt: typeof rec.acceptedAt === "string" ? rec.acceptedAt : fallback.acceptedAt
  };
}

function asIdentity(id: string, data: Record<string, unknown>): IdentityRecord {
  const now = new Date().toISOString();
  return {
    identityId: typeof data.identityId === "string" ? data.identityId : id,
    memberId: typeof data.memberId === "string" ? data.memberId : "",
    provider: "wechat_mini",
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now),
    updatedAt: asIso(data.updatedAt, now)
  };
}

function asMember(id: string, data: Record<string, unknown>): MemberRecord {
  const now = new Date().toISOString();
  const status = data.status;
  return {
    memberId: typeof data.memberId === "string" ? data.memberId : id,
    nickname: typeof data.nickname === "string" ? data.nickname : "",
    avatarKey: typeof data.avatarKey === "string" ? data.avatarKey : "",
    status:
      status === "disabled" || status === "deleting" || status === "deleted" || status === "active"
        ? (status as MemberStatus)
        : "active",
    rankingOptIn: data.rankingOptIn === true,
    consentVersions: asConsent(data.consentVersions, {
      agreementVersion: "",
      privacyVersion: "",
      acceptedAt: now
    }),
    revision: typeof data.revision === "number" ? data.revision : 1,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now),
    updatedAt: asIso(data.updatedAt, now)
  };
}

function asStats(id: string, data: Record<string, unknown>): MemberStatsRecord {
  const now = new Date().toISOString();
  return {
    memberId: typeof data.memberId === "string" ? data.memberId : id,
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

function asPolicy(data: Record<string, unknown> | undefined): PolicyRecord {
  const fallback = defaultPolicyRecord(new Date());
  if (!data) return fallback;
  return {
    agreementVersion: typeof data.agreementVersion === "string" ? data.agreementVersion : fallback.agreementVersion,
    privacyVersion: typeof data.privacyVersion === "string" ? data.privacyVersion : fallback.privacyVersion,
    agreementTitle: typeof data.agreementTitle === "string" ? data.agreementTitle : fallback.agreementTitle,
    privacyTitle: typeof data.privacyTitle === "string" ? data.privacyTitle : fallback.privacyTitle,
    placeholder: data.placeholder !== false,
    note: typeof data.note === "string" ? data.note : fallback.note,
    updatedAt: asIso(data.updatedAt, fallback.updatedAt),
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1
  };
}

function identityWrite(row: IdentityRecord): Record<string, unknown> {
  return {
    identityId: row.identityId,
    memberId: row.memberId,
    provider: row.provider,
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function memberWrite(row: MemberRecord): Record<string, unknown> {
  return {
    memberId: row.memberId,
    nickname: row.nickname,
    avatarKey: row.avatarKey,
    status: row.status,
    rankingOptIn: row.rankingOptIn,
    consentVersions: row.consentVersions,
    revision: row.revision,
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function statsWrite(row: MemberStatsRecord): Record<string, unknown> {
  return {
    memberId: row.memberId,
    totalScore: row.totalScore,
    scoreSeq: row.scoreSeq,
    levelId: row.levelId,
    growthVersion: row.growthVersion,
    revision: row.revision,
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
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

export function cloudPolicyStore(): PolicyStore {
  return {
    async get() {
      const snap = await cloudApp().database().collection(MW08_COLLECTIONS.appConfig).doc(POLICIES_DOC_ID).get();
      return asPolicy(unwrapDoc(snap));
    }
  };
}

export function cloudMemberReadStore(): MemberReadStore {
  return {
    async getIdentity(identityId) {
      const snap = await cloudApp().database().collection(MW08_COLLECTIONS.identities).doc(identityId).get();
      const data = unwrapDoc(snap);
      return data ? asIdentity(identityId, data) : undefined;
    },
    async getMember(memberId) {
      const snap = await cloudApp().database().collection(MW08_COLLECTIONS.members).doc(memberId).get();
      const data = unwrapDoc(snap);
      return data ? asMember(memberId, data) : undefined;
    },
    async getStats(memberId) {
      const snap = await cloudApp().database().collection(MW08_COLLECTIONS.memberStats).doc(memberId).get();
      const data = unwrapDoc(snap);
      return data ? asStats(memberId, data) : undefined;
    }
  };
}

export function cloudMemberWorkStore(): MemberWorkStore & MemberReadStore {
  const reads = cloudMemberReadStore();
  return {
    crashAfter: null,
    getIdentity: reads.getIdentity,
    getMember: reads.getMember,
    getStats: reads.getStats,
    async transactRegister<T>(
      identityId: string,
      memberId: string,
      idempotencyId: string,
      mutate: (snap: MemberRegisterSnapshot) => MemberRegisterMutation<T>
    ) {
      const started = Date.now();
      let readCount = 0;
      let writeCount = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        readCount += 4;
        const identitySnap = await tx.collection(MW08_COLLECTIONS.identities).doc(identityId).get();
        const memberSnap = await tx.collection(MW08_COLLECTIONS.members).doc(memberId).get();
        const statsSnap = await tx.collection(MW08_COLLECTIONS.memberStats).doc(memberId).get();
        const idemSnap = await tx.collection(MW08_COLLECTIONS.idempotency).doc(idempotencyId).get();
        const identityData = unwrapDoc(identitySnap);
        const memberData = unwrapDoc(memberSnap);
        const statsData = unwrapDoc(statsSnap);
        const idemData = unwrapDoc(idemSnap);
        const next = mutate({
          identity: identityData ? asIdentity(identityId, identityData) : undefined,
          member: memberData ? asMember(memberId, memberData) : undefined,
          stats: statsData ? asStats(memberId, statsData) : undefined,
          idem: idemData ? asIdem(idempotencyId, idemData) : undefined
        });
        if (next.identity) {
          writeCount += 1;
          await tx.collection(MW08_COLLECTIONS.identities).doc(identityId).set(identityWrite(next.identity));
        }
        if (next.member) {
          writeCount += 1;
          await tx.collection(MW08_COLLECTIONS.members).doc(memberId).set(memberWrite(next.member));
        }
        if (next.stats) {
          writeCount += 1;
          await tx.collection(MW08_COLLECTIONS.memberStats).doc(memberId).set(statsWrite(next.stats));
        }
        if (next.idem) {
          writeCount += 1;
          const body = idemWrite(next.idem, Boolean(idemData));
          if (idemData) {
            await tx.collection(MW08_COLLECTIONS.idempotency).doc(idempotencyId).update(body);
          } else {
            await tx.collection(MW08_COLLECTIONS.idempotency).doc(idempotencyId).set(body);
          }
        }
        if (next.audit) {
          writeCount += 1;
          const auditId = auditDocId(next.audit);
          await tx.collection(MW08_COLLECTIONS.auditLogs).doc(auditId).set(auditWrite(next.audit));
        }
        return next;
      });
      const budget: TxBudget = {
        reads: readCount,
        writes: writeCount,
        total: readCount + writeCount,
        elapsedMs: Date.now() - started
      };
      return { mutation, budget };
    },
    async transactProfile<T>(
      identityId: string,
      memberId: string,
      idempotencyId: string,
      mutate: (snap: MemberProfileSnapshot) => MemberProfileMutation<T>
    ) {
      const started = Date.now();
      let readCount = 0;
      let writeCount = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        readCount += 4;
        const identitySnap = await tx.collection(MW08_COLLECTIONS.identities).doc(identityId).get();
        const memberSnap = await tx.collection(MW08_COLLECTIONS.members).doc(memberId).get();
        const statsSnap = await tx.collection(MW08_COLLECTIONS.memberStats).doc(memberId).get();
        const idemSnap = await tx.collection(MW08_COLLECTIONS.idempotency).doc(idempotencyId).get();
        const identityData = unwrapDoc(identitySnap);
        const memberData = unwrapDoc(memberSnap);
        const statsData = unwrapDoc(statsSnap);
        const idemData = unwrapDoc(idemSnap);
        const next = mutate({
          identity: identityData ? asIdentity(identityId, identityData) : undefined,
          member: memberData ? asMember(memberId, memberData) : undefined,
          stats: statsData ? asStats(memberId, statsData) : undefined,
          idem: idemData ? asIdem(idempotencyId, idemData) : undefined
        });
        if (next.member) {
          writeCount += 1;
          await tx.collection(MW08_COLLECTIONS.members).doc(memberId).update(memberWrite(next.member));
        }
        if (next.idem) {
          writeCount += 1;
          const body = idemWrite(next.idem, Boolean(idemData));
          if (idemData) {
            await tx.collection(MW08_COLLECTIONS.idempotency).doc(idempotencyId).update(body);
          } else {
            await tx.collection(MW08_COLLECTIONS.idempotency).doc(idempotencyId).set(body);
          }
        }
        if (next.audit) {
          writeCount += 1;
          const auditId = auditDocId(next.audit);
          await tx.collection(MW08_COLLECTIONS.auditLogs).doc(auditId).set(auditWrite(next.audit));
        }
        return next;
      });
      const budget: TxBudget = {
        reads: readCount,
        writes: writeCount,
        total: readCount + writeCount,
        elapsedMs: Date.now() - started
      };
      return { mutation, budget };
    }
  };
}
