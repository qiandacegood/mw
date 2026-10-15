import {
  METRIC_GENERATION_BASE,
  RANKING_BUILD_SCAN_LIMIT,
  RANKING_HISTORY_GAP_NOTE,
  RANKING_NO_FEE_FILTER_NOTE,
  RANKING_REFRESH_TARGET_MS,
  RANKING_TOP_LIMIT,
  buildAuditEntry,
  buildIdempotencyRecord,
  buildRankingBoards,
  currentPeriodKey,
  decodeRankingCursor,
  effectiveEnabled,
  encodeRankingCursor,
  parseRankingListInput,
  parseRankingMeInput,
  parseRankingRebuildInput,
  parseSetRankingInput,
  rankingBoardId,
  rankingCursorMatches,
  rankingGenerationId,
  rankingMemberKey,
  rankingRefreshStateOf,
  rankingRowId,
  replayOrConflict,
  toPublicRankingRow,
  type ErrorCode,
  type IdempotencyRecord,
  type RankingHeadRecord,
  type RankingRowRecord,
  type RankingRuntimeRecord,
  type RankingScope
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import { emptyBudget } from "./job-stores.js";
import type { MemberReadStore, MemberRecord, MemberWorkStore } from "./member-stores.js";
import {
  emptyRankingRuntime,
  type RankingObsolete,
  type RankingReadStore,
  type RankingWorkStore
} from "./ranking-stores.js";

type RankingFailure = { ok: false; code: ErrorCode; reason: string; details?: Record<string, unknown> };
type RankingSuccess<T> = { ok: true; data: T; replayed?: boolean; budget: TxBudget };

function fail(code: ErrorCode, reason: string, details?: Record<string, unknown>): RankingFailure {
  return { ok: false, code, reason, ...(details ? { details } : {}) };
}

const TX_RETRY_LIMIT = 3;
const HEAD_SWITCH_CHUNK = 20;

async function runWithTxRetry<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < TX_RETRY_LIMIT; attempt += 1) {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/conflict|TRANSACTION|aborted/i.test(message)) break;
    }
  }
  return { ok: false, error: lastError };
}

type BoardRef = { scope: RankingScope; periodKey: string; categoryId: string };

export type RankingRefreshView = {
  status: "fresh" | "updating" | "delayed" | "unpublished";
  updatedAt: string;
  requestedAt: string;
  buildingSince: string;
  lagMs: number | null;
  pendingMs: number | null;
  targetMs: number;
  /** 板块头与全局已发布代不一致：该板块的切换尚未完成。 */
  boardPending: boolean;
};

export type RankingHistoryGap = {
  members: number;
  score: number;
  note: string;
};

export type RankingListView = {
  board: { boardId: string; scope: RankingScope; periodKey: string; categoryId: string };
  generation: string;
  participantCount: number;
  displayCount: number;
  topLimit: number;
  boundaryTruncated: boolean;
  sampleStartedAt: string;
  sampleEndedAt: string;
  refresh: RankingRefreshView;
  rows: ReturnType<typeof toPublicRankingRow>[];
  nextCursor: string | null;
  complete: boolean;
  /** 因成员当前状态（退出公开排行 / 停用 / 注销）被实时过滤的行数；其名次仍属旧快照。 */
  staleFiltered: number;
  historyGap: RankingHistoryGap;
  truncated: boolean;
  feeFilter: { supported: false; note: string };
};

export type RankingMeView = {
  board: { boardId: string; scope: RankingScope; periodKey: string; categoryId: string };
  generation: string;
  rankKey: string;
  participating: boolean;
  onBoard: boolean;
  rank: number | null;
  value: number;
  valueDiff: number | null;
  privateTotalScore: number;
  valueTraceable: boolean;
  historyGap: boolean;
  historyGapNote: string;
  participantCount: number;
  displayCount: number;
  refresh: RankingRefreshView;
  feeFilter: { supported: false; note: string };
};

