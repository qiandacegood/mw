import { describe, expect, it } from "vitest";
import { applyVipGrant, durationSecondsFromDays, vipGrantId } from "./vip.js";
import {
  canTransitionPayState,
  capabilityHints,
  clientFulfillmentRejected,
  freezePlanSnapshot,
  matchPaymentEvidence,
  newOrderRecord,
  orderDisplayStatus,
  orderDocId,
  parseOrderCreateInput,
  parsePaymentPrepareInput,
  parsePlanPublishInput,
  paymentReceiptId,
  resolveServerPayEnv,
  type VipPlanRecord
} from "./vip-purchase.js";

const now = new Date("2026-10-17T02:00:00.000Z");

function plan(partial: Partial<VipPlanRecord> = {}): VipPlanRecord {
  return {
    planId: "plan_test_30d",
    planVersion: 1,
    title: "30 天测试套餐",
    durationDays: 30,
    durationSeconds: durationSecondsFromDays(30),
    priceFen: 9900,
    productIds: { android: "test_android_30d", windows: "test_windows_30d" },
    channels: ["android", "windows"],
    enabled: true,
    testOnly: true,
    sort: 10,
    priceNote: "TEST_PRICE",
    schemaVersion: 1,
    publishedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...partial
  };
}

describe("vip purchase freeze and env", () => {
  it("freezes server price/days/channel and rejects a live client env", () => {
    const frozen = freezePlanSnapshot({ plan: plan(), channel: "android", environment: 1 });
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    expect(frozen.snapshot.priceFen).toBe(9900);
    expect(frozen.snapshot.durationSeconds).toBe(2592000);
    expect(frozen.snapshot.productId).toBe("test_android_30d");
    expect(resolveServerPayEnv(1, 0)).toMatchObject({ ok: false, reason: "CLIENT_ENV_LIVE_DENIED" });
    expect(resolveServerPayEnv(1)).toMatchObject({ ok: true, env: 1 });
    expect(parseOrderCreateInput({ planId: "plan_test_30d", planVersion: 1, clientChannel: "android", amountFen: 1 }).ok).toBe(
      false
    );
    expect(parsePaymentPrepareInput({ orderId: "o1", wxLoginCode: "code", env: 0 }).ok).toBe(false);
    expect(clientFulfillmentRejected({ clientSuccess: true, paid: true })).toEqual(["paid", "clientSuccess"]);
  });

  it("blocks iOS in sandbox and does not treat device claims as entitlement", () => {
    expect(capabilityHints({ channel: "ios", environment: 1 }).purchaseAvailable).toBe(false);
    expect(capabilityHints({ channel: "android", environment: 1, device: { platform: "ios" } }).purchaseAvailable).toBe(
      false
    );
    expect(capabilityHints({ channel: "android", environment: 1 }).purchaseAvailable).toBe(true);
  });
});

