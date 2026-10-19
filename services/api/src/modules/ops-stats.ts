import {
  OPS_STATS_ACTIONS,
  OPS_STATS_SCAN_LIMIT,
  aggregateOpsExceptions,
  aggregateOpsStats,
  canViewOpsStats,
  canViewOpsTutorial,
  opsStatsSnapshotId,
  opsStatsSnapshotWrite,
  tutorialStepsForRoles,
  type OpsAttemptRow,
  type OpsDiffRow,
  type OpsFeedbackRow,
  type OpsMemberRow,
  type OpsOrderRow,
  type OpsRefundRow,
  type OpsVipRow
} from "@mw/shared";

export const ADMIN_OPS_STATS_ACTIONS = [...OPS_STATS_ACTIONS] as const;
export const OPS_STATS_FIXTURE_DAY_KEY = "mw25-leftover";
export const OPS_STATS_SNAPSHOT_COLLECTION = "ops_stats_snapshots";

export type OpsStatsFailure = { ok: false; code: string; reason: string; issues?: string[] };
export type OpsStatsSuccess<T> = { ok: true; data: T };

export interface OpsStatsStore {
  listMembers(limit: number): Promise<OpsMemberRow[]>;
  listSubmittedAttempts(limit: number): Promise<OpsAttemptRow[]>;
  listVipAccounts(limit: number): Promise<OpsVipRow[]>;
  listOrders(limit: number): Promise<OpsOrderRow[]>;
  listRefunds(limit: number): Promise<OpsRefundRow[]>;
  listOpenDiffs(limit: number): Promise<OpsDiffRow[]>;
  listOpenFeedbacks(limit: number): Promise<OpsFeedbackRow[]>;
  saveSnapshot?(id: string, payload: Record<string, unknown>): Promise<void>;
}

function fail(code: string, reason: string, issues?: string[]): OpsStatsFailure {
  return issues ? { ok: false, code, reason, issues } : { ok: false, code, reason };
}

async function loadSource(store: OpsStatsStore) {
  const limit = OPS_STATS_SCAN_LIMIT;
  const [members, attempts, vipAccounts, orders, refunds, diffs, feedbacks] = await Promise.all([
    store.listMembers(limit),
    store.listSubmittedAttempts(limit),
    store.listVipAccounts(limit),
    store.listOrders(limit),
    store.listRefunds(limit),
    store.listOpenDiffs(limit),
    store.listOpenFeedbacks(limit)
  ]);
  return { members, attempts, vipAccounts, orders, refunds, diffs, feedbacks };
}

export async function readOpsStats(input: {
  store: OpsStatsStore;
  roles: readonly string[];
  now: Date;
  persistFixture?: boolean;
}): Promise<OpsStatsFailure | OpsStatsSuccess<ReturnType<typeof aggregateOpsStats> & { leftoverSnapshotId?: string }>> {
  if (!canViewOpsStats(input.roles)) {
    return fail("FORBIDDEN", "CONTENT_STATS_DENIED");
  }
  const source = await loadSource(input.store);
  const data = aggregateOpsStats({
    now: input.now,
    members: source.members,
    attempts: source.attempts,
    vipAccounts: source.vipAccounts,
    orders: source.orders,
    refunds: source.refunds
  });
  if (input.persistFixture !== true) {
    return { ok: true, data };
  }
  if (!input.store.saveSnapshot) {
    return fail("INTERNAL_ERROR", "SNAPSHOT_STORE_UNAVAILABLE");
  }
  const leftoverSnapshotId = opsStatsSnapshotId(OPS_STATS_FIXTURE_DAY_KEY);
  const payload = opsStatsSnapshotWrite({
    dayKey: OPS_STATS_FIXTURE_DAY_KEY,
    generatedAt: data.generatedAt
  });
  if (Object.prototype.hasOwnProperty.call(payload, "_id")) {
    return fail("INTERNAL_ERROR", "SNAPSHOT_ID_IN_PAYLOAD");
  }
  await input.store.saveSnapshot(leftoverSnapshotId, payload);
  return { ok: true, data: { ...data, leftoverSnapshotId } };
}

export async function readOpsExceptions(input: {
  store: OpsStatsStore;
  roles: readonly string[];
}): Promise<OpsStatsFailure | OpsStatsSuccess<ReturnType<typeof aggregateOpsExceptions>>> {
  if (!canViewOpsStats(input.roles)) {
    return fail("FORBIDDEN", "CONTENT_STATS_DENIED");
  }
  const source = await loadSource(input.store);
  return {
    ok: true,
    data: aggregateOpsExceptions({
      orders: source.orders,
      refunds: source.refunds,
      diffs: source.diffs,
      feedbacks: source.feedbacks
    })
  };
}

export function readOpsTutorial(input: { roles: readonly string[] }): OpsStatsFailure | OpsStatsSuccess<{
  steps: ReturnType<typeof tutorialStepsForRoles>;
  placeholder: false;
  mw12StillPartial: true;
}> {
  if (!canViewOpsTutorial(input.roles)) {
    return fail("FORBIDDEN", "ADMIN_REQUIRED");
  }
  return {
    ok: true,
    data: {
      steps: tutorialStepsForRoles(input.roles),
      placeholder: false,
      mw12StillPartial: true
    }
  };
}

export function memoryOpsStatsStore(seed: {
  members?: OpsMemberRow[];
  attempts?: OpsAttemptRow[];
  vipAccounts?: OpsVipRow[];
  orders?: OpsOrderRow[];
  refunds?: OpsRefundRow[];
  diffs?: OpsDiffRow[];
  feedbacks?: OpsFeedbackRow[];
} = {}): OpsStatsStore & { snapshots: Map<string, Record<string, unknown>> } {
  const snapshots = new Map<string, Record<string, unknown>>();
  return {
    snapshots,
    async listMembers(limit) {
      return (seed.members || []).slice(0, limit);
    },
    async listSubmittedAttempts(limit) {
      return (seed.attempts || []).slice(0, limit);
    },
    async listVipAccounts(limit) {
      return (seed.vipAccounts || []).slice(0, limit);
    },
    async listOrders(limit) {
      return (seed.orders || []).slice(0, limit);
    },
    async listRefunds(limit) {
      return (seed.refunds || []).slice(0, limit);
    },
    async listOpenDiffs(limit) {
      return (seed.diffs || []).slice(0, limit);
    },
    async listOpenFeedbacks(limit) {
      return (seed.feedbacks || []).slice(0, limit);
    },
    async saveSnapshot(id, payload) {
      if (Object.prototype.hasOwnProperty.call(payload, "_id")) {
        throw new Error("SNAPSHOT_ID_IN_PAYLOAD");
      }
      snapshots.set(id, { ...payload });
    }
  };
}
