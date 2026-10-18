import {
  XPAY_NOTIFY_PROVIDE_GOODS_URI,
  XPAY_QUERY_ORDER_URI,
  appKeyForEnv,
  buildNotifyProvideGoodsBody,
  buildQueryOrderBody,
  buildXpaySignedRequest,
  resolveVirtualPayEnv,
  type VirtualPayEnv
} from "@mw/shared";

export interface XpayHttpResponse {
  errcode?: number;
  errmsgPresent: boolean;
}

export interface XpayTransport {
  postJson(url: string, body: string): Promise<{ status: number; json: Record<string, unknown> }>;
}

export function redactXpayOutcome(json: Record<string, unknown>, status: number): XpayHttpResponse & {
  authPathReached: boolean;
  signatureAccepted: boolean | "unknown";
} {
  const errcode = typeof json.errcode === "number" ? json.errcode : status >= 400 ? status : undefined;
  const errmsgPresent = typeof json.errmsg === "string" && json.errmsg.length > 0;
  const signatureRejected = errcode === 268490003;
  const tokenRejected = errcode === 40001 || errcode === 40125 || errcode === 41001 || errcode === 40013;
  return {
    errcode,
    errmsgPresent,
    authPathReached: errcode !== undefined && !tokenRejected,
    signatureAccepted: signatureRejected ? false : tokenRejected ? "unknown" : errcode !== undefined
  };
}

export function prepareQueryOrder(input: {
  configuredEnv: unknown;
  clientEnv?: unknown;
  sandboxAppKey: string;
  liveAppKey?: string;
  accessToken: string;
  openid: string;
  orderId?: string;
  wxOrderId?: string;
}):
  | { ok: true; env: VirtualPayEnv; url: string; postBody: string }
  | { ok: false; reason: string } {
  const env = resolveVirtualPayEnv({ configuredEnv: input.configuredEnv, clientEnv: input.clientEnv });
  if (!env.ok) return env;
  if (env.env === 0) return { ok: false, reason: "LIVE_ENV_NOT_CALLED" };
  const key = appKeyForEnv(env.env, { sandbox: input.sandboxAppKey, live: input.liveAppKey });
  if (!key.ok) return key;
  if (!input.accessToken) return { ok: false, reason: "ACCESS_TOKEN_MISSING" };
  const postBody = buildQueryOrderBody({
    openid: input.openid,
    env: env.env,
    orderId: input.orderId,
    wxOrderId: input.wxOrderId
  });
  const signed = buildXpaySignedRequest({
    uri: XPAY_QUERY_ORDER_URI,
    postBody,
    appKey: key.appKey,
    accessToken: input.accessToken
  });
  return { ok: true, env: env.env, url: signed.url, postBody: signed.postBody };
}

export async function queryOrderUnknownSandbox(
  input: Parameters<typeof prepareQueryOrder>[0] & { transport: XpayTransport }
): Promise<
  | { ok: true; env: 1; outcome: ReturnType<typeof redactXpayOutcome>; wroteDocs: false }
  | { ok: false; reason: string; wroteDocs: false }
> {
  const prepared = prepareQueryOrder(input);
  if (!prepared.ok) return { ok: false, reason: prepared.reason, wroteDocs: false };
  const response = await input.transport.postJson(prepared.url, prepared.postBody);
  return {
    ok: true,
    env: 1,
    outcome: redactXpayOutcome(response.json, response.status),
    wroteDocs: false
  };
}

export function prepareNotifyProvideGoods(input: {
  configuredEnv: unknown;
  clientEnv?: unknown;
  sandboxAppKey: string;
  liveAppKey?: string;
  accessToken: string;
  orderId?: string;
  wxOrderId?: string;
  allowConfirm: boolean;
}):
  | { ok: true; env: VirtualPayEnv; url: string; postBody: string }
  | { ok: false; reason: string } {
  if (input.allowConfirm !== true) {
    return { ok: false, reason: "CONFIRM_NOT_AUTHORIZED" };
  }
  const env = resolveVirtualPayEnv({ configuredEnv: input.configuredEnv, clientEnv: input.clientEnv });
  if (!env.ok) return env;
  if (env.env === 0) return { ok: false, reason: "LIVE_ENV_NOT_CALLED" };
  const key = appKeyForEnv(env.env, { sandbox: input.sandboxAppKey, live: input.liveAppKey });
  if (!key.ok) return key;
  const body = buildNotifyProvideGoodsBody({
    env: env.env,
    orderId: input.orderId,
    wxOrderId: input.wxOrderId
  });
  if (!body.ok) return body;
  const signed = buildXpaySignedRequest({
    uri: XPAY_NOTIFY_PROVIDE_GOODS_URI,
    postBody: body.body,
    appKey: key.appKey,
    accessToken: input.accessToken
  });
  return { ok: true, env: env.env, url: signed.url, postBody: signed.postBody };
}

function nestedOrder(json: Record<string, unknown>): Record<string, unknown> {
  const order = json.order;
  if (order && typeof order === "object" && !Array.isArray(order)) return order as Record<string, unknown>;
  return json;
}

function intField(rec: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "number" && Number.isInteger(value)) return value;
    if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  }
  return undefined;
}

function textField(rec: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export type XpayQueryParse = {
  paid: boolean;
  unknown: boolean;
  channelBizNo?: string;
  transactionId?: string;
  amountFen?: number;
  productId?: string;
  openId?: string;
  environment?: 0 | 1;
  paidAt?: string;
  status?: number;
};

export function parseXpayQueryResult(json: Record<string, unknown>): XpayQueryParse {
  const errcode = typeof json.errcode === "number" ? json.errcode : 0;
  if (errcode && errcode !== 0) {
    return { paid: false, unknown: true, status: errcode };
  }
  const order = nestedOrder(json);
  const status = intField(order, ["status", "Status"]);
  const channelBizNo = textField(order, ["order_id", "orderId", "OutTradeNo", "out_trade_no"]);
  const transactionId = textField(order, ["wx_order_id", "wxOrderId", "TransactionId", "transaction_id"]);
  const amountFen = intField(order, ["order_fee", "actual_price", "ActualPrice", "goods_price", "product_price"]);
  const productId = textField(order, ["product_id", "productId", "ProductId"]);
  const openId = textField(order, ["openid", "OpenId", "open_id"]);
  const envRaw = intField(order, ["env", "Env"]);
  const environment = envRaw === 0 || envRaw === 1 ? envRaw : undefined;
  const paidAt = textField(order, ["paid_time", "PaidTime", "pay_time"]);
  const paid = status === 2 || status === 3;
  return {
    paid,
    unknown: status === undefined,
    channelBizNo,
    transactionId,
    amountFen,
    productId,
    openId,
    environment,
    paidAt,
    status
  };
}

export async function notifyProvideGoods(
  input: Parameters<typeof prepareNotifyProvideGoods>[0] & { transport: XpayTransport }
): Promise<{ sent: false; reason: string; wroteDocs: false } | { sent: true; outcome: ReturnType<typeof redactXpayOutcome>; wroteDocs: false }> {
  const prepared = prepareNotifyProvideGoods(input);
  if (!prepared.ok) {
    return { sent: false, reason: prepared.reason, wroteDocs: false };
  }
  const response = await input.transport.postJson(prepared.url, prepared.postBody);
  return { sent: true, outcome: redactXpayOutcome(response.json, response.status), wroteDocs: false };
}
