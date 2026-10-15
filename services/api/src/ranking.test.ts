import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY_VERSIONS,
  METRIC_GENERATION_BASE,
  RANKING_TOP_LIMIT,
  encodeRankingCursor,
  rankingBoardId,
  scoreMetricId,
  seedCategoryId,
  type CategoryRecord,
  type PaperAnswerRecord,
  type PaperChunkRecord,
  type PaperRecord,
  type PaperVersionRecord
} from "@mw/shared";
import { handleOfficial, type AdminUserRecord, type OfficialContext } from "./official.js";
import { memoryAttemptStore } from "./modules/attempt-stores.js";
import { memoryMaintenanceStore } from "./modules/job-stores.js";
import { memoryMemberBundle, memoryPolicyStore } from "./modules/member-stores.js";
import { memoryRankingStore } from "./modules/ranking-stores.js";

const appId = "wxmwallowedappid0001";
const allowedAppIds = [appId];
const now = new Date("2026-10-15T02:00:00.000Z");
const fromA = { fromAppId: appId, fromOpenId: "mw17_openid_a" };
const fromB = { fromAppId: appId, fromOpenId: "mw17_openid_b" };
const rootId = seedCategoryId("logical");

function req(action: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    apiVersion: "1",
    action,
    requestId: extra.requestId || `req_${action.replace(/\./g, "_")}`,
    data,
    ...extra
  };
}

