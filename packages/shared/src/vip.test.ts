import { describe, expect, it } from "vitest";
import { ledgerPracticeEntitlement, paperStartDeniedByAccess } from "./entitlement.js";
import {
  VIP_SOURCE_GIFT,
  applyVipGrant,
  durationSecondsFromDays,
  evaluateVipStatus,
  isVipActive,
  nextExpiresAt,
  parseVipGrantInput,
  parseVipRevokeInput,
  projectVipLedger,
  revokeVipGift,
  vipGrantId
} from "./vip.js";

const firstGrantAt = new Date("2026-10-03T02:00:00.000Z");
const thirtyDays = durationSecondsFromDays(30);

function grant(input: {
  memberId?: string;
  sourceId: string;
  grantedAt: Date;
  durationSeconds?: number;
  account?: Parameters<typeof applyVipGrant>[0]["account"];
  grants?: Parameters<typeof applyVipGrant>[0]["grants"];
}) {
  return applyVipGrant({
    account: input.account,
    grants: input.grants || [],
    memberId: input.memberId || "m1",
    sourceType: VIP_SOURCE_GIFT,
    sourceId: input.sourceId,
    durationSeconds: input.durationSeconds ?? thirtyDays,
    grantedAt: input.grantedAt,
    reason: "mw20 fictional gift",
    actorId: "uid_super"
  });
}

describe("vip duration", () => {
  it("first 30-day grant and renewal match the baseline example", () => {
    const granted = Date.parse("2026-10-03T02:00:00.000Z");
    expect(thirtyDays).toBe(2592000);
    const first = nextExpiresAt({ grantedAtMs: granted, durationSeconds: thirtyDays, currentExpiresAtMs: null });
    expect(new Date(first).toISOString()).toBe("2026-11-02T02:00:00.000Z");
    const renewed = nextExpiresAt({
      grantedAtMs: Date.parse("2026-10-20T02:00:00.000Z"),
      durationSeconds: thirtyDays,
      currentExpiresAtMs: first
    });
    expect(new Date(renewed).toISOString()).toBe("2026-12-02T02:00:00.000Z");
    expect(isVipActive(first, Date.parse("2026-11-02T02:00:00.000Z"))).toBe(false);
    expect(isVipActive(first, Date.parse("2026-11-02T01:59:59.000Z"))).toBe(true);
  });
});

describe("vip ledger grant / renew / expire", () => {
  it("opens from grantedAt when never opened, then appends while still active", () => {
    const first = grant({ sourceId: "gift-a", grantedAt: firstGrantAt });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.account.expiresAt).toBe("2026-11-02T02:00:00.000Z");
    expect(first.grant.grantId).toBe(vipGrantId(VIP_SOURCE_GIFT, "gift-a"));
    expect(first.events.some((row) => row.type === "grant")).toBe(true);
    const added = grant({
      sourceId: "gift-b",
      grantedAt: new Date("2026-10-20T02:00:00.000Z"),
      account: first.account,
      grants: first.grants
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.account.expiresAt).toBe("2026-12-02T02:00:00.000Z");
    expect(added.grants).toHaveLength(2);
  });

  it("renews from the new grantedAt after expiry instead of stacking on the old wall clock", () => {
    const first = grant({ sourceId: "gift-a", grantedAt: firstGrantAt });
    if (!first.ok) return;
    const afterExpiry = grant({
      sourceId: "gift-late",
      grantedAt: new Date("2026-11-02T03:00:00.000Z"),
      account: first.account,
      grants: first.grants
    });
    expect(afterExpiry.ok).toBe(true);
    if (!afterExpiry.ok) return;
    expect(afterExpiry.account.expiresAt).toBe("2026-12-02T03:00:00.000Z");
  });

  it("treats the exact expiry second as inactive and keeps history readable", () => {
    const first = grant({ sourceId: "gift-a", grantedAt: firstGrantAt });
    if (!first.ok) return;
    const atExpiry = new Date("2026-11-02T02:00:00.000Z");
    const before = new Date("2026-11-02T01:59:59.000Z");
    expect(evaluateVipStatus({ account: first.account, grants: first.grants, now: before }).active).toBe(true);
    expect(evaluateVipStatus({ account: first.account, grants: first.grants, now: atExpiry }).active).toBe(false);
    const entitlement = ledgerPracticeEntitlement(evaluateVipStatus({ account: first.account, grants: first.grants, now: atExpiry }));
    expect(paperStartDeniedByAccess("vip", entitlement).blocked).toBe(true);
  });

  it("serializes two sources onto one account without overwrite", () => {
    const a = grant({ sourceId: "gift-1", grantedAt: firstGrantAt, durationSeconds: 86400 });
    if (!a.ok) return;
    const b = grant({
      sourceId: "gift-2",
      grantedAt: new Date(firstGrantAt.getTime() + 1000),
      durationSeconds: 86400,
      account: a.account,
      grants: a.grants
    });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.account.expiresAt).toBe("2026-10-05T02:00:00.000Z");
    expect(b.grants.map((row) => row.sourceId)).toEqual(["gift-1", "gift-2"]);
  });

  it("replays the same source instead of stacking it twice", () => {
    const first = grant({ sourceId: "gift-a", grantedAt: firstGrantAt });
    if (!first.ok) return;
    const replay = grant({
      sourceId: "gift-a",
      grantedAt: new Date("2026-10-04T02:00:00.000Z"),
      account: first.account,
      grants: first.grants
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.replayed).toBe(true);
    expect(replay.account.expiresAt).toBe(first.account.expiresAt);
  });
});

