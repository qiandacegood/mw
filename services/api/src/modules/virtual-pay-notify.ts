import { createDecipheriv, createHash } from "node:crypto";

export const VIRTUAL_PAY_EVENTS = [
  "xpay_goods_deliver_notify",
  "xpay_coin_pay_notify",
  "xpay_refund_notify",
  "xpay_complaint_notify",
  "xpay_wxpay_callback_notify",
  "xpay_subscribe_ios_refund_query_notify"
] as const;

export type VirtualPayEventType = (typeof VIRTUAL_PAY_EVENTS)[number];

export interface VirtualPayNotifyConfig {
  token?: string;
  encodingAesKey?: string;
  appId?: string;
}

export interface VirtualPayNotifyResult {
  ok: boolean;
  reason: string;
  ErrCode: number;
  ErrMsg: string;
  eventType?: string;
  vipGranted: false;
  protocol: "virtual-pay-message-push";
}

const OFFICIAL_URL_VERIFY = {
  token: "AAAAA",
  timestamp: "1714036504",
  nonce: "1514711492",
  signature: "f464b24fc39322e44b38aa78f5edd27bd1441696",
  echostr: "4375120948345356249"
};

const OFFICIAL_PLAIN_POST = {
  token: "AAAAA",
  timestamp: "1714037059",
  nonce: "486452656",
  signature: "899cf89e464efb63f54ddac96b0a0a235f53aa78"
};

export const VIRTUAL_PAY_MESSAGE_PUSH_FIXTURES = {
  urlVerify: OFFICIAL_URL_VERIFY,
  plainPost: OFFICIAL_PLAIN_POST
};

function lowerHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
  }
  return out;
}

function queryOf(event: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const layers = [event.queryStringParameters, event.query, event.queryString, event];
  for (const layer of layers) {
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) continue;
    for (const key of ["signature", "timestamp", "nonce", "echostr", "msg_signature", "encrypt_type", "openid"]) {
      const value = (layer as Record<string, unknown>)[key];
      if (typeof value === "string" && out[key] === undefined) out[key] = value;
    }
  }
  return out;
}

function methodOf(event: Record<string, unknown>): string {
  const raw = event.httpMethod ?? event.method ?? event.http_method;
  return typeof raw === "string" ? raw.toUpperCase() : "";
}

function rawBodyOf(event: Record<string, unknown>): { raw: string; object?: Record<string, unknown> } {
  if (typeof event.body === "string") {
    if (event.isBase64Encoded === true) {
      return { raw: Buffer.from(event.body, "base64").toString("utf8") };
    }
    return { raw: event.body };
  }
  if (event.body && typeof event.body === "object" && !Array.isArray(event.body)) {
    return { raw: JSON.stringify(event.body), object: event.body as Record<string, unknown> };
  }
  if (typeof event.Encrypt === "string" || typeof event.Event === "string") {
    return { raw: JSON.stringify(event), object: event };
  }
  return { raw: "" };
}

export function looksLikeWechatPayApiV3(input: {
  headers?: Record<string, string>;
  rawBody: string;
  object?: Record<string, unknown>;
}): boolean {
  const headers = input.headers || {};
  if (headers["wechatpay-signature"] || headers["wechatpay-serial"] || headers["wechatpay-timestamp"]) {
    return true;
  }
  const obj = input.object || safeJsonObject(input.rawBody);
  if (!obj) return false;
  if (obj.resource_type === "encrypt-resource" || typeof obj.event_type === "string") return true;
  const resource = obj.resource;
  if (resource && typeof resource === "object" && !Array.isArray(resource)) {
    const rec = resource as Record<string, unknown>;
    if (typeof rec.ciphertext === "string" || rec.algorithm === "AEAD_AES_256_GCM") return true;
  }
  return false;
}

function safeJsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function sha1Hex(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

export function messagePushSignature(token: string, timestamp: string, nonce: string): string {
  return sha1Hex([token, timestamp, nonce].sort().join(""));
}

export function messagePushMsgSignature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  return sha1Hex([token, timestamp, nonce, encrypt].sort().join(""));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

export function xmlLooksUnsafe(raw: string): boolean {
  return /<!DOCTYPE/i.test(raw) || /<!ENTITY/i.test(raw) || /SYSTEM\s+["']/i.test(raw);
}

export function parseSimpleXmlText(raw: string, tag: string): string | undefined {
  const cdata = new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, "i");
  const plain = new RegExp(`<${tag}>([^<]*)</${tag}>`, "i");
  const cdataMatch = raw.match(cdata);
  if (cdataMatch) return (cdataMatch[1] || "").trim();
  const plainMatch = raw.match(plain);
  if (plainMatch) return (plainMatch[1] || "").trim();
  return undefined;
}

function unpadPkcs7(padded: Buffer): Buffer | undefined {
  if (padded.length === 0) return undefined;
  const pad = padded[padded.length - 1];
  if (!pad || pad > 32 || pad > padded.length) return undefined;
  for (let i = 1; i <= pad; i += 1) {
    if (padded[padded.length - i] !== pad) return undefined;
  }
  return padded.subarray(0, padded.length - pad);
}

export function decryptWechatMessageAes(input: {
  encrypt: string;
  encodingAesKey: string;
  expectedAppId?: string;
}): { ok: true; plain: string } | { ok: false; reason: string } {
  if (!input.encodingAesKey) return { ok: false, reason: "AES_KEY_MISSING" };
  try {
    const aesKey = Buffer.from(`${input.encodingAesKey}=`, "base64");
    if (aesKey.length !== 32) return { ok: false, reason: "AES_KEY_INVALID" };
    const iv = aesKey.subarray(0, 16);
    const decipher = createDecipheriv("aes-256-cbc", aesKey, iv);
    decipher.setAutoPadding(false);
    const padded = Buffer.concat([decipher.update(Buffer.from(input.encrypt, "base64")), decipher.final()]);
    const tmp = unpadPkcs7(padded);
    if (!tmp || tmp.length < 20) return { ok: false, reason: "AES_PLAIN_TOO_SHORT" };
    const msgLen = tmp.readUInt32BE(16);
    const msg = tmp.subarray(20, 20 + msgLen).toString("utf8");
    const appId = tmp.subarray(20 + msgLen).toString("utf8");
    if (input.expectedAppId && appId !== input.expectedAppId) {
      return { ok: false, reason: "AES_APPID_MISMATCH" };
    }
    return { ok: true, plain: msg };
  } catch {
    return { ok: false, reason: "AES_DECRYPT_FAILED" };
  }
}

function deny(reason: string): VirtualPayNotifyResult {
  return {
    ok: false,
    reason,
    ErrCode: -1,
    ErrMsg: reason,
    vipGranted: false,
    protocol: "virtual-pay-message-push"
  };
}

function accept(eventType: string): VirtualPayNotifyResult {
  return {
    ok: true,
    reason: "VERIFIED",
    ErrCode: 0,
    ErrMsg: "success",
    eventType,
    vipGranted: false,
    protocol: "virtual-pay-message-push"
  };
}

function eventTypeOf(payload: Record<string, unknown>): string | undefined {
  const event = payload.Event ?? payload.event;
  return typeof event === "string" && event.length > 0 ? event : undefined;
}

function parseVerifiedPayload(raw: string): { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "EMPTY_BODY" };
  if (trimmed.startsWith("<")) {
    if (xmlLooksUnsafe(trimmed)) return { ok: false, reason: "XML_EXTERNAL_ENTITY_DENIED" };
    const event = parseSimpleXmlText(trimmed, "Event");
    const msgType = parseSimpleXmlText(trimmed, "MsgType");
    if (!event) return { ok: false, reason: "EVENT_TYPE_MISSING" };
    return { ok: true, payload: { Event: event, MsgType: msgType || "event" } };
  }
  const obj = safeJsonObject(trimmed);
  if (!obj) return { ok: false, reason: "BODY_NOT_JSON_OR_XML" };
  return { ok: true, payload: obj };
}

