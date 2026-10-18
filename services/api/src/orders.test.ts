import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY_VERSIONS, durationSecondsFromDays, setMaintenanceGate, vipGrantId } from "@mw/shared";
import { handleOfficial, type AdminUserRecord, type OfficialContext } from "./official.js";
import { VIRTUAL_PAY_MESSAGE_PUSH_FIXTURES, messagePushSignature } from "./modules/virtual-pay-notify.js";
import { memoryMaintenanceStore } from "./modules/job-stores.js";
import { memoryMemberBundle, memoryPolicyStore } from "./modules/member-stores.js";
import { memoryVipStore } from "./modules/vip-stores.js";
import { memoryOrderStore } from "./modules/order-stores.js";
import type { VirtualPayRuntime } from "./modules/orders.js";

const allowedAppId = "wxmwallowedappid0001";
const allowedAppIds = [allowedAppId];
const now = new Date("2026-10-17T02:00:00.000Z");
const fromA = { fromAppId: allowedAppId, fromOpenId: "mw21_openid_a" };
const plain = VIRTUAL_PAY_MESSAGE_PUSH_FIXTURES.plainPost;

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
    async code2Session(code) {
      if (code === "bad") return { ok: false, reason: "WX_LOGIN_CODE_INVALID" };
      if (code === "other") return { ok: true, openid: "other_openid", sessionKey: "sess-other" };
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
    authUid: "uid_mw21_admin",
    orderStore: orders,
    vipStore: extra.vipStore,
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
        { idempotencyKey: "reg-mw21" }
      ),
      stores,
      vip,
      orders
    )
  )) as { ok: true; data: { memberId: string } };
  return res.data.memberId;
}

const planBody = {
  planId: "plan_test_30d",
  planVersion: 1,
  title: "30 天测试套餐",
  durationDays: 30,
  priceFen: 9900,
  productIds: { android: "test_android_30d" },
  channels: ["android"],
  testOnly: true,
  reason: "mw21 test plan"
};