export type RankingStatusView = {
  storeConfigured: boolean;
  publishedGeneration: string;
  publishedAt: string;
  requestedAt: string;
  buildingSince: string;
  lastBuildStartedAt: string;
  lastBuildEndedAt: string;
  lastBuildOk: boolean;
  lastBuildError: string;
  catalogVersion: number;
  boardCount: number;
  rowCount: number;
  rowCounts: Record<string, number>;
  historyGapMembers: number;
  historyGapScore: number;
  truncated: boolean;
  revision: number;
  refresh: RankingRefreshView;
};

export type RankingRebuildView = {
  generation: string;
  publishedAt: string;
  boardCount: number;
  rowCount: number;
  rowCounts: Record<string, number>;
  historyGapMembers: number;
  historyGapScore: number;
  catalogVersion: number;
  truncated: boolean;
  obsoleteRemoved: number;
  boards: {
    scope: RankingScope;
    periodKey: string;
    categoryId: string;
    participantCount: number;
    displayCount: number;
    boundaryTruncated: boolean;
  }[];
  headsChunked: boolean;
  note: string;
};

function refreshViewOf(input: {
  head?: { generation: string; publishedAt: string };
  runtime?: RankingRuntimeRecord;
  now: Date;
  targetMs?: number;
}): RankingRefreshView {
  const state = rankingRefreshStateOf({
    now: input.now,
    publishedAt: input.head?.publishedAt || input.runtime?.publishedAt || "",
    requestedAt: input.runtime?.requestedAt || "",
    buildingSince: input.runtime?.buildingSince || "",
    targetMs: input.targetMs
  });
  const boardPending = Boolean(
    input.runtime?.publishedGeneration &&
      input.head?.generation &&
      input.head.generation !== input.runtime.publishedGeneration
  );
  return {
    status: boardPending && state.status !== "updating" ? "updating" : state.status,
    updatedAt: state.updatedAt,
    requestedAt: state.requestedAt,
    buildingSince: state.buildingSince || (boardPending ? "board-switch-pending" : ""),
    lagMs: state.lagMs,
    pendingMs: state.pendingMs,
    targetMs: input.targetMs ?? RANKING_REFRESH_TARGET_MS,
    boardPending
  };
}

function historyGapOf(runtime: RankingRuntimeRecord | undefined): RankingHistoryGap {
  return {
    members: runtime?.historyGapMembers ?? 0,
    score: runtime?.historyGapScore ?? 0,
    note: RANKING_HISTORY_GAP_NOTE
  };
}

const FEE_FILTER = { supported: false as const, note: RANKING_NO_FEE_FILTER_NOTE };

/** 分类榜要求当前有效类目：停用、逻辑删除或祖先停用一律 CATEGORY_UNAVAILABLE。 */
async function categoryIndex(store: RankingReadStore): Promise<{
  known: Set<string>;
  enabled: Set<string>;
}> {
  const rows = await store.listCategories();
  const byId = new Map(rows.map((row) => [row.categoryId, row]));
  const known = new Set(rows.map((row) => row.categoryId));
  const enabled = new Set<string>();
  for (const row of rows) {
    if (effectiveEnabled(row, byId)) enabled.add(row.categoryId);
  }
  return { known, enabled };
}

async function resolveBoard(input: {
  store: RankingReadStore;
  scope: RankingScope;
  categoryId: string;
  now: Date;
}): Promise<{ ok: true; ref: BoardRef; boardId: string } | RankingFailure> {
  const ref: BoardRef = {
    scope: input.scope,
    periodKey: currentPeriodKey(input.scope, input.now),
    categoryId: input.categoryId
  };
  if (ref.scope === "category") {
    const index = await categoryIndex(input.store);
    if (!index.known.has(ref.categoryId) || !index.enabled.has(ref.categoryId)) {
      return fail("CATEGORY_UNAVAILABLE", "CATEGORY_UNAVAILABLE");
    }
  }
  return { ok: true, ref, boardId: rankingBoardId(ref) };
}

