import { hashNamedFields } from "./canonical.js";
import type { GrantState, PayState, RefundState } from "./types.js";
import { rejectUnknownKeys } from "./validate.js";
import {
  appleRefundGuidance,
  merchantRefundSupported,
  orderRefundDisplay
} from "./vip-refund.js";
import { durationSecondsFromDays, SECONDS_PER_DAY, VIP_SOURCE_ORDER } from "./vip.js";
import { resolveVirtualPayEnv, VIRTUAL_PAY_BUY_QUANTITY, type VirtualPayEnv } from "./virtual-pay.js";

export const VIP_PLAN_SCHEMA_VERSION = 1;
export const ORDER_SCHEMA_VERSION = 1;
export const ORDER_PAY_DEADLINE_SECONDS = 15 * 60;
export const ORDER_REFRESH_MIN_INTERVAL_MS = 5000;
export const INITIAL_PLAN_DAYS = [30, 90, 365] as const;
export const PLACEHOLDER_PLAN_PRICES_FEN = { 30: 9900, 90: 26900, 365: 89900 } as const;

export const VIP_CHANNELS = ["android", "harmony", "windows", "ios"] as const;
export type VipChannel = (typeof VIP_CHANNELS)[number];

export const PAY_STATES = ["pending", "confirming", "paid", "closed"] as const satisfies readonly PayState[];
export const GRANT_STATES = ["pending", "processing", "granted", "error", "revokedRemaining"] as const satisfies readonly GrantState[];
export const REFUND_STATES = ["none", "requested", "processing", "succeeded", "failed"] as const satisfies readonly RefundState[];

export const PLAN_ID_FIELDS = ["planId", "planVersion"] as const;
export const ORDER_ID_FIELDS = ["kind", "channelBizNo"] as const;
export const RECEIPT_ID_FIELDS = ["provider", "environment", "transactionId"] as const;
export const CALLBACK_EVENT_ID_FIELDS = ["provider", "stableEventKey"] as const;
export const VIRTUAL_PAY_PROVIDER = "wechat_virtual_pay";

export const ORDER_CREATE_FIELDS = ["planId", "planVersion", "clientChannel"] as const;
export const PAYMENT_PREPARE_FIELDS = ["orderId", "wxLoginCode"] as const;
export const ORDER_GET_FIELDS = ["orderId"] as const;
export const ORDER_LIST_FIELDS = ["cursor", "limit"] as const;
export const ORDER_REFRESH_FIELDS = ["orderId"] as const;
export const ORDER_CLOSE_FIELDS = ["orderId", "confirmed"] as const;
export const PLAN_SAVE_FIELDS = [
  "planId",
  "planVersion",
  "title",
  "durationDays",
  "durationSeconds",
  "priceFen",
  "productIds",
  "channels",
  "sort",
  "testOnly",
  "reason"
] as const;
export const VIP_PLANS_FIELDS = ["deviceInfo"] as const;
export const CLIENT_FULFILL_FORBIDDEN = [
  "amountFen",
  "priceFen",
  "goodsPrice",
  "env",
  "offerId",
  "productId",
  "paid",
  "paidAt",
  "clientSuccess",
  "payState",
  "session_key",
  "sessionKey"
] as const;

export type VipPlanRecord = {
  planId: string;
  planVersion: number;
  title: string;
  durationDays: number;
  durationSeconds: number;
  priceFen: number;
  productIds: Partial<Record<VipChannel, string>>;
  channels: VipChannel[];
  enabled: boolean;
  testOnly: boolean;
  sort: number;
  priceNote: "TEST_PRICE" | "PLACEHOLDER_PRICE";
  schemaVersion: number;
  publishedAt: string | null;
  updatedAt: string;
};

export type PlanSnapshot = {
  planId: string;
  planVersion: number;
  title: string;
  durationDays: number;
  durationSeconds: number;
  priceFen: number;
  productId: string;
  channel: VipChannel;
  environment: VirtualPayEnv;
  testOnly: boolean;
};

