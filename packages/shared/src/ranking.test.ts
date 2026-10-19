import { describe, expect, it } from "vitest";
import {
  RANKING_BUILD_SCAN_LIMIT,
  RANKING_REFRESH_TARGET_MS,
  RANKING_TOP_LIMIT,
  boundaryInclusiveCount,
  buildRankingBoards,
  currentPeriodKey,
  decodeRankingCursor,
  encodeRankingCursor,
  gapToPreviousDistinctRank,
  parseRankingListInput,
  parseRankingMeInput,
  parseRankingRebuildInput,
  parseSetRankingInput,
  rankParticipants,
  rankingBoardId,
  rankingRefreshStateOf,
  rankingRowId,
  type RankingParticipant
} from "./ranking.js";

function participant(memberId: string, value: number, reachedAt = "2026-10-15T00:00:00.000Z"): RankingParticipant {
  return {
    memberId,
    nickname: `学员${memberId.slice(0, 3)}`,
    avatarKey: "avatar.builtin.01",
    levelId: "L1",
    value,
    reachedAt
  };
}

describe("rankParticipants", () => {
  it("并列采用竞赛排名 1、1、3 并给出与上一不同名次的分差", () => {
    const ranked = rankParticipants([
      participant("m1", 100),
      participant("m2", 100),
      participant("m3", 80)
    ]);
    expect(ranked.map((row) => [row.memberId, row.rank])).toEqual([
      ["m1", 1],
      ["m2", 1],
      ["m3", 3]
    ]);
    expect(ranked.map((row) => row.prevValueDiff)).toEqual([null, null, 20]);
    expect(gapToPreviousDistinctRank(ranked, "m3")).toBe(20);
    expect(gapToPreviousDistinctRank(ranked, "m1")).toBeNull();
  });

  it("零分不上榜，负数与小数也不进入榜", () => {
    const ranked = rankParticipants([participant("m1", 0), participant("m2", 10), participant("m3", -5)]);
    expect(ranked.map((row) => row.memberId)).toEqual(["m2"]);
    expect(ranked[0]?.rank).toBe(1);
  });

  it("同分内部按首次达到时间、再按会员标识排序，且不打破并列名次", () => {
    const ranked = rankParticipants([
      participant("m9", 50, "2026-10-15T00:00:30.000Z"),
      participant("m8", 50, "2026-10-15T00:00:10.000Z"),
      participant("m7", 50, "2026-10-15T00:00:10.000Z")
    ]);
    expect(ranked.map((row) => row.memberId)).toEqual(["m7", "m8", "m9"]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 1, 1]);
    expect(ranked.map((row) => row.sortOrdinal)).toEqual([0, 1, 2]);
  });
});

describe("boundaryInclusiveCount", () => {
  it("不超过上限时全部展示", () => {
    const ranked = rankParticipants(Array.from({ length: 3 }, (_, index) => participant(`m${index}`, 100 - index)));
    expect(boundaryInclusiveCount(ranked)).toEqual({ count: 3, truncated: false });
  });

  it("第 100 名并列时把边界并列一起包含", () => {
    const participants = Array.from({ length: 150 }, (_, index) => participant(`m${index}`, index < 105 ? 200 : 100));
    const ranked = rankParticipants(participants);
    const boundary = boundaryInclusiveCount(ranked);
    expect(ranked[99]?.rank).toBe(1);
    expect(boundary.count).toBe(105);
    expect(boundary.truncated).toBe(false);
  });

  it("边界并列超过额外上限时标记截断", () => {
    const participants = [
      ...Array.from({ length: 10 }, (_, index) => participant(`top${index}`, 500 - index)),
      ...Array.from({ length: 250 }, (_, index) => participant(`tie${index}`, 100))
    ];
    const ranked = rankParticipants(participants);
    const boundary = boundaryInclusiveCount(ranked);
    expect(ranked[RANKING_TOP_LIMIT - 1]?.rank).toBe(11);
    expect(boundary.truncated).toBe(true);
    expect(boundary.count).toBe(RANKING_TOP_LIMIT + 100);
  });
});

