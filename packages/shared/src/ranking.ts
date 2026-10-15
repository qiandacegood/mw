import { hashNamedFields, namedCanonicalJson, sha256Hex, toHex, utf8Bytes } from "./canonical.js";
import { monthKeyShanghai, weekKeyShanghai } from "./clock.js";
import { rejectUnknownKeys } from "./validate.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, type RankingScope } from "./types.js";

/**
 * MW17 四维排行榜纯逻辑。
 *
 * 口径来源：[产品 V1.1 第 10 节](../../../docs/product/product-spec-v1.1.md)、
 * [一致性与后台任务 第 5 节](../../../docs/architecture/consistency-v1.0.md)、
 * [数据模型 第 4 节](../../../docs/architecture/data-model-v1.0.md)。
 *
 * 关键不变式：
 * - 榜值只来自服务端即时维护的 score_metrics（免费卷与 VIP 卷统一计入，不保存 accessFilter）；
 * - 零分不上榜；
 * - 并列采用竞赛排名（1、1、3），同分内部按 reachedAt 升序、再按 memberId 升序，只保证展示稳定；
 * - 前台只公开 rank<=100 并包含边界并列；快照写入全体参与者名次以支持前百之外的本人名次；
 * - 名次与本人名次必须来自同一 generation。
 */

export const RANKING_SCOPES = ["total", "category", "week", "month"] as const satisfies readonly RankingScope[];

/** 前台公开名次上限（产品：首版显示前 100 名）。 */
export const RANKING_TOP_LIMIT = 100;
/** 边界并列的额外上限，超过即标记截断，避免单个并列组无限扩张。 */
export const RANKING_BOUNDARY_MAX_EXTRA = 100;
/** 正常交卷后的榜单刷新目标（60 秒）；超过即提示更新延迟，不伪造刷新时间。 */
export const RANKING_REFRESH_TARGET_MS = 60_000;
export const RANKING_RUNTIME_DOC_ID = "ranking";
export const RANKING_SCHEMA_VERSION = 1;
/** 单轮快照构建的采样上限（容量与性能专项在 MW26）。 */
export const RANKING_BUILD_SCAN_LIMIT = 5_000;

export const TOTAL_PERIOD_KEY = "all";

/** 排行不接受任何费用维度筛选：传入即 INVALID_ARGUMENT（产品 V1.1 第 10.1 节）。 */
export const RANKING_FORBIDDEN_FILTERS = [
  "access",
  "freeOnly",
  "vipOnly",
  "accessFilter",
  "paidOnly",
  "feeFilter",
  "planId"
] as const;

export const RANKING_LIST_FIELDS: string[] = ["scope", "categoryId", "cursor", "limit"];
export const RANKING_ME_FIELDS: string[] = ["scope", "categoryId"];
export const RANKING_SET_FIELDS: string[] = ["enabled", "expectedRevision"];
export const RANKING_REBUILD_FIELDS: string[] = ["reason", "scopes", "expectedRevision"];

export const RANKING_HEAD_ID_FIELDS = ["scope", "periodKey", "categoryId"] as const;
export const RANKING_ROW_ID_FIELDS = ["boardId", "generation", "memberId"] as const;
export const RANKING_CURSOR_KEYS = ["scope", "periodKey", "categoryId", "generation", "offset"] as const;

export type RankingBoardRef = {
  scope: RankingScope;
  periodKey: string;
  categoryId: string;
};

export type RankingHeadRecord = {
  boardId: string;
  scope: RankingScope;
  periodKey: string;
  categoryId: string;
  generation: string;
  publishedAt: string;
  sampleStartedAt: string;
  sampleEndedAt: string;
  catalogVersion: number;
  /** 分类榜采样时固定的分类指标代际；与排名快照 generation 不是同一概念。 */
  categoryMetricsGeneration?: number;
  participantCount: number;
  displayCount: number;
  boundaryTruncated: boolean;
  schemaVersion: number;
  revision: number;
};

export type RankingRuntimeRecord = {
  publishedGeneration: string;
  publishedAt: string;
  requestedAt: string;
  buildingSince: string;
  lastBuildStartedAt: string;
  lastBuildEndedAt: string;
  lastBuildOk: boolean;
  lastBuildError: string;
  catalogVersion: number;
  /** 分类榜单独的构建标记，避免 category-only 重建把总分/周月榜显示成更新中。 */
  categoryBuildingSince?: string;
  categoryLastBuildOk?: boolean;
  categoryLastBuildError?: string;
  categoryPublishedGeneration?: string;
  categoryCatalogVersion?: number;
  categoryMetricsGeneration?: number;
  boardCount: number;
  rowCount: number;
  rowCounts: Record<string, number>;
  historyGapMembers: number;
  historyGapScore: number;
  truncated: boolean;
  schemaVersion: number;
  revision: number;
};