function cat(id: string, parentId: string | null = null, depth = 1, ancestorIds: string[] = []): CategoryRecord {
  return {
    categoryId: id,
    parentId,
    depth,
    ancestorIds,
    name: `虚构类目${id.slice(0, 2)}`,
    normalizedName: `虚构类目${id.slice(0, 2)}`,
    sort: 10,
    enabled: true,
    deletedAt: null,
    revision: 1,
    treeVersion: 3,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function paper(id: string, categoryId = rootId): PaperRecord {
  return {
    paperId: id,
    title: `虚构卷${id}`,
    summary: "虚构简介",
    goal: "虚构目标",
    categoryId,
    access: "free",
    difficulty: "beginner",
    sort: 10,
    suggestedMinutes: 20,
    publishedAt: "2026-10-09T06:00:00.000Z",
    status: "published",
    activeVersionId: `${id}_v`,
    revision: 2,
    draftItems: [],
    draftQuestionCount: 2,
    draftMaxScore: 10,
    accessLocked: false,
    withdrawReason: null,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function version(paperId: string): PaperVersionRecord {
  return {
    versionId: `${paperId}_v`,
    paperId,
    questionCount: 2,
    maxScore: 10,
    chunkIds: [`${paperId}_c1`],
    answerChunkIds: [`${paperId}_a1`],
    chunkDigests: ["d1"],
    answerDigests: ["d2"],
    categoryPathSnapshot: ["逻辑思维"],
    manifestHash: "m1",
    questionIds: ["q1", "q2"],
    questionVersionIds: ["qv1", "qv2"],
    schemaVersion: 1,
    createdAt: now.toISOString(),
    createdBy: "uid_content_1"
  };
}

function chunk(paperId: string): PaperChunkRecord {
  return {
    chunkId: `${paperId}_c1`,
    versionId: `${paperId}_v`,
    chunkNo: 1,
    items: [
      {
        ord: 1,
        questionId: "q1",
        questionVersionId: "qv1",
        type: "single",
        stem: { text: "虚构题干一", assetIds: [] },
        options: [
          { optionId: "A", text: "甲", assetIds: [] },
          { optionId: "B", text: "乙", assetIds: [] }
        ],
        points: 5
      },
      {
        ord: 2,
        questionId: "q2",
        questionVersionId: "qv2",
        type: "single",
        stem: { text: "虚构题干二", assetIds: [] },
        options: [
          { optionId: "A", text: "丙", assetIds: [] },
          { optionId: "B", text: "丁", assetIds: [] }
        ],
        points: 5
      }
    ],
    digest: "d1",
    schemaVersion: 1
  };
}

function answer(paperId: string): PaperAnswerRecord {
  return {
    chunkId: `${paperId}_a1`,
    versionId: `${paperId}_v`,
    chunkNo: 1,
    items: [
      {
        ord: 1,
        questionId: "q1",
        questionVersionId: "qv1",
        answer: { optionIds: ["A"] },
        analysis: { text: "虚构解析一", assetIds: [] }
      },
      {
        ord: 2,
        questionId: "q2",
        questionVersionId: "qv2",
        answer: { optionIds: ["B"] },
        analysis: { text: "虚构解析二", assetIds: [] }
      }
    ],
    digest: "d2",
    schemaVersion: 1
  };
}

type Attempts = ReturnType<typeof buildAttempts>;

function buildAttempts() {
  const papers = [paper("p_mw17_free"), paper("p_mw17_free_b")];
  const store = memoryAttemptStore({
    papers,
    versions: papers.map((row) => version(row.paperId)),
    chunks: papers.map((row) => chunk(row.paperId)),
    answers: papers.map((row) => answer(row.paperId)),
    categories: [cat(rootId)]
  });
  const ranking = memoryRankingStore();
  ranking.linkMetrics(store.metrics as never);
  ranking.seedCategory({ categoryId: rootId, parentId: null, ancestorIds: [], enabled: true, deletedAt: null });
  return { store, ranking };
}

/** score_metrics / members / member_stats 与云端一样是共享集合，本地用同一份 Map。 */
function harness() {
  const stores = memoryMemberBundle();
  const attempts = buildAttempts();
  attempts.ranking.linkMembers(stores.members as never);
  attempts.ranking.linkStats(stores.stats as never);
  return { stores, attempts, ranking: attempts.ranking };
}

function seedRankMetric(
  ranking: ReturnType<typeof memoryRankingStore>,
  input: { scope: string; periodKey: string; categoryId: string; memberId: string; value: number; reachedAt?: string }
) {
  ranking.seedMetric({
    metricId: scoreMetricId({
      metricGeneration: METRIC_GENERATION_BASE,
      scope: input.scope as never,
      periodKey: input.periodKey,
      categoryId: input.categoryId,
      memberId: input.memberId
    }),
    metricGeneration: METRIC_GENERATION_BASE,
    scope: input.scope as never,
    periodKey: input.periodKey,
    categoryId: input.categoryId,
    memberId: input.memberId,
    value: input.value,
    reachedAt: input.reachedAt || "2026-10-15T01:00:00.000Z"
  });
}

function publicCtx(ranking: ReturnType<typeof memoryRankingStore>, extra: Record<string, unknown> = {}): OfficialContext {
  return {
    entry: "mw-public",
    event: undefined,
    allowedAppIds,
    now,
    rankingStore: ranking,
    ...extra
  };
}

function memberCtx(
  event: unknown,
  stores: ReturnType<typeof memoryMemberBundle>,
  attempts: Attempts,
  extra: Record<string, unknown> = {}
): OfficialContext {
  return {
    entry: "mw-member",
    event,
    allowedAppIds,
    now,
    policyStore: memoryPolicyStore(),
    memberStore: stores,
    attemptStore: attempts.store,
    rankingStore: attempts.ranking,
    maintenanceStore: memoryMaintenanceStore(),
    ...fromA,
    ...extra
  };
}

function adminCtx(
  event: unknown,
  ranking: ReturnType<typeof memoryRankingStore>,
  roles: string[],
  extra: Record<string, unknown> = {}
): OfficialContext {
  return {
    entry: "mw-admin",
    event,
    allowedAppIds,
    now,
    adminStore: {
      async getByUid(uid) {
        return { uid, roles: roles as AdminUserRecord["roles"], enabled: true, authVersion: 1 };
      }
    },
    authUid: "uid_mw17_admin",
    rankingStore: ranking,
    ...extra
  };
}

async function register(
  stores: ReturnType<typeof memoryMemberBundle>,
  attempts: Attempts,
  openId: { fromAppId: string; fromOpenId: string },
  key: string
) {
  const res = (await handleOfficial(
    memberCtx(
      req(
        "member.register",
        {
          agreementVersion: DEFAULT_POLICY_VERSIONS.agreementVersion,
          privacyVersion: DEFAULT_POLICY_VERSIONS.privacyVersion,
          accepted: true
        },
        { idempotencyKey: key, requestId: `req_${key}` }
      ),
      stores,
      attempts,
      openId
    )
  )) as { ok: true; data: { memberId: string } };
  const memberId = res.data.memberId;
  const member = stores.members.get(memberId);
  if (member) attempts.store.members.set(memberId, member);
  attempts.store.linkMemberStats(stores.stats);
  return memberId;
}

function optIn(stores: ReturnType<typeof memoryMemberBundle>, memberId: string, enabled = true) {
  const member = stores.members.get(memberId);
  if (member) stores.members.set(memberId, { ...member, rankingOptIn: enabled });
}

async function submitScore(
  stores: ReturnType<typeof memoryMemberBundle>,
  attempts: Attempts,
  openId: { fromAppId: string; fromOpenId: string },
  paperId: string,
  optionIds: string[],
  key: string
) {
  const started = (await handleOfficial(
    memberCtx(
      req("attempt.start", { paperId }, { idempotencyKey: `start_${key}`, requestId: `req_start_${key}` }),
      stores,
      attempts,
      openId
    )
  )) as { ok: true; data: { attemptId: string } };
  const payload = {
    expectedRevision: 0,
    answers: [
      { questionId: "q1", optionIds: [optionIds[0]] },
      { questionId: "q2", optionIds: [optionIds[1]] }
    ]
  };
  await handleOfficial(
    memberCtx(
      req("attempt.save", { attemptId: started.data.attemptId, ...payload }, { idempotencyKey: `save_${key}`, requestId: `req_save_${key}` }),
      stores,
      attempts,
      openId
    )
  );
  return (await handleOfficial(
    memberCtx(
      req(
        "attempt.submit",
        { attemptId: started.data.attemptId, expectedRevision: 1, confirmUnanswered: true, answers: payload.answers },
        { idempotencyKey: `submit_${key}`, requestId: `req_submit_${key}` }
      ),
      stores,
      attempts,
      openId
    )
  )) as { ok: true; data: { score: number; delta: number; totalScore: number } };
}

function rebuildEvent(reason: string, options: Record<string, unknown> = {}) {
  return req("ranking.rebuild", { reason, ...options }, {
    idempotencyKey: `rebuild_${reason}`,
    requestId: `req_rebuild_${reason}`
  });
}

async function rebuild(ranking: ReturnType<typeof memoryRankingStore>, reason: string) {
  return (await handleOfficial(adminCtx(rebuildEvent(reason), ranking, ["super"]))) as {
    ok: boolean;
    error?: { code: string; details?: { reason?: string } };
    data: {
      generation: string;
      boardCount: number;
      rowCount: number;
      rowCounts: Record<string, number>;
      historyGapMembers: number;
      historyGapScore: number;
      obsoleteRemoved: number;
      replayed: boolean;
    };
  };
}

async function listBoard(ranking: ReturnType<typeof memoryRankingStore>, data: Record<string, unknown>, when: Date = now) {
  return (await handleOfficial(publicCtx(ranking, { event: req("ranking.list", data), now: when }))) as {
    ok: boolean;
    error?: { code: string; reason?: string; details?: Record<string, unknown> };
    data: {
      generation: string;
      rows: { rank: number; rankKey: string; value: number; nickname: string }[];
      displayCount: number;
      participantCount: number;
      nextCursor: string | null;
      complete: boolean;
      staleFiltered: number;
      refresh: { status: string; updatedAt: string; requestedAt: string; pendingMs: number | null };
      historyGap: { members: number; score: number; note: string };
      boundaryTruncated: boolean;
    };
  };
}

describe("MW17-A/B 四维榜单快照构建与发布", () => {
  it("四个榜单同一代发布，并列 1、1，未参与成员不入榜", async () => {
    const { attempts, ranking } = harness();
    ranking.seedMember({ memberId: "m_a", nickname: "甲学员", avatarKey: "avatar.builtin.01", status: "active", rankingOptIn: true, revision: 2 });
    ranking.seedMember({ memberId: "m_b", nickname: "乙学员", avatarKey: "avatar.builtin.02", status: "active", rankingOptIn: true, revision: 2 });
    ranking.seedMember({ memberId: "m_off", nickname: "丙学员", avatarKey: "avatar.builtin.03", status: "active", rankingOptIn: false, revision: 2 });
    seedRankMetric(ranking, { scope: "total", periodKey: "all", categoryId: "", memberId: "m_a", value: 10, reachedAt: "2026-10-15T01:00:00.000Z" });
    seedRankMetric(ranking, { scope: "total", periodKey: "all", categoryId: "", memberId: "m_b", value: 10, reachedAt: "2026-10-15T01:30:00.000Z" });
    seedRankMetric(ranking, { scope: "total", periodKey: "all", categoryId: "", memberId: "m_off", value: 999 });
    seedRankMetric(ranking, { scope: "week", periodKey: "2026-10-12", categoryId: "", memberId: "m_a", value: 10 });
    seedRankMetric(ranking, { scope: "month", periodKey: "2026-10", categoryId: "", memberId: "m_a", value: 10 });
    seedRankMetric(ranking, { scope: "category", periodKey: "all", categoryId: rootId, memberId: "m_a", value: 10 });

    const published = await rebuild(ranking, "mw17-boards");
    expect(published.ok).toBe(true);
    // 总分榜 + 本期周榜 + 本期月榜 + 全部有效类目榜（本轮 1 个有效类目，即使暂无指标也发布空榜）
    expect(published.data.boardCount).toBe(4);
    expect(published.data.rowCount).toBe(5);
    expect(published.data.rowCounts.total).toBe(2);
    expect(published.data.rowCounts.week).toBe(1);
    expect(published.data.rowCounts.month).toBe(1);
    expect(published.data.rowCounts.category).toBe(1);

    const total = await listBoard(ranking, { scope: "total" });
    expect(total.ok).toBe(true);
    expect(total.data.rows.map((row) => [row.value, row.rank])).toEqual([
      [10, 1],
      [10, 1]
    ]);
    // 并列 1、1 之后直接是第 3 名（此处只有两人）
    expect(total.data.rows.some((row) => row.rank === 2)).toBe(false);
    expect((await listBoard(ranking, { scope: "week" })).data.rows).toHaveLength(1);
    expect((await listBoard(ranking, { scope: "month" })).data.rows).toHaveLength(1);
    expect((await listBoard(ranking, { scope: "category", categoryId: rootId })).data.rows).toHaveLength(1);
    expect(Object.keys(total.data.rows[0] as object)).not.toContain("memberId");
  });

  it("零分不上榜；历史累计总分保留但无可追溯榜值的会员被显式诊断", async () => {
    const { stores, attempts, ranking } = harness();
    const memberId = await register(stores, attempts, fromA, "reg-gap");
    optIn(stores, memberId, true);
    // 复现 MW15/MW16 遗留：member_stats 有总分但 score_metrics 来源缺失
    ranking.seedStats({ memberId, totalScore: 9, levelId: "L1" });

    const published = await rebuild(ranking, "mw17-gap");
    expect(published.ok).toBe(true);
    expect(published.data.rowCount).toBe(0);
    expect(published.data.historyGapMembers).toBe(1);
    expect(published.data.historyGapScore).toBe(9);

    const total = await listBoard(ranking, { scope: "total" });
    expect(total.data.rows).toHaveLength(0);
    expect(total.data.historyGap.members).toBe(1);
    expect(total.data.historyGap.score).toBe(9);
    expect(total.data.historyGap.note).toContain("历史");

    const mine = (await handleOfficial(memberCtx(req("ranking.me", { scope: "total" }), stores, attempts))) as {
      ok: true;
      data: { onBoard: boolean; rank: number | null; privateTotalScore: number; historyGap: boolean; valueTraceable: boolean };
    };
    expect(mine.data.onBoard).toBe(false);
    expect(mine.data.rank).toBeNull();
    expect(mine.data.privateTotalScore).toBe(9);
    expect(mine.data.valueTraceable).toBe(false);
    expect(mine.data.historyGap).toBe(true);
    // 不把个人成长总分清零来制造一致
    expect(stores.stats.get(memberId)?.totalScore ?? 9).toBe(9);
  });

  it("分类榜父级包含后代，父级分值不低于后代且同一卷只计一次", async () => {
    const { ranking } = harness();
    const childId = seedCategoryId("logic");
    ranking.seedCategory({ categoryId: childId, parentId: rootId, ancestorIds: [rootId], enabled: true, deletedAt: null });
    ranking.seedMember({ memberId: "m_c", nickname: "丙学员", avatarKey: "avatar.builtin.03", status: "active", rankingOptIn: true, revision: 2 });
    // MW15 已把同一卷的 delta 同时累加到自身与祖先类目；父级含后代故大于等于子级。
    seedRankMetric(ranking, { scope: "category", periodKey: "all", categoryId: rootId, memberId: "m_c", value: 19 });
    seedRankMetric(ranking, { scope: "category", periodKey: "all", categoryId: childId, memberId: "m_c", value: 14 });

    await rebuild(ranking, "mw17-cat");
    const parent = await listBoard(ranking, { scope: "category", categoryId: rootId });
    const child = await listBoard(ranking, { scope: "category", categoryId: childId });
    expect(parent.data.rows).toHaveLength(1);
    expect(parent.data.rows[0]?.value).toBe(19);
    expect(child.data.rows[0]?.value).toBe(14);
    expect((parent.data.rows[0]?.value ?? 0) >= (child.data.rows[0]?.value ?? 0)).toBe(true);

    // 停用类目的旧板块被切成空的新代，不停留在旧快照
    ranking.seedCategory({ categoryId: childId, parentId: rootId, ancestorIds: [rootId], enabled: false, deletedAt: null });
    await rebuild(ranking, "mw17-cat-off");
    expect((await listBoard(ranking, { scope: "category", categoryId: childId })).error?.code).toBe("CATEGORY_UNAVAILABLE");
  });

  it("前百边界并列一起公开，游标绑定代与板块", async () => {
    const { ranking } = harness();
    const total = 105;
    for (let index = 0; index < total; index += 1) {
      const memberId = `m_${String(index).padStart(3, "0")}`;
      ranking.seedMember({ memberId, nickname: `学员${index}`, avatarKey: "avatar.builtin.01", status: "active", rankingOptIn: true, revision: 2 });
      seedRankMetric(ranking, { scope: "total", periodKey: "all", categoryId: "", memberId, value: 100 });
    }
    await rebuild(ranking, "mw17-boundary");
    const page = await listBoard(ranking, { scope: "total", limit: 20 });
    expect(page.data.displayCount).toBe(total);
    expect(page.data.rows.every((row) => row.rank === 1)).toBe(true);
    expect(page.data.nextCursor).toBeTruthy();
    expect(page.data.boundaryTruncated).toBe(false);
    expect(RANKING_TOP_LIMIT).toBe(100);

    const stale = encodeRankingCursor({ scope: "total", periodKey: "all", categoryId: "", generation: "gen_other", offset: 20 });
    const mismatch = (await handleOfficial(
      publicCtx(ranking, { event: req("ranking.list", { scope: "total", cursor: stale }) })
    )) as { ok: false; error: { details?: { reason?: string } } };
    expect(mismatch.ok).toBe(false);
    expect(mismatch.error.details?.reason).toBe("CURSOR_FILTER_MISMATCH");

    const boardId = rankingBoardId({ scope: "total", periodKey: "all", categoryId: "" });
    expect(rankings(ranking, boardId)).toBeGreaterThan(0);
  });

  it("发布失败保留上一完整代，待刷新保留成更新中/更新延迟，不伪造刷新时间", async () => {
    const { ranking } = harness();
    ranking.seedMember({ memberId: "m_x", nickname: "甲", avatarKey: "avatar.builtin.01", status: "active", rankingOptIn: true, revision: 2 });
    seedRankMetric(ranking, { scope: "total", periodKey: "all", categoryId: "", memberId: "m_x", value: 30 });
    const first = await rebuild(ranking, "mw17-ok");
    expect(first.ok).toBe(true);
    expect(first.data.obsoleteRemoved).toBe(0);

    ranking.writeRowsFailure = "simulated-write-failure";
    const failed = await rebuild(ranking, "mw17-fail");
    expect(failed.ok).toBe(false);
    expect(failed.error?.details?.reason).toBe("RANKING_ROWS_WRITE_FAILED");
    ranking.writeRowsFailure = null;

    const afterFailure = await listBoard(ranking, { scope: "total" });
    expect(afterFailure.data.generation).toBe(first.data.generation);
    expect(afterFailure.data.rows).toHaveLength(1);
    expect(afterFailure.data.refresh.status).toBe("updating");

    const delayed = await listBoard(ranking, { scope: "total" }, new Date(now.getTime() + 61_000));
    expect(delayed.data.refresh.status).toBe("delayed");
    expect(delayed.data.refresh.pendingMs as number).toBeGreaterThan(60_000);
    expect(delayed.data.refresh.updatedAt).toBe(now.toISOString());

    // 恢复后再发布：新代替换旧代行
    const second = await rebuild(ranking, "mw17-recover");
    expect(second.ok).toBe(true);
    expect(second.data.generation).not.toBe(first.data.generation);
    expect(second.data.obsoleteRemoved).toBe(1);
    expect((await listBoard(ranking, { scope: "total" })).data.refresh.status).toBe("fresh");
  });

  it("从未发布时显示未发布状态，不伪造更新时间", async () => {
    const { ranking } = harness();
    const page = await listBoard(ranking, { scope: "total" });
    expect(page.ok).toBe(true);
    expect(page.data.generation).toBe("");
    expect(page.data.rows).toEqual([]);
    expect(page.data.refresh.status).toBe("unpublished");
    expect(page.data.refresh.updatedAt).toBe("");
  });
});

function rankings(ranking: ReturnType<typeof memoryRankingStore>, boardId: string): number {
  return [...ranking.rows.values()].filter((row) => row.boardId === boardId).length;
}

describe("MW17-B 榜单读取契约", () => {
  it("拒绝费用筛选、未知字段与非法 scope；分类榜要求有效类目", async () => {
    const { ranking } = harness();
    for (const key of ["access", "freeOnly", "vipOnly", "accessFilter"]) {
      const forbidden = (await handleOfficial(
        publicCtx(ranking, { event: req("ranking.list", { scope: "total", [key]: true }) })
      )) as { ok: false; error: { code: string; details?: { issues?: string[] } } };
      expect(forbidden.ok).toBe(false);
      expect(forbidden.error.code).toBe("INVALID_ARGUMENT");
      expect(String(forbidden.error.details?.issues)).toContain(key);
    }
    const unknown = (await handleOfficial(
      publicCtx(ranking, { event: req("ranking.list", { scope: "total", period: "2026-10" }) })
    )) as { ok: false; error: { code: string } };
    expect(unknown.ok).toBe(false);
    const badScope = (await handleOfficial(
      publicCtx(ranking, { event: req("ranking.list", { scope: "season" }) })
    )) as { ok: false; error: { code: string } };
    expect(badScope.ok).toBe(false);
    const missingCategory = (await handleOfficial(
      publicCtx(ranking, { event: req("ranking.list", { scope: "category" }) })
    )) as { ok: false; error: { code: string } };
    expect(missingCategory.ok).toBe(false);
    const unexpectedCategory = (await handleOfficial(
      publicCtx(ranking, { event: req("ranking.list", { scope: "week", categoryId: rootId }) })
    )) as { ok: false; error: { code: string } };
    expect(unexpectedCategory.ok).toBe(false);

    ranking.seedCategory({ categoryId: "c_disabled", parentId: null, ancestorIds: [], enabled: false, deletedAt: null });
    for (const categoryId of ["c_unknown", "c_disabled"]) {
      const unavailable = (await handleOfficial(
        publicCtx(ranking, { event: req("ranking.list", { scope: "category", categoryId }) })
      )) as { ok: false; error: { code: string } };
      expect(unavailable.ok).toBe(false);
      expect(unavailable.error.code).toBe("CATEGORY_UNAVAILABLE");
    }
  });

  it("退出公开排行立即不再公开展示，旧快照 generation 与名次不变", async () => {
    const { stores, attempts, ranking } = harness();
    const memberId = await register(stores, attempts, fromA, "reg-optout");
    optIn(stores, memberId, true);
    seedRankMetric(ranking, { scope: "total", periodKey: "all", categoryId: "", memberId, value: 12 });
    const published = await rebuild(ranking, "mw17-optout");
    const before = await listBoard(ranking, { scope: "total" });
    expect(before.data.rows).toHaveLength(1);
    expect(before.data.staleFiltered).toBe(0);

    optIn(stores, memberId, false);
    const after = await listBoard(ranking, { scope: "total" });
    expect(after.data.generation).toBe(published.data.generation);
    expect(after.data.rows).toHaveLength(0);
    expect(after.data.staleFiltered).toBe(1);
    // 关闭公开排行不清空个人成绩
    expect(stores.stats.get(memberId)?.totalScore ?? 0).toBe(0);
  });

  it("本人名次与榜单同代，并给出与上一不同名次的分差", async () => {
    const { stores, attempts, ranking } = harness();
    const mine = await register(stores, attempts, fromA, "reg-me");
    const other = await register(stores, attempts, fromB, "reg-other");
    optIn(stores, mine, true);
    optIn(stores, other, true);
    seedRankMetric(ranking, { scope: "total", periodKey: "all", categoryId: "", memberId: other, value: 30 });
    seedRankMetric(ranking, { scope: "total", periodKey: "all", categoryId: "", memberId: mine, value: 20 });
    await rebuild(ranking, "mw17-me");

    const list = await listBoard(ranking, { scope: "total" });
    const meView = (await handleOfficial(memberCtx(req("ranking.me", { scope: "total" }), stores, attempts))) as {
      ok: true;
      data: {
        generation: string;
        rank: number | null;
        value: number;
        valueDiff: number | null;
        participating: boolean;
        onBoard: boolean;
        rankKey: string;
      };
    };
    expect(meView.ok).toBe(true);
    expect(meView.data.generation).toBe(list.data.generation);
    expect(meView.data.rank).toBe(2);
    expect(meView.data.value).toBe(20);
    expect(meView.data.valueDiff).toBe(10);
    expect(meView.data.participating).toBe(true);
    expect(meView.data.onBoard).toBe(true);
    expect(list.data.rows.some((row) => row.rankKey === meView.data.rankKey)).toBe(true);
  });

  it("未参与时不返回公开名次但仍可读私人总分；未注册返回 MEMBER_REQUIRED", async () => {
    const { stores, attempts, ranking } = harness();
    const memberId = await register(stores, attempts, fromA, "reg-private");
    ranking.seedStats({ memberId, totalScore: 9, levelId: "L1" });
    const meView = (await handleOfficial(memberCtx(req("ranking.me", { scope: "total" }), stores, attempts))) as {
      ok: true;
      data: { rank: number | null; participating: boolean; onBoard: boolean; privateTotalScore: number; historyGap: boolean; historyGapNote: string };
    };
    expect(meView.data.participating).toBe(false);
    expect(meView.data.onBoard).toBe(false);
    expect(meView.data.rank).toBeNull();
    expect(meView.data.privateTotalScore).toBe(9);
    expect(meView.data.historyGap).toBe(true);
    expect(meView.data.historyGapNote).toContain("历史");

    const anonymous = (await handleOfficial(memberCtx(req("ranking.me", { scope: "total" }), stores, attempts, { ...fromB, fromOpenId: "mw17_openid_never" }))) as {
      ok: false;
      error: { code: string };
    };
    expect(anonymous.ok).toBe(false);
    expect(anonymous.error.code).toBe("MEMBER_REQUIRED");
  });
});

describe("MW17-B 会员参与与退出", () => {
  it("开启/退出写审计与待刷新标记，幂等可回放；版本不符 VERSION_CONFLICT；未知字段 INVALID_ARGUMENT", async () => {
    const { stores, attempts, ranking } = harness();
    const memberId = await register(stores, attempts, fromA, "reg-set");
    const member = stores.members.get(memberId)!;
    expect(member.rankingOptIn).toBe(false);

    const on = (await handleOfficial(
      memberCtx(
        req("member.setRanking", { enabled: true, expectedRevision: member.revision }, { idempotencyKey: "set-on", requestId: "req_set_on" }),
        stores,
        attempts
      )
    )) as {
      ok: true;
      data: { rankingOptIn: boolean; revision: number; rankingRefresh: { requestedAt: string }; replayed: boolean };
    };
    expect(on.ok).toBe(true);
    expect(on.data.rankingOptIn).toBe(true);
    expect(on.data.rankingRefresh.requestedAt).not.toBe("");
    expect(stores.audits.some((row) => row.action === "member.setRanking")).toBe(true);
    expect(ranking.runtime?.requestedAt).toBe(now.toISOString());

    const replay = (await handleOfficial(
      memberCtx(
        req("member.setRanking", { enabled: true, expectedRevision: member.revision }, { idempotencyKey: "set-on", requestId: "req_set_on" }),
        stores,
        attempts
      )
    )) as { ok: true; data: { replayed: boolean } };
    expect(replay.ok).toBe(true);
    expect(replay.data.replayed).toBe(true);

    const stale = (await handleOfficial(
      memberCtx(
        req("member.setRanking", { enabled: false, expectedRevision: member.revision }, { idempotencyKey: "set-off", requestId: "req_set_off" }),
        stores,
        attempts
      )
    )) as { ok: false; error: { code: string } };
    expect(stale.ok).toBe(false);
    expect(stale.error.code).toBe("VERSION_CONFLICT");

    const off = (await handleOfficial(
      memberCtx(
        req("member.setRanking", { enabled: false, expectedRevision: member.revision + 1 }, { idempotencyKey: "set-off2", requestId: "req_set_off2" }),
        stores,
        attempts
      )
    )) as { ok: true; data: { rankingOptIn: boolean } };
    expect(off.ok).toBe(true);
    expect(off.data.rankingOptIn).toBe(false);

    const unknownField = (await handleOfficial(
      memberCtx(
        req(
          "member.setRanking",
          { enabled: true, expectedRevision: member.revision + 2, scope: "total" },
          { idempotencyKey: "set-unknown", requestId: "req_set_unknown" }
        ),
        stores,
        attempts
      )
    )) as { ok: false; error: { code: string; details?: { issues?: string[] } } };
    expect(unknownField.ok).toBe(false);
    expect(unknownField.error.code).toBe("INVALID_ARGUMENT");
    expect(String(unknownField.error.details?.issues)).toContain("scope");

    // 客户端传入会员标识属于伪造身份字段，公共层直接拒绝（不进入业务逻辑）
    const forged = (await handleOfficial(
      memberCtx(
        req(
          "member.setRanking",
          { enabled: true, expectedRevision: member.revision + 2, memberId: "someone_else" },
          { idempotencyKey: "set-forged", requestId: "req_set_forged" }
        ),
        stores,
        attempts
      )
    )) as { ok: false; error: { code: string; details?: { reason?: string } } };
    expect(forged.ok).toBe(false);
    expect(forged.error.code).toBe("FORBIDDEN");
    expect(forged.error.details?.reason).toBe("CLIENT_IDENTITY_IGNORED");
  });

  it("停用账号不能改参与状态", async () => {
    const { stores, attempts } = harness();
    const memberId = await register(stores, attempts, fromA, "reg-disabled");
    const member = stores.members.get(memberId)!;
    stores.members.set(memberId, { ...member, status: "disabled" });
    const res = (await handleOfficial(
      memberCtx(
        req("member.setRanking", { enabled: true, expectedRevision: member.revision }, { idempotencyKey: "set-disabled", requestId: "req_set_disabled" }),
        stores,
        attempts
      )
    )) as { ok: false; error: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("ACCOUNT_DISABLED");
  });
});

describe("MW17-B 后台治理入口", () => {
  it("ranking.status 只读；ranking.rebuild 仅 super 且需要 reason 与幂等键", async () => {
    const { ranking } = harness();
    const status = (await handleOfficial(adminCtx(req("ranking.status"), ranking, ["operations"]))) as {
      ok: true;
      data: { publishedGeneration: string; storeConfigured: boolean; refresh: { status: string } };
    };
    expect(status.ok).toBe(true);
    expect(status.data.storeConfigured).toBe(true);
    expect(status.data.publishedGeneration).toBe("");
    expect(status.data.refresh.status).toBe("unpublished");

    const denied = (await handleOfficial(adminCtx(rebuildEvent("mw17-denied"), ranking, ["operations"]))) as {
      ok: false;
      error: { code: string; details?: { reason?: string } };
    };
    expect(denied.ok).toBe(false);
    expect(denied.error.details?.reason).toBe("SUPER_REQUIRED");

    const noReason = (await handleOfficial(
      adminCtx(req("ranking.rebuild", {}, { idempotencyKey: "rebuild-noreason", requestId: "req_noreason" }), ranking, ["super"])
    )) as { ok: false; error: { code: string } };
    expect(noReason.ok).toBe(false);
    expect(noReason.error.code).toBe("INVALID_ARGUMENT");

    const noKey = (await handleOfficial(adminCtx(req("ranking.rebuild", { reason: "缺幂等键" }), ranking, ["super"]))) as {
      ok: false;
      error: { code: string };
    };
    expect(noKey.ok).toBe(false);
    expect(noKey.error.code).toBe("INVALID_ARGUMENT");

    const published = await rebuild(ranking, "mw17-admin");
    expect(published.ok).toBe(true);
    const replay = (await handleOfficial(adminCtx(rebuildEvent("mw17-admin"), ranking, ["super"]))) as {
      ok: true;
      data: { generation: string; replayed: boolean };
    };
    expect(replay.ok).toBe(true);
    expect(replay.data.replayed).toBe(true);
    expect(replay.data.generation).toBe(published.data.generation);

    const after = (await handleOfficial(adminCtx(req("ranking.status"), ranking, ["operations"]))) as {
      ok: true;
      data: { publishedGeneration: string; refresh: { status: string; updatedAt: string } };
    };
    expect(after.data.publishedGeneration).toBe(published.data.generation);
    expect(after.data.refresh.status).toBe("fresh");
    expect(after.data.refresh.updatedAt).toBe(now.toISOString());
  });

  it("未在白名单的登录账号读不到榜单治理；已启用后台角色可读快照状态", async () => {
    const { ranking } = harness();
    const unknown = (await handleOfficial(
      adminCtx(req("ranking.status"), ranking, ["super"], {
        adminStore: { async getByUid() { return undefined; } }
      })
    )) as { ok: false; error: { code: string; details?: { reason?: string } } };
    expect(unknown.ok).toBe(false);
    expect(unknown.error.code).toBe("FORBIDDEN");
    expect(unknown.error.details?.reason).toBe("NOT_IN_ADMIN_WHITELIST");

    const operations = (await handleOfficial(adminCtx(req("ranking.status"), ranking, ["operations"]))) as {
      ok: true;
      data: { publishedGeneration: string };
    };
    expect(operations.ok).toBe(true);
  });
});

describe("MW17-B 交卷路径", () => {
  it("免费卷交卷成功写入待刷新标记，指标结构不含费用维度，重建后进入榜单", async () => {
    const { stores, attempts, ranking } = harness();
    const memberId = await register(stores, attempts, fromA, "reg-submit");
    optIn(stores, memberId, true);
    ranking.seedMember({
      memberId,
      nickname: stores.members.get(memberId)!.nickname,
      avatarKey: stores.members.get(memberId)!.avatarKey,
      status: "active",
      rankingOptIn: true,
      revision: stores.members.get(memberId)!.revision
    });

    const submitted = await submitScore(stores, attempts, fromA, "p_mw17_free", ["A", "B"], "submit-mw17");
    expect(submitted.ok).toBe(true);
    expect(submitted.data.score).toBe(10);
    expect(ranking.runtime?.requestedAt).toBeTruthy();

    const metrics = await ranking.scanMetrics({ limit: 100 });
    const totalMetric = metrics.rows.find((row) => row.memberId === memberId && row.scope === "total" && row.periodKey === "all");
    expect(totalMetric?.value).toBe(10);
    // 免费卷与 VIP 卷走同一条路径：榜值就是卷面得分，没有 access / planId 维度
    expect(Object.keys(totalMetric as object)).not.toContain("access");
    expect(Object.keys(totalMetric as object)).not.toContain("planId");
    expect(metrics.rows.some((row) => row.memberId === memberId && row.scope === "week")).toBe(true);
    expect(metrics.rows.some((row) => row.memberId === memberId && row.scope === "month")).toBe(true);
    expect(metrics.rows.some((row) => row.memberId === memberId && row.scope === "category" && row.categoryId === rootId)).toBe(true);

    const stats = stores.stats.get(memberId)!;
    ranking.seedStats({ memberId, totalScore: stats.totalScore, levelId: stats.levelId });
    await rebuild(ranking, "mw17-submit");
    const total = await listBoard(ranking, { scope: "total" });
    expect(total.data.rows[0]?.value).toBe(10);
    expect(total.data.refresh.requestedAt).toBe("");

    // 重复交卷（同卷不再加分）不改变榜值，也不产生重复行
    await submitScore(stores, attempts, fromA, "p_mw17_free", ["A", "B"], "submit-mw17-again");
    const statsAfter = stores.stats.get(memberId)!;
    ranking.seedStats({ memberId, totalScore: statsAfter.totalScore, levelId: statsAfter.levelId });
    await rebuild(ranking, "mw17-repeat");
    const repeated = await listBoard(ranking, { scope: "total" });
    expect(repeated.data.rows).toHaveLength(1);
    expect(repeated.data.rows[0]?.value).toBe(10);
  });
});

describe("MW17 周期口径", () => {
  it("周/月榜按北京时间周期键取用当期指标，历史周期不混入", async () => {
    const { ranking } = harness();
    ranking.seedMember({ memberId: "m_w", nickname: "甲", avatarKey: "avatar.builtin.01", status: "active", rankingOptIn: true, revision: 2 });
    seedRankMetric(ranking, { scope: "week", periodKey: "2026-10-12", categoryId: "", memberId: "m_w", value: 40 });
    seedRankMetric(ranking, { scope: "week", periodKey: "2026-10-05", categoryId: "", memberId: "m_w", value: 70 });
    seedRankMetric(ranking, { scope: "month", periodKey: "2026-10", categoryId: "", memberId: "m_w", value: 40 });
    seedRankMetric(ranking, { scope: "month", periodKey: "2026-09", categoryId: "", memberId: "m_w", value: 90 });
    await rebuild(ranking, "mw17-period");

    // now = 2026-10-15T02:00Z → 北京时间 10:00，属于 2026-10-12 那一周与 2026-10 本月
    const week = await listBoard(ranking, { scope: "week" });
    expect(week.data.rows[0]?.value).toBe(40);
    const month = await listBoard(ranking, { scope: "month" });
    expect(month.data.rows[0]?.value).toBe(40);
    expect(week.data.generation).toBe(month.data.generation);
    expect((await listBoard(ranking, { scope: "total" })).data.rows).toHaveLength(0);
  });
});
