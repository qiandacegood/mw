import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY_VERSIONS, DELETED_NICKNAME, type OrderRecord } from "@mw/shared";
import { handleOfficial, type OfficialContext } from "./official.js";
import type { VirtualPayRuntime } from "./modules/orders.js";
import { memoryMemberBundle, memoryPolicyStore } from "./modules/member-stores.js";
import { memoryFeedbackStore } from "./modules/feedback-stores.js";
import { memoryOrderStore } from "./modules/order-stores.js";
import { memoryPaperStore } from "./modules/paper-stores.js";
import { listRanking } from "./modules/ranking.js";
import { memoryRankingStore } from "./modules/ranking-stores.js";
import { rankingBoardId, rankingRowId, type FeedbackRecord, type RankingHeadRecord, type RankingRowRecord } from "@mw/shared";

const allowedAppIds = ["wxmwallowedappid0001"];
const now = new Date("2026-10-19T02:00:00.000Z");
const fromA = { fromAppId: allowedAppIds[0], fromOpenId: "mw24_openid_a" };

function req(action: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    apiVersion: "1",
    action,
    requestId: extra.requestId || `req_${action.replace(/\./g, "_")}`,
    data,
    ...extra
  };
}

function payStub(openid = fromA.fromOpenId): VirtualPayRuntime {
  return {
    offerId: "offer",
    configuredEnv: 1,
    sandboxAppKey: "k",
    appId: allowedAppIds[0] || "wxmwallowedappid0001",
    async code2Session(code: string) {
      if (code === "ok") return { ok: true as const, openid, sessionKey: "sess-ok" };
      if (code === "other") return { ok: true as const, openid: "other_openid", sessionKey: "sess-other" };
      return { ok: false as const, reason: "WX_LOGIN_CODE_INVALID" };
    },
    async queryOrder() {
      return { paid: false, unknown: true };
    }
  };
}

