import {
  GROWTH_SCHEMA_VERSION,
  MEDAL_GRANT_SOURCE_RECOMPUTE,
  buildAuditEntry,
  buildIdempotencyRecord,
  growthImpactOf,
  levelIdForScore,
  nextGrowthConfigVersion,
  parseGrowthPreviewInput,
  parseGrowthPublishInput,
  parseGrowthRecomputeInput,
  planMedalGrants,
  type GrowthConfigRecord,
  type GrowthImpactSummary,
  type GrowthLevel
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import { TX_BUDGET_LIMIT } from "./transaction-jobs.js";
import { growthGrantIdsFor, resolveGrowthConfig, type GrowthWorkStore } from "./growth-stores.js";

export const GROWTH_ADMIN_READ_ACTIONS = ["growth.config", "growth.preview"] as const;
export const GROWTH_ADMIN_WRITE_ACTIONS = ["growth.publish", "growth.recompute"] as const;

/** 预览与重算的扫描上限：只做有限扫描，超出必须如实报告 truncated。 */
export const GROWTH_SCAN_LIMIT = 500;
export const GROWTH_SCAN_PAGE = 100;
export const GROWTH_RECOMPUTE_LIMIT = 200;

export type GrowthActionFailure = {
  ok: false;
  code: string;
  reason: string;
  issues?: string[];
  details?: Record<string, unknown>;
};

export type GrowthActionSuccess<T> = {
  ok: true;
  data: T;
  replayed?: boolean;
  budget: TxBudget;
};

export type GrowthRecomputeRow = {
  memberId: string;
  fromLevelId: string;
  toLevelId: string;
  levelChanged: boolean;
  medalsGranted: string[];
};

export type GrowthRecomputeSummary = {
  requested: number;
  recomputed: number;
  levelChanged: number;
  medalsGranted: number;
  remaining: number;
  rows: GrowthRecomputeRow[];
  truncated: boolean;
};

function emptyBudget(): TxBudget {
  return { reads: 0, writes: 0, total: 0, elapsedMs: 0 };
}

function fail(code: string, reason: string, extra?: { issues?: string[]; details?: Record<string, unknown> }): GrowthActionFailure {
  return {
    ok: false,
    code,
    reason,
    ...(extra?.issues ? { issues: extra.issues } : {}),
    ...(extra?.details ? { details: extra.details } : {})
  };
}

export async function readGrowthConfigForAdmin(
  store: GrowthWorkStore,
  now: Date
): Promise<GrowthActionSuccess<{ config: GrowthConfigRecord; source: "stored" | "default"; scanLimit: number }>> {
  const stored = await store.getConfig();
  const config = stored && stored.levels.length ? stored : await resolveGrowthConfig(store, now);
  return {
    ok: true,
    data: { config, source: stored && stored.levels.length ? "stored" : "default", scanLimit: GROWTH_SCAN_LIMIT },
    budget: emptyBudget()
  };
}

async function growthImpact(
  store: GrowthWorkStore,
  levels: readonly GrowthLevel[]
): Promise<GrowthImpactSummary & { scanLimit: number; grantsTruncated: boolean }> {
  const statsScan = await store.scanMemberStats({ limit: GROWTH_SCAN_LIMIT, pageSize: GROWTH_SCAN_PAGE });
  const grantsScan = await store.scanGrants({ limit: GROWTH_SCAN_LIMIT, pageSize: GROWTH_SCAN_PAGE });
  const grantedMedalIdsByMember: Record<string, string[]> = {};
  for (const grant of grantsScan.rows) {
    if (grant.revokedAt) continue;
    const list = grantedMedalIdsByMember[grant.memberId] || [];
    list.push(grant.medalId);
    grantedMedalIdsByMember[grant.memberId] = list;
  }
  const summary = growthImpactOf({
    members: statsScan.rows,
    levels,
    grantedMedalIdsByMember,
    truncated: statsScan.truncated || grantsScan.truncated
  });
  return { ...summary, scanLimit: GROWTH_SCAN_LIMIT, grantsTruncated: grantsScan.truncated };
}

/** 门槛变动预览：不写任何文档，只按现有总分重算并给出影响人数与待补发勋章。 */
export async function previewGrowthChange(
  store: GrowthWorkStore,
  data: Record<string, unknown>
): Promise<GrowthActionSuccess<GrowthImpactSummary & { scanLimit: number; grantsTruncated: boolean; wroteDocs: false }> | GrowthActionFailure> {
  const parsed = parseGrowthPreviewInput(data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "GROWTH_LEVELS_INVALID", { issues: parsed.issues });
  const impact = await growthImpact(store, parsed.levels);
  return { ok: true, data: { ...impact, wroteDocs: false }, budget: emptyBudget() };
}

async function recomputeMembers(input: {
  store: GrowthWorkStore;
  config: GrowthConfigRecord;
  memberIds: string[];
  limit: number;
  now: Date;
  requested: number;
  truncated: boolean;
}): Promise<GrowthRecomputeSummary> {
  const rows: GrowthRecomputeRow[] = [];
  const targets = input.memberIds.slice(0, input.limit);
  const nowIso = input.now.toISOString();
  for (const memberId of targets) {
    const grantIds = growthGrantIdsFor(memberId, input.config.levels);
    const attempted = await input.store.transactMemberGrowth<GrowthRecomputeRow | undefined>({
      memberId,
      grantIds,
      mutate: (snap) => {
        if (!snap.stats) return { result: undefined };
        const stats = snap.stats;
        const toLevelId = levelIdForScore(stats.totalScore, input.config.levels);
        const grants = planMedalGrants({
          memberId,
          totalScore: stats.totalScore,
          levels: input.config.levels,
          existingMedalIds: snap.grants.map((grant) => grant.medalId),
          sourceType: MEDAL_GRANT_SOURCE_RECOMPUTE,
          sourceId: `growth@v${input.config.configVersion}`,
          configVersion: input.config.configVersion,
          nowIso
        });
        const levelChanged = toLevelId !== stats.levelId;
        const versionChanged = stats.growthVersion !== input.config.configVersion;
        const nextStats =
          levelChanged || versionChanged
            ? {
                ...stats,
                levelId: toLevelId,
                growthVersion: input.config.configVersion,
                revision: stats.revision + 1,
                updatedAt: nowIso
              }
            : undefined;
        return {
          ...(nextStats ? { stats: nextStats } : {}),
          ...(grants.length ? { grants } : {}),
          result: {
            memberId,
            fromLevelId: stats.levelId,
            toLevelId,
            levelChanged,
            medalsGranted: grants.map((grant) => grant.medalId)
          }
        };
      }
    });
    const budget = attempted.budget;
    if (budget.total > TX_BUDGET_LIMIT) {
      return {
        requested: input.requested,
        recomputed: rows.length,
        levelChanged: rows.filter((row) => row.levelChanged).length,
        medalsGranted: rows.reduce((sum, row) => sum + row.medalsGranted.length, 0),
        remaining: Math.max(0, input.requested - rows.length),
        rows,
        truncated: input.truncated
      };
    }
    if (attempted.mutation.result) rows.push(attempted.mutation.result);
  }
  return {
    requested: input.requested,
    recomputed: rows.length,
    levelChanged: rows.filter((row) => row.levelChanged).length,
    medalsGranted: rows.reduce((sum, row) => sum + row.medalsGranted.length, 0),
    remaining: Math.max(0, input.requested - rows.length),
    rows,
    truncated: input.truncated
  };
}

/** 发布新门槛：写配置新版本，随后对现有总分做有界重算（补发新达到的勋章，不删除既得勋章）。 */
export async function publishGrowthConfig(input: {
  store: GrowthWorkStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<
  | GrowthActionSuccess<{
      config: GrowthConfigRecord;
      impact: GrowthImpactSummary & { scanLimit: number; grantsTruncated: boolean };
      recompute: GrowthRecomputeSummary;
    }>
  | GrowthActionFailure
> {
  const parsed = parseGrowthPublishInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "GROWTH_CONFIG_INVALID", { issues: parsed.issues });
  const current = await resolveGrowthConfig(input.store, input.now);
  if (current.configVersion !== parsed.expectedConfigVersion) {
    return fail("VERSION_CONFLICT", "GROWTH_CONFIG_VERSION_MISMATCH", {
      details: { currentConfigVersion: current.configVersion }
    });
  }
  const nowIso = input.now.toISOString();
  const nextConfig: GrowthConfigRecord = {
    configVersion: nextGrowthConfigVersion(current.configVersion),
    levels: parsed.levels,
    publishedAt: nowIso,
    publishedBy: input.actorId,
    reason: parsed.reason,
    note: "由后台发布的等级门槛（MW16 可配置，最终门槛在 MW28 冻结）。",
    placeholder: false,
    schemaVersion: GROWTH_SCHEMA_VERSION,
    updatedAt: nowIso
  };
  const idem = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "growth.publish",
    idempotencyKey: input.idempotencyKey,
    payload: { levels: parsed.levels, reason: parsed.reason, expectedConfigVersion: parsed.expectedConfigVersion },
    requestId: input.requestId
  });
  const attempted = await input.store.transactPublish({
    config: nextConfig,
    expectedConfigVersion: parsed.expectedConfigVersion,
    idempotencyId: idem.id,
    idempotency: idem,
    audit: buildAuditEntry({
      actorType: "admin",
      actorId: input.actorId,
      action: "growth.publish",
      target: "app_config/growth",
      reason: parsed.reason,
      requestId: input.requestId,
      before: { configVersion: current.configVersion, levels: current.levels },
      after: { configVersion: nextConfig.configVersion, levels: nextConfig.levels },
      now: input.now
    })
  });
  const mutation = attempted.mutation;
  if (mutation.error === "IDEMPOTENCY_CONFLICT") return fail("IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT");
  if (mutation.error === "VERSION_CONFLICT") {
    return fail("VERSION_CONFLICT", "GROWTH_CONFIG_VERSION_MISMATCH", {
      details: { currentConfigVersion: current.configVersion }
    });
  }
  if (mutation.error) return fail("INTERNAL_ERROR", mutation.error);
  if (attempted.budget.total > TX_BUDGET_LIMIT) return fail("INTERNAL_ERROR", "TX_BUDGET_EXCEEDED");

  const published = mutation.config || nextConfig;
  const impact = await growthImpact(input.store, published.levels);
  const statsScan = await input.store.scanMemberStats({ limit: GROWTH_SCAN_LIMIT, pageSize: GROWTH_SCAN_PAGE });
  const recompute = await recomputeMembers({
    store: input.store,
    config: published,
    memberIds: statsScan.rows.map((row) => row.memberId),
    limit: GROWTH_RECOMPUTE_LIMIT,
    now: input.now,
    requested: statsScan.rows.length,
    truncated: statsScan.truncated
  });
  return {
    ok: true,
    data: { config: published, impact, recompute },
    replayed: mutation.replayed === true,
    budget: attempted.budget
  };
}