describe("order paid/grant display and close rules", () => {
  it("maps the three status dimensions and refuses closing a paid order", () => {
    const frozen = freezePlanSnapshot({ plan: plan(), channel: "android", environment: 1 });
    if (!frozen.ok) return;
    const order = newOrderRecord({
      channelBizNo: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      memberId: "m1",
      openId: "oid",
      snapshot: frozen.snapshot,
      now
    });
    expect(order.orderId).toBe(orderDocId(order.channelBizNo));
    expect(orderDisplayStatus(order).displayStatus).toBe("待支付");
    expect(canTransitionPayState("pending", "closed")).toBe(true);
    expect(canTransitionPayState("paid", "closed")).toBe(false);
    expect(orderDisplayStatus({ ...order, payState: "paid", grantState: "pending" }).userHint).toBe("已支付，权益开通中");
    expect(orderDisplayStatus({ ...order, payState: "paid", grantState: "granted" }).displayStatus).toBe("已完成");
  });

  it("sends amount/user/product mismatches to needsReview", () => {
    const frozen = freezePlanSnapshot({ plan: plan(), channel: "android", environment: 1 });
    if (!frozen.ok) return;
    const order = newOrderRecord({
      channelBizNo: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      memberId: "m1",
      openId: "oid-real",
      snapshot: frozen.snapshot,
      now
    });
    const base = {
      source: "notify" as const,
      channelBizNo: order.channelBizNo,
      transactionId: "wx_tx_1",
      amountFen: 9900,
      productId: "test_android_30d",
      openId: "oid-real",
      environment: 1 as const,
      paid: true,
      eventKey: "ev1"
    };
    expect(matchPaymentEvidence(order, { ...base, amountFen: 1 })).toMatchObject({
      ok: false,
      reason: "AMOUNT_MISMATCH",
      needsReview: true
    });
    expect(matchPaymentEvidence(order, { ...base, openId: "other" })).toMatchObject({ reason: "USER_MISMATCH" });
    expect(matchPaymentEvidence(order, { ...base, productId: "other" })).toMatchObject({ reason: "PRODUCT_MISMATCH" });
    expect(matchPaymentEvidence(order, { ...base, environment: 0 })).toMatchObject({ reason: "ENV_MISMATCH" });
    expect(matchPaymentEvidence(order, base)).toEqual({ ok: true });
    expect(paymentReceiptId("wechat_virtual_pay", 1, "wx_tx_1")).toHaveLength(64);
  });
});

describe("order source grant onto the MW20 ledger", () => {
  it("creates one grant per order business number and replays without extending", () => {
    const first = applyVipGrant({
      account: undefined,
      grants: [],
      memberId: "m1",
      sourceType: "order",
      sourceId: "biz-1",
      durationSeconds: durationSecondsFromDays(30),
      grantedAt: now,
      reason: "paid-order:biz-1",
      actorId: "system"
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.grant.grantId).toBe(vipGrantId("order", "biz-1"));
    expect(first.account.expiresAt).toBe("2026-11-16T02:00:00.000Z");
    const replay = applyVipGrant({
      account: first.account,
      grants: first.grants,
      memberId: "m1",
      sourceType: "order",
      sourceId: "biz-1",
      durationSeconds: durationSecondsFromDays(30),
      grantedAt: new Date("2026-10-17T03:00:00.000Z"),
      reason: "paid-order:biz-1",
      actorId: "system"
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.replayed).toBe(true);
    expect(replay.account.expiresAt).toBe(first.account.expiresAt);
    const second = applyVipGrant({
      account: first.account,
      grants: first.grants,
      memberId: "m1",
      sourceType: "order",
      sourceId: "biz-2",
      durationSeconds: durationSecondsFromDays(30),
      grantedAt: new Date("2026-10-20T02:00:00.000Z"),
      reason: "paid-order:biz-2",
      actorId: "system"
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.grants).toHaveLength(2);
    expect(second.account.expiresAt).toBe("2026-12-16T02:00:00.000Z");
  });
});

describe("plan publish input", () => {
  it("requires platform goods, days and fen to match, and forces testOnly", () => {
    const ok = parsePlanPublishInput({
      planId: "plan_test_30d",
      planVersion: 1,
      title: "30 天测试套餐",
      durationDays: 30,
      priceFen: 9900,
      productIds: { android: "test_android_30d" },
      channels: ["android"],
      testOnly: true,
      reason: "mw21 test plan"
    });
    expect(ok.ok).toBe(true);
    expect(
      parsePlanPublishInput({
        planId: "plan_test_30d",
        planVersion: 1,
        title: "30 天",
        durationDays: 30,
        durationSeconds: 10,
        priceFen: 9900,
        productIds: { android: "x" },
        channels: ["android"],
        testOnly: true,
        reason: "x"
      }).ok
    ).toBe(false);
    expect(
      parsePlanPublishInput({
        planId: "plan_test_30d",
        planVersion: 1,
        title: "30 天",
        durationDays: 30,
        priceFen: 9900,
        productIds: { android: "x" },
        channels: ["android"],
        testOnly: false,
        reason: "x"
      }).ok
    ).toBe(false);
  });
});
