import { describe, expect, it } from "vitest";
import { XPAY_NOTIFY_PROVIDE_GOODS_URI, XPAY_QUERY_ORDER_URI } from "@mw/shared";
import {
  notifyProvideGoods,
  prepareNotifyProvideGoods,
  prepareQueryOrder,
  queryOrderUnknownSandbox,
  redactXpayOutcome
} from "./virtual-pay-xpay.js";

describe("xpay adapters", () => {
  it("prepares sandbox query_order and never selects client live env", () => {
    const prepared = prepareQueryOrder({
      configuredEnv: 1,
      sandboxAppKey: "sandbox-fixture-key",
      accessToken: "token-fixture",
      openid: "mw07b_unknown_openid",
      orderId: "mw07b_unknown_order"
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.env).toBe(1);
    expect(prepared.url).toContain(XPAY_QUERY_ORDER_URI);
    expect(prepared.url).toContain("pay_sig=");
    expect(JSON.parse(prepared.postBody)).toMatchObject({ env: 1, order_id: "mw07b_unknown_order" });
    expect(
      prepareQueryOrder({
        configuredEnv: 1,
        clientEnv: 0,
        sandboxAppKey: "sandbox-fixture-key",
        accessToken: "token-fixture",
        openid: "mw07b_unknown_openid",
        orderId: "mw07b_unknown_order"
      })
    ).toEqual({ ok: false, reason: "CLIENT_ENV_LIVE_DENIED" });
    expect(
      prepareQueryOrder({
        configuredEnv: 0,
        sandboxAppKey: "sandbox-fixture-key",
        liveAppKey: "live-fixture-key",
        accessToken: "token-fixture",
        openid: "mw07b_unknown_openid",
        orderId: "mw07b_unknown_order"
      })
    ).toEqual({ ok: false, reason: "LIVE_ENV_NOT_CALLED" });
  });

  it("treats official 268490003 as signature failure without writing docs", async () => {
    expect(redactXpayOutcome({ errcode: 268490003, errmsg: "sign error" }, 200)).toMatchObject({
      errcode: 268490003,
      signatureAccepted: false,
      authPathReached: true
    });
    const queried = await queryOrderUnknownSandbox({
      configuredEnv: 1,
      sandboxAppKey: "sandbox-fixture-key",
      accessToken: "token-fixture",
      openid: "mw07b_unknown_openid",
      orderId: "mw07b_unknown_order",
      transport: {
        async postJson() {
          return { status: 200, json: { errcode: 268490001, errmsg: "openid error" } };
        }
      }
    });
    expect(queried).toMatchObject({
      ok: true,
      env: 1,
      wroteDocs: false,
      outcome: { errcode: 268490001, signatureAccepted: true }
    });
  });

  it("does not confirm shipment on an unauthorized order", async () => {
    expect(
      prepareNotifyProvideGoods({
        configuredEnv: 1,
        sandboxAppKey: "sandbox-fixture-key",
        accessToken: "token-fixture",
        orderId: "mw07b_unknown_order",
        allowConfirm: false
      })
    ).toEqual({ ok: false, reason: "CONFIRM_NOT_AUTHORIZED" });

    const denied = await notifyProvideGoods({
      configuredEnv: 1,
      sandboxAppKey: "sandbox-fixture-key",
      accessToken: "token-fixture",
      orderId: "mw07b_unknown_order",
      allowConfirm: false,
      transport: {
        async postJson() {
          throw new Error("must not send notify_provide_goods");
        }
      }
    });
    expect(denied).toEqual({ sent: false, reason: "CONFIRM_NOT_AUTHORIZED", wroteDocs: false });

    const prepared = prepareNotifyProvideGoods({
      configuredEnv: 1,
      sandboxAppKey: "sandbox-fixture-key",
      accessToken: "token-fixture",
      orderId: "mw07b_unknown_order",
      allowConfirm: true
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.url).toContain(XPAY_NOTIFY_PROVIDE_GOODS_URI);
    const negative = await notifyProvideGoods({
      configuredEnv: 1,
      sandboxAppKey: "sandbox-fixture-key",
      accessToken: "token-fixture",
      orderId: "mw07b_unknown_order",
      allowConfirm: true,
      transport: {
        async postJson() {
          return { status: 200, json: { errcode: 268490002, errmsg: "invalid order" } };
        }
      }
    });
    expect(negative).toMatchObject({
      sent: true,
      wroteDocs: false,
      outcome: { errcode: 268490002, signatureAccepted: true }
    });
  });
});