export type OrderRecord = {
  orderId: string;
  channelBizNo: string;
  memberId: string;
  openId: string;
  planSnapshot: PlanSnapshot;
  amountFen: number;
  channel: VipChannel;
  environment: VirtualPayEnv;
  payState: PayState;
  grantState: GrantState;
  refundState: RefundState;
  payDeadlineAt: string;
  paidAt: string | null;
  grantedAt: string | null;
  createdAt: string;
  updatedAt: string;
  nextCheckAt: string;
  lastQueryAt: string | null;
  needsReview: boolean;
  reviewReason: string;
  goodsNotified: boolean;
  fixtureLedger: boolean;
  schemaVersion: number;
};

export type PaymentReceiptRecord = {
  receiptId: string;
  orderId: string;
  provider: string;
  environment: VirtualPayEnv;
  transactionId: string;
  amountFen: number;
  verifiedAt: string;
  eventDigest: string;
};

export type CallbackEventRecord = {
  eventId: string;
  provider: string;
  type: string;
  orderId: string;
  payloadDigest: string;
  status: "received" | "matched" | "needsReview" | "ignored";
  createdAt: string;
};

export type VerifiedPaymentEvidence = {
  source: "notify" | "query";
  channelBizNo: string;
  transactionId: string;
  amountFen: number;
  productId: string;
  openId: string;
  environment: VirtualPayEnv;
  paid: boolean;
  paidAt?: string;
  eventKey: string;
  eventType?: string;
};

export type DeviceInfo = {
  platform?: string;
  system?: string;
  wechatVersion?: string;
};

export function isVipChannel(value: unknown): value is VipChannel {
  return typeof value === "string" && (VIP_CHANNELS as readonly string[]).includes(value);
}

export function planDocId(planId: string, planVersion: number): string {
  return hashNamedFields({ planId, planVersion }, PLAN_ID_FIELDS);
}

export function orderDocId(channelBizNo: string): string {
  return hashNamedFields({ kind: "mw_order", channelBizNo }, ORDER_ID_FIELDS);
}

export function paymentReceiptId(provider: string, environment: VirtualPayEnv, transactionId: string): string {
  return hashNamedFields({ provider, environment, transactionId }, RECEIPT_ID_FIELDS);
}

export function callbackEventId(provider: string, stableEventKey: string): string {
  return hashNamedFields({ provider, stableEventKey }, CALLBACK_EVENT_ID_FIELDS);
}

export function freezePlanSnapshot(input: {
  plan: VipPlanRecord;
  channel: VipChannel;
  environment: VirtualPayEnv;
}): { ok: true; snapshot: PlanSnapshot } | { ok: false; reason: string } {
  if (!input.plan.enabled) return { ok: false, reason: "PLAN_NOT_FOR_SALE" };
  if (!input.plan.channels.includes(input.channel)) return { ok: false, reason: "CHANNEL_NOT_FOR_SALE" };
  const productId = input.plan.productIds[input.channel];
  if (!productId) return { ok: false, reason: "PRODUCT_ID_MISSING" };
  if (input.plan.durationSeconds !== durationSecondsFromDays(input.plan.durationDays)) {
    return { ok: false, reason: "DURATION_MISMATCH" };
  }
  return {
    ok: true,
    snapshot: {
      planId: input.plan.planId,
      planVersion: input.plan.planVersion,
      title: input.plan.title,
      durationDays: input.plan.durationDays,
      durationSeconds: input.plan.durationSeconds,
      priceFen: input.plan.priceFen,
      productId,
      channel: input.channel,
      environment: input.environment,
      testOnly: input.plan.testOnly === true
    }
  };
}