/**
 * 榜单页数据：只读已发布的完整代；名次与本人名次来自同一 generation。
 * 返回前按成员当前状态二次核对，退出公开排行的会员立即不再公开展示。
 */
export async function listRanking(input: {
  store?: RankingReadStore;
  data: Record<string, unknown>;
  now: Date;
}): Promise<RankingSuccess<RankingListView> | RankingFailure> {
  const parsed = parseRankingListInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "RANKING_LIST_INPUT_INVALID", { issues: parsed.issues });
  if (!input.store) return fail("INTERNAL_ERROR", "RANKING_STORE_UNAVAILABLE");
  const store = input.store;
  const resolved = await resolveBoard({ store, scope: parsed.scope, categoryId: parsed.categoryId, now: input.now });
  if (!resolved.ok) return resolved;
  const { ref, boardId } = resolved;
  const runtime = await store.getRuntime();
  const head = await store.getHead(boardId);
  const refresh = refreshViewOf({ head, runtime, now: input.now });
  const board = { boardId, scope: ref.scope, periodKey: ref.periodKey, categoryId: ref.categoryId };
  const base = {
    board,
    generation: head?.generation || "",
    participantCount: head?.participantCount || 0,
    displayCount: head?.displayCount || 0,
    topLimit: RANKING_TOP_LIMIT,
    boundaryTruncated: head?.boundaryTruncated === true,
    sampleStartedAt: head?.sampleStartedAt || "",
    sampleEndedAt: head?.sampleEndedAt || "",
    refresh,
    historyGap: historyGapOf(runtime),
    truncated: runtime?.truncated === true,
    feeFilter: FEE_FILTER
  };
  if (!head || !head.generation) {
    return {
      ok: true,
      data: { ...base, rows: [], nextCursor: null, complete: true, staleFiltered: 0 },
      budget: emptyBudget()
    };
  }
  let offset = 0;
  if (parsed.cursor) {
    const decoded = decodeRankingCursor(parsed.cursor);
    if (!decoded.ok) return fail("INVALID_ARGUMENT", "CURSOR_INVALID");
    if (
      !rankingCursorMatches(decoded.payload, {
        scope: ref.scope,
        periodKey: ref.periodKey,
        categoryId: ref.categoryId,
        generation: head.generation
      })
    ) {
      return fail("INVALID_ARGUMENT", "CURSOR_FILTER_MISMATCH", {
        issues: ["游标绑定其它板块或其它代，请重新加载榜单"]
      });
    }
    offset = decoded.payload.offset;
  }
  const displayCount = Math.max(0, head.displayCount);
  const remaining = Math.max(0, displayCount - offset);
  if (remaining === 0) {
    return {
      ok: true,
      data: { ...base, rows: [], nextCursor: null, complete: true, staleFiltered: 0 },
      budget: emptyBudget()
    };
  }
  const page = await store.listRows({
    boardId,
    generation: head.generation,
    offset,
    limit: Math.min(parsed.limit, remaining)
  });
  const members = await store.listMembers(page.rows.map((row) => row.memberId));
  const memberOf = new Map(members.map((row) => [row.memberId, row]));
  const visible = page.rows.filter((row) => {
    const member = memberOf.get(row.memberId);
    return Boolean(member && member.status === "active" && member.rankingOptIn === true);
  });
  const staleFiltered = page.rows.length - visible.length;
  const advanced = offset + page.rows.length;
  const nextCursor =
    advanced < displayCount
      ? encodeRankingCursor({
          scope: ref.scope,
          periodKey: ref.periodKey,
          categoryId: ref.categoryId,
          generation: head.generation,
          offset: advanced
        })
      : null;
  return {
    ok: true,
    data: { ...base, rows: visible.map(toPublicRankingRow), nextCursor, complete: nextCursor === null, staleFiltered },
    budget: emptyBudget()
  };
}