export type VirtualPayUrlVerify = { kind: "url-verify"; echostr: string };

export function isVirtualPayUrlVerify(
  value: VirtualPayNotifyResult | VirtualPayUrlVerify
): value is VirtualPayUrlVerify {
  return "kind" in value && value.kind === "url-verify";
}

export function verifyVirtualPayNotify(
  event: unknown,
  config: VirtualPayNotifyConfig = {}
): VirtualPayNotifyResult | VirtualPayUrlVerify {
  const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const headers = lowerHeaders(
    rec.headers && typeof rec.headers === "object" ? (rec.headers as Record<string, unknown>) : undefined
  );
  const query = queryOf(rec);
  const extracted = rawBodyOf(rec);
  const token = typeof config.token === "string" ? config.token : "";

  if (looksLikeWechatPayApiV3({ headers, rawBody: extracted.raw, object: extracted.object })) {
    return deny("APIV3_REJECTED");
  }

  const method = methodOf(rec) || (query.echostr ? "GET" : extracted.raw ? "POST" : "UNKNOWN");
  if (method === "GET" || query.echostr) {
    if (!token) return deny("NOTIFY_TOKEN_MISSING");
    if (!query.signature || !query.timestamp || !query.nonce || !query.echostr) {
      return deny("SIGNATURE_REQUIRED");
    }
    const expected = messagePushSignature(token, query.timestamp, query.nonce);
    if (!timingSafeEqual(expected, query.signature)) return deny("SIGNATURE_INVALID");
    return { kind: "url-verify", echostr: query.echostr };
  }

  if (!token) {
    if (!query.signature && !query.msg_signature && rec.signature == null && rec.sign == null) {
      return deny("SIGNATURE_REQUIRED");
    }
    return deny("NOTIFY_TOKEN_MISSING");
  }

  if (query.encrypt_type === "aes" || query.msg_signature) {
    const jsonBody = extracted.object || safeJsonObject(extracted.raw);
    const encrypt =
      (jsonBody && typeof jsonBody.Encrypt === "string" && jsonBody.Encrypt) ||
      parseSimpleXmlText(extracted.raw, "Encrypt") ||
      "";
    if (!query.msg_signature || !query.timestamp || !query.nonce || !encrypt) {
      return deny("SIGNATURE_REQUIRED");
    }
    const expected = messagePushMsgSignature(token, query.timestamp, query.nonce, encrypt);
    if (!timingSafeEqual(expected, query.msg_signature)) return deny("SIGNATURE_INVALID");
    const decrypted = decryptWechatMessageAes({
      encrypt,
      encodingAesKey: config.encodingAesKey || "",
      expectedAppId: config.appId
    });
    if (!decrypted.ok) return deny(decrypted.reason);
    const parsed = parseVerifiedPayload(decrypted.plain);
    if (!parsed.ok) return deny(parsed.reason);
    const eventType = eventTypeOf(parsed.payload);
    if (!eventType) return deny("EVENT_TYPE_MISSING");
    return accept(eventType);
  }

  if (!query.signature || !query.timestamp || !query.nonce) {
    return deny("SIGNATURE_REQUIRED");
  }
  const expected = messagePushSignature(token, query.timestamp, query.nonce);
  if (!timingSafeEqual(expected, query.signature)) return deny("SIGNATURE_INVALID");
  const parsed = parseVerifiedPayload(extracted.raw);
  if (!parsed.ok) return deny(parsed.reason);
  const eventType = eventTypeOf(parsed.payload);
  if (!eventType) return deny("EVENT_TYPE_MISSING");
  return accept(eventType);
}

export function virtualPayNotifyResponse(result: VirtualPayNotifyResult): {
  ErrCode: number;
  ErrMsg: string;
  eventType?: string;
  vipGranted: false;
} {
  return {
    ErrCode: result.ErrCode,
    ErrMsg: result.ErrMsg,
    eventType: result.eventType,
    vipGranted: false
  };
}