export function orderDisplayStatus(
  order: Pick<OrderRecord, "payState" | "grantState" | "refundState" | "channel">
): {
  displayStatus: string;
  userHint?: string;
  availableActions: string[];
  forbidRepurchaseHint?: boolean;
  merchantRefundSupported: boolean;
  appleGuidance?: string;
  canRequestRefund: boolean;
} {
  const merchant = merchantRefundSupported(order.channel);
  const appleGuidance = merchant ? undefined : appleRefundGuidance();
  if (order.refundState !== "none") {
    const refund = orderRefundDisplay(order.refundState);
    return {
      displayStatus: refund.displayStatus,
      userHint: refund.userHint,
      availableActions: ["order.get"],
      merchantRefundSupported: merchant,
      appleGuidance,
      canRequestRefund: false
    };
  }
  if (order.payState === "closed") {
    return {
      displayStatus: "已关闭",
      availableActions: ["order.get"],
      merchantRefundSupported: merchant,
      appleGuidance,
      canRequestRefund: false
    };
  }
  if (order.payState === "pending") {
    return {
      displayStatus: "待支付",
      availableActions: ["payment.prepare", "order.refresh", "order.close"],
      merchantRefundSupported: merchant,
      appleGuidance,
      canRequestRefund: false
    };
  }
  if (order.payState === "confirming") {
    return {
      displayStatus: "确认中",
      availableActions: ["order.refresh"],
      merchantRefundSupported: merchant,
      appleGuidance,
      canRequestRefund: false
    };
  }
  const canRequestRefund =
    merchant &&
    order.payState === "paid" &&
    (order.grantState === "granted" || order.grantState === "pending" || order.grantState === "processing");
  if (order.payState === "paid" && order.grantState === "granted") {
    return {
      displayStatus: "已完成",
      availableActions: canRequestRefund ? ["order.get", "refund.request"] : ["order.get"],
      merchantRefundSupported: merchant,
      appleGuidance,
      canRequestRefund
    };
  }
  if (order.payState === "paid" && order.grantState === "processing") {
    return {
      displayStatus: "开通中",
      availableActions: ["order.refresh"],
      forbidRepurchaseHint: true,
      merchantRefundSupported: merchant,
      appleGuidance,
      canRequestRefund
    };
  }
  if (order.payState === "paid") {
    return {
      displayStatus: "已支付",
      userHint: "已支付，权益开通中",
      availableActions: canRequestRefund ? ["order.refresh", "refund.request"] : ["order.refresh"],
      forbidRepurchaseHint: true,
      merchantRefundSupported: merchant,
      appleGuidance,
      canRequestRefund
    };
  }
  return {
    displayStatus: "确认中",
    availableActions: ["order.refresh"],
    merchantRefundSupported: merchant,
    appleGuidance,
    canRequestRefund: false
  };
}

export function canTransitionPayState(from: PayState, to: PayState): boolean {
  if (from === to) return true;
  if (from === "paid") return false;
  if (from === "closed") return to === "paid";
  if (from === "pending") return to === "confirming" || to === "paid" || to === "closed";
  if (from === "confirming") return to === "paid" || to === "closed" || to === "pending";
  return false;
}

export function clientFulfillmentRejected(data: Record<string, unknown>): string[] {
  return CLIENT_FULFILL_FORBIDDEN.filter((key) => key in data);
}

export function matchPaymentEvidence(
  order: OrderRecord,
  evidence: VerifiedPaymentEvidence
): { ok: true } | { ok: false; reason: string; needsReview: true } {
  if (evidence.channelBizNo !== order.channelBizNo) {
    return { ok: false, reason: "ORDER_MISMATCH", needsReview: true };
  }
  if (evidence.openId && order.openId && evidence.openId !== order.openId) {
    return { ok: false, reason: "USER_MISMATCH", needsReview: true };
  }
  if (evidence.productId && evidence.productId !== order.planSnapshot.productId) {
    return { ok: false, reason: "PRODUCT_MISMATCH", needsReview: true };
  }
  if (Number.isInteger(evidence.amountFen) && evidence.amountFen !== order.amountFen) {
    return { ok: false, reason: "AMOUNT_MISMATCH", needsReview: true };
  }
  if (evidence.environment !== order.environment) {
    return { ok: false, reason: "ENV_MISMATCH", needsReview: true };
  }
  if (evidence.paid !== true) {
    return { ok: false, reason: "NOT_PAID", needsReview: true };
  }
  return { ok: true };
}