export type RankingRowRecord = {
  rowId: string;
  boardId: string;
  generation: string;
  scope: RankingScope;
  periodKey: string;
  categoryId: string;
  memberId: string;
  nickname: string;
  avatarKey: string;
  levelId: string;
  value: number;
  rank: number;
  sortOrdinal: number;
  reachedAt: string;
  prevValueDiff: number | null;
  schemaVersion: number;
};

export type RankingParticipant = {
  memberId: string;
  nickname: string;
  avatarKey: string;
  levelId: string;
  value: number;
  reachedAt: string;
};

export type RankedParticipant = RankingParticipant & {
  rank: number;
  sortOrdinal: number;
  prevValueDiff: number | null;
};

export type RankingRefreshStatus = "fresh" | "updating" | "delayed" | "unpublished";

export type RankingRefreshState = {
  status: RankingRefreshStatus;
  /** 快照真实构建完成时间；从未发布时为空字符串。 */
  updatedAt: string;
  /** 最近一次待刷新请求时间；为空表示没有待处理请求。 */
  requestedAt: string;
  /** 重建进行中标记。 */
  buildingSince: string;
  /** now - updatedAt（毫秒）；未发布时为 null。 */
  lagMs: number | null;
  /** now - requestedAt（毫秒）；无待刷新请求时为 null。 */
  pendingMs: number | null;
};

export function rankingBoardId(input: RankingBoardRef): string {
  return hashNamedFields(
    { scope: input.scope, periodKey: input.periodKey, categoryId: input.categoryId },
    RANKING_HEAD_ID_FIELDS
  );
}

export function rankingRowId(input: { boardId: string; generation: string; memberId: string }): string {
  return hashNamedFields(
    { boardId: input.boardId, generation: input.generation, memberId: input.memberId },
    RANKING_ROW_ID_FIELDS
  );
}

/**
 * 代标识：由构建时刻与上一次已发布代唯一确定，不使用随机数，
 * 便于排查「同一代」与「新代」的差异。
 */
export function rankingGenerationId(input: { nowIso: string; previousGeneration: string; boardCount: number }): string {
  return `gen_${hashNamedFields(
    { nowIso: input.nowIso, previousGeneration: input.previousGeneration, boardCount: input.boardCount },
    ["nowIso", "previousGeneration", "boardCount"] as const
  ).slice(0, 24)}`;
}

/** 周期键由服务端计算：total 为 all，week 为北京时间周一起始日期，month 为北京时间 YYYY-MM。 */
export function currentPeriodKey(scope: RankingScope, now: Date): string {
  if (scope === "week") return weekKeyShanghai(now);
  if (scope === "month") return monthKeyShanghai(now);
  return TOTAL_PERIOD_KEY;
}

export function parseRankingScope(value: unknown): RankingScope | undefined {
  return typeof value === "string" && (RANKING_SCOPES as readonly string[]).includes(value)
    ? (value as RankingScope)
    : undefined;
}

function forbiddenFiltersIn(data: Record<string, unknown>): string[] {
  return RANKING_FORBIDDEN_FILTERS.filter((key) => data[key] !== undefined);
}

function parseRankingBoardInput(
  data: Record<string, unknown>,
  allowed: string[]
): { ok: true; scope: RankingScope; categoryId: string } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  const forbidden = forbiddenFiltersIn(data);
  if (forbidden.length) {
    issues.push(`排行不接受费用筛选参数: ${forbidden.join(",")}`);
  }
  const extra = rejectUnknownKeys(data, allowed);
  if (extra.length) {
    issues.push(`unknown fields: ${extra.join(",")}`);
  }
  const scope = parseRankingScope(data.scope);
  if (!scope) {
    issues.push(`scope must be one of ${RANKING_SCOPES.join(",")}`);
  }
  let categoryId = "";
  if (scope === "category") {
    if (typeof data.categoryId !== "string" || !data.categoryId.trim()) {
      issues.push("categoryId required when scope=category");
    } else {
      categoryId = data.categoryId.trim();
    }
  } else if (scope && data.categoryId !== undefined && data.categoryId !== "") {
    issues.push("categoryId is only allowed when scope=category");
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, scope: scope as RankingScope, categoryId };
}

