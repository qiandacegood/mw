import { describe, expect, it } from "vitest";
import { callAdminJob, loginAndReadAdmin, type AdminSession } from "./cloudbase-web";

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

describe("admin job helpers", () => {
  it("calls job.get and job.resume through mw-admin", async () => {
    const calls: unknown[] = [];
    const app = {
      auth: () => ({
        signInWithPassword: async () => ({}),
        getLoginState: async () => ({ user: { uid: "uid_super" } }),
        signOut: async () => ({})
      }),
      callFunction: async (input: { name: string; data: unknown }) => {
        calls.push(input);
        return { result: { ok: true, data: { job: { state: "queued" }, replayed: false, pending: false } } };
      }
    };
    const got = await callAdminJob(app, "job.get", { jobId: "mw06/test/job_1" });
    const resumed = await callAdminJob(app, "job.resume", { jobId: "mw06/test/job_1", reason: "continue" }, "mw06/test/admin_resume");
    expect(got.ok).toBe(true);
    expect(resumed.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ name: "mw-admin", data: { action: "job.get" } });
    expect(calls[1]).toMatchObject({
      name: "mw-admin",
      data: { action: "job.resume", idempotencyKey: "mw06/test/admin_resume" }
    });
  });
});
