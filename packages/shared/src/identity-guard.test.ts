import { describe, expect, it } from "vitest";
import { adminAuthorized, forgedClientFields, identityFromTrustedContext } from "./identity-guard.js";

describe("identity-guard", () => {
  it("treats client identity fields as forged", () => {
    expect(forgedClientFields({ userId: "mem_fict_x", role: "super", paperId: "p1" })).toEqual([
      "userId",
      "role"
    ]);
  });

  it("rejects tourist and missing mini context", () => {
    expect(identityFromTrustedContext({ appId: "touristappid", openIdPresent: true, touristAppId: true })).toEqual({
      trusted: false,
      reason: "TOURIST_APPID"
    });
    expect(identityFromTrustedContext({ openIdPresent: false })).toEqual({
      trusted: false,
      reason: "NO_TRUSTED_MINI_CONTEXT"
    });
  });

  it("requires both auth uid and admin whitelist", () => {
    expect(adminAuthorized({ authUidPresent: true, whitelistHit: false, enabled: true }).allowed).toBe(false);
    expect(adminAuthorized({ authUidPresent: false, whitelistHit: true, enabled: true }).allowed).toBe(false);
    expect(adminAuthorized({ authUidPresent: true, whitelistHit: true, enabled: false }).reason).toBe(
      "ADMIN_DISABLED"
    );
    expect(adminAuthorized({ authUidPresent: true, whitelistHit: true, enabled: true })).toEqual({
      allowed: true,
      reason: "AUTH_UID_AND_WHITELIST"
    });
  });
});
