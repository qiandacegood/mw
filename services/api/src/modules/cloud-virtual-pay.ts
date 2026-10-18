import {
  prepareNotifyProvideGoods,
  prepareQueryOrder,
  parseXpayQueryResult,
  type XpayQueryParse
} from "./virtual-pay-xpay.js";
import { exchangeJsCode, readAccessToken } from "./wechat-session.js";
import type { VirtualPayRuntime } from "./orders.js";

async function postJson(url: string, body: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

export function cloudVirtualPayRuntime(): VirtualPayRuntime | undefined {
  const offerId = process.env.VIRTUAL_PAY_OFFER_ID || "";
  const sandboxAppKey = process.env.VIRTUAL_PAY_APP_KEY || "";
  const appId = process.env.WECHAT_APP_ID || "";
  const appSecret = process.env.WECHAT_APP_SECRET || "";
  if (!offerId || !sandboxAppKey || !appId) return undefined;
  return {
    offerId,
    configuredEnv: process.env.VIRTUAL_PAY_ENV,
    sandboxAppKey,
    appId,
    appSecret,
    async code2Session(code) {
      return exchangeJsCode({ appId, appSecret, code });
    },
    async queryOrder(input): Promise<XpayQueryParse> {
      const token = await readAccessToken({ appId, appSecret });
      if (!token.ok) return { paid: false, unknown: true };
      const prepared = prepareQueryOrder({
        configuredEnv: process.env.VIRTUAL_PAY_ENV,
        sandboxAppKey,
        accessToken: token.accessToken,
        openid: input.openid,
        orderId: input.orderId
      });
      if (!prepared.ok) return { paid: false, unknown: true };
      const response = await postJson(prepared.url, prepared.postBody);
      return parseXpayQueryResult(response.json);
    },
    async notifyProvideGoods(input) {
      const token = await readAccessToken({ appId, appSecret });
      if (!token.ok) return { sent: false, reason: token.reason };
      const prepared = prepareNotifyProvideGoods({
        configuredEnv: process.env.VIRTUAL_PAY_ENV,
        sandboxAppKey,
        accessToken: token.accessToken,
        orderId: input.orderId,
        wxOrderId: input.wxOrderId,
        allowConfirm: true
      });
      if (!prepared.ok) return { sent: false, reason: prepared.reason };
      await postJson(prepared.url, prepared.postBody);
      return { sent: true };
    }
  };
}
