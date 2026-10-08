import { describe, expect, it } from "vitest";
import {
  BUILTIN_AVATAR_KEYS,
  DEFAULT_POLICY_VERSIONS,
  NICKNAME_CONTENT_SAFETY,
  setMaintenanceGate
} from "@mw/shared";
import { handleOfficial } from "./official.js";
import { memoryMaintenanceStore } from "./modules/job-stores.js";
import { memoryMemberBundle, memoryPolicyStore } from "./modules/member-stores.js";

const allowedAppIds = ["wxmwallowedappid0001"];
const now = new Date("2026-10-08T09:00:00.000Z");
const fromA = { fromAppId: allowedAppIds[0], fromOpenId: "mw08_openid_a" };
const fromB = { fromAppId: allowedAppIds[0], fromOpenId: "mw08_openid_b" };

function req(
  action: string,
  data: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
) {
  return {
    apiVersion: "1",
    action,
    requestId: `req_${action.replace(".", "_")}`,
    data,
    ...extra
  };
}

function ctx(
  entry: "mw-member" | "mw-public",
  event: unknown,
  identity: { fromAppId?: string; fromOpenId?: string } = {},
  stores?: ReturnType<typeof memoryMemberBundle>
) {
  const memberStore = stores ?? memoryMemberBundle();
  return {
    entry,
    event,
    allowedAppIds,
    now,
    policyStore: memoryPolicyStore(),
    memberStore,
    maintenanceStore: memoryMaintenanceStore(),
    ...identity
  };
}

function registerData(extra: Record<string, unknown> = {}) {
  return {
    agreementVersion: DEFAULT_POLICY_VERSIONS.agreementVersion,
    privacyVersion: DEFAULT_POLICY_VERSIONS.privacyVersion,
    accepted: true,
    ...extra
  };
}

