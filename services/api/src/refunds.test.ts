import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY_VERSIONS, durationSecondsFromDays, vipGrantId } from "@mw/shared";
import { handleOfficial, type AdminUserRecord, type OfficialContext } from "./official.js";
import { VIRTUAL_PAY_MESSAGE_PUSH_FIXTURES, messagePushSignature } from "./modules/virtual-pay-notify.js";
import { memoryMaintenanceStore } from "./modules/job-stores.js";
import { memoryMemberBundle, memoryPolicyStore } from "./modules/member-stores.js";
import { memoryVipStore } from "./modules/vip-stores.js";
import { memoryOrderStore } from "./modules/order-stores.js";
import type { VirtualPayRuntime } from "./modules/orders.js";

const allowedAppId = "wxmwallowedappid0001";
const allowedAppIds = [allowedAppId];
const now = new Date("2026-10-18T02:00:00.000Z");
const fromA = { fromAppId: allowedAppId, fromOpenId: "mw22_openid_a" };
const plain = VIRTUAL_PAY_MESSAGE_PUSH_FIXTURES.plainPost;
const day = durationSecondsFromDays(1);

function req(action: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    apiVersion: "1",
    action,
    requestId: extra.requestId || `req_${action.replace(".", "_")}`,
    data,
    ...extra
  };
}

function testPay(overrides: Partial<VirtualPayRuntime> = {}): VirtualPayRuntime {
  return {
    offerId: "offer_test",
    configuredEnv: 1,
    sandboxAppKey: "12345",
    appId: allowedAppId,
    async code2Session() {
      return { ok: true, openid: fromA.fromOpenId, sessionKey: "sess-ok" };
    },
    async queryOrder() {
      return { paid: false, unknown: true };
    },
    ...overrides
  };
}

function memberCtx(
  event: unknown,
  stores: ReturnType<typeof memoryMemberBundle>,
  vip: ReturnType<typeof memoryVipStore>,
  orders: ReturnType<typeof memoryOrderStore>,
  extra: Partial<OfficialContext> = {}
): OfficialContext {
  return {
    entry: "mw-member",
    event,
    allowedAppIds,
    now,
    policyStore: memoryPolicyStore(),
    memberStore: stores,
    vipStore: vip,
    orderStore: orders,
    virtualPay: extra.virtualPay || testPay(),
    maintenanceStore: extra.maintenanceStore || memoryMaintenanceStore(),
    ...fromA,
    ...extra
  };
}

function adminCtx(
  event: unknown,
  orders: ReturnType<typeof memoryOrderStore>,
  roles: string[],
  extra: Partial<OfficialContext> = {}
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
    authUid: "uid_mw22_admin",
    orderStore: orders,
    vipStore: extra.vipStore,
    memberStore: extra.memberStore,
    virtualPay: extra.virtualPay || testPay(),
    maintenanceStore: extra.maintenanceStore || memoryMaintenanceStore(),
    ...extra
  };
}

async function register(stores: ReturnType<typeof memoryMemberBundle>, vip: ReturnType<typeof memoryVipStore>, orders: ReturnType<typeof memoryOrderStore>) {
  const res = (await handleOfficial(
    memberCtx(
      req(
        "member.register",
        {
          agreementVersion: DEFAULT_POLICY_VERSIONS.agreementVersion,
          privacyVersion: DEFAULT_POLICY_VERSIONS.privacyVersion,
          accepted: true
        },
        { idempotencyKey: "reg-mw22" }
      ),
      stores,
      vip,
      orders
    )
  )) as { ok: true; data: { memberId: string } };
  return res.data.memberId;
}

async function fixture(memberId: string, stores: ReturnType<typeof memoryMemberBundle>, vip: ReturnType<typeof memoryVipStore>, orders: ReturnType<typeof memoryOrderStore>) {
  return handleOfficial(
    adminCtx(
      req("refund.fixturePrepare", { targetMemberId: memberId, reason: "mw22 fixture" }),
      orders,
      ["super"],
      { vipStore: vip, memberStore: stores, now }
    )
  ) as Promise<{
    ok: true;
    data: {
      keepB: { orderA: string; orderB: string; remainingASeconds: number; remainingBSeconds: number };
      consumedA: { orderA: string; orderB: string; remainingASeconds: number; remainingBSeconds: number };
      apple: { orderId: string; merchantRefundSupported: boolean };
      beforeGrant: { orderId: string };
      leftover: { orders: string[] };
    };
  }>;
}