export function parseRankingListInput(
  data: Record<string, unknown>
): { ok: true; scope: RankingScope; categoryId: string; cursor: string; limit: number } | { ok: false; issues: string[] } {
  const base = parseRankingBoardInput(data, RANKING_LIST_FIELDS);
  if (!base.ok) return base;
  const issues: string[] = [];
  let limit = DEFAULT_PAGE_LIMIT;
  if (data.limit !== undefined) {
    if (typeof data.limit !== "number" || !Number.isInteger(data.limit) || data.limit < 1 || data.limit > MAX_PAGE_LIMIT) {
      issues.push(`limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`);
    } else {
      limit = data.limit;
    }
  }
  let cursor = "";
  if (data.cursor !== undefined) {
    if (typeof data.cursor !== "string") {
      issues.push("cursor must be a string");
    } else {
      cursor = data.cursor;
    }
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, scope: base.scope, categoryId: base.categoryId, cursor, limit };
}

export function parseRankingMeInput(
  data: Record<string, unknown>
): { ok: true; scope: RankingScope; categoryId: string } | { ok: false; issues: string[] } {
  return parseRankingBoardInput(data, RANKING_ME_FIELDS);
}

export function parseSetRankingInput(
  data: Record<string, unknown>
): { ok: true; enabled: boolean; expectedRevision: number } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  const extra = rejectUnknownKeys(data, RANKING_SET_FIELDS);
  if (extra.length) issues.push(`unknown fields: ${extra.join(",")}`);
  if (typeof data.enabled !== "boolean") issues.push("enabled must be boolean");
  if (
    typeof data.expectedRevision !== "number" ||
    !Number.isInteger(data.expectedRevision) ||
    data.expectedRevision < 1
  ) {
    issues.push("expectedRevision must be a positive integer");
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, enabled: data.enabled as boolean, expectedRevision: data.expectedRevision as number };
}

export function parseRankingRebuildInput(
  data: Record<string, unknown>
): { ok: true; reason: string; scopes: RankingScope[]; expectedRevision: number | null } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  const extra = rejectUnknownKeys(data, RANKING_REBUILD_FIELDS);
  if (extra.length) issues.push(`unknown fields: ${extra.join(",")}`);
  const reason = typeof data.reason === "string" ? data.reason.trim() : "";
  if (!reason) issues.push("reason required");
  const scopes: RankingScope[] = [];
  if (data.scopes !== undefined) {
    if (!Array.isArray(data.scopes) || data.scopes.some((item) => !parseRankingScope(item))) {
      issues.push(`scopes must be an array of ${RANKING_SCOPES.join(",")}`);
    } else {
      for (const item of data.scopes) scopes.push(parseRankingScope(item) as RankingScope);
    }
  }
  let expectedRevision: number | null = null;
  if (data.expectedRevision !== undefined) {
    if (typeof data.expectedRevision !== "number" || !Number.isInteger(data.expectedRevision) || data.expectedRevision < 0) {
      issues.push("expectedRevision must be a non-negative integer");
    } else {
      expectedRevision = data.expectedRevision;
    }
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, reason, scopes, expectedRevision };
}

/**
 * 竞赛排名：按 value 降序、reachedAt 升序、memberId 升序排列，零分不上榜。
 * 并列名次为 1、1、3；prevValueDiff 为「上一不同名次」的分差（并列组内一致，最高名次为 null）。
 */
export function rankParticipants(participants: readonly RankingParticipant[]): RankedParticipant[] {
  const positive = participants.filter((row) => Number.isInteger(row.value) && row.value > 0);
  const sorted = [...positive].sort((left, right) => {
    if (left.value !== right.value) return right.value - left.value;
    if (left.reachedAt !== right.reachedAt) return left.reachedAt < right.reachedAt ? -1 : 1;
    return left.memberId.localeCompare(right.memberId);
  });
  const out: RankedParticipant[] = [];
  let currentValue: number | null = null;
  let currentRank = 0;
  let aboveValue: number | null = null;
  let currentDiff: number | null = null;
  for (let index = 0; index < sorted.length; index += 1) {
    const row = sorted[index] as RankingParticipant;
    if (currentValue === null || row.value !== currentValue) {
      aboveValue = currentValue;
      currentValue = row.value;
      currentRank = index + 1;
      currentDiff = aboveValue === null ? null : aboveValue - row.value;
    }
    out.push({
      ...row,
      rank: currentRank,
      sortOrdinal: index,
      prevValueDiff: currentDiff
    });
  }
  return out;
}

/**
 * 前百边界并列：取前 topLimit 行，并包含与第 topLimit 行同名次的全部行；
 * 超出边界额外上限时标记截断（不静默丢弃并列用户）。
 */