function memberCtx(
  event: unknown,
  stores: ReturnType<typeof memoryMemberBundle>,
  extra: Partial<OfficialContext> = {}
): OfficialContext {
  return {
    entry: "mw-member",
    event,
    allowedAppIds,
    now,
    policyStore: memoryPolicyStore(),
    memberStore: stores,
    orderStore: extra.orderStore,
    feedbackStore: extra.feedbackStore || memoryFeedbackStore(),
    paperStore: extra.paperStore || memoryPaperStore(),
    virtualPay: extra.virtualPay || payStub(),
    ...fromA,
    ...extra
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

function pendingOrder(memberId: string, extra: Partial<OrderRecord> = {}): OrderRecord {
  return {
    orderId: extra.orderId || "ord_pending",
    channelBizNo: "biz_pending",
    memberId,
    openId: fromA.fromOpenId,
    planSnapshot: {
      planId: "p",
      planVersion: 1,
      title: "测",
      durationDays: 30,
      durationSeconds: 2592000,
      priceFen: 9900,
      productId: "prod",
      channel: "android",
      environment: 1,
      testOnly: true
    },
    amountFen: 9900,
    channel: "android",
    environment: 1,
    payState: "pending",
    grantState: "pending",
    refundState: "none",
    payDeadlineAt: now.toISOString(),
    paidAt: null,
    grantedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    nextCheckAt: now.toISOString(),
    lastQueryAt: null,
    needsReview: false,
    reviewReason: "",
    goodsNotified: false,
    fixtureLedger: true,
    schemaVersion: 1,
    ...extra
  };
}

async function register(stores: ReturnType<typeof memoryMemberBundle>) {
  const res = await handleOfficial(
    memberCtx(req("member.register", registerData(), { idempotencyKey: "reg-a" }), stores)
  );
  expect(res).toMatchObject({ ok: true });
  return res as { ok: true; data: { memberId: string; revision: number } };
}

describe("MW24 policies and account deletion", () => {
  it("returns current test-draft policy text with versions", async () => {
    const res = await handleOfficial({
      entry: "mw-public",
      event: req("policies.current"),
      allowedAppIds,
      now,
      policyStore: memoryPolicyStore()
    });
    expect(res).toMatchObject({
      ok: true,
      data: {
        agreementVersion: DEFAULT_POLICY_VERSIONS.agreementVersion,
        privacyVersion: DEFAULT_POLICY_VERSIONS.privacyVersion,
        placeholder: true
      }
    });
    const data = (res as { data: { agreementText: string; privacyText: string } }).data;
    expect(data.agreementText).toContain("mw24-test-agreement-v1");
    expect(data.privacyText).toContain("mw24-test-privacy-v1");
  });

  it("rejects old policy versions on register and missing checkbox", async () => {
    const stores = memoryMemberBundle();
    const stale = await handleOfficial(
      memberCtx(
        req(
          "member.register",
          { agreementVersion: "mw08-test-agreement-v1", privacyVersion: DEFAULT_POLICY_VERSIONS.privacyVersion, accepted: true },
          { idempotencyKey: "stale" }
        ),
        stores
      )
    );
    expect(stale).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT", details: { reason: "POLICY_VERSION_MISMATCH" } } });
    const unsigned = await handleOfficial(
      memberCtx(req("member.register", { ...registerData(), accepted: false }, { idempotencyKey: "un" }), stores)
    );
    expect(unsigned).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  });

  it("rejects deletion without reauth and with mismatched login code", async () => {
    const stores = memoryMemberBundle();
    await register(stores);
    const missing = await handleOfficial(
      memberCtx(
        req("member.requestDeletion", { acknowledgementVersion: DEFAULT_POLICY_VERSIONS.agreementVersion }, { idempotencyKey: "d0" }),
        stores
      )
    );
    expect(missing).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    const mismatch = await handleOfficial(
      memberCtx(
        req(
          "member.requestDeletion",
          {
            reauthProof: { kind: "wx_login_code", code: "other" },
            acknowledgementVersion: DEFAULT_POLICY_VERSIONS.agreementVersion
          },
          { idempotencyKey: "d1" }
        ),
        stores
      )
    );
    expect(mismatch).toMatchObject({ ok: false, error: { details: { reason: "REAUTH_MISMATCH" } } });
  });

  it("returns pending orders instead of deleting", async () => {
    const stores = memoryMemberBundle();
    const created = await register(stores);
    const orders = memoryOrderStore();
    orders.orders.set("ord_pending", pendingOrder(created.data.memberId));
    const res = await handleOfficial(
      memberCtx(
        req(
          "member.requestDeletion",
          {
            reauthProof: { kind: "wx_login_code", code: "ok" },
            acknowledgementVersion: DEFAULT_POLICY_VERSIONS.agreementVersion
          },
          { idempotencyKey: "d-block" }
        ),
        stores,
        { orderStore: orders }
      )
    );
    expect(res).toMatchObject({ ok: true, data: { blocked: true, status: "active" } });
    const data = (res as { data: { pendingItems: { orderId: string }[] } }).data;
    expect(data.pendingItems[0]?.orderId).toBe("ord_pending");
    expect(JSON.stringify(res)).not.toMatch(/openid|OPENID/i);
    expect(stores.members.get(created.data.memberId)?.status).toBe("active");
  });

  it("deletes when unblocked, hides ranking, redacts profile, marks feedback, and refuses re-register", async () => {
    const stores = memoryMemberBundle();
    const created = await register(stores);
    const memberId = created.data.memberId;
    const feedbacks = memoryFeedbackStore();
    const seededFeedback: FeedbackRecord = {
      feedbackId: "fb_mw24",
      memberId,
      type: "question_error",
      paperId: "p1",
      questionId: "q1",
      versionId: "v1",
      text: "题干有误测试",
      status: "open",
      resolveNote: "",
      resolvedBy: "",
      resolvedAt: "",
      submitterDeleted: false,
      submitterDeletedAt: "",
      schemaVersion: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    await feedbacks.save(seededFeedback);
    const ranking = memoryRankingStore();
    const boardId = rankingBoardId({ scope: "total", periodKey: "all", categoryId: "" });
    const generation = "gen_del";
    const head: RankingHeadRecord = {
      boardId,
      generation,
      scope: "total",
      periodKey: "all",
      categoryId: "",
      publishedAt: now.toISOString(),
      sampleStartedAt: now.toISOString(),
      sampleEndedAt: now.toISOString(),
      catalogVersion: 1,
      participantCount: 1,
      displayCount: 1,
      boundaryTruncated: false,
      schemaVersion: 1,
      revision: 1
    };
    const row: RankingRowRecord = {
      rowId: rankingRowId({ boardId, generation, memberId }),
      boardId,
      generation,
      scope: "total",
      periodKey: "all",
      categoryId: "",
      memberId,
      nickname: "练习学员甲",
      avatarKey: "avatar.builtin.01",
      levelId: "L1",
      value: 9,
      rank: 1,
      sortOrdinal: 0,
      reachedAt: now.toISOString(),
      prevValueDiff: null,
      schemaVersion: 1
    };
    ranking.heads.set(boardId, head);
    ranking.rows.set(row.rowId, row);
    ranking.seedMember({
      memberId,
      nickname: "练习学员甲",
      avatarKey: "avatar.builtin.01",
      status: "active",
      rankingOptIn: true,
      rankingBanned: false,
      revision: 1
    });
    ranking.runtime = {
      publishedGeneration: generation,
      publishedAt: now.toISOString(),
      requestedAt: "",
      buildingSince: "",
      lastBuildStartedAt: now.toISOString(),
      lastBuildEndedAt: now.toISOString(),
      lastBuildOk: true,
      lastBuildError: "",
      catalogVersion: 1,
      boardCount: 1,
      rowCount: 1,
      rowCounts: { total: 1 },
      historyGapMembers: 0,
      historyGapScore: 0,
      truncated: false,
      schemaVersion: 1,
      revision: 1
    };
    stores.members.set(memberId, { ...stores.members.get(memberId)!, rankingOptIn: true });
    const before = await listRanking({ store: ranking, members: stores, data: { scope: "total" }, now });
    expect(before.ok && before.data.rows.length).toBe(1);

    const deleted = await handleOfficial(
      memberCtx(
        req(
          "member.requestDeletion",
          {
            reauthProof: { kind: "wx_login_code", code: "ok" },
            acknowledgementVersion: DEFAULT_POLICY_VERSIONS.agreementVersion
          },
          { idempotencyKey: "del-ok" }
        ),
        stores,
        { feedbackStore: feedbacks }
      )
    );
    expect(deleted).toMatchObject({ ok: true, data: { status: "deleted", blocked: false, nickname: DELETED_NICKNAME } });
    expect(JSON.stringify(deleted)).not.toMatch(/openid|OPENID|mw24_openid/i);
    expect(stores.audits.some((row) => row.action === "member.requestDeletion")).toBe(true);
    expect([...feedbacks.rows.values()][0]?.submitterDeleted).toBe(true);

    const me = await handleOfficial(memberCtx(req("member.me"), stores));
    expect(me).toMatchObject({ ok: true, data: { status: "deleted", nickname: DELETED_NICKNAME } });
    expect(JSON.stringify(me)).not.toMatch(/openid|OPENID/i);

    const after = await listRanking({ store: ranking, members: stores, data: { scope: "total" }, now });
    expect(after.ok && after.data.rows).toEqual([]);
    expect(ranking.heads.get(boardId)?.generation).toBe(generation);

    const write = await handleOfficial(
      memberCtx(
        req("member.updateProfile", { nickname: "注销后改名", expectedRevision: 2 }, { idempotencyKey: "w1" }),
        stores
      )
    );
    expect(write).toMatchObject({ ok: false, error: { code: "ACCOUNT_DISABLED" } });

    const again = await handleOfficial(
      memberCtx(req("member.register", registerData(), { idempotencyKey: "reg-again" }), stores)
    );
    expect(again).toMatchObject({ ok: false, error: { code: "ACCOUNT_DELETED" } });
    expect(stores.identities.size).toBe(1);
    expect(stores.members.size).toBe(1);

    const status = await handleOfficial(memberCtx(req("member.deletionStatus"), stores));
    expect(status).toMatchObject({ ok: true, data: { status: "deleted", blocked: false } });
  });
});
