import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROWTH_LEVELS,
  GROWTH_CONFIG_DOC_ID,
  cloneGrowthLevels,
  defaultGrowthConfig,
  growthImpactOf,
  growthMemberView,
  levelIdForScore,
  levelProgress,
  levelsReached,
  medalGrantId,
  newMedalGrant,
  nextGrowthConfigVersion,
  nextLevelFor,
  normalizeGrowthLevels,
  parseGrowthPublishInput,
  parseGrowthRecomputeInput,
  planMedalGrants,
  validateGrowthLevels,
  type GrowthLevel,
  type MedalGrantRecord
} from "./growth.js";

const levels: GrowthLevel[] = cloneGrowthLevels(DEFAULT_GROWTH_LEVELS);

describe("growth level thresholds", () => {
  it("maps total score to the highest reached level", () => {
    expect(GROWTH_CONFIG_DOC_ID).toBe("growth");
    expect(levelIdForScore(0)).toBe("L1");
    expect(levelIdForScore(99)).toBe("L1");
    expect(levelIdForScore(100)).toBe("L2");
    expect(levelIdForScore(299)).toBe("L2");
    expect(levelIdForScore(300)).toBe("L3");
    expect(levelIdForScore(800)).toBe("L4");
    expect(levelIdForScore(1500)).toBe("L5");
    expect(levelIdForScore(3000)).toBe("L6");
    expect(levelIdForScore(999999)).toBe("L6");
  });

  it("never regresses below the first level", () => {
    expect(levelIdForScore(-5)).toBe("L1");
    expect(nextLevelFor(0)?.levelId).toBe("L2");
    expect(nextLevelFor(3000)).toBeUndefined();
  });

  it("reports upgrade progress inside the current band", () => {
    const progress = levelProgress(50);
    expect(progress.levelId).toBe("L1");
    expect(progress.levelName).toBe("思维新芽");
    expect(progress.nextLevelId).toBe("L2");
    expect(progress.nextMinScore).toBe(100);
    expect(progress.remaining).toBe(50);
    expect(progress.percent).toBe(50);
    const top = levelProgress(5000);
    expect(top.levelId).toBe("L6");
    expect(top.nextLevelId).toBeNull();
    expect(top.percent).toBe(100);
  });

  it("validates 0-based strictly increasing thresholds with names and medals", () => {
    expect(validateGrowthLevels(levels)).toEqual([]);
    expect(validateGrowthLevels([])).toContain("LEVELS_REQUIRED");
    const notZero: GrowthLevel[] = levels.map((row, index) => (index === 0 ? { ...row, minScore: 10 } : row));
    expect(validateGrowthLevels(notZero)).toContain("LEVEL_FIRST_MIN_NOT_ZERO");
    const flat: GrowthLevel[] = [
      { ...levels[0]!, minScore: 0 },
      { ...levels[1]!, minScore: 0 }
    ];
    expect(validateGrowthLevels(flat)).toContain("LEVEL_MIN_NOT_INCREASING");
    const dupMedal: GrowthLevel[] = [levels[0]!, { ...levels[1]!, medalId: levels[0]!.medalId }];
    expect(validateGrowthLevels(dupMedal)).toContain("MEDAL_ID_DUPLICATE");
    const noName: GrowthLevel[] = [{ ...levels[0]!, name: "  " }];
    expect(validateGrowthLevels(noName)).toContain("LEVEL_NAME_MISSING");
    const noMedalName: GrowthLevel[] = [{ ...levels[0]!, medalName: "" }];
    expect(validateGrowthLevels(noMedalName)).toContain("MEDAL_NAME_MISSING");
  });

  it("normalizes candidate levels and rejects unknown fields", () => {
    const ok = normalizeGrowthLevels([
      { levelId: "L1", name: "新芽", minScore: 0, medalId: "m1", medalName: "芽" },
      { levelId: "L2", name: "启程", minScore: 50, medalId: "m2", medalName: "启" }
    ]);
    expect(ok.ok).toBe(true);
    const bad = normalizeGrowthLevels([{ levelId: "L1", name: "新芽", minScore: 0, medalId: "m1", medalName: "芽", extra: 1 }]);
    expect(bad.ok).toBe(false);
    const notArray = normalizeGrowthLevels("L1");
    expect(notArray.ok).toBe(false);
    expect(defaultGrowthConfig(new Date("2026-10-14T00:00:00.000Z")).levels).toHaveLength(6);
    expect(nextGrowthConfigVersion(0)).toBe(1);
    expect(nextGrowthConfigVersion(3)).toBe(4);
  });
});

