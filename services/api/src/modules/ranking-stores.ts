import {
  RANKING_SCHEMA_VERSION,
  type AuditEntry,
  type IdempotencyRecord,
  type RankingHeadRecord,
  type RankingRowRecord,
  type RankingRuntimeRecord,
  type RankingScope
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";

/**
 * MW17 排行榜存储接口。
 *
 * 集合归属（见 docs/architecture/data-model-v1.0.md 第 4 节）：
 * - `ranking_heads`：`_id = H(scope,periodKey,categoryId)`，只指向完整快照；
 * - `ranking_rows`：`_id = H(boardId,generation,memberId)`，写全体参与者名次行；
 * - `app_config/ranking`：快照运行状态（已发布代、刷新请求、重建标记、历史缺口诊断）。
 *
 * `ranking_heads` / `ranking_rows` / `app_config/ranking` 是派生、可重建、跨用户共享的快照，
 * 不计入 leftover（删除会让全站榜单空白）。
 */
export const RANKING_COLLECTIONS = {
  rankingHeads: "ranking_heads",
  rankingRows: "ranking_rows",
  scoreMetrics: "score_metrics",
  memberStats: "member_stats",
  members: "members",
  categories: "categories",
  appConfig: "app_config",
  idempotency: "idempotency",
  auditLogs: "audit_logs"
} as const;

export type RankingMemberRow = {
  memberId: string;
  nickname: string;
  avatarKey: string;
  status: "active" | "disabled" | "deleting" | "deleted";
  rankingOptIn: boolean;
  rankingBanned?: boolean;
  revision: number;
};

export type RankingMetricRow = {
  metricId: string;
  metricGeneration: string;
  scope: RankingScope;
  periodKey: string;
  categoryId: string;
  memberId: string;
  value: number;
  reachedAt: string;
};

export type RankingStatsRow = {
  memberId: string;
  totalScore: number;
  levelId: string;
};

export type RankingCategoryRow = {
  categoryId: string;
  parentId: string | null;
  ancestorIds: string[];
  enabled: boolean;
  deletedAt: string | null;
};

export type RankingScan<T> = { rows: T[]; truncated: boolean };

export type RankingObsolete = { boardId: string; generation: string };

export interface RankingReadStore {
  getRuntime(): Promise<RankingRuntimeRecord | undefined>;
  getHead(boardId: string): Promise<RankingHeadRecord | undefined>;
  listHeads(): Promise<RankingHeadRecord[]>;
  listRows(input: { boardId: string; generation: string; offset: number; limit: number }): Promise<{ rows: RankingRowRecord[] }>;
  getRow(input: { boardId: string; generation: string; memberId: string }): Promise<RankingRowRecord | undefined>;
  getMember(memberId: string): Promise<RankingMemberRow | undefined>;
  getStats(memberId: string): Promise<RankingStatsRow | undefined>;
  listMembers(memberIds: readonly string[]): Promise<RankingMemberRow[]>;
  getMetric(input: {
    metricGeneration: string;
    scope: RankingScope;
    periodKey: string;
    categoryId: string;
    memberId: string;
  }): Promise<RankingMetricRow | undefined>;
  scanMetrics(input: { limit: number }): Promise<RankingScan<RankingMetricRow>>;
  scanMembers(input: { limit: number }): Promise<RankingScan<RankingMemberRow>>;
  scanStats(input: { limit: number }): Promise<RankingScan<RankingStatsRow>>;
  listCategories(): Promise<RankingCategoryRow[]>;
}

export type RankingRebuildSnapshot = {
  idem?: IdempotencyRecord;
  runtime?: RankingRuntimeRecord;
};

export type RankingRebuildMutation<T> = {
  idem?: IdempotencyRecord;
  audit?: AuditEntry;
  runtime?: RankingRuntimeRecord;
  /** 与幂等记录同一次提交切换的板块头；写齐行数后才切换，读者只看已切换的代。 */
  heads?: RankingHeadRecord[];
  result: T;
  error?: string;
  replayed?: boolean;
};

export interface RankingWorkStore extends RankingReadStore {
  /** 只写该代的行（读者看不到未切换的代），并清理同一板块的历史代行。 */
  writeRows(rows: readonly RankingRowRecord[], obsolete: readonly RankingObsolete[]): Promise<{ rowsWritten: number; obsoleteRemoved: number }>;
  saveRuntime(runtime: RankingRuntimeRecord): Promise<void>;
  /** 交卷/参与变更后的待刷新标记（幂等：已有请求时间时不覆盖成更晚的时间）。 */
  markRequested(requestedAt: string): Promise<{ requestedAt: string; changed: boolean }>;
  transactRebuild<T>(
    input: {
      idempotencyId: string;
      idempotency: IdempotencyRecord;
      mutate: (snap: RankingRebuildSnapshot) => RankingRebuildMutation<T>;
    }
  ): Promise<{ mutation: RankingRebuildMutation<T>; budget: TxBudget }>;
}

export type MemoryRankingBundle = RankingWorkStore & {
  heads: Map<string, RankingHeadRecord>;
  rows: Map<string, RankingRowRecord>;
  runtime?: RankingRuntimeRecord;
  members: Map<string, RankingMemberRow>;
  metrics: Map<string, RankingMetricRow>;
  stats: Map<string, RankingStatsRow>;
  categories: Map<string, RankingCategoryRow>;
  idem: Map<string, IdempotencyRecord>;
  audits: AuditEntry[];
  seedMember(row: RankingMemberRow): void;
  seedMetric(row: RankingMetricRow): void;
  seedStats(row: RankingStatsRow): void;
  seedCategory(row: RankingCategoryRow): void;
  linkMembers(members: Map<string, RankingMemberRow>): void;
  linkStats(stats: Map<string, RankingStatsRow>): void;
  /** 与其它本地 bundle 共享 score_metrics（云端是同一集合）。 */
  linkMetrics(metrics: Map<string, RankingMetricRow>): void;
  /** 测试用故障注入：非空时让 writeRows 抛错，用来验证"发布失败保留上一完整代"。 */
  writeRowsFailure: string | null;
};

function cloneHead(row: RankingHeadRecord): RankingHeadRecord {
  return { ...row };
}

function cloneRow(row: RankingRowRecord): RankingRowRecord {
  return { ...row };
}

export function emptyRankingRuntime(): RankingRuntimeRecord {
  return {
    publishedGeneration: "",
    publishedAt: "",
    requestedAt: "",
    buildingSince: "",
    lastBuildStartedAt: "",
    lastBuildEndedAt: "",
    lastBuildOk: false,
    lastBuildError: "",
    catalogVersion: 0,
    boardCount: 0,
    rowCount: 0,
    rowCounts: {},
    historyGapMembers: 0,
    historyGapScore: 0,
    truncated: false,
    schemaVersion: RANKING_SCHEMA_VERSION,
    revision: 0
  };
}

export function memoryRankingStore(seed: { runtime?: RankingRuntimeRecord } = {}): MemoryRankingBundle {
  const heads = new Map<string, RankingHeadRecord>();
  const rows = new Map<string, RankingRowRecord>();
  let members = new Map<string, RankingMemberRow>();
  let stats = new Map<string, RankingStatsRow>();
  let metrics = new Map<string, RankingMetricRow>();
  const categories = new Map<string, RankingCategoryRow>();
  const idem = new Map<string, IdempotencyRecord>();
  const audits: AuditEntry[] = [];
  let runtime = seed.runtime ? { ...seed.runtime } : undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const bundle: MemoryRankingBundle = {
    heads,
    rows,
    members,
    metrics,
    stats,
    categories,
    idem,
    audits,
    writeRowsFailure: null,
    get runtime() {
      return runtime ? { ...runtime } : undefined;
    },
    set runtime(next) {
      runtime = next ? { ...next } : undefined;
    },
    seedMember(row) {
      members.set(row.memberId, { ...row });
    },
    seedMetric(row) {
      metrics.set(row.metricId, { ...row });
    },
    seedStats(row) {
      stats.set(row.memberId, { ...row });
    },
    seedCategory(row) {
      categories.set(row.categoryId, { ...row, ancestorIds: [...row.ancestorIds] });
    },
    linkMembers(next) {
      members = next;
      bundle.members = next;
    },
    linkStats(next) {
      stats = next;
      bundle.stats = next;
    },
    linkMetrics(next) {
      metrics = next;
      bundle.metrics = next;
    },
    async getRuntime() {
      return runtime ? { ...runtime } : undefined;
    },
    async getHead(boardId) {
      const row = heads.get(boardId);
      return row ? cloneHead(row) : undefined;
    },
    async listHeads() {
      return [...heads.values()].map(cloneHead);
    },
    async listRows(input) {
      const all = [...rows.values()]
        .filter((row) => row.boardId === input.boardId && row.generation === input.generation)
        .sort((left, right) => left.sortOrdinal - right.sortOrdinal);
      return { rows: all.slice(input.offset, input.offset + input.limit).map(cloneRow) };
    },
    async getRow(input) {
      const row = [...rows.values()].find(
        (item) =>
          item.boardId === input.boardId && item.generation === input.generation && item.memberId === input.memberId
      );
      return row ? cloneRow(row) : undefined;
    },
    async getMember(memberId) {
      const row = members.get(memberId);
      return row ? { ...row } : undefined;
    },
    async getStats(memberId) {
      const row = stats.get(memberId);
      return row ? { ...row } : undefined;
    },
    async listMembers(memberIds) {
      return memberIds
        .map((memberId) => members.get(memberId))
        .filter((row): row is RankingMemberRow => Boolean(row))
        .map((row) => ({ ...row }));
    },
    async getMetric(input) {
      const row = [...metrics.values()].find(
        (item) =>
          item.metricGeneration === input.metricGeneration &&
          item.scope === input.scope &&
          item.periodKey === input.periodKey &&
          item.categoryId === input.categoryId &&
          item.memberId === input.memberId
      );
      return row ? { ...row } : undefined;
    },
    async scanMetrics(input) {
      const all = [...metrics.values()].map((row) => ({ ...row }));
      return { rows: all.slice(0, input.limit), truncated: all.length > input.limit };
    },
    async scanMembers(input) {
      const all = [...members.values()].map((row) => ({ ...row }));
      return { rows: all.slice(0, input.limit), truncated: all.length > input.limit };
    },
    async scanStats(input) {
      const all = [...stats.values()].map((row) => ({ ...row }));
      return { rows: all.slice(0, input.limit), truncated: all.length > input.limit };
    },
    async listCategories() {
      return [...categories.values()].map((row) => ({ ...row, ancestorIds: [...row.ancestorIds] }));
    },
    async writeRows(next, obsolete) {
      if (bundle.writeRowsFailure) throw new Error(bundle.writeRowsFailure);
      let rowsWritten = 0;
      for (const row of next) {
        rows.set(row.rowId, cloneRow(row));
        rowsWritten += 1;
      }
      let obsoleteRemoved = 0;
      for (const item of obsolete) {
        for (const [key, row] of [...rows.entries()]) {
          if (row.boardId === item.boardId && row.generation === item.generation) {
            rows.delete(key);
            obsoleteRemoved += 1;
          }
        }
      }
      return { rowsWritten, obsoleteRemoved };
    },
    async saveRuntime(next) {
      runtime = { ...next };
    },
    async markRequested(requestedAt) {
      const current = runtime ? { ...runtime } : emptyRankingRuntime();
      if (current.requestedAt) return { requestedAt: current.requestedAt, changed: false };
      current.requestedAt = requestedAt;
      current.revision = (current.revision || 0) + 1;
      runtime = current;
      return { requestedAt, changed: true };
    },
    transactRebuild<T>(input: {
      idempotencyId: string;
      idempotency: IdempotencyRecord;
      mutate: (snap: RankingRebuildSnapshot) => RankingRebuildMutation<T>;
    }): Promise<{ mutation: RankingRebuildMutation<T>; budget: TxBudget }> {
      const run = queue.then(() => {
        const started = Date.now();
        const existing = idem.get(input.idempotencyId);
        const mutation: RankingRebuildMutation<unknown> = { result: undefined };
        if (existing && existing.payloadHash !== input.idempotency.payloadHash) {
          mutation.error = "IDEMPOTENCY_CONFLICT";
          return { mutation, budget: { reads: 2, writes: 0, total: 2, elapsedMs: Date.now() - started } };
        }
        if (existing && existing.status === "succeeded") {
          mutation.replayed = true;
          mutation.result = existing.resultRef;
          mutation.idem = { ...existing };
          mutation.runtime = runtime ? { ...runtime } : undefined;
          return { mutation, budget: { reads: 2, writes: 0, total: 2, elapsedMs: Date.now() - started } };
        }
        const next = input.mutate({
          idem: existing ? { ...existing } : undefined,
          runtime: runtime ? { ...runtime } : undefined
        });
        if (next.error) {
          return { mutation: next, budget: { reads: 2, writes: 0, total: 2, elapsedMs: Date.now() - started } };
        }
        let writes = 0;
        for (const head of next.heads || []) {
          heads.set(head.boardId, cloneHead(head));
          writes += 1;
        }
        if (next.idem) {
          idem.set(next.idem.id, { ...next.idem });
          writes += 1;
        }
        if (next.audit) {
          audits.push({ ...next.audit });
          writes += 1;
        }
        if (next.runtime) {
          runtime = { ...next.runtime };
          writes += 1;
        }
        return {
          mutation: next,
          budget: { reads: 2, writes, total: 2 + writes, elapsedMs: Date.now() - started }
        };
      });
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run as Promise<{ mutation: RankingRebuildMutation<T>; budget: TxBudget }>;
    }
  };
  return bundle;
}