describe("rankingRefreshStateOf", () => {
  const now = new Date("2026-10-15T10:00:00.000Z");

  it("从未发布时为 unpublished，且不伪造更新时间", () => {
    const state = rankingRefreshStateOf({ now, publishedAt: "", requestedAt: "", buildingSince: "" });
    expect(state.status).toBe("unpublished");
    expect(state.updatedAt).toBe("");
    expect(state.lagMs).toBeNull();
  });

  it("有请求且在 60 秒内为 updating", () => {
    const state = rankingRefreshStateOf({
      now,
      publishedAt: "2026-10-15T09:59:40.000Z",
      requestedAt: "2026-10-15T09:59:50.000Z",
      buildingSince: ""
    });
    expect(state.status).toBe("updating");
    expect(state.pendingMs).toBe(10_000);
    expect(state.lagMs).toBe(20_000);
  });

  it("请求超过 60 秒为 delayed，并给出真实滞后", () => {
    const state = rankingRefreshStateOf({
      now,
      publishedAt: "2026-10-15T09:50:00.000Z",
      requestedAt: "2026-10-15T09:58:00.000Z",
      buildingSince: ""
    });
    expect(state.status).toBe("delayed");
    expect(state.pendingMs).toBe(120_000);
    expect(state.pendingMs as number).toBeGreaterThan(RANKING_REFRESH_TARGET_MS);
    expect(state.lagMs).toBe(600_000);
  });

  it("重建进行中优先显示 updating", () => {
    const state = rankingRefreshStateOf({
      now,
      publishedAt: "2026-10-15T09:00:00.000Z",
      requestedAt: "2026-10-15T09:58:00.000Z",
      buildingSince: "2026-10-15T09:59:59.000Z"
    });
    expect(state.status).toBe("updating");
  });

  it("无待刷新请求时为 fresh", () => {
    const state = rankingRefreshStateOf({
      now,
      publishedAt: "2026-10-15T09:59:30.000Z",
      requestedAt: "",
      buildingSince: ""
    });
    expect(state.status).toBe("fresh");
    expect(state.pendingMs).toBeNull();
  });
});

describe("契约解析", () => {
  it("拒绝任何费用筛选参数", () => {
    for (const key of ["access", "freeOnly", "vipOnly", "accessFilter"]) {
      const parsed = parseRankingListInput({ scope: "total", [key]: "free" });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.issues.join(",")).toContain(key);
    }
  });

  it("scope=category 必须带有效类目，其他 scope 禁止 categoryId", () => {
    const missing = parseRankingListInput({ scope: "category" });
    expect(missing.ok).toBe(false);
    const unexpected = parseRankingListInput({ scope: "week", categoryId: "c1" });
    expect(unexpected.ok).toBe(false);
    const ok = parseRankingListInput({ scope: "category", categoryId: "c1" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.categoryId).toBe("c1");
  });

  it("拒绝未知 scope、越界 limit 与未知字段", () => {
    expect(parseRankingListInput({ scope: "season" }).ok).toBe(false);
    expect(parseRankingListInput({ scope: "total", limit: 101 }).ok).toBe(false);
    expect(parseRankingListInput({ scope: "total", limit: 0 }).ok).toBe(false);
    expect(parseRankingListInput({ scope: "total", period: "2026-10" }).ok).toBe(false);
    expect(parseRankingMeInput({ scope: "total", cursor: "x" }).ok).toBe(false);
    expect(parseRankingMeInput({ scope: "month" }).ok).toBe(true);
  });

  it("member.setRanking 只接受 enabled 与 expectedRevision", () => {
    expect(parseSetRankingInput({ enabled: true, expectedRevision: 1 }).ok).toBe(true);
    expect(parseSetRankingInput({ enabled: "yes", expectedRevision: 1 }).ok).toBe(false);
    expect(parseSetRankingInput({ enabled: true, expectedRevision: 0 }).ok).toBe(false);
    const withForbidden = parseSetRankingInput({ enabled: true, expectedRevision: 1, memberId: "m1" });
    expect(withForbidden.ok).toBe(false);
  });

  it("ranking.rebuild 需要 reason，scopes 只接受四个 scope", () => {
    expect(parseRankingRebuildInput({ reason: "" }).ok).toBe(false);
    expect(parseRankingRebuildInput({ reason: "MW17 手点重建", scopes: ["total", "season"] }).ok).toBe(false);
    const ok = parseRankingRebuildInput({ reason: "MW17 手点重建", scopes: ["total"], expectedRevision: 3 });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.scopes).toEqual(["total"]);
      expect(ok.expectedRevision).toBe(3);
    }
  });
});