describe("MW22 refund roles and apple path", () => {
  it("blocks content from review/execute and operations from execute; apple has no merchant execute", async () => {
    const orders = memoryOrderStore();
    const vip = memoryVipStore();
    const stores = memoryMemberBundle();
    const memberId = await register(stores, vip, orders);
    const prepared = await fixture(memberId, stores, vip, orders);
    expect(prepared.ok).toBe(true);
    const requested = await handleOfficial(
      memberCtx(req("refund.request", { orderId: prepared.data.keepB.orderA, reason: "want refund" }), stores, vip, orders)
    );
    expect(requested).toMatchObject({ ok: true, data: { kind: "whole" } });
    const contentReview = await handleOfficial(
      adminCtx(
        req("refund.review", { orderId: prepared.data.keepB.orderA, advice: "ok", reason: "x" }),
        orders,
        ["content"],
        { vipStore: vip }
      )
    );
    expect(contentReview).toMatchObject({ ok: false, error: { details: { reason: "OPERATIONS_ROLE_REQUIRED" } } });
    const opsExecute = await handleOfficial(
      adminCtx(
        req("refund.execute", { orderId: prepared.data.keepB.orderA, amountFen: 9900, reason: "x" }, { idempotencyKey: "ex1" }),
        orders,
        ["operations"],
        { vipStore: vip }
      )
    );
    expect(opsExecute).toMatchObject({ ok: false, error: { details: { reason: "SUPER_ROLE_REQUIRED" } } });
    const appleReq = await handleOfficial(
      memberCtx(req("refund.request", { orderId: prepared.data.apple.orderId, reason: "ios" }), stores, vip, orders)
    );
    expect(appleReq).toMatchObject({ ok: true, data: { appleGuidance: expect.stringContaining("App Store"), merchantRefundSupported: false } });
    const appleExec = await handleOfficial(
      adminCtx(
        req("refund.execute", { orderId: prepared.data.apple.orderId, amountFen: 9900, reason: "no" }, { idempotencyKey: "ex-ios" }),
        orders,
        ["super"],
        { vipStore: vip }
      )
    );
    expect(appleExec).toMatchObject({ ok: false, error: { details: { reason: "MERCHANT_REFUND_UNSUPPORTED" } } });
  });
});

