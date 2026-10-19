import { describe, expect, it } from "vitest";
import { AUDIT_FORBIDDEN_KEYS, sanitizeAuditValue } from "./audit.js";
import { weekKeyShanghai, monthKeyShanghai } from "./clock.js";
import {
  MW26_FIXTURE_ROUND,
  MW26_TARGET_MEMBERS,
  mw26AttemptId,
  mw26CleanupMetricIds,
  mw26FixturePayload,
  mw26LeftoverDecision,
  mw26LoggedInRoleRow,
  mw26MemberId,
  mw26MonthMetricId,
  mw26PaperId,
  mw26PeriodStateFromSeededAt,
  mw26RequirePeriodState,
  mw26ScaleBlockedReason,
  mw26UnauthStorageVerdict,
  mw26WeekMetricId,
  percentileNearestRank
} from "./mw26-capacity.js";
import { toPublicRankingRow, type RankingRowRecord } from "./ranking.js";

describe("MW26 fixture ids and leftover gate", () => {
  it("generates deterministic sha256 ids and rejects _id in write payload", () => {
    expect(mw26MemberId(0)).toMatch(/^[a-f0-9]{64}$/);
    expect(mw26MemberId(0)).toBe(mw26MemberId(0, MW26_FIXTURE_ROUND));
    expect(mw26MemberId(1)).not.toBe(mw26MemberId(0));
    expect(mw26PaperId(0)).toMatch(/^[a-f0-9]{64}$/);
    expect(mw26AttemptId(0, 0)).toMatch(/^[a-f0-9]{64}$/);
    expect(() => mw26FixturePayload({ _id: "nope" })).toThrow(/MW26_ID_IN_PAYLOAD/);
    const payload = mw26FixturePayload({ nickname: "夹具甲" });
    expect(payload.fixtureRound).toBe("MW26");
    expect(payload).not.toHaveProperty("_id");
  });

  it("refuses leftover=0 when wroteDocs is false or independent remain", () => {
    expect(mw26LeftoverDecision({ wroteDocs: false, resolved: true, fixtureRemain: 0, seedPresent: true }).reason).toBe(
      "WROTE_DOCS_FALSE"
    );
    expect(mw26LeftoverDecision({ wroteDocs: true, resolved: false, fixtureRemain: 0, seedPresent: true }).reason).toBe(
      "KNOWN_IDS_NOT_RESOLVED"
    );
    expect(mw26LeftoverDecision({ wroteDocs: true, resolved: true, fixtureRemain: 2, seedPresent: true }).reason).toBe(
      "INDEPENDENT_REMAIN"
    );
    expect(
      mw26LeftoverDecision({ wroteDocs: true, resolved: true, fixtureRemain: 0, knownIdRemain: 1, seedPresent: true }).reason
    ).toBe("KNOWN_IDS_REMAIN");
    expect(mw26LeftoverDecision({ wroteDocs: true, resolved: true, fixtureRemain: 0, seedPresent: false }).reason).toBe(
      "SEED_CATEGORIES_MISSING"
    );
    expect(mw26LeftoverDecision({ wroteDocs: true, resolved: true, fixtureRemain: 0, seedPresent: true }).ok).toBe(true);
  });

  it("keeps week/month metric ids on seeded period keys even if cleanup runs next week", () => {
    const seededAt = new Date("2026-10-19T03:00:00.000Z");
    const nextWeek = new Date("2026-10-26T03:00:00.000Z");
    const nextMonth = new Date("2026-11-02T03:00:00.000Z");
    const state = mw26PeriodStateFromSeededAt(seededAt);
    expect(state.weekKeyShanghai).toBe(weekKeyShanghai(seededAt));
    expect(state.monthKeyShanghai).toBe(monthKeyShanghai(seededAt));
    expect(state.weekKeyShanghai).not.toBe(weekKeyShanghai(nextWeek));
    expect(state.monthKeyShanghai).not.toBe(monthKeyShanghai(nextMonth));
    const cleanupIds = mw26CleanupMetricIds(0, state);
    expect(cleanupIds.week).toBe(mw26WeekMetricId(0, seededAt));
    expect(cleanupIds.month).toBe(mw26MonthMetricId(0, seededAt));
    expect(cleanupIds.week).not.toBe(mw26WeekMetricId(0, nextWeek));
    expect(cleanupIds.month).not.toBe(mw26MonthMetricId(0, nextMonth));
    expect(() => mw26RequirePeriodState({})).toThrow(/MW26_PERIOD_KEYS_MISSING/);
    expect(() => mw26CleanupMetricIds(0, { seededAt: nextWeek.toISOString(), weekKeyShanghai: "", monthKeyShanghai: "" })).toThrow(
      /MW26_PERIOD_KEYS_MISSING/
    );
  });

  it("does not mark S03 PASS without a storage URL or when the request fails", () => {
    expect(mw26UnauthStorageVerdict({ urlCount: 0, saw200: false, deniedCount: 0, requestFailed: false }).result).toBe("NOT_RUN");
    expect(mw26UnauthStorageVerdict({ urlCount: 1, saw200: false, deniedCount: 0, requestFailed: true }).result).toBe("BLOCKED");
    expect(mw26UnauthStorageVerdict({ urlCount: 1, saw200: true, deniedCount: 0, requestFailed: false }).result).toBe("FAIL");
    expect(mw26UnauthStorageVerdict({ urlCount: 1, saw200: false, deniedCount: 1, requestFailed: false }).result).toBe("PASS");
  });

  it("keeps S06/S07 logged-in checks NOT_RUN and does not promote unauth deny to product PASS", () => {
    expect(mw26LoggedInRoleRow("S06", true, "unauth order.list=AUTH_REQUIRED").result).toBe("NOT_RUN");
    expect(mw26LoggedInRoleRow("S07", true, "unauth refund/correction").result).toBe("NOT_RUN");
    expect(mw26LoggedInRoleRow("S06", false, "unauth order.list=OK").result).toBe("FAIL");
  });

  it("reports degraded scale instead of pretending the 1万/1000/10万 target was met", () => {
    expect(mw26ScaleBlockedReason({ members: 200, papers: 20, attempts: 2000 })).toMatch(/SCALE_DEGRADED/);
    expect(
      mw26ScaleBlockedReason({
        members: MW26_TARGET_MEMBERS,
        papers: 1000,
        attempts: 100000
      })
    ).toBeNull();
  });
});