/** 本人名次：与榜单同一代；未参与时不返回公开名次，但返回可追溯的私人值。 */
export async function readRankingMe(input: {
  store?: RankingReadStore;
  memberId: string;
  data: Record<string, unknown>;
  now: Date;
}): Promise<RankingSuccess<RankingMeView> | RankingFailure> {
  const parsed = parseRankingMeInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "RANKING_ME_INPUT_INVALID", { issues: parsed.issues });
  if (!input.store) return fail("INTERNAL_ERROR", "RANKING_STORE_UNAVAILABLE");
  const store = input.store;
  const resolved = await resolveBoard({ store, scope: parsed.scope, categoryId: parsed.categoryId, now: input.now });
  if (!resolved.ok) return resolved;
  const { ref, boardId } = resolved;
  const runtime = await store.getRuntime();
  const head = await store.getHead(boardId);
  const refresh = refreshViewOf({ head, runtime, now: input.now });
  const member = await store.getMember(input.memberId);
  const stats = await store.getStats(input.memberId);
  const participating = Boolean(member && member.status === "active" && member.rankingOptIn === true);
  const metric = await store.getMetric({
    metricGeneration: METRIC_GENERATION_BASE,
    scope: ref.scope,
    periodKey: ref.periodKey,
    categoryId: ref.categoryId,
    memberId: input.memberId
  });
  const metricValue = metric && metric.value > 0 ? metric.value : 0;
  const row =
    head && head.generation
      ? await store.getRow({ boardId, generation: head.generation, memberId: input.memberId })
      : undefined;
  const onBoard = participating && Boolean(row);
  const privateTotalScore = stats?.totalScore ?? 0;
  const valueTraceable = metricValue > 0;
  const historyGap = ref.scope === "total" && privateTotalScore > 0 && !valueTraceable;
  return {
    ok: true,
    data: {
      board: { boardId, scope: ref.scope, periodKey: ref.periodKey, categoryId: ref.categoryId },
      generation: head?.generation || "",
      rankKey: rankingMemberKey(input.memberId),
      participating,
      onBoard,
      rank: onBoard && row ? row.rank : null,
      value: onBoard && row ? row.value : metricValue,
      valueDiff: onBoard && row ? row.prevValueDiff : null,
      privateTotalScore,
      valueTraceable,
      historyGap,
      historyGapNote: historyGap ? RANKING_HISTORY_GAP_NOTE : "",
      participantCount: head?.participantCount || 0,
      displayCount: head?.displayCount || 0,
      refresh,
      feeFilter: FEE_FILTER
    },
    budget: emptyBudget()
  };
}

