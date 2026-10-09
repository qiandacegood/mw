import { describe, expect, it } from "vitest";
import {
  VIRTUAL_PAY_BUY_QUANTITY,
  VIRTUAL_PAY_OFFICIAL_APP_KEY,
  VIRTUAL_PAY_OFFICIAL_PAY_SIG,
  VIRTUAL_PAY_OFFICIAL_POST_BODY,
  VIRTUAL_PAY_OFFICIAL_QUERY_USER_BALANCE_URI,
  VIRTUAL_PAY_OFFICIAL_SESSION_KEY,
  VIRTUAL_PAY_OFFICIAL_SIGNATURE,
  VIRTUAL_PAY_REQUEST_URI,
  appKeyForEnv,
  buildGoodsSignData,
  buildNotifyProvideGoodsBody,
  buildQueryOrderBody,
  buildXpaySignedRequest,
  calcPaySig,
  calcUserSignature,
  resolveVirtualPayEnv,
  verifyPaySig,
  verifyUserSignature
} from "./virtual-pay.js";

describe("virtual pay signatures", () => {
  it("matches the official pay_sig and signature test vectors", () => {
    expect(
      calcPaySig(
        VIRTUAL_PAY_OFFICIAL_QUERY_USER_BALANCE_URI,
        VIRTUAL_PAY_OFFICIAL_POST_BODY,
        VIRTUAL_PAY_OFFICIAL_APP_KEY
      )
    ).toBe(VIRTUAL_PAY_OFFICIAL_PAY_SIG);
    expect(
      calcUserSignature(VIRTUAL_PAY_OFFICIAL_POST_BODY, VIRTUAL_PAY_OFFICIAL_SESSION_KEY)
    ).toBe(VIRTUAL_PAY_OFFICIAL_SIGNATURE);
    expect(
      verifyPaySig(
        VIRTUAL_PAY_OFFICIAL_QUERY_USER_BALANCE_URI,
        VIRTUAL_PAY_OFFICIAL_POST_BODY,
        VIRTUAL_PAY_OFFICIAL_APP_KEY,
        VIRTUAL_PAY_OFFICIAL_PAY_SIG
      )
    ).toBe(true);
    expect(
      verifyUserSignature(
        VIRTUAL_PAY_OFFICIAL_POST_BODY,
        VIRTUAL_PAY_OFFICIAL_SESSION_KEY,
        VIRTUAL_PAY_OFFICIAL_SIGNATURE
      )
    ).toBe(true);
  });

  it("rejects a tampered pay_sig", () => {
    expect(
      verifyPaySig(
        VIRTUAL_PAY_OFFICIAL_QUERY_USER_BALANCE_URI,
        VIRTUAL_PAY_OFFICIAL_POST_BODY,
        VIRTUAL_PAY_OFFICIAL_APP_KEY,
        "0".repeat(64)
      )
    ).toBe(false);
  });

  it("signs requestVirtualPayment with quantity 1 and fen amounts", () => {
    const built = buildGoodsSignData({
      offerId: "123",
      env: 1,
      productId: "testproductId",
      goodsPriceFen: 10,
      outTradeNo: "xxxxxx",
      attach: "testdata"
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const parsed = JSON.parse(built.signData) as { buyQuantity: number; goodsPrice: number; env: number };
    expect(parsed.buyQuantity).toBe(VIRTUAL_PAY_BUY_QUANTITY);
    expect(parsed.goodsPrice).toBe(10);
    expect(parsed.env).toBe(1);
    const paySig = calcPaySig(VIRTUAL_PAY_REQUEST_URI, built.signData, VIRTUAL_PAY_OFFICIAL_APP_KEY);
    expect(paySig).toHaveLength(64);
    expect(verifyPaySig(VIRTUAL_PAY_REQUEST_URI, built.signData, VIRTUAL_PAY_OFFICIAL_APP_KEY, paySig)).toBe(true);
  });

  it("rejects non-integer fen amounts", () => {
    const built = buildGoodsSignData({
      offerId: "123",
      env: 1,
      productId: "testproductId",
      goodsPriceFen: 10.5,
      outTradeNo: "xxxxxx",
      attach: "testdata"
    });
    expect(built).toEqual({ ok: false, reason: "AMOUNT_MUST_BE_FEN_INTEGER" });
  });
});

describe("virtual pay env selection", () => {
  it("uses server config and rejects client live env", () => {
    expect(resolveVirtualPayEnv({ configuredEnv: 1 })).toEqual({ ok: true, env: 1, source: "server" });
    expect(resolveVirtualPayEnv({ configuredEnv: "1", clientEnv: 1 })).toEqual({
      ok: true,
      env: 1,
      source: "server"
    });
    expect(resolveVirtualPayEnv({ configuredEnv: 1, clientEnv: 0 })).toEqual({
      ok: false,
      reason: "CLIENT_ENV_LIVE_DENIED"
    });
    expect(resolveVirtualPayEnv({ configuredEnv: 0, clientEnv: "0" })).toEqual({
      ok: false,
      reason: "CLIENT_ENV_LIVE_DENIED"
    });
    expect(resolveVirtualPayEnv({ configuredEnv: "sandbox-placeholder" })).toEqual({
      ok: false,
      reason: "INVALID_SERVER_ENV"
    });
  });

  it("keeps live AppKey path but does not select it this round", () => {
    expect(appKeyForEnv(1, { sandbox: "sandbox-fixture", live: "live-fixture" })).toEqual({
      ok: true,
      appKey: "sandbox-fixture"
    });
    expect(appKeyForEnv(0, { sandbox: "sandbox-fixture", live: "live-fixture" })).toEqual({
      ok: false,
      reason: "LIVE_KEY_NOT_USED"
    });
  });
});

describe("xpay request builders", () => {
  it("builds query_order and notify_provide_goods bodies without calling the network", () => {
    const queryBody = buildQueryOrderBody({
      openid: "mw07b_unknown_openid",
      env: 1,
      orderId: "mw07b_unknown_order"
    });
    expect(JSON.parse(queryBody)).toEqual({
      openid: "mw07b_unknown_openid",
      env: 1,
      order_id: "mw07b_unknown_order"
    });
    const signed = buildXpaySignedRequest({
      uri: "/xpay/query_order",
      postBody: queryBody,
      appKey: VIRTUAL_PAY_OFFICIAL_APP_KEY,
      accessToken: "ACCESS_TOKEN_FIXTURE"
    });
    expect(signed.url).toContain("/xpay/query_order?");
    expect(signed.url).toContain("pay_sig=");
    expect(signed.url).not.toContain("refund_order");
    const notify = buildNotifyProvideGoodsBody({ env: 1, orderId: "mw07b_unknown_order" });
    expect(notify.ok).toBe(true);
  });
});