describe("MW26 measurement helpers", () => {
  it("uses nearest-rank percentiles", () => {
    expect(percentileNearestRank([10, 20, 30, 40, 50], 95)).toBe(50);
    expect(percentileNearestRank([5, 1, 3], 50)).toBe(3);
    expect(percentileNearestRank([], 95)).toBe(0);
  });
});

describe("MW26 public ranking and audit redaction", () => {
  it("public ranking rows do not expose memberId or OPENID", () => {
    const row: RankingRowRecord = {
      rowId: "r1",
      boardId: "b1",
      generation: "g1",
      scope: "total",
      periodKey: "all",
      categoryId: "",
      memberId: "secret-member",
      nickname: "夹具甲",
      avatarKey: "avatar.builtin.01",
      levelId: "L1",
      value: 80,
      rank: 1,
      sortOrdinal: 1,
      reachedAt: "2026-10-19T02:00:00.000Z",
      prevValueDiff: null,
      schemaVersion: 1
    };
    const pub = toPublicRankingRow(row);
    expect(JSON.stringify(pub)).not.toMatch(/secret-member|openid|OPENID|AppKey/i);
    expect(pub).not.toHaveProperty("memberId");
  });

  it("audit sanitizer redacts OPENID, answers and AppKey", () => {
    expect(AUDIT_FORBIDDEN_KEYS).toEqual(expect.arrayContaining(["openid", "OPENID", "AppKey", "answer"]));
    const sanitized = sanitizeAuditValue({
      openId: "wx_secret",
      answer: ["A", "B", "C"],
      AppKey: "live-key",
      score: 80
    }) as Record<string, unknown>;
    expect(sanitized.openId).toBe("[redacted]");
    expect(sanitized.answer).toBe("[redacted]");
    expect(sanitized.AppKey).toBe("[redacted]");
    expect(sanitized.score).toBe(80);
  });
});