describe("MW21 plans, orders and fulfillment", () => {
  it("rejects content publishing and freezes server price", async () => {
    const orders = memoryOrderStore();
    const content = await handleOfficial(
      adminCtx(req("plan.publish", planBody, { idempotencyKey: "p1" }), orders, ["content"])
    );
    expect(content).toMatchObject({ ok: false, error: { details: { reason: "SUPER_ROLE_REQUIRED" } } });
    const published = await handleOfficial(
      adminCtx(req("plan.publish", planBody, { idempotencyKey: "p2" }), orders, ["super"])
    );
    expect(published).toMatchObject({ ok: true, data: { planId: "plan_test_30d", enabled: true } });
    const stores = memoryMemberBundle();
    const vip = memoryVipStore();
    await register(stores, vip, orders);
    const listed = (await handleOfficial(memberCtx(req("vip.plans", { deviceInfo: { platform: "android" } }), stores, vip, orders))) as {
      ok: true;
      data: { plans: Array<{ priceFen: number }>; capability: { purchaseAvailable: boolean } };
    };
    expect(listed.ok).toBe(true);
    expect(listed.data.plans).toHaveLength(1);
    expect(listed.data.plans[0]?.priceFen).toBe(9900);
    expect(listed.data.capability.purchaseAvailable).toBe(true);
    const cheap = await handleOfficial(
      memberCtx(
        req("order.create", { planId: "plan_test_30d", planVersion: 1, clientChannel: "android", amountFen: 1 }, { idempotencyKey: "c1" }),
        stores,
        vip,
        orders
      )
    );
    expect(cheap).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    const created = (await handleOfficial(
      memberCtx(
        req("order.create", { planId: "plan_test_30d", planVersion: 1, clientChannel: "android" }, { idempotencyKey: "c2" }),
        stores,
        vip,
        orders
      )
    )) as { ok: true; data: { amountFen: number; payState: string; durationSeconds: number } };
    expect(created.data.amountFen).toBe(9900);
    expect(created.data.durationSeconds).toBe(durationSecondsFromDays(30));
    expect(created.data.payState).toBe("pending");
  });

  it("refuses live env, iOS sandbox, forged client success and mismatched session", async () => {
    const orders = memoryOrderStore();
    await handleOfficial(adminCtx(req("plan.publish", planBody, { idempotencyKey: "p3" }), orders, ["super"]));
    const stores = memoryMemberBundle();
    const vip = memoryVipStore();
    await register(stores, vip, orders);
    const ios = await handleOfficial(
      memberCtx(
        req("order.create", { planId: "plan_test_30d", planVersion: 1, clientChannel: "ios" }, { idempotencyKey: "ios" }),
        stores,
        vip,
        orders
      )
    );
    expect(ios).toMatchObject({ ok: false, error: { code: "PAYMENT_CHANNEL_UNAVAILABLE" } });
    const created = (await handleOfficial(
      memberCtx(
        req("order.create", { planId: "plan_test_30d", planVersion: 1, clientChannel: "android" }, { idempotencyKey: "c3" }),
        stores,
        vip,
        orders
      )
    )) as { ok: true; data: { orderId: string } };
    const fake = await handleOfficial(
      memberCtx(
        req("payment.prepare", { orderId: created.data.orderId, wxLoginCode: "ok", clientSuccess: true, env: 0 }),
        stores,
        vip,
        orders
      )
    );
    expect(fake).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    const mismatch = await handleOfficial(
      memberCtx(req("payment.prepare", { orderId: created.data.orderId, wxLoginCode: "other" }), stores, vip, orders)
    );
    expect(mismatch).toMatchObject({ ok: false, error: { details: { reason: "OPENID_MISMATCH" } } });
    const prepared = (await handleOfficial(
      memberCtx(req("payment.prepare", { orderId: created.data.orderId, wxLoginCode: "ok" }), stores, vip, orders)
    )) as { ok: true; data: Record<string, unknown> };
    expect(prepared.data.sessionKeyReturned).toBe(false);
    expect(prepared.data.session_key).toBeUndefined();
    expect(prepared.data.env).toBe(1);
    expect(prepared.data.goodsPrice).toBe(9900);
    expect(prepared.data.signature).toEqual(expect.any(String));
  });

  it("grants once from ten verified notifies and stacks two paid orders", async () => {
    const orders = memoryOrderStore();
    const vip = memoryVipStore();
    const stores = memoryMemberBundle();
    await handleOfficial(adminCtx(req("plan.publish", planBody, { idempotencyKey: "p4" }), orders, ["super"]));
    await register(stores, vip, orders);
    const first = (await handleOfficial(
      memberCtx(
        req("order.create", { planId: "plan_test_30d", planVersion: 1, clientChannel: "android" }, { idempotencyKey: "o1" }),
        stores,
        vip,
        orders
      )
    )) as { ok: true; data: { orderId: string; channelBizNo: string } };
    const second = (await handleOfficial(
      memberCtx(
        req("order.create", { planId: "plan_test_30d", planVersion: 1, clientChannel: "android" }, { idempotencyKey: "o2" }),
        stores,
        vip,
        orders
      )
    )) as { ok: true; data: { orderId: string; channelBizNo: string } };
    async function notify(bizNo: string, tx: string) {
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
            Event: "xpay_goods_deliver_notify",
            OpenId: fromA.fromOpenId,
            OutTradeNo: bizNo,
            ProductId: "test_android_30d",
            ActualPrice: 9900,
            Env: 1,
            WeChatPayInfo: { TransactionId: tx }
          })
        },
        allowedAppIds,
        virtualPayNotify: { token: plain.token },
        orderStore: orders,
        vipStore: vip,
        now
      });
    }
    const results = [];
    for (let i = 0; i < 10; i += 1) {
      results.push(await notify(first.data.channelBizNo, "tx-first"));
    }
    expect(results.every((row) => (row as { ErrCode: number }).ErrCode === 0)).toBe(true);
    expect(results.filter((row) => (row as { vipGranted: boolean }).vipGranted).length).toBeGreaterThan(0);
    const grants = [...vip.grants.values()].filter((row) => row.sourceType === "order");
    expect(grants).toHaveLength(1);
    expect(grants[0]?.grantId).toBe(vipGrantId("order", first.data.channelBizNo));
    await Promise.all([notify(first.data.channelBizNo, "tx-first"), notify(second.data.channelBizNo, "tx-second")]);
    const orderGrants = [...vip.grants.values()].filter((row) => row.sourceType === "order");
    expect(orderGrants).toHaveLength(2);
    const account = [...vip.accounts.values()][0];
    expect(account?.expiresAt).toBe("2026-12-16T02:00:00.000Z");
    const again = await notify(second.data.channelBizNo, "tx-second");
    expect(again).toMatchObject({ vipGranted: true, replayed: true });
    expect([...vip.grants.values()].filter((row) => row.sourceType === "order")).toHaveLength(2);
  });

  it("queries before close, refuses closing a paid order, and compensates the same order once", async () => {
    const orders = memoryOrderStore();
    const vip = memoryVipStore();
    const stores = memoryMemberBundle();
    await handleOfficial(adminCtx(req("plan.publish", planBody, { idempotencyKey: "p5" }), orders, ["super"]));
    await register(stores, vip, orders);
    const created = (await handleOfficial(
      memberCtx(
        req("order.create", { planId: "plan_test_30d", planVersion: 1, clientChannel: "android" }, { idempotencyKey: "o3" }),
        stores,
        vip,
        orders
      )
    )) as { ok: true; data: { orderId: string; channelBizNo: string } };
    const unpaid = await handleOfficial(
      memberCtx(req("order.close", { orderId: created.data.orderId, confirmed: true }), stores, vip, orders, {
        now: new Date(now.getTime() + 6000)
      })
    );
    expect(unpaid).toMatchObject({ ok: true, data: { payState: "closed" } });
    const paidCreate = (await handleOfficial(
      memberCtx(
        req("order.create", { planId: "plan_test_30d", planVersion: 1, clientChannel: "android" }, { idempotencyKey: "o4" }),
        stores,
        vip,
        orders
      )
    )) as { ok: true; data: { orderId: string; channelBizNo: string } };
    const pay = testPay({
      async queryOrder() {
        return {
          paid: true,
          unknown: false,
          channelBizNo: paidCreate.data.channelBizNo,
          transactionId: "tx-paid",
          amountFen: 9900,
          productId: "test_android_30d",
          openId: fromA.fromOpenId,
          environment: 1,
          status: 2
        };
      }
    });
    const closePaid = await handleOfficial(
      memberCtx(req("order.close", { orderId: paidCreate.data.orderId, confirmed: true }), stores, vip, orders, {
        virtualPay: pay,
        now: new Date(now.getTime() + 12000)
      })
    );
    expect(closePaid).toMatchObject({ ok: false, error: { details: { reason: "PAID_ORDER_NOT_CLOSABLE" } } });
    const later = new Date(now.getTime() + 18000);
    const again = await handleOfficial(
      memberCtx(req("order.refresh", { orderId: paidCreate.data.orderId }), stores, vip, orders, {
        virtualPay: pay,
        now: later
      })
    );
    expect(again).toMatchObject({ ok: true, data: { payState: "paid", grantState: "granted" } });
    expect([...vip.grants.values()].filter((row) => row.sourceId === paidCreate.data.channelBizNo)).toHaveLength(1);
  });

  it("keeps purchaseCreate off the notify path and does not add growth from a purchase", async () => {
    const orders = memoryOrderStore();
    const vip = memoryVipStore();
    const stores = memoryMemberBundle();
    const maintenance = memoryMaintenanceStore();
    const closed = setMaintenanceGate(await maintenance.get(), "purchaseCreate", { enabled: false, reason: "test", jobId: "j1" }, now);
    await maintenance.save(closed);
    await handleOfficial(adminCtx(req("plan.publish", planBody, { idempotencyKey: "p6" }), orders, ["super"]));
    const memberId = await register(stores, vip, orders);
    const createBlocked = await handleOfficial(
      memberCtx(
        req("order.create", { planId: "plan_test_30d", planVersion: 1, clientChannel: "android" }, { idempotencyKey: "blocked" }),
        stores,
        vip,
        orders,
        { maintenanceStore: maintenance }
      )
    );
    expect(createBlocked).toMatchObject({ ok: false, error: { code: "CONTENT_UPDATING" } });
    await maintenance.save(setMaintenanceGate(await maintenance.get(), "purchaseCreate", { enabled: true, reason: "", jobId: "" }, now));
    const created = (await handleOfficial(
      memberCtx(
        req("order.create", { planId: "plan_test_30d", planVersion: 1, clientChannel: "android" }, { idempotencyKey: "ok" }),
        stores,
        vip,
        orders
      )
    )) as { ok: true; data: { channelBizNo: string } };
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
          OpenId: fromA.fromOpenId,
          OutTradeNo: created.data.channelBizNo,
          ProductId: "test_android_30d",
          ActualPrice: 9900,
          Env: 1,
          WeChatPayInfo: { TransactionId: "tx-maint" }
        })
      },
      allowedAppIds,
      virtualPayNotify: { token: plain.token },
      orderStore: orders,
      vipStore: vip,
      maintenanceStore: memoryMaintenanceStore(
        setMaintenanceGate((await memoryMaintenanceStore().get()), "purchaseCreate", { enabled: false, reason: "x", jobId: "j2" }, now)
      ),
      now
    });
    expect(notify).toMatchObject({ ErrCode: 0, vipGranted: true });
    expect(stores.stats.get(memberId)?.totalScore || 0).toBe(0);
  });
});