export function boundaryInclusiveCount(
  ranked: readonly { rank: number }[],
  topLimit = RANKING_TOP_LIMIT,
  maxExtra = RANKING_BOUNDARY_MAX_EXTRA
): { count: number; truncated: boolean } {
  if (ranked.length <= topLimit) return { count: ranked.length, truncated: false };
  const cutoffRank = (ranked[topLimit - 1] as { rank: number }).rank;
  let count = topLimit;
  while (count < ranked.length && (ranked[count] as { rank: number }).rank === cutoffRank) count += 1;
  if (count > topLimit + maxExtra) return { count: topLimit + maxExtra, truncated: true };
  return { count, truncated: false };
}

/** 与「上一不同名次」的分差；最高名次或未上榜返回 null。 */
export function gapToPreviousDistinctRank(
  ranked: readonly RankedParticipant[],
  memberId: string
): number | null {
  const hit = ranked.find((row) => row.memberId === memberId);
  return hit ? hit.prevValueDiff : null;
}

/**
 * 刷新状态：updatedAt 是快照真实构建完成时间，requestedAt 是待刷新请求时间。
 * 不伪造刷新时间——只有真实重建完成才会推进 updatedAt。
 */
export function rankingRefreshStateOf(input: {
  now: Date;
  publishedAt: string;
  requestedAt: string;
  buildingSince: string;
  targetMs?: number;
}): RankingRefreshState {
  const target = input.targetMs ?? RANKING_REFRESH_TARGET_MS;
  const nowMs = input.now.getTime();
  const publishedMs = input.publishedAt ? Date.parse(input.publishedAt) : Number.NaN;
  const requestedMs = input.requestedAt ? Date.parse(input.requestedAt) : Number.NaN;
  const lagMs = Number.isFinite(publishedMs) ? Math.max(0, nowMs - publishedMs) : null;
  const pendingMs = Number.isFinite(requestedMs) ? Math.max(0, nowMs - requestedMs) : null;
  let status: RankingRefreshStatus;
  if (!input.publishedAt) status = "unpublished";
  else if (input.buildingSince) status = "updating";
  else if (pendingMs !== null && pendingMs > target) status = "delayed";
  else if (pendingMs !== null) status = "updating";
  else status = "fresh";
  return {
    status,
    updatedAt: input.publishedAt,
    requestedAt: input.requestedAt,
    buildingSince: input.buildingSince,
    lagMs,
    pendingMs
  };
}

export type RankingCursorPayload = {
  scope: RankingScope;
  periodKey: string;
  categoryId: string;
  generation: string;
  offset: number;
};

export function encodeRankingCursor(payload: RankingCursorPayload): string {
  const body = namedCanonicalJson(payload, [...RANKING_CURSOR_KEYS]);
  return `${sha256Hex(body)}.${toHex(utf8Bytes(body))}`;
}

