import { hmacSha256Hex } from "./jobs-invoke.js";

export const VIRTUAL_PAY_BUY_QUANTITY = 1;
export const VIRTUAL_PAY_CURRENCY = "CNY";
export const VIRTUAL_PAY_REQUEST_URI = "requestVirtualPayment";
export const XPAY_QUERY_ORDER_URI = "/xpay/query_order";
export const XPAY_NOTIFY_PROVIDE_GOODS_URI = "/xpay/notify_provide_goods";
export const XPAY_REFUND_ORDER_URI = "/xpay/refund_order";

export const VIRTUAL_PAY_OFFICIAL_QUERY_USER_BALANCE_URI = "/xpay/query_user_balance";
export const VIRTUAL_PAY_OFFICIAL_POST_BODY =
  '{"openid": "xxx", "user_ip": "127.0.0.1", "env": 0}';
export const VIRTUAL_PAY_OFFICIAL_APP_KEY = "12345";
export const VIRTUAL_PAY_OFFICIAL_SESSION_KEY = "9hAb/NEYUlkaMBEsmFgzig==";
export const VIRTUAL_PAY_OFFICIAL_PAY_SIG =
  "c37809f27c6d7fd1837ad2500a04512b66b34fd793a39a385fade56dca89a4b5";
export const VIRTUAL_PAY_OFFICIAL_SIGNATURE =
  "089d9e8dc5d308977360c4b79ec600a93d736802802a807d634192328032f6c7";

export type VirtualPayEnv = 0 | 1;

export function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

export function calcPaySig(uri: string, signData: string, appKey: string): string {
  return hmacSha256Hex(appKey, `${uri}&${signData}`);
}

export function calcUserSignature(signData: string, sessionKey: string): string {
  return hmacSha256Hex(sessionKey, signData);
}

export function verifyPaySig(uri: string, signData: string, appKey: string, paySig: string): boolean {
  return timingSafeEqualHex(calcPaySig(uri, signData, appKey), paySig);
}

export function verifyUserSignature(signData: string, sessionKey: string, signature: string): boolean {
  return timingSafeEqualHex(calcUserSignature(signData, sessionKey), signature);
}

export function parseVirtualPayEnv(value: unknown): VirtualPayEnv | undefined {
  if (value === 0 || value === "0") return 0;
  if (value === 1 || value === "1") return 1;
  return undefined;
}

export function resolveVirtualPayEnv(input: {
  configuredEnv: unknown;
  clientEnv?: unknown;
}): { ok: true; env: VirtualPayEnv; source: "server" } | { ok: false; reason: "CLIENT_ENV_LIVE_DENIED" | "INVALID_SERVER_ENV" } {
  if (input.clientEnv !== undefined && input.clientEnv !== null && input.clientEnv !== "") {
    const clientEnv = parseVirtualPayEnv(input.clientEnv);
    if (clientEnv === 0) {
      return { ok: false, reason: "CLIENT_ENV_LIVE_DENIED" };
    }
  }
  const env = parseVirtualPayEnv(input.configuredEnv);
  if (env === undefined) {
    return { ok: false, reason: "INVALID_SERVER_ENV" };
  }
  return { ok: true, env, source: "server" };
}

export function appKeyForEnv(
  env: VirtualPayEnv,
  keys: { sandbox: string; live?: string }
): { ok: true; appKey: string } | { ok: false; reason: "LIVE_KEY_NOT_USED" | "SANDBOX_KEY_MISSING" } {
  if (env === 1) {
    if (!keys.sandbox) return { ok: false, reason: "SANDBOX_KEY_MISSING" };
    return { ok: true, appKey: keys.sandbox };
  }
  return { ok: false, reason: "LIVE_KEY_NOT_USED" };
}

export function buildGoodsSignData(input: {
  offerId: string;
  env: VirtualPayEnv;
  productId: string;
  goodsPriceFen: number;
  outTradeNo: string;
  attach: string;
  activitySellingPriceFen?: number;
}): { ok: true; signData: string } | { ok: false; reason: string } {
  if (!input.offerId || !input.productId || !input.outTradeNo) {
    return { ok: false, reason: "SIGN_DATA_FIELDS_REQUIRED" };
  }
  if (!Number.isInteger(input.goodsPriceFen) || input.goodsPriceFen < 0) {
    return { ok: false, reason: "AMOUNT_MUST_BE_FEN_INTEGER" };
  }
  if (
    input.activitySellingPriceFen !== undefined &&
    (!Number.isInteger(input.activitySellingPriceFen) || input.activitySellingPriceFen < 0)
  ) {
    return { ok: false, reason: "AMOUNT_MUST_BE_FEN_INTEGER" };
  }
  const payload: Record<string, unknown> = {
    offerId: input.offerId,
    buyQuantity: VIRTUAL_PAY_BUY_QUANTITY,
    env: input.env,
    currencyType: VIRTUAL_PAY_CURRENCY,
    productId: input.productId,
    goodsPrice: input.goodsPriceFen,
    outTradeNo: input.outTradeNo,
    attach: input.attach
  };
  if (input.activitySellingPriceFen !== undefined) {
    payload.activitySellingPrice = input.activitySellingPriceFen;
  }
  return { ok: true, signData: JSON.stringify(payload) };
}

export function buildXpayPostBody(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

export function buildQueryOrderBody(input: {
  openid: string;
  env: VirtualPayEnv;
  orderId?: string;
  wxOrderId?: string;
}): string {
  const body: Record<string, unknown> = {
    openid: input.openid,
    env: input.env
  };
  if (input.orderId) body.order_id = input.orderId;
  if (input.wxOrderId) body.wx_order_id = input.wxOrderId;
  return buildXpayPostBody(body);
}

export function buildNotifyProvideGoodsBody(input: {
  env: VirtualPayEnv;
  orderId?: string;
  wxOrderId?: string;
}): { ok: true; body: string } | { ok: false; reason: "ORDER_ID_REQUIRED" } {
  if (!input.orderId && !input.wxOrderId) {
    return { ok: false, reason: "ORDER_ID_REQUIRED" };
  }
  const body: Record<string, unknown> = { env: input.env };
  if (input.orderId) body.order_id = input.orderId;
  if (input.wxOrderId) body.wx_order_id = input.wxOrderId;
  return { ok: true, body: buildXpayPostBody(body) };
}

export function buildXpaySignedRequest(input: {
  uri: string;
  postBody: string;
  appKey: string;
  accessToken: string;
}): { url: string; paySig: string; postBody: string } {
  const paySig = calcPaySig(input.uri, input.postBody, input.appKey);
  return {
    url: `https://api.weixin.qq.com${input.uri}?access_token=${encodeURIComponent(input.accessToken)}&pay_sig=${encodeURIComponent(paySig)}`,
    paySig,
    postBody: input.postBody
  };
}
