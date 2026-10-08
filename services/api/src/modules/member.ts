import {
  DEFAULT_AVATAR_KEY,
  DEFAULT_LEVEL_ID,
  MEMBER_SCHEMA_VERSION,
  auditDocId,
  buildAuditEntry,
  buildIdempotencyRecord,
  defaultNickname,
  identityDocId,
  matchPolicyVersions,
  memberDocId,
  parseProfileInput,
  parseRegisterInput,
  payloadHash,
  replayOrConflict,
  type ConsentVersions,
  type IdempotencyRecord
} from "@mw/shared";
import { TX_BUDGET_LIMIT } from "./transaction-jobs.js";
import type {
  IdentityRecord,
  MemberRecord,
  MemberStatsRecord,
  MemberWorkStore,
  PolicyRecord,
  PolicyStore,
  MemberReadStore
} from "./member-stores.js";
import type { TxBudget } from "./job-stores.js";

export const MEMBER_WRITE_ACTIONS = ["member.register", "member.updateProfile"] as const;
export const MEMBER_READ_ACTIONS = ["member.session", "member.me"] as const;
export const MEMBER_TX_MAX_ATTEMPTS = 3;

const RETRYABLE_TX =
  /TX_CONFLICT|TRANSACTION_CONFLICT|DATABASE_TRANSACTION_CONFLICT|DOCUMENT_VERSION_CONFLICT|TRANSACTION_CONFLICTED|optimistic.?lock|write.?conflict|contention|please retry|try again/i;

export type MemberPublicView = {
  memberId: string;
  identityId?: string;
  nickname: string;
  avatarKey: string;
  status: MemberRecord["status"];
  rankingOptIn: boolean;
  consentVersions: ConsentVersions;
  revision: number;
  stats: {
    totalScore: number;
    scoreSeq: number;
    levelId: string;
  };
  vip: {
    active: false;
    expiresAt: null;
  };
  draft: {
    attemptId: null;
  };
};

export type MemberActionFailure = {
  ok: false;
  code: string;
  reason: string;
  issues?: string[];
};

export type MemberActionSuccess<T> = {
  ok: true;
  data: T;
  replayed?: boolean;
  created?: boolean;
  budget: TxBudget;
};

export type MemberWriteView = MemberPublicView & {
  identityId: string;
  idempotencyId: string;
  auditId?: string;
};

function emptyBudget(): TxBudget {
  return { reads: 0, writes: 0, total: 0, elapsedMs: 0 };
}

function fail(code: string, reason: string, issues?: string[]): MemberActionFailure {
  return issues ? { ok: false, code, reason, issues } : { ok: false, code, reason };
}

export function isRetryableMemberTxError(error: unknown): boolean {
  if (error == null) return false;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/CRASH_AFTER_/i.test(text)) return false;
  return RETRYABLE_TX.test(text);
}

async function runWithTxRetry<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MEMBER_TX_MAX_ATTEMPTS; attempt += 1) {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      lastError = error;
      if (!isRetryableMemberTxError(error) || attempt === MEMBER_TX_MAX_ATTEMPTS) {
        return { ok: false, error };
      }
    }
  }
  return { ok: false, error: lastError };
}

function withWriteIds(
  view: MemberPublicView,
  identityId: string,
  idempotencyId: string,
  auditId?: string
): MemberWriteView {
  return {
    ...view,
    identityId: view.identityId || identityId,
    idempotencyId,
    ...(auditId ? { auditId } : {})
  };
}

function mutationAuditId(audit: { requestId: string; action: string; target: string } | undefined): string | undefined {
  return audit ? auditDocId(audit) : undefined;
}

async function existingPublicView(
  stores: MemberReadStore,
  identityId: string,
  memberId: string
): Promise<MemberPublicView | undefined> {
  const identity = await stores.getIdentity(identityId);
  if (!identity) return undefined;
  const member = await stores.getMember(identity.memberId || memberId);
  if (!member) return undefined;
  const stats = await stores.getStats(member.memberId);
  return publicMemberView(member, stats, identity.identityId || identityId);
}

