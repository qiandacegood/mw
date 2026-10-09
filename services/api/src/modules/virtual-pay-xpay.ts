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
