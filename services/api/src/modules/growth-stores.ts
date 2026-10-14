import {
  GROWTH_CONFIG_DOC_ID,
  GROWTH_SCHEMA_VERSION,
  cloneGrowthLevels,
  defaultGrowthConfig,
  defaultGrowthLevels,
  medalGrantId,
  type AuditEntry,
  type GrowthConfigRecord,
  type GrowthLevel,
  type IdempotencyRecord,
  type MedalGrantRecord
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { MemberStatsRecord } from "./member-stores.js";

export const GROWTH_COLLECTIONS = {
  medalGrants: "medal_grants",
  memberStats: "member_stats",
  appConfig: "app_config",
  idempotency: "idempotency",
  auditLogs: "audit_logs"
} as const;

export { GROWTH_CONFIG_DOC_ID, GROWTH_SCHEMA_VERSION };

export type MemberStatsScanRow = {
  memberId: string;
  totalScore: number;
  levelId: string;
  growthVersion: number;
};

export type GrowthScan<T> = { rows: T[]; truncated: boolean };

export interface GrowthReadStore {
  getConfig(): Promise<GrowthConfigRecord | undefined>;
  listMemberGrants(memberId: string): Promise<MedalGrantRecord[]>;
  scanMemberStats(input: { limit: number; pageSize: number }): Promise<GrowthScan<MemberStatsScanRow>>;
  scanGrants(input: { limit: number; pageSize: number }): Promise<GrowthScan<MedalGrantRecord>>;
}

export type GrowthPublishInput = {
  config: GrowthConfigRecord;
  expectedConfigVersion: number;
  idempotencyId: string;
  idempotency: IdempotencyRecord;
  audit?: AuditEntry;
};

export type GrowthPublishSnapshot = {
  config?: GrowthConfigRecord;
  idem?: IdempotencyRecord;
};

export type GrowthPublishMutation = {
  config?: GrowthConfigRecord;
  idem?: IdempotencyRecord;
  audit?: AuditEntry;
  error?: string;
  replayed?: boolean;
  result?: unknown;
};

export type GrowthMemberSnapshot = {
  stats?: MemberStatsRecord;
  grants: MedalGrantRecord[];
};

export type GrowthMemberMutation<T> = {
  stats?: MemberStatsRecord;
  grants?: MedalGrantRecord[];
  result: T;
  error?: string;
};

export interface GrowthWorkStore extends GrowthReadStore {
  transactPublish(input: GrowthPublishInput): Promise<{ mutation: GrowthPublishMutation; budget: TxBudget }>;
  transactMemberGrowth<T>(input: {
    memberId: string;
    grantIds: string[];
    mutate: (snap: GrowthMemberSnapshot) => GrowthMemberMutation<T>;
  }): Promise<{ mutation: GrowthMemberMutation<T>; budget: TxBudget }>;
}

export type MemoryGrowthBundle = GrowthWorkStore & {
  config?: GrowthConfigRecord;
  grants: Map<string, MedalGrantRecord>;
  memberStats: Map<string, MemberStatsRecord>;
  audits: AuditEntry[];
  idem: Map<string, IdempotencyRecord>;
  seedConfig(config: GrowthConfigRecord): void;
  seedStats(rows: MemberStatsRecord[]): void;
  seedGrant(grant: MedalGrantRecord): void;
  /** 本地测试用：与其它本地 bundle 共享同一份 member_stats / medal_grants（云端为同一集合）。 */
  linkMemberStats(stats: Map<string, MemberStatsRecord>): void;
  linkGrants(grants: Map<string, MedalGrantRecord>): void;
};

function cloneLevels(levels: readonly GrowthLevel[]): GrowthLevel[] {
  return cloneGrowthLevels(levels);
}

function cloneConfig(config: GrowthConfigRecord): GrowthConfigRecord {
  return { ...config, levels: cloneLevels(config.levels) };
}

function cloneGrant(row: MedalGrantRecord): MedalGrantRecord {
  return { ...row };
}

function cloneStats(row: MemberStatsRecord): MemberStatsRecord {
  return { ...row };
}

export function memoryGrowthStore(seed: { config?: GrowthConfigRecord; grants?: MedalGrantRecord[] } = {}): MemoryGrowthBundle {
  let grants = new Map<string, MedalGrantRecord>();
  let memberStats = new Map<string, MemberStatsRecord>();
  const audits: AuditEntry[] = [];
  const idem = new Map<string, IdempotencyRecord>();
  let config = seed.config ? cloneConfig(seed.config) : undefined;
  for (const grant of seed.grants || []) grants.set(grant.grantId, cloneGrant(grant));
  let queue: Promise<unknown> = Promise.resolve();

  const bundle: MemoryGrowthBundle = {
    grants,
    memberStats,
    audits,
    idem,
    get config() {
      return config ? cloneConfig(config) : undefined;
    },
    set config(next) {
      config = next ? cloneConfig(next) : undefined;
    },
    seedConfig(next) {
      config = cloneConfig(next);
    },
    seedStats(rows) {
      for (const row of rows) memberStats.set(row.memberId, cloneStats(row));
    },
    seedGrant(grant) {
      grants.set(grant.grantId, cloneGrant(grant));
    },
    linkMemberStats(next) {
      memberStats = next;
      bundle.memberStats = next;
    },
    linkGrants(next) {
      grants = next;
      bundle.grants = next;
    },
    async getConfig() {
      return config ? cloneConfig(config) : undefined;
    },
    async listMemberGrants(memberId) {
      return [...grants.values()].filter((row) => row.memberId === memberId).map(cloneGrant);
    },
    async scanMemberStats(input) {
      const rows = [...memberStats.values()].map((row) => ({
        memberId: row.memberId,
        totalScore: row.totalScore,
        levelId: row.levelId,
        growthVersion: row.growthVersion
      }));
      return { rows: rows.slice(0, input.limit), truncated: rows.length > input.limit };
    },
    async scanGrants(input) {
      const rows = [...grants.values()].map(cloneGrant);
      return { rows: rows.slice(0, input.limit), truncated: rows.length > input.limit };
    },
    transactPublish(input) {
      const run = queue.then(() => {
        const started = Date.now();
        const current = config;
        const existingIdem = idem.get(input.idempotencyId);
        const mutation: GrowthPublishMutation = { result: undefined };
        if (existingIdem && existingIdem.payloadHash !== input.idempotency.payloadHash) {
          mutation.error = "IDEMPOTENCY_CONFLICT";
          return { mutation, budget: { reads: 2, writes: 0, total: 2, elapsedMs: Date.now() - started } };
        }
        if (existingIdem && existingIdem.status === "succeeded") {
          mutation.replayed = true;
          mutation.result = existingIdem.resultRef;
          mutation.idem = { ...existingIdem };
          mutation.config = current ? cloneConfig(current) : undefined;
          return { mutation, budget: { reads: 2, writes: 0, total: 2, elapsedMs: Date.now() - started } };
        }
        if ((current?.configVersion ?? 0) !== input.expectedConfigVersion) {
          mutation.error = "VERSION_CONFLICT";
          return { mutation, budget: { reads: 2, writes: 0, total: 2, elapsedMs: Date.now() - started } };
        }
        config = cloneConfig(input.config);
        const succeeded: IdempotencyRecord = { ...input.idempotency, status: "succeeded", resultRef: input.config };
        idem.set(succeeded.id, { ...succeeded });
        if (input.audit) audits.push({ ...input.audit });
        mutation.config = config ? cloneConfig(config) : undefined;
        mutation.idem = { ...succeeded };
        mutation.audit = input.audit ? { ...input.audit } : undefined;
        mutation.result = input.config;
        return {
          mutation,
          budget: { reads: 2, writes: 3, total: 5, elapsedMs: Date.now() - started }
        };
      });
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
    transactMemberGrowth(input) {
      const run = queue.then(() => {
        const started = Date.now();
        const mutation = input.mutate({
          stats: memberStats.get(input.memberId) ? cloneStats(memberStats.get(input.memberId) as MemberStatsRecord) : undefined,
          grants: input.grantIds
            .map((id) => grants.get(id))
            .filter((row): row is MedalGrantRecord => Boolean(row))
            .map(cloneGrant)
        });
        let writes = 0;
        if (mutation.stats) {
          memberStats.set(mutation.stats.memberId, cloneStats(mutation.stats));
          writes += 1;
        }
        for (const grant of mutation.grants || []) {
          grants.set(grant.grantId, cloneGrant(grant));
          writes += 1;
        }
        return {
          mutation,
          budget: { reads: 1 + input.grantIds.length, writes, total: 1 + input.grantIds.length + writes, elapsedMs: Date.now() - started }
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

/** 读取当前生效门槛；未配置时回落到产品说明书 V1.1 的初始建议配置（configVersion 0）。 */
export async function resolveGrowthConfig(store: GrowthReadStore | undefined, now: Date): Promise<GrowthConfigRecord> {
  const stored = store ? await store.getConfig() : undefined;
  if (stored && stored.levels.length) return stored;
  const fallback = defaultGrowthConfig(now);
  return {
    ...fallback,
    configVersion: 0,
    levels: defaultGrowthLevels(),
    placeholder: true,
    note: "尚未发布自定义门槛，使用产品说明书 V1.1 初始建议配置。"
  };
}

export function growthGrantIdsFor(memberId: string, levels: readonly GrowthLevel[]): string[] {
  return [...new Set(levels.map((row) => row.medalId).filter(Boolean))].map((medalId) => medalGrantId(memberId, medalId));
}