export function publicMemberView(
  member: MemberRecord,
  stats?: MemberStatsRecord,
  identityId?: string
): MemberPublicView {
  return {
    memberId: member.memberId,
    ...(identityId ? { identityId } : {}),
    nickname: member.nickname,
    avatarKey: member.avatarKey,
    status: member.status,
    rankingOptIn: member.rankingOptIn === true,
    consentVersions: { ...member.consentVersions },
    revision: member.revision,
    stats: {
      totalScore: stats?.totalScore ?? 0,
      scoreSeq: stats?.scoreSeq ?? 0,
      levelId: stats?.levelId ?? DEFAULT_LEVEL_ID
    },
    vip: { active: false, expiresAt: null },
    draft: { attemptId: null }
  };
}

export function trustedMemberIds(fromAppId: string, fromOpenId: string): {
  identityId: string;
  memberId: string;
} {
  const identityId = identityDocId(fromAppId, fromOpenId);
  return { identityId, memberId: memberDocId(identityId) };
}

function newIdentity(identityId: string, memberId: string, now: Date): IdentityRecord {
  const at = now.toISOString();
  return {
    identityId,
    memberId,
    provider: "wechat_mini",
    schemaVersion: MEMBER_SCHEMA_VERSION,
    createdAt: at,
    updatedAt: at
  };
}

function newMember(memberId: string, consent: ConsentVersions, now: Date): MemberRecord {
  const at = now.toISOString();
  return {
    memberId,
    nickname: defaultNickname(memberId),
    avatarKey: DEFAULT_AVATAR_KEY,
    status: "active",
    rankingOptIn: false,
    consentVersions: consent,
    revision: 1,
    schemaVersion: MEMBER_SCHEMA_VERSION,
    createdAt: at,
    updatedAt: at
  };
}

function newStats(memberId: string, now: Date): MemberStatsRecord {
  const at = now.toISOString();
  return {
    memberId,
    totalScore: 0,
    scoreSeq: 0,
    levelId: DEFAULT_LEVEL_ID,
    growthVersion: 0,
    revision: 1,
    schemaVersion: MEMBER_SCHEMA_VERSION,
    createdAt: at,
    updatedAt: at
  };
}

function budgetOk(budget: TxBudget): boolean {
  return budget.total <= TX_BUDGET_LIMIT;
}

export async function readCurrentPolicies(store: PolicyStore | undefined, now: Date): Promise<PolicyRecord> {
  if (!store) {
    return {
      agreementVersion: "",
      privacyVersion: "",
      agreementTitle: "",
      privacyTitle: "",
      placeholder: true,
      note: "POLICY_STORE_MISSING",
      updatedAt: now.toISOString(),
      schemaVersion: MEMBER_SCHEMA_VERSION
    };
  }
  return store.get();
}

export async function readMemberSession(
  stores: MemberReadStore | undefined,
  fromAppId: string,
  fromOpenId: string
): Promise<{ trusted: true; registered: boolean; memberId?: string }> {
  const { identityId, memberId } = trustedMemberIds(fromAppId, fromOpenId);
  if (!stores) {
    return { trusted: true, registered: false };
  }
  const identity = await stores.getIdentity(identityId);
  if (!identity) {
    return { trusted: true, registered: false };
  }
  return { trusted: true, registered: true, memberId: identity.memberId || memberId };
}

export async function readMemberMe(
  stores: MemberReadStore | undefined,
  fromAppId: string,
  fromOpenId: string
): Promise<MemberActionSuccess<MemberPublicView> | MemberActionFailure> {
  if (!stores) {
    return fail("INTERNAL_ERROR", "MEMBER_STORE_UNAVAILABLE");
  }
  const { identityId, memberId } = trustedMemberIds(fromAppId, fromOpenId);
  const identity = await stores.getIdentity(identityId);
  if (!identity) {
    return fail("MEMBER_REQUIRED", "MEMBER_NOT_REGISTERED");
  }
  const member = await stores.getMember(identity.memberId || memberId);
  if (!member) {
    return fail("INTERNAL_ERROR", "MEMBER_ROW_MISSING");
  }
  const stats = await stores.getStats(member.memberId);
  return { ok: true, data: publicMemberView(member, stats, identity.identityId || identityId), budget: emptyBudget() };
}

