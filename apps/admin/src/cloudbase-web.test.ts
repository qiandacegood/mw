import { describe, expect, it } from "vitest";
import { loginAndReadAdmin, type AdminSession } from "./cloudbase-web";

function fakeApp(options: {
  uid?: string;
  result: unknown;
}): Parameters<typeof loginAndReadAdmin>[0] {
  return {
    auth: () => ({
      signInWithPassword: async () => ({}),
      getLoginState: async () => (options.uid ? { user: { uid: options.uid } } : null),
      signOut: async () => ({})
    }),
    callFunction: async () => ({ result: options.result })
  };
}

describe("admin web login adapter", () => {
  it("does not grant admin when CloudBase user is not in admin_users", async () => {
    const session: AdminSession = await loginAndReadAdmin(
      fakeApp({
        uid: "uid_plain",
        result: { ok: false, error: { code: "FORBIDDEN", message: "权限不足" } }
      }),
      "plain",
      "secret"
    );
    expect(session.loggedIn).toBe(false);
    expect(session.uidPresent).toBe(true);
    expect(session.roles).toEqual([]);
  });

  it("returns roles after a successful admin.me", async () => {
    const session = await loginAndReadAdmin(
      fakeApp({
        uid: "uid_super",
        result: { ok: true, data: { roles: ["super"], enabled: true } }
      }),
      "super",
      "secret"
    );
    expect(session.loggedIn).toBe(true);
    expect(session.roles).toEqual(["super"]);
  });
});
