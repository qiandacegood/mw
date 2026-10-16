import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY_VERSIONS,
  emptyCatalog,
  seedCategoryId,
  setMaintenanceGate,
  type CategoryRecord,
  type PaperAnswerRecord,
  type PaperChunkRecord,
  type PaperRecord,
  type PaperVersionRecord
} from "@mw/shared";
import { handleOfficial, type AdminUserRecord, type OfficialContext } from "./official.js";
import { memoryMaintenanceStore } from "./modules/job-stores.js";
import { memoryMemberBundle, memoryPolicyStore } from "./modules/member-stores.js";
import { memoryAttemptStore } from "./modules/attempt-stores.js";
import { memoryCategoryStore } from "./modules/category-stores.js";
import { memoryVipStore } from "./modules/vip-stores.js";

const allowedAppIds = ["wxmwallowedappid0001"];
const now = new Date("2026-10-16T02:00:00.000Z");
const fromA = { fromAppId: allowedAppIds[0], fromOpenId: "mw20_openid_a" };
const rootId = seedCategoryId("logical");

function req(action: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    apiVersion: "1",
    action,
    requestId: extra.requestId || `req_${action.replace(".", "_")}`,
    data,
    ...extra
  };
}

function cat(id: string): CategoryRecord {
  return {
    categoryId: id,
    parentId: null,
    depth: 1,
    ancestorIds: [],
    name: "逻辑思维",
    normalizedName: "逻辑思维",
    sort: 10,
    enabled: true,
    deletedAt: null,
    revision: 1,
    treeVersion: 3,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function paper(id: string, access: "free" | "vip"): PaperRecord {
  return {
    paperId: id,
    title: `虚构${id}`,
    summary: "虚构简介",
    goal: "虚构目标",
    categoryId: rootId,
    access,
    difficulty: "beginner",
    sort: 10,
    suggestedMinutes: 20,
    publishedAt: "2026-10-09T06:00:00.000Z",
    status: "published",
    activeVersionId: `${id}_v`,
    revision: 2,
    draftItems: [],
    draftQuestionCount: 1,
    draftMaxScore: 10,
    accessLocked: false,
    withdrawReason: null,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function versionOf(paperId: string): PaperVersionRecord {
  return {
    versionId: `${paperId}_v`,
    paperId,
    questionCount: 1,
    maxScore: 10,
    chunkIds: [`${paperId}_c1`],
    answerChunkIds: [`${paperId}_a1`],
    chunkDigests: ["d1"],
    answerDigests: ["d2"],
    categoryPathSnapshot: ["逻辑思维"],
    manifestHash: "m1",
    questionIds: ["q1"],
    questionVersionIds: ["qv1"],
    schemaVersion: 1,
    createdAt: now.toISOString(),
    createdBy: "uid_content_1"
  };
}

function chunkOf(paperId: string): PaperChunkRecord {
  return {
    chunkId: `${paperId}_c1`,
    versionId: `${paperId}_v`,
    chunkNo: 1,
    items: [
      {
        ord: 1,
        questionId: "q1",
        questionVersionId: "qv1",
        type: "single",
        stem: { text: "虚构题干", assetIds: [] },
        options: [
          { optionId: "A", text: "甲", assetIds: [] },
          { optionId: "B", text: "乙", assetIds: [] }
        ],
        points: 10
      }
    ],
    digest: "d1",
    schemaVersion: 1
  };
}

function answerOf(paperId: string): PaperAnswerRecord {
  return {
    chunkId: `${paperId}_a1`,
    versionId: `${paperId}_v`,
    chunkNo: 1,
    items: [
      {
        ord: 1,
        questionId: "q1",
        questionVersionId: "qv1",
        answer: { optionIds: ["A"] },
        analysis: { text: "虚构解析", assetIds: [] }
      }
    ],
    digest: "d2",
    schemaVersion: 1
  };
}

function seededAttempts() {
  return memoryAttemptStore({
    papers: [paper("p_vip", "vip"), paper("p_free", "free")],
    versions: [versionOf("p_vip"), versionOf("p_free")],
    chunks: [chunkOf("p_vip"), chunkOf("p_free")],
    answers: [answerOf("p_vip"), answerOf("p_free")],
    categories: [cat(rootId)]
  });
}

function memberCtx(
  event: unknown,
  stores: ReturnType<typeof memoryMemberBundle>,
  attempts: ReturnType<typeof seededAttempts>,
  vip: ReturnType<typeof memoryVipStore>,
  extra: Record<string, unknown> = {}
): OfficialContext {
  return {
    entry: "mw-member",
    event,
    allowedAppIds,
    now,
    policyStore: memoryPolicyStore(),
    memberStore: stores,
    attemptStore: attempts,
    vipStore: vip,
    maintenanceStore: memoryMaintenanceStore(),
    categoryStore: memoryCategoryStore([cat(rootId)], { ...emptyCatalog(now), treeVersion: 3, seeded: true }),
    ...fromA,
    ...extra
  };
}

function adminCtx(
  event: unknown,
  vip: ReturnType<typeof memoryVipStore>,
  roles: string[],
  extra: Record<string, unknown> = {}
): OfficialContext {
  return {
    entry: "mw-admin",
    event,
    allowedAppIds,
    now,
    adminStore: {
      async getByUid(uid: string) {
        return { uid, roles: roles as AdminUserRecord["roles"], enabled: true, authVersion: 1 };
      }
    },
    authUid: "uid_mw20_admin",
    vipStore: vip,
    memberStore: extra.memberStore as ReturnType<typeof memoryMemberBundle> | undefined,
    maintenanceStore: (extra.maintenanceStore as ReturnType<typeof memoryMaintenanceStore>) || memoryMaintenanceStore(),
    ...extra
  };
}

async function register(stores: ReturnType<typeof memoryMemberBundle>, attempts: ReturnType<typeof seededAttempts>, vip: ReturnType<typeof memoryVipStore>) {
  const res = (await handleOfficial(
    memberCtx(
      req(
        "member.register",
        {
          agreementVersion: DEFAULT_POLICY_VERSIONS.agreementVersion,
          privacyVersion: DEFAULT_POLICY_VERSIONS.privacyVersion,
          accepted: true
        },
        { idempotencyKey: "reg-mw20", requestId: "req_reg_mw20" }
      ),
      stores,
      attempts,
      vip
    )
  )) as { ok: true; data: { memberId: string } };
  const memberId = res.data.memberId;
  const member = stores.members.get(memberId);
  if (member) attempts.members.set(memberId, member);
  attempts.linkMemberStats(stores.stats);
  return memberId;
}

describe("MW20 vip ledger and entitlement", () => {
  it("rejects content role grant and payment-shaped gift fields", async () => {
    const vip = memoryVipStore();
    const content = await handleOfficial(
      adminCtx(req("vip.grant", { targetMemberId: "m1", durationDays: 1, reason: "x" }, { idempotencyKey: "g1" }), vip, ["content"])
    );
    expect(content).toMatchObject({ ok: false, error: { code: "FORBIDDEN", details: { reason: "SUPER_ROLE_REQUIRED" } } });
    const payment = await handleOfficial(
      adminCtx(
        req("vip.grant", { targetMemberId: "m1", durationDays: 1, reason: "x", orderId: "o1" }, { idempotencyKey: "g2" }),
        vip,
        ["super"]
      )
    );
    expect(payment).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  });

  it("grants from the same ledger used by member.me, vip.status and attempt.start", async () => {
    const stores = memoryMemberBundle();
    const attempts = seededAttempts();
    const vip = memoryVipStore();
    const memberId = await register(stores, attempts, vip);
    const denied = await handleOfficial(memberCtx(req("attempt.start", { paperId: "p_vip" }, { idempotencyKey: "s1" }), stores, attempts, vip));
    expect(denied).toMatchObject({ ok: false, error: { code: "VIP_REQUIRED" } });
    const granted = await handleOfficial(
      adminCtx(
        req("vip.grant", { targetMemberId: memberId, durationDays: 1, reason: "mw20 first gift", sourceId: "gift-first" }, { idempotencyKey: "grant-1" }),
        vip,
        ["super"],
        { memberStore: stores }
      )
    );
    expect(granted).toMatchObject({
      ok: true,
      data: { sourceType: "gift", active: true, grantId: expect.any(String) }
    });
    const me = (await handleOfficial(memberCtx(req("member.me"), stores, attempts, vip))) as {
      ok: true;
      data: { vip: { active: boolean; expiresAt: string }; stats: { totalScore: number } };
    };
    const status = (await handleOfficial(memberCtx(req("vip.status"), stores, attempts, vip))) as {
      ok: true;
      data: { active: boolean; expiresAt: string };
    };
    expect(me.data.vip.active).toBe(true);
    expect(status.data.active).toBe(true);
    expect(me.data.vip.expiresAt).toBe(status.data.expiresAt);
    expect(me.data.stats.totalScore).toBe(0);
    const started = await handleOfficial(
      memberCtx(req("attempt.start", { paperId: "p_vip" }, { idempotencyKey: "s2" }), stores, attempts, vip)
    );
    expect(started).toMatchObject({ ok: true, data: { paperId: "p_vip" } });
  });

  it("appends while active, renews after expiry, and keeps submitted analysis readable", async () => {
    const stores = memoryMemberBundle();
    const attempts = seededAttempts();
    const vip = memoryVipStore();
    const memberId = await register(stores, attempts, vip);
    await handleOfficial(
      adminCtx(
        req("vip.grant", { targetMemberId: memberId, durationSeconds: 10, reason: "short", sourceId: "g-short" }, { idempotencyKey: "g-short" }),
        vip,
        ["super"],
        { memberStore: stores }
      )
    );
    const started = (await handleOfficial(
      memberCtx(req("attempt.start", { paperId: "p_vip" }, { idempotencyKey: "start-short" }), stores, attempts, vip)
    )) as { ok: true; data: { attemptId: string } };
    await handleOfficial(
      memberCtx(
        req(
          "attempt.submit",
          {
            attemptId: started.data.attemptId,
            expectedRevision: 1,
            answers: [{ questionId: "q1", optionIds: ["A"] }],
            confirmUnanswered: true
          },
          { idempotencyKey: "sub-short" }
        ),
        stores,
        attempts,
        vip
      )
    );
    const expiredNow = new Date(now.getTime() + 10_000);
    const startAfter = await handleOfficial(
      memberCtx(req("attempt.start", { paperId: "p_vip" }, { idempotencyKey: "start-late" }), stores, attempts, vip, {
        now: expiredNow
      })
    );
    expect(startAfter).toMatchObject({ ok: false, error: { code: "VIP_REQUIRED" } });
    const result = await handleOfficial(
      memberCtx(req("attempt.result", { attemptId: started.data.attemptId }), stores, attempts, vip, { now: expiredNow })
    );
    expect(result).toMatchObject({ ok: true });
    const renewed = await handleOfficial(
      adminCtx(
        req("vip.grant", { targetMemberId: memberId, durationSeconds: 10, reason: "renew", sourceId: "g-renew" }, { idempotencyKey: "g-renew" }),
        vip,
        ["super"],
        { memberStore: stores, now: expiredNow }
      )
    );
    expect(renewed).toMatchObject({ ok: true, data: { active: true } });
  });

  it("serializes two concurrent gifts onto one account", async () => {
    const stores = memoryMemberBundle();
    const attempts = seededAttempts();
    const vip = memoryVipStore();
    const memberId = await register(stores, attempts, vip);
    const [a, b] = await Promise.all([
      handleOfficial(
        adminCtx(
          req("vip.grant", { targetMemberId: memberId, durationSeconds: 86400, reason: "a", sourceId: "gift-a" }, { idempotencyKey: "ca" }),
          vip,
          ["super"],
          { memberStore: stores }
        )
      ),
      handleOfficial(
        adminCtx(
          req("vip.grant", { targetMemberId: memberId, durationSeconds: 86400, reason: "b", sourceId: "gift-b" }, { idempotencyKey: "cb" }),
          vip,
          ["super"],
          { memberStore: stores }
        )
      )
    ]);
    expect((a as { ok: boolean }).ok).toBe(true);
    expect((b as { ok: boolean }).ok).toBe(true);
    expect(vip.grants.size).toBe(2);
    expect(vip.accounts.get(memberId)?.expiresAt).toBeTruthy();
    const expires = Date.parse(String(vip.accounts.get(memberId)?.expiresAt));
    expect(expires - now.getTime()).toBe(2 * 86400 * 1000);
  });

  it("revokes unused gift seconds and keeps entitlementApply off the submit path", async () => {
    const stores = memoryMemberBundle();
    const attempts = seededAttempts();
    const vip = memoryVipStore();
    const memberId = await register(stores, attempts, vip);
    await handleOfficial(
      adminCtx(
        req("vip.grant", { targetMemberId: memberId, durationSeconds: 20, reason: "gift", sourceId: "gift-r" }, { idempotencyKey: "gr" }),
        vip,
        ["super"],
        { memberStore: stores }
      )
    );
    const maintenance = memoryMaintenanceStore();
    await maintenance.save(
      setMaintenanceGate(await maintenance.get(), "entitlementApply", { enabled: false, reason: "vip rebuild", jobId: "job-vip" }, now)
    );
    const blockedGrant = await handleOfficial(
      adminCtx(
        req("vip.grant", { targetMemberId: memberId, durationSeconds: 10, reason: "later", sourceId: "gift-x" }, { idempotencyKey: "gx" }),
        vip,
        ["super"],
        { memberStore: stores, maintenanceStore: maintenance }
      )
    );
    expect(blockedGrant).toMatchObject({ ok: false, error: { code: "CONTENT_UPDATING" } });
    const started = await handleOfficial(
      memberCtx(req("attempt.start", { paperId: "p_free" }, { idempotencyKey: "free-1" }), stores, attempts, vip)
    );
    expect(started).toMatchObject({ ok: true });
    const revoked = await handleOfficial(
      adminCtx(
        req("vip.revokeGift", { targetMemberId: memberId, sourceId: "gift-r", reason: "unused only" }, { idempotencyKey: "rv" }),
        vip,
        ["super"]
      )
    );
    expect(revoked).toMatchObject({ ok: true, data: { revokedSeconds: 20, active: false } });
  });
});