export async function registerMember(input: {
  stores: MemberWorkStore & MemberReadStore;
  policies?: PolicyStore;
  fromAppId: string;
  fromOpenId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<MemberActionSuccess<MemberWriteView> | MemberActionFailure> {
  const parsed = parseRegisterInput(input.data);
  if (!parsed.ok) {
    return fail("INVALID_ARGUMENT", "REGISTER_INPUT_INVALID", parsed.issues);
  }
  const policies = await readCurrentPolicies(input.policies, input.now);
  const matched = matchPolicyVersions(parsed, policies);
  if (!matched.ok) {
    return fail("INVALID_ARGUMENT", matched.reason);
  }

  const { identityId, memberId } = trustedMemberIds(input.fromAppId, input.fromOpenId);
  const idemRecord = buildIdempotencyRecord({
    actorId: identityId,
    action: "member.register",
    idempotencyKey: input.idempotencyKey,
    payload: {
      agreementVersion: parsed.agreementVersion,
      privacyVersion: parsed.privacyVersion,
      accepted: true
    },
    requestId: input.requestId
  });

  const attempted = await runWithTxRetry(() =>
    input.stores.transactRegister(identityId, memberId, idemRecord.id, (snap) => {
      const replay = replayOrConflict(snap.idem, idemRecord.payloadHash, () => null);
      if (!replay.ok) {
        return { error: "IDEMPOTENCY_CONFLICT", result: undefined as unknown as MemberPublicView };
      }
      if (replay.replayed && snap.idem?.status === "succeeded" && snap.idem.resultRef) {
        return {
          result: snap.idem.resultRef as MemberPublicView,
          replayed: true
        };
      }
      if (snap.identity) {
        const existing = snap.member;
        if (!existing) {
          return { error: "MEMBER_ROW_MISSING", result: undefined as unknown as MemberPublicView };
        }
        const view = publicMemberView(existing, snap.stats, identityId);
        return {
          idem: {
            ...idemRecord,
            status: "succeeded",
            resultRef: view
          },
          result: view
        };
      }
      const consent: ConsentVersions = {
        agreementVersion: parsed.agreementVersion,
        privacyVersion: parsed.privacyVersion,
        acceptedAt: input.now.toISOString()
      };
      const identity = newIdentity(identityId, memberId, input.now);
      const member = newMember(memberId, consent, input.now);
      const stats = newStats(memberId, input.now);
      const view = publicMemberView(member, stats, identityId);
      const succeeded: IdempotencyRecord = {
        ...idemRecord,
        status: "succeeded",
        resultRef: view
      };
      return {
        identity,
        member,
        stats,
        idem: succeeded,
        audit: buildAuditEntry({
          actorType: "member",
          actorId: memberId,
          action: "member.register",
          target: `members/${memberId}`,
          reason: "first register",
          requestId: input.requestId,
          before: null,
          after: { memberId, status: member.status, avatarKey: member.avatarKey, revision: 1 },
          now: input.now
        }),
        result: view
      };
    })
  );
  if (attempted.ok) {
    const { mutation, budget } = attempted.value;
    if (mutation.error === "IDEMPOTENCY_CONFLICT") {
      return fail("IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT");
    }
    if (mutation.error) {
      return fail("INTERNAL_ERROR", mutation.error);
    }
    if (!budgetOk(budget)) {
      return fail("INTERNAL_ERROR", "TX_BUDGET_EXCEEDED");
    }
    return {
      ok: true,
      data: withWriteIds(mutation.result, identityId, idemRecord.id, mutationAuditId(mutation.audit)),
      replayed: mutation.replayed === true,
      created: Boolean(mutation.identity),
      budget
    };
  }
  const existing = await existingPublicView(input.stores, identityId, memberId);
  if (existing) {
    return {
      ok: true,
      data: withWriteIds(existing, identityId, idemRecord.id),
      created: false,
      budget: emptyBudget()
    };
  }
  return fail("SERVICE_BUSY", "REGISTER_TX_CONFLICT");
}

export async function updateMemberProfile(input: {
  stores: MemberWorkStore & MemberReadStore;
  fromAppId: string;
  fromOpenId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<MemberActionSuccess<MemberWriteView> | MemberActionFailure> {
  const parsed = parseProfileInput(input.data);
  if (!parsed.ok) {
    return fail("INVALID_ARGUMENT", "PROFILE_INPUT_INVALID", parsed.issues);
  }
  const { identityId, memberId } = trustedMemberIds(input.fromAppId, input.fromOpenId);
  const idemRecord = buildIdempotencyRecord({
    actorId: identityId,
    action: "member.updateProfile",
    idempotencyKey: input.idempotencyKey,
    payload: {
      nickname: parsed.nickname ?? null,
      avatarKey: parsed.avatarKey ?? null,
      expectedRevision: parsed.expectedRevision
    },
    requestId: input.requestId
  });

  const attempted = await runWithTxRetry(() =>
    input.stores.transactProfile(identityId, memberId, idemRecord.id, (snap) => {
      const replay = replayOrConflict(snap.idem, idemRecord.payloadHash, () => null);
      if (!replay.ok) {
        return { error: "IDEMPOTENCY_CONFLICT", result: undefined as unknown as MemberPublicView };
      }
      if (replay.replayed && snap.idem?.status === "succeeded" && snap.idem.resultRef) {
        return { result: snap.idem.resultRef as MemberPublicView, replayed: true };
      }
      if (!snap.identity) {
        return { error: "MEMBER_REQUIRED", result: undefined as unknown as MemberPublicView };
      }
      const current = snap.member;
      if (!current) {
        return { error: "MEMBER_ROW_MISSING", result: undefined as unknown as MemberPublicView };
      }
      if (current.status === "disabled" || current.status === "deleting" || current.status === "deleted") {
        return { error: "ACCOUNT_DISABLED", result: undefined as unknown as MemberPublicView };
      }
      if (current.revision !== parsed.expectedRevision) {
        return { error: "VERSION_CONFLICT", result: undefined as unknown as MemberPublicView };
      }
      const next: MemberRecord = {
        ...current,
        nickname: parsed.nickname ?? current.nickname,
        avatarKey: parsed.avatarKey ?? current.avatarKey,
        revision: current.revision + 1,
        updatedAt: input.now.toISOString()
      };
      const view = publicMemberView(next, snap.stats, identityId);
      return {
        member: next,
        idem: {
          ...idemRecord,
          status: "succeeded",
          resultRef: view
        },
        audit: buildAuditEntry({
          actorType: "member",
          actorId: current.memberId,
          action: "member.updateProfile",
          target: `members/${current.memberId}`,
          reason: "profile update",
          requestId: input.requestId,
          before: { nickname: current.nickname, avatarKey: current.avatarKey, revision: current.revision },
          after: { nickname: next.nickname, avatarKey: next.avatarKey, revision: next.revision },
          now: input.now
        }),
        result: view
      };
    })
  );
  if (!attempted.ok) {
    return fail("SERVICE_BUSY", "PROFILE_TX_CONFLICT");
  }
  const { mutation, budget } = attempted.value;
  if (mutation.error === "MEMBER_REQUIRED") return fail("MEMBER_REQUIRED", "MEMBER_NOT_REGISTERED");
  if (mutation.error === "ACCOUNT_DISABLED") return fail("ACCOUNT_DISABLED", "MEMBER_DISABLED");
  if (mutation.error === "VERSION_CONFLICT") return fail("VERSION_CONFLICT", "PROFILE_REVISION_MISMATCH");
  if (mutation.error === "IDEMPOTENCY_CONFLICT") return fail("IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT");
  if (mutation.error) return fail("INTERNAL_ERROR", mutation.error);
  if (!budgetOk(budget)) return fail("INTERNAL_ERROR", "TX_BUDGET_EXCEEDED");
  return {
    ok: true,
    data: withWriteIds(mutation.result, identityId, idemRecord.id, mutationAuditId(mutation.audit)),
    replayed: mutation.replayed === true,
    budget
  };
}

export function profileUnchanged(before: MemberRecord, after: MemberRecord | undefined): boolean {
  if (!after) return true;
  return (
    before.nickname === after.nickname &&
    before.avatarKey === after.avatarKey &&
    before.status === after.status &&
    before.rankingOptIn === after.rankingOptIn &&
    before.revision === after.revision &&
    payloadHash(before.consentVersions) === payloadHash(after.consentVersions)
  );
}