/** 会员主动参与 / 退出公开排行；关闭后立即不再公开展示，个人成绩与成长总分不变。 */
export async function setMemberRanking(input: {
  stores: MemberReadStore & MemberWorkStore;
  ranking?: RankingWorkStore;
  identityId: string;
  memberId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<
  | RankingSuccess<{
      memberId: string;
      rankingOptIn: boolean;
      revision: number;
      rankingRefresh: { requestedAt: string; status: string };
    }>
  | RankingFailure
> {
  const parsed = parseSetRankingInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "MEMBER_SET_RANKING_INPUT_INVALID", { issues: parsed.issues });
  const idemRecord = buildIdempotencyRecord({
    actorId: input.identityId,
    action: "member.setRanking",
    idempotencyKey: input.idempotencyKey,
    payload: { enabled: parsed.enabled, expectedRevision: parsed.expectedRevision },
    requestId: input.requestId
  });
  type View = { memberId: string; rankingOptIn: boolean; revision: number };
  const attempted = await runWithTxRetry(() =>
    input.stores.transactProfile(input.identityId, input.memberId, idemRecord.id, (snap) => {
      const replay = replayOrConflict(snap.idem, idemRecord.payloadHash, () => null);
      if (!replay.ok) {
        return { error: "IDEMPOTENCY_CONFLICT", result: undefined as unknown as View };
      }
      if (replay.replayed && snap.idem?.status === "succeeded" && snap.idem.resultRef) {
        return { result: snap.idem.resultRef as View, replayed: true };
      }
      if (!snap.identity) {
        return { error: "MEMBER_REQUIRED", result: undefined as unknown as View };
      }
      const current = snap.member;
      if (!current) {
        return { error: "MEMBER_ROW_MISSING", result: undefined as unknown as View };
      }
      if (current.status === "disabled" || current.status === "deleting" || current.status === "deleted") {
        return { error: "ACCOUNT_DISABLED", result: undefined as unknown as View };
      }
      if (current.revision !== parsed.expectedRevision) {
        return { error: "VERSION_CONFLICT", result: undefined as unknown as View };
      }
      const next: MemberRecord = {
        ...current,
        rankingOptIn: parsed.enabled,
        revision: current.revision + 1,
        updatedAt: input.now.toISOString()
      };
      const view: View = { memberId: next.memberId, rankingOptIn: next.rankingOptIn, revision: next.revision };
      return {
        member: next,
        idem: { ...idemRecord, status: "succeeded", resultRef: view },
        audit: buildAuditEntry({
          actorType: "member",
          actorId: current.memberId,
          action: "member.setRanking",
          target: `members/${current.memberId}`,
          reason: parsed.enabled ? "开启公开排行" : "退出公开排行",
          requestId: input.requestId,
          before: { rankingOptIn: current.rankingOptIn, revision: current.revision },
          after: { rankingOptIn: next.rankingOptIn, revision: next.revision },
          now: input.now
        }),
        result: view
      };
    })
  );
  if (!attempted.ok) return fail("SERVICE_BUSY", "MEMBER_PROFILE_TX_CONFLICT");
  const { mutation, budget } = attempted.value;
  if (mutation.error === "MEMBER_REQUIRED") return fail("MEMBER_REQUIRED", "MEMBER_NOT_REGISTERED");
  if (mutation.error === "ACCOUNT_DISABLED") return fail("ACCOUNT_DISABLED", "MEMBER_DISABLED");
  if (mutation.error === "VERSION_CONFLICT") return fail("VERSION_CONFLICT", "MEMBER_REVISION_MISMATCH");
  if (mutation.error === "IDEMPOTENCY_CONFLICT") return fail("IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT");
  if (mutation.error) return fail("INTERNAL_ERROR", mutation.error);
  // 待刷新标记：真实反映"榜单还没跟上"，不伪造刷新时间。标记失败不影响会员状态写入。
  let requestedAt = "";
  if (input.ranking) {
    try {
      const marked = await input.ranking.markRequested(input.now.toISOString());
      requestedAt = marked.requestedAt;
    } catch {
      requestedAt = "";
    }
  }
  return {
    ok: true,
    data: {
      ...mutation.result,
      rankingRefresh: { requestedAt, status: requestedAt ? "pending" : "unknown" }
    },
    replayed: mutation.replayed === true,
    budget
  };
}

/** 后台只读：快照状态、真实更新时间、待刷新与延迟、历史缺口诊断。 */
export async function readRankingStatus(input: {
  store?: RankingReadStore;
  now: Date;
}): Promise<RankingSuccess<RankingStatusView>> {
  const runtime = input.store ? await input.store.getRuntime() : undefined;
  const view = runtime ?? emptyRankingRuntime();
  return {
    ok: true,
    data: {
      storeConfigured: Boolean(input.store),
      publishedGeneration: view.publishedGeneration,
      publishedAt: view.publishedAt,
      requestedAt: view.requestedAt,
      buildingSince: view.buildingSince,
      lastBuildStartedAt: view.lastBuildStartedAt,
      lastBuildEndedAt: view.lastBuildEndedAt,
      lastBuildOk: view.lastBuildOk,
      lastBuildError: view.lastBuildError,
      catalogVersion: view.catalogVersion,
      boardCount: view.boardCount,
      rowCount: view.rowCount,
      rowCounts: view.rowCounts,
      historyGapMembers: view.historyGapMembers,
      historyGapScore: view.historyGapScore,
      truncated: view.truncated,
      revision: view.revision,
      refresh: refreshViewOf({ runtime, now: input.now })
    },
    budget: emptyBudget()
  };
}

/**
 * 重建并发布四维榜单快照。
 *
 * 顺序（见 docs/architecture/consistency-v1.0.md 第 5 节）：
 * 1. 标记 building（页面显示"更新中"）；
 * 2. 采样 score_metrics / members / member_stats / categories；
 * 3. 写齐该代全部名次行（读者看不到未切换的代）；
 * 4. 事务内切换板块头 + 运行状态 + 幂等 + 审计（写齐行数后才切换，不展示半成品）；
 * 5. 失败保留上一完整代并记录 lastBuildError；待刷新请求保留 → 超过 60 秒显示"更新延迟"。
 */
export async function rebuildRanking(input: {
  store?: RankingWorkStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<RankingSuccess<RankingRebuildView> | RankingFailure> {
  const parsed = parseRankingRebuildInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "RANKING_REBUILD_INPUT_INVALID", { issues: parsed.issues });
  if (!input.store) return fail("INTERNAL_ERROR", "RANKING_STORE_UNAVAILABLE");
  const store = input.store;
  const nowIso = input.now.toISOString();
  const before = (await store.getRuntime()) ?? emptyRankingRuntime();
  if (parsed.expectedRevision !== null && before.revision !== parsed.expectedRevision) {
    return fail("VERSION_CONFLICT", "RANKING_REVISION_MISMATCH", { serverRevision: before.revision });
  }
  const idemRecord: IdempotencyRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "ranking.rebuild",
    idempotencyKey: input.idempotencyKey,
    payload: { reason: parsed.reason, scopes: parsed.scopes },
    requestId: input.requestId
  });
  const building: RankingRuntimeRecord = {
    ...before,
    buildingSince: nowIso,
    lastBuildStartedAt: nowIso,
    lastBuildOk: false,
    lastBuildError: "",
    revision: before.revision + 1
  };
  await store.saveRuntime(building);

  const finishFailed = async (reason: string): Promise<RankingFailure> => {
    const current = (await store.getRuntime()) ?? building;
    await store.saveRuntime({
      ...current,
      buildingSince: "",
      requestedAt: current.requestedAt || nowIso,
      lastBuildEndedAt: nowIso,
      lastBuildOk: false,
      lastBuildError: reason
    });
    return fail("INTERNAL_ERROR", reason);
  };

  let metrics;
  let members;
  let stats;
  let categories;
  try {
    metrics = await store.scanMetrics({ limit: RANKING_BUILD_SCAN_LIMIT });
    members = await store.scanMembers({ limit: RANKING_BUILD_SCAN_LIMIT });
    stats = await store.scanStats({ limit: RANKING_BUILD_SCAN_LIMIT });
    categories = await store.listCategories();
  } catch {
    return finishFailed("RANKING_SAMPLE_FAILED");
  }
  const truncated = metrics.truncated || members.truncated || stats.truncated;
  const categoryMap = new Map(categories.map((row) => [row.categoryId, row]));
  const enabledCategories = categories
    .filter((row) => effectiveEnabled(row, categoryMap))
    .map((row) => row.categoryId);
  const statsOf = new Map(stats.rows.map((row) => [row.memberId, row]));
  const eligible = members.rows.map((row) => {
    const statsRow = statsOf.get(row.memberId);
    return {
      memberId: row.memberId,
      nickname: row.nickname,
      avatarKey: row.avatarKey,
      levelId: statsRow?.levelId || "",
      eligible: row.status === "active" && row.rankingOptIn === true
    };
  });
  const boards = buildRankingBoards({
    metrics: metrics.rows.filter((row) => row.metricGeneration === METRIC_GENERATION_BASE),
    members: eligible,
    categoryIds: enabledCategories
  }).filter((board) => (parsed.scopes.length ? parsed.scopes.includes(board.ref.scope) : true));

  const generation = rankingGenerationId({
    nowIso,
    previousGeneration: before.publishedGeneration,
    boardCount: boards.length
  });
  const heads: RankingHeadRecord[] = boards.map((board) => ({
    boardId: rankingBoardId(board.ref),
    scope: board.ref.scope,
    periodKey: board.ref.periodKey,
    categoryId: board.ref.categoryId,
    generation,
    publishedAt: nowIso,
    sampleStartedAt: nowIso,
    sampleEndedAt: nowIso,
    catalogVersion: before.catalogVersion,
    participantCount: board.ranked.length,
    displayCount: board.displayCount,
    boundaryTruncated: board.boundaryTruncated,
    schemaVersion: 1,
    revision: 1
  }));
  const headByBoard = new Map(heads.map((head) => [head.boardId, head]));
  // 已存在但本轮不再发布的板块（例如类目停用）也切到"空的新代"，不留在旧快照上。
  const previousHeads = await store.listHeads();
  for (const previous of previousHeads) {
    if (headByBoard.has(previous.boardId)) continue;
    const empty: RankingHeadRecord = {
      ...previous,
      generation,
      publishedAt: nowIso,
      sampleStartedAt: nowIso,
      sampleEndedAt: nowIso,
      participantCount: 0,
      displayCount: 0,
      boundaryTruncated: false,
      revision: previous.revision + 1
    };
    heads.push(empty);
    headByBoard.set(empty.boardId, empty);
  }
  const rows: RankingRowRecord[] = boards.flatMap((board) => {
    const boardId = rankingBoardId(board.ref);
    return board.ranked.map((row) => ({
      rowId: rankingRowId({ boardId, generation, memberId: row.memberId }),
      boardId,
      generation,
      scope: board.ref.scope,
      periodKey: board.ref.periodKey,
      categoryId: board.ref.categoryId,
      memberId: row.memberId,
      nickname: row.nickname,
      avatarKey: row.avatarKey,
      levelId: row.levelId,
      value: row.value,
      rank: row.rank,
      sortOrdinal: row.sortOrdinal,
      reachedAt: row.reachedAt,
      prevValueDiff: row.prevValueDiff,
      schemaVersion: 1
    }));
  });
  const obsolete: RankingObsolete[] = previousHeads
    .filter((head) => head.generation && head.generation !== generation)
    .map((head) => ({ boardId: head.boardId, generation: head.generation }));

  let written;
  try {
    written = await store.writeRows(rows, obsolete);
  } catch {
    return finishFailed("RANKING_ROWS_WRITE_FAILED");
  }
  if (written.rowsWritten !== rows.length) {
    return finishFailed("RANKING_ROWS_INCOMPLETE");
  }

  const historyGapRows = eligible.filter((row) => {
    const statsRow = statsOf.get(row.memberId);
    if (!statsRow || statsRow.totalScore <= 0) return false;
    const traceable = metrics.rows.some(
      (metric) =>
        metric.memberId === row.memberId &&
        metric.scope === "total" &&
        metric.periodKey === "all" &&
        metric.value > 0
    );
    return !traceable;
  });
  const rowCounts: Record<string, number> = {};
  for (const board of boards) {
    rowCounts[board.ref.scope] = (rowCounts[board.ref.scope] || 0) + board.ranked.length;
  }
  const chunkedHeads = heads.length > HEAD_SWITCH_CHUNK;
  if (chunkedHeads) {
    // 类目数很多时按块切换；每个板块自身仍指向完整代，读者不会看到半成品。
    for (let index = 0; index < heads.length; index += HEAD_SWITCH_CHUNK) {
      const chunk = heads.slice(index, index + HEAD_SWITCH_CHUNK);
      await store.transactRebuild({
        idempotencyId: `${idemRecord.id}:chunk${index}`,
        idempotency: { ...idemRecord, id: `${idemRecord.id}:chunk${index}` },
        mutate: () => ({ heads: chunk, result: null })
      });
    }
  }
  const finalRuntime: RankingRuntimeRecord = {
    ...building,
    publishedGeneration: generation,
    publishedAt: nowIso,
    requestedAt: before.requestedAt === building.requestedAt ? "" : building.requestedAt,
    buildingSince: "",
    lastBuildEndedAt: nowIso,
    lastBuildOk: true,
    lastBuildError: "",
    boardCount: boards.length,
    rowCount: rows.length,
    rowCounts,
    historyGapMembers: historyGapRows.length,
    historyGapScore: historyGapRows.reduce((sum, row) => sum + (statsOf.get(row.memberId)?.totalScore ?? 0), 0),
    truncated,
    revision: building.revision
  };
  const view: RankingRebuildView = {
    generation,
    publishedAt: nowIso,
    boardCount: boards.length,
    rowCount: rows.length,
    rowCounts,
    historyGapMembers: finalRuntime.historyGapMembers,
    historyGapScore: finalRuntime.historyGapScore,
    catalogVersion: finalRuntime.catalogVersion,
    truncated,
    obsoleteRemoved: written.obsoleteRemoved,
    boards: boards.map((board) => ({
      scope: board.ref.scope,
      periodKey: board.ref.periodKey,
      categoryId: board.ref.categoryId,
      participantCount: board.ranked.length,
      displayCount: board.displayCount,
      boundaryTruncated: board.boundaryTruncated
    })),
    headsChunked: chunkedHeads,
    note: RANKING_NO_FEE_FILTER_NOTE
  };
  const committed = await store.transactRebuild<RankingRebuildView>({
    idempotencyId: idemRecord.id,
    idempotency: idemRecord,
    mutate: (snap) => {
      const replay = replayOrConflict(snap.idem, idemRecord.payloadHash, () => view);
      if (!replay.ok) {
        return { error: "IDEMPOTENCY_CONFLICT", result: view };
      }
      if (replay.replayed && snap.idem?.status === "succeeded") {
        return {
          result: (snap.idem.resultRef as RankingRebuildView | null) ?? view,
          replayed: true,
          idem: snap.idem
        };
      }
      return {
        heads: chunkedHeads ? [] : heads,
        runtime: finalRuntime,
        idem: { ...idemRecord, status: "succeeded", resultRef: view },
        audit: buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: "ranking.rebuild",
          target: "ranking_heads",
          reason: parsed.reason,
          requestId: input.requestId,
          before: { generation: before.publishedGeneration, rowCount: before.rowCount },
          after: { generation, rowCount: rows.length, boardCount: boards.length },
          now: input.now
        }),
        result: view
      };
    }
  });
  /** 回放或幂等冲突时本轮不再发布：清掉自己刚写下的"构建中"标记，避免状态卡在更新中。 */
  const clearOwnBuildingFlag = async (): Promise<void> => {
    const current = await store.getRuntime();
    if (current && current.buildingSince === nowIso) {
      await store.saveRuntime({ ...current, buildingSince: "" });
    }
  };
  if (committed.mutation.error === "IDEMPOTENCY_CONFLICT") {
    await clearOwnBuildingFlag();
    return fail("IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT");
  }
  if (committed.mutation.error) {
    await clearOwnBuildingFlag();
    return fail("INTERNAL_ERROR", committed.mutation.error);
  }
  if (committed.mutation.replayed) {
    await clearOwnBuildingFlag();
  }
  return {
    ok: true,
    data: committed.mutation.result,
    replayed: committed.mutation.replayed === true,
    budget: committed.budget
  };
}

/** 交卷 / 参与变更后的待刷新标记（尽力而为，失败不影响主业务）。 */
export async function markRankingDirty(store: RankingWorkStore | undefined, now: Date): Promise<{ changed: boolean }> {
  if (!store) return { changed: false };
  try {
    const marked = await store.markRequested(now.toISOString());
    return { changed: marked.changed };
  } catch {
    return { changed: false };
  }
}
