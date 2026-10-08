import { describe, expect, it } from "vitest";
import {
  adminAuthorized,
  adminHasRole,
  cloudbaseAuthDecision,
  forgedClientFields,
  identityFromTrustedContext,
  sharedMiniIdentity
} from "./identity-guard.js";

describe("identity-guard", () => {
  it("treats client identity fields as forged", () => {
    expect(forgedClientFields({ userId: "mem_fict_x", role: "super", paperId: "p1" })).toEqual([
      "userId",
      "role"
    ]);
    expect(
      forgedClientFields({
        apiVersion: "1",
        data: { openid: "forged", FROM_APPID: "wx_forged" }
      })
    ).toEqual(["openid", "FROM_APPID"]);
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

  it("uses FROM_APPID/FROM_OPENID and ignores resource APPID/OPENID", () => {
    expect(
      sharedMiniIdentity({
        resourceAppId: "wxresourceownerappid",
        resourceOpenId: "resource_openid",
        allowedAppIds: ["wxmwallowedappid0001"]
      }).reason
    ).toBe("RESOURCE_IDENTITY_IGNORED");
    expect(
      sharedMiniIdentity({
        fromAppId: "wxotherappid00000001",
        fromOpenId: "from_openid",
        allowedAppIds: ["wxmwallowedappid0001"]
      }).reason
    ).toBe("APPID_NOT_ALLOWED");
    expect(
      sharedMiniIdentity({
        fromAppId: "wxmwallowedappid0001",
        fromOpenId: "from_openid",
        resourceAppId: "wxresourceownerappid",
        allowedAppIds: ["wxmwallowedappid0001"]
      })
    ).toEqual({ trusted: true, reason: "TRUSTED_SHARED_MINI" });
    expect(
      cloudbaseAuthDecision({
        fromAppId: "wxmwallowedappid0001",
        fromOpenId: "from_openid",
        allowedAppIds: ["wxmwallowedappid0001"]
      }).allowedFunctions
    ).toEqual(["mw-public", "mw-member"]);
    expect(adminHasRole(["content"], "operations")).toBe(false);
    expect(adminHasRole(["super"], "operations")).toBe(true);
  });
});