describe("vip ledger consume and revoke", () => {
  it("consumes in source order without negatives and projects on read without rewriting expiry", () => {
    const first = grant({ sourceId: "early", grantedAt: firstGrantAt, durationSeconds: 10 });
    if (!first.ok) return;
    const stacked = grant({
      sourceId: "late",
      grantedAt: new Date(firstGrantAt.getTime() + 1000),
      durationSeconds: 10,
      account: first.account,
      grants: first.grants
    });
    if (!stacked.ok) return;
    const later = new Date(firstGrantAt.getTime() + 12_000);
    const projected = projectVipLedger({ account: stacked.account, grants: stacked.grants, now: later });
    expect(projected.consumedSeconds).toBe(11);
    expect(projected.grants[0]?.remainingSeconds).toBe(0);
    expect(projected.grants[1]?.remainingSeconds).toBe(8);
    expect(projected.grants.every((row) => row.remainingSeconds >= 0)).toBe(true);
    expect(projected.account.expiresAt).toBe(stacked.account.expiresAt);
  });

  it("revokes only unused gift seconds and cannot pretend to be a paid source", () => {
    const first = grant({ sourceId: "gift-a", grantedAt: firstGrantAt, durationSeconds: 20 });
    if (!first.ok) return;
    const mid = new Date(firstGrantAt.getTime() + 5_000);
    const revoked = revokeVipGift({
      account: first.account,
      grants: first.grants,
      sourceId: "gift-a",
      now: mid,
      reason: "mw20 revoke unused"
    });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.revokedSeconds).toBe(15);
    expect(revoked.grant.remainingSeconds).toBe(0);
    expect(evaluateVipStatus({ account: revoked.account, grants: revoked.grants, now: mid }).active).toBe(false);
    const paid = applyVipGrant({
      account: first.account,
      grants: first.grants,
      memberId: "m1",
      sourceType: "order",
      sourceId: "ord-1",
      durationSeconds: 20,
      grantedAt: firstGrantAt,
      reason: "should fail",
      actorId: "uid_super"
    });
    expect(paid).toMatchObject({ ok: false, reason: "GIFT_SOURCE_REQUIRED" });
  });
});

describe("vip grant input", () => {
  it("requires a reason and rejects payment-shaped fields", () => {
    expect(parseVipGrantInput({ targetMemberId: "m1", durationDays: 1 }).ok).toBe(false);
    expect(
      parseVipGrantInput({ targetMemberId: "m1", durationDays: 1, reason: "ok", orderId: "o1" }).ok
    ).toBe(false);
    expect(parseVipGrantInput({ targetMemberId: "m1", durationDays: 1, reason: "ok" })).toMatchObject({
      ok: true,
      durationSeconds: 86400
    });
    expect(parseVipRevokeInput({ targetMemberId: "m1", sourceId: "gift-a" }).ok).toBe(false);
  });
});
