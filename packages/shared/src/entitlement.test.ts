import { describe, expect, it } from "vitest";
import {
  isolatedEntitlementReader,
  isolatedPracticeEntitlement,
  ledgerPracticeEntitlement,
  paperStartDeniedByAccess
} from "./entitlement.js";

describe("isolated practice entitlement stub", () => {
  it("defaults to no VIP and does not invent a ledger", () => {
    expect(isolatedPracticeEntitlement()).toEqual({ vipActive: false, source: "isolated-stub" });
    expect(isolatedPracticeEntitlement({ memberId: "m1", vipMemberIds: [] }).vipActive).toBe(false);
    expect(paperStartDeniedByAccess("free", isolatedPracticeEntitlement()).blocked).toBe(false);
    expect(paperStartDeniedByAccess("vip", isolatedPracticeEntitlement())).toMatchObject({
      blocked: true,
      code: "VIP_REQUIRED"
    });
  });

  it("lets isolation tests inject a member as VIP without vip_* collections", async () => {
    const reader = isolatedEntitlementReader(["member_vip_stub"]);
    const allowed = await reader.evaluate("member_vip_stub", new Date());
    const denied = await reader.evaluate("member_free", new Date());
    expect(allowed).toEqual({ vipActive: true, source: "isolated-stub" });
    expect(denied.vipActive).toBe(false);
    expect(paperStartDeniedByAccess("vip", allowed).blocked).toBe(false);
    expect(paperStartDeniedByAccess("vip", denied).blocked).toBe(true);
  });

  it("maps a ledger status onto the same VIP_REQUIRED gate", () => {
    const inactive = ledgerPracticeEntitlement({
      active: false,
      expiresAt: null,
      remainingSeconds: 0,
      reconcileState: "idle",
      source: "ledger"
    });
    const active = ledgerPracticeEntitlement({
      active: true,
      expiresAt: "2026-11-02T02:00:00.000Z",
      remainingSeconds: 10,
      reconcileState: "idle",
      source: "ledger"
    });
    expect(inactive.source).toBe("ledger");
    expect(paperStartDeniedByAccess("vip", inactive).blocked).toBe(true);
    expect(paperStartDeniedByAccess("vip", active).blocked).toBe(false);
  });
});