describe("medal grants", () => {
  it("uses a deterministic member/medal id so replays cannot double grant", () => {
    const first = medalGrantId("member-a", "medal.L2");
    expect(first).toBe(medalGrantId("member-a", "medal.L2"));
    expect(first).not.toBe(medalGrantId("member-b", "medal.L2"));
    expect(first).not.toContain("member-a");
  });

  it("backfills every level crossed in one jump", () => {
    const pending = planMedalGrants({
      memberId: "member-a",
      totalScore: 350,
      levels,
      existingMedalIds: [],
      sourceType: "submit",
      sourceId: "attempt-1",
      configVersion: 4,
      nowIso: "2026-10-14T00:00:00.000Z"
    });
    expect(pending.map((row) => row.medalId)).toEqual(["medal.L1", "medal.L2", "medal.L3"]);
  });

  it("does not re-grant earned medals and keeps them when thresholds change", () => {
    const pending = planMedalGrants({
      memberId: "member-a",
      totalScore: 350,
      levels,
      existingMedalIds: ["medal.L1", "medal.L2"],
      sourceType: "submit",
      sourceId: "attempt-2",
      configVersion: 4,
      nowIso: "2026-10-14T00:00:00.000Z"
    });
    expect(pending.map((row) => row.medalId)).toEqual(["medal.L3"]);
    const stricter: GrowthLevel[] = levels.map((row) => ({ ...row, minScore: row.minScore * 10 }));
    const afterChange = planMedalGrants({
      memberId: "member-a",
      totalScore: 350,
      levels: stricter,
      existingMedalIds: ["medal.L1", "medal.L2", "medal.L3"],
      sourceType: "recompute",
      sourceId: "publish-2",
      configVersion: 5,
      nowIso: "2026-10-14T01:00:00.000Z"
    });
    expect(afterChange).toEqual([]);
    // 门槛提高到 10 倍后等级回落，但既得勋章一枚都不撤销。
    expect(levelIdForScore(350, stricter)).toBe("L1");
  });

  it("builds the member growth view with earned medals only", () => {
    const grants: MedalGrantRecord[] = [
      newMedalGrant({
        memberId: "member-a",
        level: levels[0]!,
        sourceType: "register",
        sourceId: "register",
        configVersion: 1,
        nowIso: "2026-10-13T00:00:00.000Z"
      }),
      newMedalGrant({
        memberId: "member-a",
        level: levels[1]!,
        sourceType: "submit",
        sourceId: "attempt-1",
        configVersion: 1,
        nowIso: "2026-10-14T00:00:00.000Z"
      })
    ];
    const view = growthMemberView({ totalScore: 120, levels, configVersion: 1, grants });
    expect(view.levelId).toBe("L2");
    expect(view.levelName).toBe("思维学徒");
    expect(view.medalName).toBe("启程");
    expect(view.nextLevelId).toBe("L3");
    expect(view.remaining).toBe(180);
    expect(view.earnedCount).toBe(2);
    expect(view.medals.filter((row) => row.earned).map((row) => row.medalId)).toEqual(["medal.L1", "medal.L2"]);
    expect(view.medals.find((row) => row.medalId === "medal.L1")?.awardedAt).toBe("2026-10-13T00:00:00.000Z");
    expect(view.medals.find((row) => row.medalId === "medal.L3")?.earned).toBe(false);
  });

  it("ignores revoked grants in the earned view", () => {
    const grant: MedalGrantRecord = {
      ...newMedalGrant({
        memberId: "member-a",
        level: levels[0]!,
        sourceType: "register",
        sourceId: "register",
        configVersion: 1,
        nowIso: "2026-10-13T00:00:00.000Z"
      }),
      revokedAt: "2026-10-14T00:00:00.000Z",
      reason: "confirmed cheating"
    };
    const view = growthMemberView({ totalScore: 0, levels, configVersion: 1, grants: [grant] });
    expect(view.earnedCount).toBe(0);
  });
});