export function capabilityHints(input: {
  channel: VipChannel;
  environment: VirtualPayEnv;
  device?: DeviceInfo;
}): {
  channel: VipChannel;
  purchaseAvailable: boolean;
  reason: string;
  hint: string;
} {
  if (input.environment === 0) {
    return {
      channel: input.channel,
      purchaseAvailable: false,
      reason: "LIVE_ENV_NOT_USED",
      hint: "本轮不切现网。Apple 现网路径记到 MW29。"
    };
  }
  if (input.channel === "ios") {
    return {
      channel: "ios",
      purchaseAvailable: false,
      reason: "APPLE_SANDBOX_UNSUPPORTED",
      hint: "Apple 不支持沙箱。A20 / T26 现网路径明确记到 MW29。"
    };
  }
  const platform = (input.device?.platform || "").toLowerCase();
  if (platform === "ios" || platform === "iphone" || platform === "ipad") {
    return {
      channel: "ios",
      purchaseAvailable: false,
      reason: "APPLE_SANDBOX_UNSUPPORTED",
      hint: "设备声明不能授予权限。当前沙箱不能走 Apple 现网付款。"
    };
  }
  return {
    channel: input.channel,
    purchaseAvailable: true,
    reason: "SANDBOX_VIRTUAL_PAY",
    hint: "沙箱测试价，非正式售价。quantity=1。"
  };
}

export function inferChannelFromDevice(device?: DeviceInfo): VipChannel {
  const platform = (device?.platform || "").toLowerCase();
  if (platform === "ios" || platform === "iphone" || platform === "ipad") return "ios";
  if (platform === "windows") return "windows";
  if (platform === "ohos" || platform === "harmony" || platform === "openharmony") return "harmony";
  return "android";
}

export function sessionOpenIdMatches(sessionOpenId: string, cloudOpenId: string): boolean {
  return Boolean(sessionOpenId) && sessionOpenId === cloudOpenId;
}

export function parseDeviceInfo(value: unknown): DeviceInfo | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  const extra = rejectUnknownKeys(rec, ["platform", "system", "wechatVersion"]);
  if (extra.length) return undefined;
  const out: DeviceInfo = {};
  if (typeof rec.platform === "string") out.platform = rec.platform;
  if (typeof rec.system === "string") out.system = rec.system;
  if (typeof rec.wechatVersion === "string") out.wechatVersion = rec.wechatVersion;
  return out;
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function token(value: unknown, max = 80): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function parseOrderCreateInput(data: Record<string, unknown>):
  | { ok: true; planId: string; planVersion: number; clientChannel: VipChannel }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...ORDER_CREATE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  issues.push(...clientFulfillmentRejected(data).map((key) => `client fulfillment forbidden: ${key}`));
  const planId = token(data.planId);
  const planVersion = asPositiveInt(data.planVersion);
  if (!planId) issues.push("planId required");
  if (planVersion === undefined) issues.push("planVersion must be a positive integer");
  if (!isVipChannel(data.clientChannel)) issues.push("clientChannel must be android|harmony|windows|ios");
  if (issues.length) return { ok: false, issues };
  return { ok: true, planId, planVersion: planVersion as number, clientChannel: data.clientChannel as VipChannel };
}

export function parsePaymentPrepareInput(data: Record<string, unknown>):
  | { ok: true; orderId: string; wxLoginCode: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...PAYMENT_PREPARE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  issues.push(...clientFulfillmentRejected(data).map((key) => `client fulfillment forbidden: ${key}`));
  const orderId = token(data.orderId, 128);
  const wxLoginCode = token(data.wxLoginCode, 256);
  if (!orderId) issues.push("orderId required");
  if (!wxLoginCode) issues.push("wxLoginCode required");
  if (issues.length) return { ok: false, issues };
  return { ok: true, orderId, wxLoginCode };
}

export function parseOrderIdInput(data: Record<string, unknown>, extraAllowed: readonly string[] = []):
  | { ok: true; orderId: string; rest: Record<string, unknown> }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, ["orderId", ...extraAllowed]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  issues.push(...clientFulfillmentRejected(data).map((key) => `client fulfillment forbidden: ${key}`));
  const orderId = token(data.orderId, 128);
  if (!orderId) issues.push("orderId required");
  if (issues.length) return { ok: false, issues };
  return { ok: true, orderId, rest: data };
}

