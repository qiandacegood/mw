import { describe, expect, it } from "vitest";
import { overlayPublicRankingRow, rankingPublicEligible, type RankingRowRecord } from "./ranking.js";
import {
  disableBlocksWrites,
  parseMemberDisableInput,
  parseMemberGetInput,
  parseMemberListInput,
  parseRankingBanInput,
  rankingBanChangesAccountStatus
} from "./profile-ops.js";

function row(nickname: string): RankingRowRecord {
  return {
    rowId: "r1",
    boardId: "b1",
    generation: "g1",
    scope: "total",
    periodKey: "all",
    categoryId: "",
    memberId: "secret-member",
    nickname,
    avatarKey: "avatar.builtin.01",
    levelId: "L1",
    value: 10,
    rank: 1,
    sortOrdinal: 0,
    reachedAt: "2026-10-18T00:00:00.000Z",
    prevValueDiff: null,
    schemaVersion: 1
  };
}

describe("disable vs ban", () => {
  it("records disable and ban separately; ban does not change account status", () => {
    expect(parseMemberDisableInput({ targetMemberId: "m1", disabled: true, reason: "违规停用测试" }).ok).toBe(true);
    expect(parseMemberDisableInput({ targetMemberId: "m1", disabled: false, reason: "恢复写权限" }).ok).toBe(true);
    expect(parseMemberDisableInput({ targetMemberId: "m1", disabled: true }).ok).toBe(false);
    expect(parseRankingBanInput({ targetMemberId: "m1", banned: true, reason: "刷榜禁榜测试" }).ok).toBe(true);
    expect(parseRankingBanInput({ targetMemberId: "m1", banned: false, reason: "解除禁榜" }).ok).toBe(true);
    expect(rankingBanChangesAccountStatus()).toBe(false);
    expect(disableBlocksWrites("disabled")).toBe(true);
    expect(disableBlocksWrites("active")).toBe(false);
    expect(disableBlocksWrites("deleted")).toBe(true);
  });
});

describe("public ranking eligibility and nickname overlay", () => {
  it("hides opted-out, disabled, banned members and overlays live nickname without secrets", () => {
    expect(rankingPublicEligible({ status: "active", rankingOptIn: true, rankingBanned: false })).toBe(true);
    expect(rankingPublicEligible({ status: "active", rankingOptIn: false })).toBe(false);
    expect(rankingPublicEligible({ status: "disabled", rankingOptIn: true })).toBe(false);
    expect(rankingPublicEligible({ status: "deleted", rankingOptIn: true })).toBe(false);
    expect(rankingPublicEligible({ status: "deleting", rankingOptIn: true })).toBe(false);
    expect(rankingPublicEligible({ status: "active", rankingOptIn: true, rankingBanned: true })).toBe(false);
    const publicRow = overlayPublicRankingRow(row("旧昵称"), { nickname: "新昵称甲", avatarKey: "avatar.builtin.02" });
    expect(publicRow.nickname).toBe("新昵称甲");
    expect(Object.keys(publicRow)).not.toContain("memberId");
    expect(JSON.stringify(publicRow)).not.toMatch(/secret-member|openid|OPENID/i);
  });
});

describe("member list/get input", () => {
  it("rejects unknown fields and requires memberId for get", () => {
    expect(parseMemberListInput({ status: "active", limit: 20 }).ok).toBe(true);
    expect(parseMemberGetInput({ targetMemberId: "m1" }).ok).toBe(true);
    expect(parseMemberGetInput({ targetMemberId: "m1", openid: "x" }).ok).toBe(false);
    expect(parseMemberGetInput({ memberId: "m1" }).ok).toBe(false);
  });
});