describe("MW22 whole refund only cuts the order source", () => {
  it("keeps B 30 days after refunding A leftover 10 days, and used-up A does not cut B", async () => {
    const orders = memoryOrderStore();
    const vip = memoryVipStore();
    const stores = memoryMemberBundle();
    const memberId = await register(stores, vip, orders);
    const prepared = await fixture(memberId, stores, vip, orders);
    expect(prepared.data.keepB.remainingASeconds).toBe(10 * day);
    expect(prepared.data.keepB.remainingBSeconds).toBe(30 * day);
    await handleOfficial(
      memberCtx(req("refund.request", { orderId: prepared.data.keepB.orderA, reason: "refund A" }), stores, vip, orders)
    );
    await handleOfficial(
      adminCtx(
        req("refund.execute", { orderId: prepared.data.keepB.orderA, amountFen: 9900, reason: "whole" }, { idempotencyKey: "ex-a" }),
        orders,
        ["super"],
        { vipStore: vip }
      )
    );
    const done = (await handleOfficial(
      adminCtx(
        req("refund.recordChannelResult", {
          orderId: prepared.data.keepB.orderA,
          outcome: "succeeded",
          confirmedFen: 9900,
          eventKey: "ev-a",
          reason: "sandbox final"
        }),
        orders,
        ["super"],
        { vipStore: vip }
      )
    )) as { ok: true; data: { revokedSeconds: number; state: string } };
    expect(done.data.state).toBe("succeeded");
    expect(done.data.revokedSeconds).toBe(10 * day);
    const grantB = [...vip.grants.values()].find((row) => row.sourceId === orders.orders.get(prepared.data.keepB.orderB)?.channelBizNo);
    expect(grantB?.remainingSeconds).toBe(30 * day);
    const again = await handleOfficial(
      adminCtx(
        req("refund.recordChannelResult", {
          orderId: prepared.data.keepB.orderA,
          outcome: "succeeded",
          confirmedFen: 9900,
          eventKey: "ev-a",
          reason: "sandbox final"
        }),
        orders,
        ["super"],
        { vipStore: vip }
      )
    );
    expect(again).toMatchObject({ ok: true, data: { revokedSeconds: 0 }, replayed: true });
    expect(grantB?.remainingSeconds).toBe(30 * day);

    await handleOfficial(
      memberCtx(req("refund.request", { orderId: prepared.data.consumedA.orderA, reason: "used A" }), stores, vip, orders)
    );
    await handleOfficial(
      adminCtx(
        req("refund.execute", { orderId: prepared.data.consumedA.orderA, amountFen: 9900, reason: "whole" }, { idempotencyKey: "ex-used" }),
        orders,
        ["super"],
        { vipStore: vip }
      )
    );
    const used = (await handleOfficial(
      adminCtx(
        req("refund.recordChannelResult", {
          orderId: prepared.data.consumedA.orderA,
          outcome: "succeeded",
          confirmedFen: 9900,
          eventKey: "ev-used",
          reason: "sandbox final"
        }),
        orders,
        ["super"],
        { vipStore: vip }
      )
    )) as { ok: true; data: { revokedSeconds: number } };
    expect(used.data.revokedSeconds).toBe(0);
    const usedB = [...vip.grants.values()].find((row) => row.sourceId === orders.orders.get(prepared.data.consumedA.orderB)?.channelBizNo);
    expect(usedB?.remainingSeconds).toBe(30 * day);
  });

  it("does not grant after a terminal refund and sends partial refunds to manual review", async () => {
    const orders = memoryOrderStore();
    const vip = memoryVipStore();
    const stores = memoryMemberBundle();
    const memberId = await register(stores, vip, orders);
    const prepared = await fixture(memberId, stores, vip, orders);
    await handleOfficial(
      memberCtx(req("refund.request", { orderId: prepared.data.beforeGrant.orderId, reason: "first" }), stores, vip, orders)
    );
    await handleOfficial(
      adminCtx(
        req("refund.execute", { orderId: prepared.data.beforeGrant.orderId, amountFen: 9900, reason: "whole" }, { idempotencyKey: "ex-bg" }),
        orders,
        ["super"],
        { vipStore: vip }
      )
    );
    await handleOfficial(
      adminCtx(
        req("refund.recordChannelResult", {
          orderId: prepared.data.beforeGrant.orderId,
          outcome: "succeeded",
          confirmedFen: 9900,
          eventKey: "ev-bg",
          reason: "sandbox final"
        }),
        orders,
        ["super"],
        { vipStore: vip }
      )
    );
    const order = orders.orders.get(prepared.data.beforeGrant.orderId);
    expect(order?.refundState).toBe("succeeded");
    const notify = await handleOfficial({
      entry: "mw-pay-hook",
      event: {
        httpMethod: "POST",
        queryStringParameters: {
          signature: messagePushSignature(plain.token, plain.timestamp, plain.nonce),
          timestamp: plain.timestamp,
          nonce: plain.nonce
        },
        body: JSON.stringify({
          Event: "xpay_goods_deliver_notify",
          OpenId: order?.openId,
          OutTradeNo: order?.channelBizNo,
          ProductId: "test_android_fixture",
          ActualPrice: 9900,
          Env: 1,
          WeChatPayInfo: { TransactionId: "tx-late" }
        })
      },
      allowedAppIds,
      virtualPayNotify: { token: plain.token },
      orderStore: orders,
      vipStore: vip,
      now
    });
    expect(notify).toMatchObject({ vipGranted: false, needsReview: true, reason: "SOURCE_CONFLICT_REFUND_FIRST" });
    expect([...vip.grants.values()].some((row) => row.grantId === vipGrantId("order", order?.channelBizNo || ""))).toBe(false);

    await handleOfficial(
      memberCtx(req("refund.request", { orderId: prepared.data.keepB.orderB, reason: "partial" }), stores, vip, orders)
    );
    const partial = await handleOfficial(
      adminCtx(
        req("refund.execute", { orderId: prepared.data.keepB.orderB, amountFen: 100, reason: "partial" }, { idempotencyKey: "ex-p" }),
        orders,
        ["super"],
        { vipStore: vip }
      )
    );
    expect(partial).toMatchObject({ ok: true, data: { kind: "partial", state: "needsReview" } });
    const grantB = [...vip.grants.values()].find((row) => row.sourceId === orders.orders.get(prepared.data.keepB.orderB)?.channelBizNo);
    expect(grantB?.remainingSeconds).toBe(30 * day);
    await handleOfficial(
      memberCtx(req("refund.request", { orderId: prepared.data.keepB.orderA, reason: "dup" }), stores, vip, orders)
    );
    const firstExec = await handleOfficial(
      adminCtx(
        req("refund.execute", { orderId: prepared.data.keepB.orderA, amountFen: 9900, reason: "whole" }, { idempotencyKey: "ex-unknown" }),
        orders,
        ["super"],
        { vipStore: vip }
      )
    );
    expect(firstExec).toMatchObject({ ok: true, data: { state: "processing", unknownResult: true } });
    const refundCount = orders.refunds.size;
    const unknown = await handleOfficial(
      adminCtx(
        req("refund.execute", { orderId: prepared.data.keepB.orderA, amountFen: 9900, reason: "again" }, { idempotencyKey: "ex-unknown-2" }),
        orders,
        ["super"],
        { vipStore: vip }
      )
    );
    expect(unknown).toMatchObject({ ok: true, replayed: true, data: { state: "processing" } });
    expect(orders.refunds.size).toBe(refundCount);
    const diffs = (await handleOfficial(
      adminCtx(req("order.reconcile", {}), orders, ["operations"], { vipStore: vip })
    )) as { ok: true; data: { amountFenUnchanged: true; diffs: unknown[] } };
    expect(diffs.data.amountFenUnchanged).toBe(true);
  });
});

