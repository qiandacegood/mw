import {
  buildAuditEntry,
  defaultPolicyRecord,
  type AuditEntry,
  type ConsentVersions,
  type IdempotencyRecord,
  type MemberStatus
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";

export interface IdentityRecord {
  identityId: string;
  memberId: string;
  provider: "wechat_mini";
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemberRecord {
  memberId: string;
  nickname: string;
  avatarKey: string;
  status: MemberStatus;
  rankingOptIn: boolean;
  consentVersions: ConsentVersions;
  revision: number;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemberStatsRecord {
  memberId: string;
  totalScore: number;
  scoreSeq: number;
  levelId: string;
  growthVersion: number;
  revision: number;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyRecord {
  agreementVersion: string;
  privacyVersion: string;
  agreementTitle: string;
  privacyTitle: string;
  placeholder: boolean;
  note: string;
  updatedAt: string;
  schemaVersion: number;
}

export interface MemberRegisterSnapshot {
  identity?: IdentityRecord;
  member?: MemberRecord;
  stats?: MemberStatsRecord;
  idem?: IdempotencyRecord;
  policies?: PolicyRecord;
}

export interface MemberRegisterMutation<T> {
  identity?: IdentityRecord;
  member?: MemberRecord;
  stats?: MemberStatsRecord;
  idem?: IdempotencyRecord;
  audit?: AuditEntry;
  result: T;
  error?: string;
  replayed?: boolean;
}

export interface MemberProfileSnapshot {
  identity?: IdentityRecord;
  member?: MemberRecord;
  stats?: MemberStatsRecord;
  idem?: IdempotencyRecord;
}

export interface MemberProfileMutation<T> {
  member?: MemberRecord;
  idem?: IdempotencyRecord;
  audit?: AuditEntry;
  result: T;
  error?: string;
  replayed?: boolean;
}

export interface PolicyStore {
  get(): Promise<PolicyRecord>;
}

export interface MemberReadStore {
  getIdentity(identityId: string): Promise<IdentityRecord | undefined>;
  getMember(memberId: string): Promise<MemberRecord | undefined>;
  getStats(memberId: string): Promise<MemberStatsRecord | undefined>;
}

export interface MemberWorkStore {
  crashAfter?: "identity" | "member" | "stats" | "idempotency" | "audit" | null;
  transactRegister<T>(
    identityId: string,
    memberId: string,
    idempotencyId: string,
    mutate: (snap: MemberRegisterSnapshot) => MemberRegisterMutation<T>
  ): Promise<{ mutation: MemberRegisterMutation<T>; budget: TxBudget }>;
  transactProfile<T>(
    identityId: string,
    memberId: string,
    idempotencyId: string,
    mutate: (snap: MemberProfileSnapshot) => MemberProfileMutation<T>
  ): Promise<{ mutation: MemberProfileMutation<T>; budget: TxBudget }>;
}

export function memoryPolicyStore(seed?: Partial<PolicyRecord>): PolicyStore & { record: PolicyRecord } {
  const record = { ...defaultPolicyRecord(new Date("2026-10-08T09:00:00.000Z")), ...seed };
  return {
    record,
    async get() {
      return { ...record };
    }
  };
}

export type MemoryMemberBundle = MemberReadStore &
  MemberWorkStore & {
    identities: Map<string, IdentityRecord>;
    members: Map<string, MemberRecord>;
    stats: Map<string, MemberStatsRecord>;
    idem: Map<string, IdempotencyRecord>;
    audits: AuditEntry[];
    disable(memberId: string): void;
  };

function cloneIdentity(row: IdentityRecord): IdentityRecord {
  return { ...row };
}

function cloneMember(row: MemberRecord): MemberRecord {
  return { ...row, consentVersions: { ...row.consentVersions } };
}

function cloneStats(row: MemberStatsRecord): MemberStatsRecord {
  return { ...row };
}

function cloneIdem(row: IdempotencyRecord): IdempotencyRecord {
  return { ...row };
}

export function memoryMemberBundle(): MemoryMemberBundle {
  const identities = new Map<string, IdentityRecord>();
  const members = new Map<string, MemberRecord>();
  const stats = new Map<string, MemberStatsRecord>();
  const idem = new Map<string, IdempotencyRecord>();
  const audits: AuditEntry[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  let crashAfter: MemoryMemberBundle["crashAfter"] = null;

  function applyRegister<T>(mutation: MemberRegisterMutation<T>) {
    if (mutation.identity) identities.set(mutation.identity.identityId, cloneIdentity(mutation.identity));
    if (mutation.member) members.set(mutation.member.memberId, cloneMember(mutation.member));
    if (mutation.stats) stats.set(mutation.stats.memberId, cloneStats(mutation.stats));
    if (mutation.idem) idem.set(mutation.idem.id, cloneIdem(mutation.idem));
    if (mutation.audit) audits.push({ ...mutation.audit });
  }

  function applyProfile<T>(mutation: MemberProfileMutation<T>) {
    if (mutation.member) members.set(mutation.member.memberId, cloneMember(mutation.member));
    if (mutation.idem) idem.set(mutation.idem.id, cloneIdem(mutation.idem));
    if (mutation.audit) audits.push({ ...mutation.audit });
  }

  const bundle: MemoryMemberBundle = {
    identities,
    members,
    stats,
    idem,
    audits,
    get crashAfter() {
      return crashAfter;
    },
    set crashAfter(value) {
      crashAfter = value;
    },
    disable(memberId: string) {
      const current = members.get(memberId);
      if (current) {
        members.set(memberId, { ...current, status: "disabled", revision: current.revision + 1 });
      }
    },
    async getIdentity(identityId) {
      const row = identities.get(identityId);
      return row ? cloneIdentity(row) : undefined;
    },
    async getMember(memberId) {
      const row = members.get(memberId);
      return row ? cloneMember(row) : undefined;
    },
    async getStats(memberId) {
      const row = stats.get(memberId);
      return row ? cloneStats(row) : undefined;
    },
    transactRegister(identityId, memberId, idempotencyId, mutate) {
      const run = queue.then(() => {
        const started = Date.now();
        const mutation = mutate({
          identity: identities.get(identityId) ? cloneIdentity(identities.get(identityId) as IdentityRecord) : undefined,
          member: members.get(memberId) ? cloneMember(members.get(memberId) as MemberRecord) : undefined,
          stats: stats.get(memberId) ? cloneStats(stats.get(memberId) as MemberStatsRecord) : undefined,
          idem: idem.get(idempotencyId) ? cloneIdem(idem.get(idempotencyId) as IdempotencyRecord) : undefined
        });
        let writes = 0;
        if (mutation.identity) writes += 1;
        if (mutation.member) writes += 1;
        if (mutation.stats) writes += 1;
        if (mutation.idem) writes += 1;
        if (mutation.audit) writes += 1;
        if (crashAfter === "identity" && mutation.identity) {
          throw new Error("CRASH_AFTER_IDENTITY");
        }
        if (crashAfter === "member" && mutation.member) {
          throw new Error("CRASH_AFTER_MEMBER");
        }
        if (crashAfter === "stats" && mutation.stats) {
          throw new Error("CRASH_AFTER_STATS");
        }
        if (crashAfter === "idempotency" && mutation.idem) {
          throw new Error("CRASH_AFTER_IDEMPOTENCY");
        }
        if (crashAfter === "audit" && mutation.audit) {
          throw new Error("CRASH_AFTER_AUDIT");
        }
        applyRegister(mutation);
        return {
          mutation,
          budget: { reads: 4, writes, total: 4 + writes, elapsedMs: Date.now() - started }
        };
      });
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
    transactProfile(identityId, memberId, idempotencyId, mutate) {
      const run = queue.then(() => {
        const started = Date.now();
        const mutation = mutate({
          identity: identities.get(identityId) ? cloneIdentity(identities.get(identityId) as IdentityRecord) : undefined,
          member: members.get(memberId) ? cloneMember(members.get(memberId) as MemberRecord) : undefined,
          stats: stats.get(memberId) ? cloneStats(stats.get(memberId) as MemberStatsRecord) : undefined,
          idem: idem.get(idempotencyId) ? cloneIdem(idem.get(idempotencyId) as IdempotencyRecord) : undefined
        });
        let writes = 0;
        if (mutation.member) writes += 1;
        if (mutation.idem) writes += 1;
        if (mutation.audit) writes += 1;
        if (crashAfter === "member" && mutation.member) {
          throw new Error("CRASH_AFTER_MEMBER");
        }
        if (crashAfter === "idempotency" && mutation.idem) {
          throw new Error("CRASH_AFTER_IDEMPOTENCY");
        }
        if (crashAfter === "audit" && mutation.audit) {
          throw new Error("CRASH_AFTER_AUDIT");
        }
        applyProfile(mutation);
        return {
          mutation,
          budget: { reads: 3, writes, total: 3 + writes, elapsedMs: Date.now() - started }
        };
      });
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  };
  return bundle;
}

export { buildAuditEntry };