describe("MW08 member register, me and profile", () => {
  it("rejects unauthenticated and missing FROM context", async () => {
    const missing = await handleOfficial(
      ctx("mw-member", req("member.register", registerData(), { idempotencyKey: "k1" }))
    );
    expect(missing).toMatchObject({
      ok: false,
      error: { code: "AUTH_REQUIRED", details: { reason: "NO_FROM_APPID" } }
    });

    const noOpenId = await handleOfficial(
      ctx("mw-member", req("member.me"), { fromAppId: allowedAppIds[0] })
    );
    expect(noOpenId).toMatchObject({
      ok: false,
      error: { code: "AUTH_REQUIRED", details: { reason: "NO_FROM_OPENID" } }
    });
  });

  it("ignores client forged openid, memberId, role and fake source context", async () => {
    const forged = await handleOfficial(
      ctx(
        "mw-member",
        req("member.register", { ...registerData(), openid: "forged", memberId: "x", role: "super" }, {
          idempotencyKey: "k-forged"
        }),
        fromA
      )
    );
    expect(forged).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", details: { reason: "CLIENT_IDENTITY_IGNORED" } }
    });

    const fakeSource = await handleOfficial(
      ctx(
        "mw-member",
        {
          ...req("member.session"),
          Type: "Timer",
          source: "shared-mini",
          context: { trusted: true }
        }
      )
    );
    expect(fakeSource).toMatchObject({
      ok: false,
      error: { code: "AUTH_REQUIRED" }
    });
  });

  it("rejects missing consent or stale policy versions", async () => {
    const unsigned = await handleOfficial(
      ctx(
        "mw-member",
        req("member.register", { ...registerData(), accepted: false }, { idempotencyKey: "k-un" }),
        fromA
      )
    );
    expect(unsigned).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT" }
    });

    const stale = await handleOfficial(
      ctx(
        "mw-member",
        req(
          "member.register",
          { agreementVersion: "old", privacyVersion: DEFAULT_POLICY_VERSIONS.privacyVersion, accepted: true },
          { idempotencyKey: "k-stale" }
        ),
        fromA
      )
    );
    expect(stale).toMatchObject({
      ok: false,
      error: { details: { reason: "POLICY_VERSION_MISMATCH" } }
    });
  });

  it("registers once, retries the same member, and isolates two identities", async () => {
    const stores = memoryMemberBundle();
    const first = await handleOfficial(
      ctx(
        "mw-member",
        req("member.register", registerData(), { idempotencyKey: "reg-a", requestId: "req_reg_a" }),
        fromA,
        stores
      )
    ) as { ok: true; data: { memberId: string; nickname: string; created: boolean } };
    expect(first.ok).toBe(true);
    expect(first.data.created).toBe(true);
    expect(first.data.nickname).toMatch(/^思维学员/);
    expect(JSON.stringify(first)).not.toContain("mw08_openid_a");

    const retry = await handleOfficial(
      ctx(
        "mw-member",
        req("member.register", registerData(), { idempotencyKey: "reg-a-2", requestId: "req_reg_a2" }),
        fromA,
        stores
      )
    ) as { ok: true; data: { memberId: string; created: boolean } };
    expect(retry.data.memberId).toBe(first.data.memberId);
    expect(retry.data.created).toBe(false);
    expect(stores.identities.size).toBe(1);
    expect(stores.members.size).toBe(1);
    expect(stores.stats.size).toBe(1);

    const other = await handleOfficial(
      ctx(
        "mw-member",
        req("member.register", registerData(), { idempotencyKey: "reg-b" }),
        fromB,
        stores
      )
    ) as { ok: true; data: { memberId: string } };
    expect(other.data.memberId).not.toBe(first.data.memberId);

    const cross = await handleOfficial(ctx("mw-member", req("member.me"), fromB, stores)) as {
      ok: true;
      data: { memberId: string };
    };
    expect(cross.data.memberId).toBe(other.data.memberId);
    expect(cross.data.memberId).not.toBe(first.data.memberId);
  });

  it("creates only one member under concurrent register of the same identity", async () => {
    const stores = memoryMemberBundle();
    const [left, right] = await Promise.all([
      handleOfficial(
        ctx(
          "mw-member",
          req("member.register", registerData(), { idempotencyKey: "race-1", requestId: "req_race_1" }),
          fromA,
          stores
        )
      ),
      handleOfficial(
        ctx(
          "mw-member",
          req("member.register", registerData(), { idempotencyKey: "race-2", requestId: "req_race_2" }),
          fromA,
          stores
        )
      )
    ]);
    expect(left).toMatchObject({ ok: true });
    expect(right).toMatchObject({ ok: true });
    expect((left as { data: { memberId: string } }).data.memberId).toBe(
      (right as { data: { memberId: string } }).data.memberId
    );
    expect(stores.identities.size).toBe(1);
    expect(stores.members.size).toBe(1);
    expect(stores.stats.size).toBe(1);
    expect(stores.audits.filter((row) => row.action === "member.register")).toHaveLength(1);
  });

  it("returns a redacted member.me payload", async () => {
    const stores = memoryMemberBundle();
    await handleOfficial(
      ctx("mw-member", req("member.register", registerData(), { idempotencyKey: "me-1" }), fromA, stores)
    );
    const me = await handleOfficial(ctx("mw-member", req("member.me"), fromA, stores));
    expect(me).toMatchObject({
      ok: true,
      data: {
        status: "active",
        rankingOptIn: false,
        stats: { totalScore: 0, levelId: "L1" },
        vip: { active: false, expiresAt: null },
        draft: { attemptId: null }
      }
    });
    const raw = JSON.stringify(me);
    expect(raw).not.toContain("mw08_openid_a");
    expect(raw).not.toContain("openid");
    expect(raw).not.toContain("OPENID");
    expect((me as { data: { role?: string } }).data.role).toBeUndefined();
  });

  it("updates legal nickname and builtin avatar, and refuses illegal values", async () => {
    const stores = memoryMemberBundle();
    const created = await handleOfficial(
      ctx("mw-member", req("member.register", registerData(), { idempotencyKey: "up-1" }), fromA, stores)
    ) as { data: { revision: number } };
    const okUpdate = await handleOfficial(
      ctx(
        "mw-member",
        req(
          "member.updateProfile",
          { nickname: "练习学员甲", avatarKey: BUILTIN_AVATAR_KEYS[1], expectedRevision: created.data.revision },
          { idempotencyKey: "up-ok" }
        ),
        fromA,
        stores
      )
    );
    expect(okUpdate).toMatchObject({
      ok: true,
      data: { nickname: "练习学员甲", avatarKey: BUILTIN_AVATAR_KEYS[1], revision: 2 }
    });
    expect((okUpdate as { data: { nicknameContentSafety: string } }).data.nicknameContentSafety).toBe(
      NICKNAME_CONTENT_SAFETY.status
    );

    const illegal = await handleOfficial(
      ctx(
        "mw-member",
        req(
          "member.updateProfile",
          { nickname: "管理员", avatarKey: "https://evil.example/a.png", expectedRevision: 2 },
          { idempotencyKey: "up-bad" }
        ),
        fromA,
        stores
      )
    );
    expect(illegal).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect([...stores.members.values()][0]?.nickname).toBe("练习学员甲");
    expect([...stores.members.values()][0]?.avatarKey).toBe(BUILTIN_AVATAR_KEYS[1]);
  });

  it("rejects unknown or privileged profile fields and leaves the database unchanged", async () => {
    const stores = memoryMemberBundle();
    await handleOfficial(
      ctx("mw-member", req("member.register", registerData(), { idempotencyKey: "priv-1" }), fromA, stores)
    );
    const before = JSON.stringify([...stores.members.values()][0]);
    const privileged = await handleOfficial(
      ctx(
        "mw-member",
        req(
          "member.updateProfile",
          { nickname: "合法昵称甲", expectedRevision: 1, status: "disabled", totalScore: 99, vipExpiresAt: "x" },
          { idempotencyKey: "priv-bad" }
        ),
        fromA,
        stores
      )
    );
    expect(privileged).toMatchObject({ ok: false });
    expect(JSON.stringify([...stores.members.values()][0])).toBe(before);
    expect([...stores.stats.values()][0]?.totalScore).toBe(0);
  });

  it("blocks ordinary writes for a disabled member but still allows me", async () => {
    const stores = memoryMemberBundle();
    const created = await handleOfficial(
      ctx("mw-member", req("member.register", registerData(), { idempotencyKey: "dis-1" }), fromA, stores)
    ) as { data: { memberId: string } };
    stores.disable(created.data.memberId);
    const write = await handleOfficial(
      ctx(
        "mw-member",
        req("member.updateProfile", { nickname: "停用后改名", expectedRevision: 1 }, { idempotencyKey: "dis-w" }),
        fromA,
        stores
      )
    );
    expect(write).toMatchObject({ ok: false, error: { code: "ACCOUNT_DISABLED" } });
    const me = await handleOfficial(ctx("mw-member", req("member.me"), fromA, stores));
    expect(me).toMatchObject({ ok: true, data: { status: "disabled", memberId: created.data.memberId } });
    expect([...stores.members.values()][0]?.nickname).toMatch(/^思维学员/);
  });

  it("does not let maintenance content or payment gates block register or profile", async () => {
    const stores = memoryMemberBundle();
    const maintenance = memoryMaintenanceStore();
    let config = await maintenance.get();
    for (const gate of ["contentWrites", "attemptStart", "attemptSubmit", "purchaseCreate", "entitlementApply"] as const) {
      config = setMaintenanceGate(config, gate, { enabled: false, reason: `${gate} closed`, jobId: "mw06/test/x" }, now);
    }
    await maintenance.save(config);
    const registered = await handleOfficial({
      ...ctx(
        "mw-member",
        req("member.register", registerData(), { idempotencyKey: "maint-1" }),
        fromA,
        stores
      ),
      maintenanceStore: maintenance
    });
    expect(registered).toMatchObject({ ok: true });
    const updated = await handleOfficial({
      ...ctx(
        "mw-member",
        req("member.updateProfile", { nickname: "维护中可改", expectedRevision: 1 }, { idempotencyKey: "maint-2" }),
        fromA,
        stores
      ),
      maintenanceStore: maintenance
    });
    expect(updated).toMatchObject({ ok: true, data: { nickname: "维护中可改" } });
  });

  it("replays the same idempotency key without a second audit or extra rows", async () => {
    const stores = memoryMemberBundle();
    const first = await handleOfficial(
      ctx(
        "mw-member",
        req("member.register", registerData(), { idempotencyKey: "idem-1", requestId: "req_idem_1" }),
        fromA,
        stores
      )
    );
    const replay = await handleOfficial(
      ctx(
        "mw-member",
        req("member.register", registerData(), { idempotencyKey: "idem-1", requestId: "req_idem_1b" }),
        fromA,
        stores
      )
    );
    expect(first).toMatchObject({ ok: true, data: { created: true, replayed: false } });
    expect(replay).toMatchObject({ ok: true, data: { created: false, replayed: true } });
    expect(stores.identities.size).toBe(1);
    expect(stores.members.size).toBe(1);
    expect(stores.stats.size).toBe(1);
    expect(stores.audits).toHaveLength(1);
    expect(stores.idem.size).toBe(1);

    const profile = await handleOfficial(
      ctx(
        "mw-member",
        req("member.updateProfile", { nickname: "幂等资料甲", expectedRevision: 1 }, { idempotencyKey: "idem-up" }),
        fromA,
        stores
      )
    );
    expect(profile).toMatchObject({ ok: true });
    const conflict = await handleOfficial(
      ctx(
        "mw-member",
        req("member.updateProfile", { nickname: "幂等资料乙", expectedRevision: 1 }, { idempotencyKey: "idem-up" }),
        fromA,
        stores
      )
    );
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect([...stores.members.values()][0]?.nickname).toBe("幂等资料甲");
    expect(stores.audits.filter((row) => row.action === "member.updateProfile")).toHaveLength(1);
  });

  it("does not leave orphan identity or member rows when a transaction crashes", async () => {
    const stores = memoryMemberBundle();
    stores.crashAfter = "stats";
    const failed = await handleOfficial(
      ctx("mw-member", req("member.register", registerData(), { idempotencyKey: "crash-1" }), fromA, stores)
    );
    expect(failed).toMatchObject({ ok: false, error: { code: "SERVICE_BUSY" } });
    expect(stores.identities.size).toBe(0);
    expect(stores.members.size).toBe(0);
    expect(stores.stats.size).toBe(0);
    expect(stores.audits).toHaveLength(0);

    stores.crashAfter = null;
    const recovered = await handleOfficial(
      ctx("mw-member", req("member.register", registerData(), { idempotencyKey: "crash-2" }), fromA, stores)
    );
    expect(recovered).toMatchObject({ ok: true });
    expect(stores.identities.size).toBe(1);
    expect(stores.members.size).toBe(1);
    expect(stores.stats.size).toBe(1);
  });

  it("rejects oversized write bodies", async () => {
    const huge = {
      apiVersion: "1",
      action: "member.updateProfile",
      requestId: "req_huge",
      idempotencyKey: "huge",
      data: { nickname: "合法昵称乙", expectedRevision: 1, pad: "x".repeat(5000) }
    };
    const res = await handleOfficial(ctx("mw-member", huge, fromA));
    expect(res).toMatchObject({
      ok: false,
      error: { details: { reason: "PAYLOAD_TOO_LARGE" } }
    });
  });

  it("exposes current policy versions on the public entry", async () => {
    const res = await handleOfficial(ctx("mw-public", req("policies.current")));
    expect(res).toMatchObject({
      ok: true,
      data: {
        agreementVersion: DEFAULT_POLICY_VERSIONS.agreementVersion,
        privacyVersion: DEFAULT_POLICY_VERSIONS.privacyVersion,
        placeholder: true
      }
    });
  });
});