describe("threshold change preview", () => {
  const members = [
    { memberId: "m1", totalScore: 0, levelId: "L1" },
    { memberId: "m2", totalScore: 150, levelId: "L2" },
    { memberId: "m3", totalScore: 320, levelId: "L3" }
  ];

  it("reports affected members and pending medals without writing anything", () => {
    const stricter: GrowthLevel[] = levels.map((row) => ({ ...row, minScore: row.minScore * 2 }));
    const impact = growthImpactOf({ members, levels: stricter, grantedMedalIdsByMember: { m2: ["medal.L1"] } });
    expect(impact.scannedMembers).toBe(3);
    // 门槛翻倍后：m1（0 分）仍在 L1；m2（150）由 L2 落回 L1；m3（320）由 L3 落回 L2。
    expect(impact.affected).toBe(2);
    expect(impact.downgraded).toBe(2);
    expect(impact.unchanged).toBe(1);
    // 待补发勋章：m1 的 L1 一枚、m3 的 L1 与 L2 两枚（m2 已有 L1），共 3 枚。
    expect(impact.medalsToGrant).toBe(3);
    expect(impact.byTransition.some((row) => row.fromLevelId === "L3" && row.toLevelId === "L2")).toBe(true);
    expect(impact.truncated).toBe(false);
  });

  it("counts upgrades when thresholds become easier", () => {
    const easier: GrowthLevel[] = levels.map((row) => ({ ...row, minScore: Math.floor(row.minScore / 2) }));
    const impact = growthImpactOf({ members, levels: easier });
    // m2（150）由 L2 升到 L3；m1 与 m3 等级不变。
    expect(impact.upgraded).toBe(1);
    expect(impact.downgraded).toBe(0);
    expect(impact.unchanged).toBe(2);
  });

  it("derives reached levels for cross-level backfill", () => {
    expect(levelsReached(350, levels).map((row) => row.levelId)).toEqual(["L1", "L2", "L3"]);
  });
});

describe("admin growth input parsing", () => {
  it("accepts a well formed publish payload", () => {
    const parsed = parseGrowthPublishInput({
      levels: levels.map((row) => ({ ...row })),
      reason: "MW16 测试门槛",
      expectedConfigVersion: 0
    });
    expect(parsed.ok).toBe(true);
  });

  it("rejects missing reason, bad version and unknown fields", () => {
    const noReason = parseGrowthPublishInput({ levels: levels.map((row) => ({ ...row })), reason: "  ", expectedConfigVersion: 0 });
    expect(noReason.ok).toBe(false);
    const badVersion = parseGrowthPublishInput({ levels: levels.map((row) => ({ ...row })), reason: "x", expectedConfigVersion: -1 });
    expect(badVersion.ok).toBe(false);
    const extra = parseGrowthPublishInput({
      levels: levels.map((row) => ({ ...row })),
      reason: "x",
      expectedConfigVersion: 0,
      vip: true
    });
    expect(extra.ok).toBe(false);
  });

  it("parses recompute input with a bounded limit and rejects untrusted fields", () => {
    expect(parseGrowthRecomputeInput({})).toEqual({ ok: true, targetMemberId: "", limit: 200 });
    expect(parseGrowthRecomputeInput({ targetMemberId: "m1", limit: 5 })).toEqual({
      ok: true,
      targetMemberId: "m1",
      limit: 5
    });
    expect(parseGrowthRecomputeInput({ limit: 0 }).ok).toBe(false);
    // memberId 属不可信客户端字段，不能用它指定重算目标。
    expect(parseGrowthRecomputeInput({ memberId: "m1" }).ok).toBe(false);
    expect(parseGrowthRecomputeInput({ uid: "forged" }).ok).toBe(false);
  });
});