describe("board 与 cursor", () => {
  it("板块标识稳定、可复现", () => {
    expect(rankingBoardId({ scope: "total", periodKey: "all", categoryId: "" })).toBe(
      rankingBoardId({ scope: "total", periodKey: "all", categoryId: "" })
    );
    expect(rankingBoardId({ scope: "week", periodKey: "2026-10-12", categoryId: "" })).not.toBe(
      rankingBoardId({ scope: "week", periodKey: "2026-10-19", categoryId: "" })
    );
    expect(rankingRowId({ boardId: "b1", generation: "gen1", memberId: "m1" })).not.toBe(
      rankingRowId({ boardId: "b1", generation: "gen2", memberId: "m1" })
    );
  });

  it("游标绑定板块与 generation，篡改即失效", () => {
    const payload = {
      scope: "week" as const,
      periodKey: "2026-10-12",
      categoryId: "",
      generation: "gen1",
      offset: 20
    };
    const raw = encodeRankingCursor(payload);
    const decoded = decodeRankingCursor(raw);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.payload).toEqual(payload);
    const tampered = `${raw.slice(0, raw.indexOf(".") + 1)}00`;
    expect(decodeRankingCursor(tampered).ok).toBe(false);
    expect(decodeRankingCursor("not-a-cursor").ok).toBe(false);
  });

  it("周期键遵循北京时间周一与月初", () => {
    // 2026-10-15T00:30Z 即北京时间 08:30，周一为 2026-10-12。
    expect(currentPeriodKey("week", new Date("2026-10-15T00:30:00.000Z"))).toBe("2026-10-12");
    // 2026-10-31T16:30Z 即北京时间 11 月 1 日 00:30，月键进入 2026-11。
    expect(currentPeriodKey("month", new Date("2026-10-31T16:30:00.000Z"))).toBe("2026-11");
    expect(currentPeriodKey("total", new Date("2026-10-15T00:30:00.000Z"))).toBe("all");
  });
});

