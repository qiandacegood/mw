import { describe, expect, it } from "vitest";
import { isolatedEntitlementReader, isolatedPracticeEntitlement, paperStartDeniedByAccess } from "./entitlement.js";

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
});
