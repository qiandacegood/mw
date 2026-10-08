import { describe, expect, it } from "vitest";
import { handleOfficial, memoryAdminStore } from "./official.js";

const allowedAppIds = ["wxmwallowedappid0001"];
const now = new Date("2026-10-08T09:00:00.000Z");

function publicReq(action: string, extra: Record<string, unknown> = {}) {
  return {
    apiVersion: "1",
    action,
    requestId: "req_public",
    data: extra
  };
}

describe("official identity and entry boundaries", () => {
  it("rejects nested forged identity fields", async () => {
    const res = await handleOfficial({
      entry: "mw-public",
      event: publicReq("home.get", { userId: "mem_forged", role: "super" }),
      allowedAppIds,
      now
    });
    expect(res).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", details: { reason: "CLIENT_IDENTITY_IGNORED" } }
    });
  });

  it("public allows only the read whitelist", async () => {
    const ping = await handleOfficial({
      entry: "mw-public",
      event: publicReq("public.ping"),
      allowedAppIds,
      now
    });
    expect(ping).toMatchObject({ ok: true, data: { entry: "mw-public" } });

    const denied = await handleOfficial({
      entry: "mw-public",
      event: publicReq("admin.me"),
      allowedAppIds,
      now
    });
    expect(denied).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", details: { reason: "ACTION_DENIED" } }
    });

    const tree = await handleOfficial({
      entry: "mw-public",
      event: publicReq("category.tree"),
      allowedAppIds,
      now
    });
    expect(tree).toMatchObject({
      ok: true,
      data: { nodes: [], writeConcurrency: "expectedTreeVersion" }
    });
  });

  it("member requires FROM_APPID/FROM_OPENID and ignores resource APPID/OPENID", async () => {
    const resourceOnly = await handleOfficial({
      entry: "mw-member",
      event: publicReq("member.session"),
      allowedAppIds,
      resourceAppId: "wxresourceownerappid",
      resourceOpenId: "resource_openid",
      now
    });
    expect(resourceOnly).toMatchObject({
      ok: false,
      error: { code: "AUTH_REQUIRED", details: { reason: "RESOURCE_IDENTITY_IGNORED" } }
    });

    const wrongSource = await handleOfficial({
      entry: "mw-member",
      event: publicReq("member.session"),
      allowedAppIds,
      fromAppId: "wxotherappid00000001",
      fromOpenId: "from_openid",
      now
    });
    expect(wrongSource).toMatchObject({
      ok: false,
      error: { code: "AUTH_REQUIRED", details: { reason: "APPID_NOT_ALLOWED" } }
    });

    const trusted = await handleOfficial({
      entry: "mw-member",
      event: publicReq("member.session"),
      allowedAppIds,
      fromAppId: allowedAppIds[0],
      fromOpenId: "from_openid",
      resourceAppId: "wxresourceownerappid",
      resourceOpenId: "resource_openid",
      now
    });
    expect(trusted).toMatchObject({ ok: true, data: { trusted: true, registered: false } });
  });

  it("ordinary CloudBase user cannot use admin entry", async () => {
    const store = memoryAdminStore([
      { uid: "uid_super_1", roles: ["super"], enabled: true, authVersion: 1 }
    ]);
    const res = await handleOfficial({
      entry: "mw-admin",
      event: publicReq("admin.me"),
      allowedAppIds,
      authUid: "uid_plain_user",
      adminStore: store,
      now
    });
    expect(res).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", details: { reason: "NOT_IN_ADMIN_WHITELIST" } }
    });
  });

  it("disabled admin is refused even with a matching uid", async () => {
    const store = memoryAdminStore([
      { uid: "uid_disabled", roles: ["super"], enabled: false, authVersion: 1 }
    ]);
    const res = await handleOfficial({
      entry: "mw-admin",
      event: publicReq("admin.me"),
      allowedAppIds,
      authUid: "uid_disabled",
      adminStore: store,
      now
    });
    expect(res).toMatchObject({
      ok: false,
      error: { code: "ACCOUNT_DISABLED", details: { reason: "ADMIN_DISABLED" } }
    });
  });

  it("accepts Web SDK platform wrappers and still rejects forged business fields", async () => {
    const store = memoryAdminStore([
      { uid: "uid_super_1", roles: ["super"], enabled: true, authVersion: 1 }
    ]);
    const wrapped = await handleOfficial({
      entry: "mw-admin",
      event: {
        userInfo: { openId: "platform_openid", uid: "platform_uid" },
        tcbContext: { session_id: "s1" },
        apiVersion: "1",
        action: "admin.me",
        requestId: "req_web_admin",
        data: {}
      },
      allowedAppIds,
      authUid: "uid_super_1",
      adminStore: store,
      now
    });
    expect(wrapped).toMatchObject({ ok: true, data: { roles: ["super"] } });

    const nested = await handleOfficial({
      entry: "mw-admin",
      event: {
        data: {
          apiVersion: "1",
          action: "admin.me",
          requestId: "req_nested_admin",
          data: {}
        },
        userInfo: { uid: "platform_uid" }
      },
      allowedAppIds,
      authUid: "uid_super_1",
      adminStore: store,
      now
    });
    expect(nested).toMatchObject({ ok: true, data: { roles: ["super"] } });

    const forged = await handleOfficial({
      entry: "mw-admin",
      event: {
        userInfo: { uid: "platform_uid" },
        apiVersion: "1",
        action: "admin.me",
        requestId: "req_forged_admin",
        data: { role: "super" }
      },
      allowedAppIds,
      authUid: "uid_super_1",
      adminStore: store,
      now
    });
    expect(forged).toMatchObject({
      ok: false,
      error: { details: { reason: "CLIENT_IDENTITY_IGNORED" } }
    });
  });

  it("enabled super admin can read admin.me and cannot register publicly", async () => {
    const store = memoryAdminStore([
      { uid: "uid_super_1", roles: ["super"], enabled: true, authVersion: 1 }
    ]);
    const me = await handleOfficial({
      entry: "mw-admin",
      event: publicReq("admin.me"),
      allowedAppIds,
      authUid: "uid_super_1",
      adminStore: store,
      now
    });
    expect(me).toMatchObject({
      ok: true,
      data: { roles: ["super"], canSuper: true, enabled: true }
    });

    const register = await handleOfficial({
      entry: "mw-admin",
      event: publicReq("admin.register"),
      allowedAppIds,
      authUid: "uid_super_1",
      adminStore: store,
      now
    });
    expect(register).toMatchObject({
      ok: false,
      error: { details: { reason: "PUBLIC_ADMIN_REGISTER_DENIED" } }
    });
  });

  it("upload, pay-hook and jobs stay default-deny", async () => {
    const upload = await handleOfficial({
      entry: "mw-upload",
      event: { requestId: "req_up", data: {} },
      allowedAppIds,
      now
    });
    expect(upload).toMatchObject({
      ok: false,
      error: { details: { reason: "TICKET_REQUIRED" } }
    });

    const pay = await handleOfficial({
      entry: "mw-pay-hook",
      event: { body: "unsigned" },
      allowedAppIds,
      now
    });
    expect(pay).toMatchObject({ ok: false, reason: "SIGNATURE_REQUIRED" });

    const jobs = await handleOfficial({
      entry: "mw-jobs",
      event: { fromClient: true, Type: "Timer" },
      allowedAppIds,
      now
    });
    expect(jobs).toMatchObject({ ok: false, reason: "CLIENT_INVOKE_DENIED" });
  });

  it("cloudbase_auth allows only the MW shared AppID", () => {
    return handleOfficial({
      entry: "cloudbase_auth",
      event: {},
      allowedAppIds,
      fromAppId: allowedAppIds[0],
      fromOpenId: "from_openid"
    }).then((res) => {
      expect(res).toMatchObject({ errCode: 0, errMsg: "" });
      const auth = JSON.parse((res as { auth: string }).auth);
      expect(auth.allow).toEqual(["mw-public", "mw-member"]);
    });
  });
});