describe("buildRankingBoards", () => {
  const members = [
    { memberId: "m1", nickname: "甲", avatarKey: "avatar.builtin.01", levelId: "L2", eligible: true },
    { memberId: "m2", nickname: "乙", avatarKey: "avatar.builtin.02", levelId: "L1", eligible: true },
    { memberId: "m3", nickname: "丙", avatarKey: "avatar.builtin.03", levelId: "L1", eligible: false }
  ];

  it("统一计入免费与 VIP 卷的指标，零分不上榜，未参与成员被排除", () => {
    const boards = buildRankingBoards({
      metrics: [
        { scope: "total", periodKey: "all", categoryId: "", memberId: "m1", value: 160, reachedAt: "2026-10-15T00:00:00.000Z" },
        { scope: "total", periodKey: "all", categoryId: "", memberId: "m2", value: 80, reachedAt: "2026-10-15T01:00:00.000Z" },
        { scope: "total", periodKey: "all", categoryId: "", memberId: "m3", value: 500, reachedAt: "2026-10-15T01:00:00.000Z" },
        { scope: "total", periodKey: "all", categoryId: "", memberId: "m1", value: 0, reachedAt: "2026-10-15T01:00:00.000Z" }
      ],
      members,
      categoryIds: []
    });
    const total = boards.find((board) => board.ref.scope === "total");
    expect(total?.ranked.map((row) => row.memberId)).toEqual(["m1", "m2"]);
    expect(total?.ranked.map((row) => row.value)).toEqual([160, 80]);
    // m3 未参与公开排行 → 不在榜；m1 的 0 值指标不覆盖正分。
    expect(total?.ranked.some((row) => row.memberId === "m3")).toBe(false);
  });

  it("分类榜只发布允许的有效类目，父子各榜独立排序", () => {
    const boards = buildRankingBoards({
      metrics: [
        { scope: "category", periodKey: "all", categoryId: "c1", memberId: "m1", value: 190, reachedAt: "2026-10-15T00:00:00.000Z" },
        { scope: "category", periodKey: "all", categoryId: "c2", memberId: "m1", value: 140, reachedAt: "2026-10-15T00:00:00.000Z" },
        { scope: "category", periodKey: "all", categoryId: "c3", memberId: "m2", value: 80, reachedAt: "2026-10-15T00:00:00.000Z" },
        { scope: "category", periodKey: "all", categoryId: "c9", memberId: "m2", value: 999, reachedAt: "2026-10-15T00:00:00.000Z" }
      ],
      members,
      categoryIds: ["c1", "c2", "c3"]
    });
    // "" 为总分榜（即使暂无正分指标也会发布，避免页面把"还没构建"和"空榜"混为一谈）。
    const ids = boards.map((board) => board.ref.categoryId).sort();
    expect(ids).toEqual(["", "c1", "c2", "c3"]);
    const parent = boards.find((board) => board.ref.categoryId === "c1");
    const child = boards.find((board) => board.ref.categoryId === "c3");
    expect(parent?.ranked[0]?.value).toBe(190);
    expect(child?.ranked[0]?.value).toBe(80);
    // 停用/删除的 c9 即使有指标也不发布。
    expect(boards.some((board) => board.ref.categoryId === "c9")).toBe(false);
  });

  it("周/月榜按周期键各自成榜", () => {
    const boards = buildRankingBoards({
      metrics: [
        { scope: "week", periodKey: "2026-10-12", categoryId: "", memberId: "m1", value: 40, reachedAt: "2026-10-15T00:00:00.000Z" },
        { scope: "week", periodKey: "2026-10-19", categoryId: "", memberId: "m2", value: 20, reachedAt: "2026-10-20T00:00:00.000Z" },
        { scope: "month", periodKey: "2026-10", categoryId: "", memberId: "m1", value: 40, reachedAt: "2026-10-15T00:00:00.000Z" }
      ],
      members,
      categoryIds: []
    });
    const weeks = boards.filter((board) => board.ref.scope === "week").map((board) => board.ref.periodKey).sort();
    expect(weeks).toEqual(["2026-10-12", "2026-10-19"]);
    const months = boards.filter((board) => board.ref.scope === "month");
    expect(months).toHaveLength(1);
    expect(months[0]?.ref.periodKey).toBe("2026-10");
  });

  it("MW26：全量名次生成覆盖 1 万参与者，不把扫描上限停在 5000，且计入全体行而不是前 100", () => {
    expect(RANKING_BUILD_SCAN_LIMIT).toBeGreaterThanOrEqual(10_000);
    const members = Array.from({ length: 10_000 }, (_, index) => ({
      memberId: `m${index}`,
      nickname: `夹具${index}`,
      avatarKey: "avatar.builtin.01",
      levelId: "L1",
      eligible: true
    }));
    const metrics = members.map((row, index) => ({
      scope: "total",
      periodKey: "all",
      categoryId: "",
      memberId: row.memberId,
      value: 1 + (index % 99),
      reachedAt: "2026-10-19T02:00:00.000Z"
    }));
    const started = Date.now();
    const boards = buildRankingBoards({ metrics, members, categoryIds: [] });
    const elapsedMs = Date.now() - started;
    const total = boards.find((board) => board.ref.scope === "total");
    expect(total?.ranked.length).toBe(10_000);
    expect(total?.displayCount).toBeLessThanOrEqual(RANKING_TOP_LIMIT + 100);
    expect(total?.ranked[9999]?.rank).toBeGreaterThan(100);
    expect(JSON.stringify(total?.ranked.slice(0, 3))).not.toMatch(/openid|OPENID|AppKey/i);
    expect(elapsedMs).toBeLessThan(RANKING_REFRESH_TARGET_MS);
  });
});