/** 当前等级可重算：按当前生效门槛重算等级并补齐勋章；既得勋章保留。 */
export async function recomputeGrowth(input: {
  store: GrowthWorkStore;
  data: Record<string, unknown>;
  now: Date;
}): Promise<
  GrowthActionSuccess<{ configVersion: number; recompute: GrowthRecomputeSummary }> | GrowthActionFailure
> {
  const parsed = parseGrowthRecomputeInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "GROWTH_RECOMPUTE_INVALID", { issues: parsed.issues });
  const config = await resolveGrowthConfig(input.store, input.now);
  if (parsed.targetMemberId) {
    const recompute = await recomputeMembers({
      store: input.store,
      config,
      memberIds: [parsed.targetMemberId],
      limit: 1,
      now: input.now,
      requested: 1,
      truncated: false
    });
    return { ok: true, data: { configVersion: config.configVersion, recompute }, budget: emptyBudget() };
  }
  const statsScan = await input.store.scanMemberStats({ limit: parsed.limit, pageSize: GROWTH_SCAN_PAGE });
  const recompute = await recomputeMembers({
    store: input.store,
    config,
    memberIds: statsScan.rows.map((row) => row.memberId),
    limit: parsed.limit,
    now: input.now,
    requested: statsScan.rows.length,
    truncated: statsScan.truncated
  });
  return { ok: true, data: { configVersion: config.configVersion, recompute }, budget: emptyBudget() };
}