export function parsePlanPublishInput(data: Record<string, unknown>):
  | { ok: true; plan: Omit<VipPlanRecord, "enabled" | "publishedAt" | "updatedAt" | "schemaVersion"> & { reason: string } }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...PLAN_SAVE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const planId = token(data.planId);
  const title = token(data.title, 40);
  const reason = token(data.reason, 200);
  const planVersion = asPositiveInt(data.planVersion);
  const durationDays = asPositiveInt(data.durationDays);
  const priceFen = asPositiveInt(data.priceFen);
  const sort = data.sort === undefined ? 10 : asPositiveInt(data.sort);
  if (!planId) issues.push("planId required");
  if (!title) issues.push("title required");
  if (!reason) issues.push("reason required");
  if (planVersion === undefined) issues.push("planVersion must be a positive integer");
  if (durationDays === undefined) issues.push("durationDays must be a positive integer");
  if (priceFen === undefined) issues.push("priceFen must be a positive integer");
  if (sort === undefined) issues.push("sort must be a positive integer");
  const seconds = data.durationSeconds === undefined ? undefined : asPositiveInt(data.durationSeconds);
  if (data.durationSeconds !== undefined && seconds === undefined) issues.push("durationSeconds must be a positive integer");
  if (durationDays !== undefined && seconds !== undefined && seconds !== durationSecondsFromDays(durationDays)) {
    issues.push("durationDays and durationSeconds mismatch");
  }
  const channelsRaw = Array.isArray(data.channels) ? data.channels : [];
  const channels = channelsRaw.filter(isVipChannel);
  if (!channels.length) issues.push("channels required");
  const productIds: Partial<Record<VipChannel, string>> = {};
  if (data.productIds && typeof data.productIds === "object" && !Array.isArray(data.productIds)) {
    const rec = data.productIds as Record<string, unknown>;
    for (const channel of channels) {
      const id = token(rec[channel], 64);
      if (!id) issues.push(`productIds.${channel} required`);
      else productIds[channel] = id;
    }
  } else {
    issues.push("productIds required");
  }
  if (data.testOnly !== true) issues.push("testOnly must be true for development plans");
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    plan: {
      planId,
      planVersion: planVersion as number,
      title,
      durationDays: durationDays as number,
      durationSeconds: durationSecondsFromDays(durationDays as number),
      priceFen: priceFen as number,
      productIds,
      channels,
      sort: sort as number,
      testOnly: true,
      priceNote: "TEST_PRICE",
      reason
    }
  };
}

export function resolveServerPayEnv(configuredEnv: unknown, clientEnv?: unknown):
  | { ok: true; env: VirtualPayEnv }
  | { ok: false; reason: string } {
  const resolved = resolveVirtualPayEnv({ configuredEnv, clientEnv });
  if (!resolved.ok) return resolved;
  if (resolved.env === 0) return { ok: false, reason: "LIVE_ENV_NOT_USED" };
  return { ok: true, env: 1 };
}

export function orderGrantSourceId(order: Pick<OrderRecord, "channelBizNo">): string {
  return order.channelBizNo;
}

export function orderGrantReason(order: Pick<OrderRecord, "orderId" | "channelBizNo">): string {
  return `paid-order:${order.channelBizNo}`;
}

export function payDeadlineAt(createdAt: Date): string {
  return new Date(createdAt.getTime() + ORDER_PAY_DEADLINE_SECONDS * 1000).toISOString();
}

export function newOrderRecord(input: {
  channelBizNo: string;
  memberId: string;
  openId: string;
  snapshot: PlanSnapshot;
  now: Date;
}): OrderRecord {
  const createdAt = input.now.toISOString();
  return {
    orderId: orderDocId(input.channelBizNo),
    channelBizNo: input.channelBizNo,
    memberId: input.memberId,
    openId: input.openId,
    planSnapshot: input.snapshot,
    amountFen: input.snapshot.priceFen,
    channel: input.snapshot.channel,
    environment: input.snapshot.environment,
    payState: "pending",
    grantState: "pending",
    refundState: "none",
    payDeadlineAt: payDeadlineAt(input.now),
    paidAt: null,
    grantedAt: null,
    createdAt,
    updatedAt: createdAt,
    nextCheckAt: payDeadlineAt(input.now),
    lastQueryAt: null,
    needsReview: false,
    reviewReason: "",
    goodsNotified: false,
    fixtureLedger: false,
    schemaVersion: ORDER_SCHEMA_VERSION
  };
}

export { SECONDS_PER_DAY, VIP_SOURCE_ORDER, VIRTUAL_PAY_BUY_QUANTITY };