export function decodeRankingCursor(
  raw: unknown
): { ok: true; payload: RankingCursorPayload } | { ok: false; reason: string } {
  if (typeof raw !== "string" || !raw.includes(".")) return { ok: false, reason: "CURSOR_INVALID" };
  const dot = raw.indexOf(".");
  const signature = raw.slice(0, dot);
  const hex = raw.slice(dot + 1);
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return { ok: false, reason: "CURSOR_INVALID" };
  let body = "";
  for (let index = 0; index < hex.length; index += 2) {
    body += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  if (sha256Hex(body) !== signature) return { ok: false, reason: "CURSOR_INVALID" };
  try {
    const parsed = JSON.parse(body) as RankingCursorPayload;
    if (
      !parseRankingScope(parsed.scope) ||
      typeof parsed.periodKey !== "string" ||
      typeof parsed.categoryId !== "string" ||
      typeof parsed.generation !== "string" ||
      typeof parsed.offset !== "number" ||
      !Number.isInteger(parsed.offset) ||
      parsed.offset < 0
    ) {
      return { ok: false, reason: "CURSOR_INVALID" };
    }
    return { ok: true, payload: parsed };
  } catch {
    return { ok: false, reason: "CURSOR_INVALID" };
  }
}

export function rankingCursorMatches(
  payload: RankingCursorPayload,
  filter: Omit<RankingCursorPayload, "offset">
): boolean {
  return (
    payload.scope === filter.scope &&
    payload.periodKey === filter.periodKey &&
    payload.categoryId === filter.categoryId &&
    payload.generation === filter.generation
  );
}

/**
 * 公开榜用的行标识：`memberId` 的不可逆短摘要。
 * 公开榜不返回 memberId（契约只列 rank / 昵称 / 头像 / 等级 / value），
 * 但页面需要在本人类里高亮自己，因此用一个 12 位哈希前缀做匹配键。
 */
export function rankingMemberKey(memberId: string): string {
  return sha256Hex(`mw17:rankKey:${memberId}`).slice(0, 12);
}

/** 公开榜行：只暴露产品允许展示的字段，不含微信身份、会员标识、订单或手机信息。 */
export type RankingPublicRow = {
  rank: number;
  rankKey: string;
  nickname: string;
  avatarKey: string;
  levelId: string;
  value: number;
  reachedAt: string;
  valueDiff: number | null;
};

export function toPublicRankingRow(row: RankingRowRecord): RankingPublicRow {
  return {
    rank: row.rank,
    rankKey: rankingMemberKey(row.memberId),
    nickname: row.nickname,
    avatarKey: row.avatarKey,
    levelId: row.levelId,
    value: row.value,
    reachedAt: row.reachedAt,
    valueDiff: row.prevValueDiff
  };
}

/** 历史累计总分与可追溯榜值不一致时的固定说明（发起人 2026-10-15 已定"不补记"）。 */
export const RANKING_HISTORY_GAP_NOTE =
  "本榜值只从可追溯的计分事件累计；历史来源已缺失的部分不纳入榜值，也不补记。";

/** 免费与 VIP 统一计入，不存在费用筛选。 */
export const RANKING_NO_FEE_FILTER_NOTE = "免费卷与 VIP 卷统一计入，不提供费用筛选。";

export type RankingSnapshotDiagnostics = {
  historyGapMembers: number;
  historyGapScore: number;
  excludedByOptOut: number;
  excludedByStatus: number;
  truncated: boolean;
};

export type RankingBoardBuild = {
  ref: RankingBoardRef;
  ranked: RankedParticipant[];
  displayCount: number;
  boundaryTruncated: boolean;
};

/**
 * 由 sample 构建各榜的名次（纯函数，便于本地覆盖并列、边界与零分规则）。
 */
export function rankingRebuildIsCategoryOnly(scopes: readonly string[]): boolean {
  return scopes.length > 0 && scopes.every((scope) => scope === "category");
}

export function buildRankingBoards(input: {
  metrics: readonly { scope: string; periodKey: string; categoryId: string; memberId: string; value: number; reachedAt: string }[];
  members: readonly { memberId: string; nickname: string; avatarKey: string; levelId: string; eligible: boolean }[];
  /** 允许发布的类目榜（已过滤停用与逻辑删除路径）。 */
  categoryIds: readonly string[];
  /** 限定重建范围；仅 category 时不生成 total/week/month 板块。 */
  scopes?: readonly RankingScope[];
}): RankingBoardBuild[] {
  const memberOf = new Map(input.members.map((row) => [row.memberId, row]));
  const boards = new Map<string, RankingBoardRef>();
  const allow = (scope: RankingScope) => !input.scopes?.length || input.scopes.includes(scope);
  const collect = (ref: RankingBoardRef) => {
    if (!allow(ref.scope)) return;
    boards.set(rankingBoardId(ref), ref);
  };
  collect({ scope: "total", periodKey: TOTAL_PERIOD_KEY, categoryId: "" });
  for (const categoryId of input.categoryIds) {
    collect({ scope: "category", periodKey: TOTAL_PERIOD_KEY, categoryId });
  }
  for (const metric of input.metrics) {
    const scope = parseRankingScope(metric.scope);
    if (!scope || scope === "category") continue;
    collect({ scope, periodKey: metric.periodKey, categoryId: "" });
  }
  const buckets = new Map<string, RankingParticipant[]>();
  for (const board of boards.values()) buckets.set(rankingBoardId(board), []);
  for (const metric of input.metrics) {
    const scope = parseRankingScope(metric.scope);
    if (!scope) continue;
    if (scope === "category" && !input.categoryIds.includes(metric.categoryId)) continue;
    const key = rankingBoardId({ scope, periodKey: metric.periodKey, categoryId: metric.categoryId });
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const member = memberOf.get(metric.memberId);
    if (!member || !member.eligible) continue;
    bucket.push({
      memberId: metric.memberId,
      nickname: member.nickname,
      avatarKey: member.avatarKey,
      levelId: member.levelId,
      value: metric.value,
      reachedAt: metric.reachedAt
    });
  }
  const out: RankingBoardBuild[] = [];
  for (const [key, board] of boards) {
    const ranked = rankParticipants(buckets.get(key) || []);
    const boundary = boundaryInclusiveCount(ranked);
    out.push({ ref: board, ranked, displayCount: boundary.count, boundaryTruncated: boundary.truncated });
  }
  return out;
}