describe("MW22 notify-without-prior-request", () => {
  function refundNotify(
    orders: ReturnType<typeof memoryOrderStore>,
    vip: ReturnType<typeof memoryVipStore>,
    order: { openId?: string; channelBizNo?: string } | undefined,
    status: string,
    extra: Record<string, unknown> = {}
  ) {
    return handleOfficial({
      entry: "mw-pay-hook",
      event: {
        httpMethod: "POST",
        queryStringParameters: {
          signature: messagePushSignature(plain.token, plain.timestamp, plain.nonce),
          timestamp: plain.timestamp,
          nonce: plain.nonce
        },
        body: JSON.stringify({
          Event: "xpay_refund_notify",
          OpenId: order?.openId,
          OutTradeNo: order?.channelBizNo,
          RefundStatus: status,
          RefundFee: 9900,
          RefundId: extra.RefundId || `rf-${status}-${order?.channelBizNo || "x"}`
        })
      },
      allowedAppIds,
      virtualPayNotify: { token: plain.token },
      orderStore: orders,
      vipStore: vip,
      now
    });
  }

  it("does not insert a refunds document when channel notify arrives before refund.request", async () => {
    const orders = memoryOrderStore();
    const vip = memoryVipStore();
    const stores = memoryMemberBundle();
    const memberId = await register(stores, vip, orders);
    const prepared = await fixture(memberId, stores, vip, orders);
    expect(prepared.ok).toBe(true);
    const keepA = orders.orders.get(prepared.data.keepB.orderA);
    expect(orders.refunds.size).toBe(0);
    const processing = await refundNotify(orders, vip, keepA, "PROCESSING");
    expect(processing).toMatchObject({
      refundCreated: false,
      reason: "NO_PRIOR_REFUND_REQUEST",
      refundState: "none"
    });
    expect(orders.refunds.size).toBe(0);
    expect(orders.orders.get(prepared.data.keepB.orderA)?.refundState).toBe("none");
    const remainingBefore = [...vip.grants.values()].find(
      (row) => row.sourceId === keepA?.channelBizNo
    )?.remainingSeconds;
    const succeeded = await refundNotify(orders, vip, keepA, "SUCCESS");
    expect(succeeded).toMatchObject({
      refundCreated: false,
      reason: "CHANNEL_REFUND_BEFORE_REQUEST",
      refundState: "succeeded"
    });
    expect(orders.refunds.size).toBe(0);
    expect(orders.orders.get(prepared.data.keepB.orderA)?.refundState).toBe("succeeded");
    const remainingAfter = [...vip.grants.values()].find((row) => row.sourceId === keepA?.channelBizNo)?.remainingSeconds;
    expect(remainingAfter).toBe(0);
    expect(remainingBefore).toBe(10 * day);
    const again = await refundNotify(orders, vip, keepA, "SUCCESS", { RefundId: "rf-SUCCESS-dup" });
    expect(again).toMatchObject({
      refundCreated: false,
      replayed: true,
      reason: "CHANNEL_REFUND_BEFORE_REQUEST",
      revokedSeconds: 0
    });
    expect(orders.refunds.size).toBe(0);
    const backfill = (await handleOfficial(
      memberCtx(req("refund.request", { orderId: prepared.data.keepB.orderA, reason: "补单" }), stores, vip, orders)
    )) as { ok: true; data: { state: string; unknownResult: boolean; refundId: string } };
    expect(backfill).toMatchObject({
      ok: true,
      data: { state: "succeeded", unknownResult: false }
    });
    expect(orders.refunds.size).toBe(1);
    expect(orders.refunds.get(backfill.data.refundId)?.channelRef).toBe("channel-before-request");
    const grantB = [...vip.grants.values()].find(
      (row) => row.sourceId === orders.orders.get(prepared.data.keepB.orderB)?.channelBizNo
    );
    expect(grantB?.remainingSeconds).toBe(30 * day);
  });
});
