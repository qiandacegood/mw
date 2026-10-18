import { randomBytes } from "node:crypto";
import {
  ORDER_REFRESH_MIN_INTERVAL_MS,
  VIP_SOURCE_ORDER,
  applyVipGrant,
  buildAuditEntry,
  buildGoodsSignData,
  buildIdempotencyRecord,
  calcPaySig,
  calcUserSignature,
  callbackEventId,
  canTransitionPayState,
  capabilityHints,
  checkMaintenanceGate,
  defaultMaintenanceConfig,
  evaluateVipStatus,
  freezePlanSnapshot,
  inferChannelFromDevice,
  matchPaymentEvidence,
  newOrderRecord,
  orderDisplayStatus,
  orderDocId,
  orderGrantReason,
  orderGrantSourceId,
  parseDeviceInfo,
  parseOrderCreateInput,
  parseOrderIdInput,
  parsePaymentPrepareInput,
  parsePlanPublishInput,
  parseVirtualPayEnv,
  payloadHash,
  paymentReceiptId,
  planDocId,
  replayOrConflict,
  resolveServerPayEnv,
  sessionOpenIdMatches,
  vipGrantId,
  VIRTUAL_PAY_PROVIDER,
  VIRTUAL_PAY_REQUEST_URI,
  type MaintenanceConfig,
  type OrderRecord,
  type VerifiedPaymentEvidence,
  type VipPlanRecord
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { MemberReadStore } from "./member-stores.js";
import type { OrderWorkStore } from "./order-stores.js";
import type { VipWorkStore } from "./vip-stores.js";
import type { Code2SessionFn } from "./wechat-session.js";
import type { XpayQueryParse } from "./virtual-pay-xpay.js";

export const MEMBER_PURCHASE_ACTIONS = [
  "vip.plans",
  "order.create",
  "payment.prepare",
  "order.get",
  "order.list",
  "order.refresh",
  "order.close"
] as const;
export const ADMIN_PLAN_ACTIONS = ["plan.save", "plan.publish", "plan.disable", "plan.list"] as const;
export const ADMIN_ORDER_ACTIONS = ["order.list", "order.get", "order.reconcile"] as const;

export type VirtualPayRuntime = {
  offerId: string;
  configuredEnv: unknown;
  sandboxAppKey: string;
  appId: string;
  appSecret?: string;
  code2Session: Code2SessionFn;
  queryOrder: (input: { openid: string; orderId: string }) => Promise<XpayQueryParse>;
  notifyProvideGoods?: (input: { orderId: string; wxOrderId?: string }) => Promise<{ sent: boolean; reason?: string }>;
};

export type PurchaseFailure = {
  ok: false;
  code: string;
  reason: string;
  issues?: string[];
  details?: Record<string, unknown>;
};

export type PurchaseSuccess<T> = {
  ok: true;
  data: T;
  replayed?: boolean;
  budget: TxBudget;
};

function emptyBudget(): TxBudget {
  return { reads: 0, writes: 0, total: 0, elapsedMs: 0 };
}

function fail(code: string, reason: string, extra?: { issues?: string[]; details?: Record<string, unknown> }): PurchaseFailure {
  return {
    ok: false,
    code,
    reason,
    ...(extra?.issues ? { issues: extra.issues } : {}),
    ...(extra?.details ? { details: extra.details } : {})
  };
}

function purchaseCreateBlocked(config: MaintenanceConfig | undefined): PurchaseFailure | undefined {
  const checked = checkMaintenanceGate(config || defaultMaintenanceConfig(new Date()), "purchaseCreate");
  if (checked.allowed) return undefined;
  return fail("CONTENT_UPDATING", checked.reason || "PURCHASE_CREATE_CLOSED", {
    details: { gate: "purchaseCreate", jobId: checked.jobId }
  });
}

function entitlementApplyBlocked(config: MaintenanceConfig | undefined): boolean {
  const checked = checkMaintenanceGate(config || defaultMaintenanceConfig(new Date()), "entitlementApply");
  return !checked.allowed;
}

function newChannelBizNo(): string {
  return randomBytes(16).toString("hex");
}

export function orderView(order: OrderRecord) {
  const display = orderDisplayStatus(order);
  return {
    orderId: order.orderId,
    channelBizNo: order.channelBizNo,
    amountFen: order.amountFen,
    durationDays: order.planSnapshot.durationDays,
    durationSeconds: order.planSnapshot.durationSeconds,
    planId: order.planSnapshot.planId,
    planVersion: order.planSnapshot.planVersion,
    title: order.planSnapshot.title,
    channel: order.channel,
    environment: order.environment,
    payState: order.payState,
    grantState: order.grantState,
    refundState: order.refundState,
    payDeadlineAt: order.payDeadlineAt,
    paidAt: order.paidAt,
    grantedAt: order.grantedAt,
    needsReview: order.needsReview,
    testOnly: order.planSnapshot.testOnly === true,
    priceNote: "TEST_PRICE",
    ...display
  };
}

function textOf(rec: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function nest(rec: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = rec[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function intOf(rec: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "number" && Number.isInteger(value)) return value;
    if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  }
  return undefined;
}

export function evidenceFromNotify(payload: Record<string, unknown>, eventType: string): VerifiedPaymentEvidence | undefined {
  if (eventType !== "xpay_goods_deliver_notify") return undefined;
  const goods = nest(payload, "GoodsInfo");
  const pay = nest(payload, "WeChatPayInfo");
  const channelBizNo = textOf(payload, ["OutTradeNo", "out_trade_no", "order_id"]) || textOf(pay, ["OutTradeNo"]);
  const openId = textOf(payload, ["OpenId", "openid", "FromUserName"]);
  const productId = textOf(goods, ["ProductId", "product_id"]) || textOf(payload, ["ProductId", "product_id"]);
  const amountFen = intOf(goods, ["ActualPrice", "actual_price", "GoodsPrice"]) ?? intOf(payload, ["ActualPrice"]);
  const transactionId =
    textOf(pay, ["TransactionId", "wx_order_id", "MchOrderNo"]) || textOf(payload, ["TransactionId", "wx_order_id"]);
  const envRaw = intOf(payload, ["Env", "env"]) ?? parseVirtualPayEnv(payload.Env ?? payload.env);
  const environment = envRaw === 0 || envRaw === 1 ? envRaw : 1;
  if (!channelBizNo) return undefined;
  return {
    source: "notify",
    channelBizNo,
    transactionId: transactionId || `notify:${channelBizNo}`,
    amountFen: amountFen ?? -1,
    productId,
    openId,
    environment,
    paid: true,
    eventKey: transactionId || `${eventType}:${channelBizNo}`,
    eventType
  };
}

export function evidenceFromQuery(parsed: XpayQueryParse, fallbackBizNo: string, fallbackOpenId: string): VerifiedPaymentEvidence | undefined {
  if (!parsed.paid) return undefined;
  return {
    source: "query",
    channelBizNo: parsed.channelBizNo || fallbackBizNo,
    transactionId: parsed.transactionId || `query:${fallbackBizNo}`,
    amountFen: parsed.amountFen ?? -1,
    productId: parsed.productId || "",
    openId: parsed.openId || fallbackOpenId,
    environment: parsed.environment ?? 1,
    paid: true,
    paidAt: parsed.paidAt,
    eventKey: parsed.transactionId || `query:${fallbackBizNo}`
  };
}

async function grantFromPaidOrder(input: {
  vip: VipWorkStore;
  order: OrderRecord;
  now: Date;
  actorId: string;
  maintenance?: MaintenanceConfig;
}): Promise<{ order: OrderRecord; replayed: boolean; granted: boolean; error?: string }> {
  if (input.order.grantState === "granted") {
    return { order: input.order, replayed: true, granted: true };
  }
  if (entitlementApplyBlocked(input.maintenance)) {
    return {
      order: { ...input.order, grantState: "pending", updatedAt: input.now.toISOString() },
      replayed: false,
      granted: false,
      error: "ENTITLEMENT_APPLY_CLOSED"
    };
  }
  const sourceId = orderGrantSourceId(input.order);
  const grantId = vipGrantId(VIP_SOURCE_ORDER, sourceId);
  const existing = await input.vip.listGrants(input.order.memberId);
  const grantIds = [...new Set([grantId, ...existing.map((row) => row.grantId)])];
  const { mutation } = await input.vip.transactLedger({
    memberId: input.order.memberId,
    grantIds,
    mutate: (snap) => {
      const applied = applyVipGrant({
        account: snap.account,
        grants: snap.grants,
        memberId: input.order.memberId,
        sourceType: VIP_SOURCE_ORDER,
        sourceId,
        durationSeconds: input.order.planSnapshot.durationSeconds,
        grantedAt: input.now,
        reason: orderGrantReason(input.order),
        actorId: input.actorId
      });
      if (!applied.ok) {
        return { error: applied.reason, result: null };
      }
      return {
        account: applied.account,
        grants: applied.grants,
        events: applied.events,
        result: { replayed: applied.replayed, expiresAt: applied.account.expiresAt },
        replayed: applied.replayed
      };
    }
  });
  if (mutation.error) {
    return {
      order: { ...input.order, grantState: "error", reviewReason: mutation.error, updatedAt: input.now.toISOString() },
      replayed: false,
      granted: false,
      error: mutation.error
    };
  }
  const grantedAt = input.order.grantedAt || input.now.toISOString();
  return {
    order: {
      ...input.order,
      grantState: "granted",
      grantedAt,
      updatedAt: input.now.toISOString()
    },
    replayed: mutation.replayed === true,
    granted: true
  };
}

export async function fulfillVerifiedPayment(input: {
  orders: OrderWorkStore;
  vip: VipWorkStore;
  evidence: VerifiedPaymentEvidence;
  now: Date;
  actorId: string;
  maintenance?: MaintenanceConfig;
  pay?: VirtualPayRuntime;
}): Promise<{ granted: boolean; replayed: boolean; needsReview: boolean; reason: string; order?: OrderRecord }> {
  const found = await input.orders.getOrderByBizNo(input.evidence.channelBizNo);
  const eventId = callbackEventId(VIRTUAL_PAY_PROVIDER, input.evidence.eventKey);
  if (!found) {
    await input.orders.transactOrder({
      orderId: `missing:${input.evidence.channelBizNo}`,
      callbackId: eventId,
      mutate: () => ({
        callback: {
          eventId,
          provider: VIRTUAL_PAY_PROVIDER,
          type: input.evidence.eventType || input.evidence.source,
          orderId: "",
          payloadDigest: payloadHash({ eventKey: input.evidence.eventKey }),
          status: "needsReview",
          createdAt: input.now.toISOString()
        },
        result: null
      })
    });
    return { granted: false, replayed: false, needsReview: true, reason: "ORDER_NOT_FOUND" };
  }
  const matched = matchPaymentEvidence(found, input.evidence);
  const receiptId = paymentReceiptId(VIRTUAL_PAY_PROVIDER, found.environment, input.evidence.transactionId);
  const { mutation } = await input.orders.transactOrder({
    orderId: found.orderId,
    receiptId,
    callbackId: eventId,
    mutate: (snap) => {
      const callback = {
        eventId,
        provider: VIRTUAL_PAY_PROVIDER,
        type: input.evidence.eventType || input.evidence.source,
        orderId: found.orderId,
        payloadDigest: payloadHash({ eventKey: input.evidence.eventKey, orderId: found.orderId }),
        status: matched.ok ? ("matched" as const) : ("needsReview" as const),
        createdAt: snap.callback?.createdAt || input.now.toISOString()
      };
      if (!matched.ok) {
        return {
          order: {
            ...found,
            needsReview: true,
            reviewReason: matched.reason,
            updatedAt: input.now.toISOString()
          },
          callback,
          result: { review: true, reason: matched.reason },
          error: undefined
        };
      }
      if (!canTransitionPayState(found.payState, "paid") && found.payState !== "paid") {
        return {
          order: { ...found, needsReview: true, reviewReason: "PAY_STATE_CONFLICT", updatedAt: input.now.toISOString() },
          callback,
          result: { review: true, reason: "PAY_STATE_CONFLICT" }
        };
      }
      const receipt = snap.receipt || {
        receiptId,
        orderId: found.orderId,
        provider: VIRTUAL_PAY_PROVIDER,
        environment: found.environment,
        transactionId: input.evidence.transactionId,
        amountFen: found.amountFen,
        verifiedAt: input.now.toISOString(),
        eventDigest: payloadHash({ eventKey: input.evidence.eventKey })
      };
      const paid: OrderRecord = {
        ...found,
        payState: "paid",
        paidAt: found.paidAt || input.evidence.paidAt || input.now.toISOString(),
        grantState: found.grantState === "granted" ? "granted" : "processing",
        needsReview: false,
        reviewReason: "",
        updatedAt: input.now.toISOString()
      };
      return { order: paid, receipt, callback, result: { review: false, reason: "PAID" } };
    }
  });
  const order = mutation.order || found;
  if (mutation.result && (mutation.result as { review?: boolean }).review) {
    return { granted: false, replayed: false, needsReview: true, reason: (mutation.result as { reason: string }).reason, order };
  }
  const granted = await grantFromPaidOrder({
    vip: input.vip,
    order,
    now: input.now,
    actorId: input.actorId,
    maintenance: input.maintenance
  });
  await input.orders.transactOrder({
    orderId: order.orderId,
    mutate: () => ({ order: granted.order, result: null })
  });
  if (granted.granted && input.pay?.notifyProvideGoods && !granted.order.goodsNotified) {
    const sent = await input.pay.notifyProvideGoods({ orderId: granted.order.channelBizNo });
    if (sent.sent) {
      await input.orders.transactOrder({
        orderId: order.orderId,
        mutate: (snap) => ({
          order: { ...(snap.order || granted.order), goodsNotified: true, updatedAt: input.now.toISOString() },
          result: null
        })
      });
    }
  }
  return {
    granted: granted.granted,
    replayed: granted.replayed,
    needsReview: false,
    reason: granted.granted ? "GRANTED" : granted.error || "GRANT_PENDING",
    order: granted.order
  };
}

export async function listVipPlans(input: {
  orders: OrderWorkStore;
  data: Record<string, unknown>;
  configuredEnv: unknown;
}): Promise<PurchaseSuccess<Record<string, unknown>> | PurchaseFailure> {
  const extra = Object.keys(input.data).filter((key) => key !== "deviceInfo");
  if (extra.length) return fail("INVALID_ARGUMENT", "VIP_PLANS_INPUT_INVALID", { issues: [`unknown fields: ${extra.join(",")}`] });
  const device = parseDeviceInfo(input.data.deviceInfo) || undefined;
  if (input.data.deviceInfo !== undefined && !device && input.data.deviceInfo !== null) {
    return fail("INVALID_ARGUMENT", "DEVICE_INFO_INVALID");
  }
  const env = resolveServerPayEnv(input.configuredEnv);
  if (!env.ok) return fail("PAYMENT_CHANNEL_UNAVAILABLE", env.reason);
  const channel = inferChannelFromDevice(device);
  const capability = capabilityHints({ channel, environment: env.env, device });
  const saleChannel = capability.purchaseAvailable ? channel : capability.channel;
  const visible = (await input.orders.listPlans()).filter(
    (row) => row.enabled && row.testOnly && row.channels.includes(saleChannel)
  );
  return {
    ok: true,
    data: {
      channel: saleChannel,
      environment: env.env,
      capability,
      deviceDoesNotGrant: true,
      plans: visible.map((row) => ({
        planId: row.planId,
        planVersion: row.planVersion,
        title: row.title,
        durationDays: row.durationDays,
        durationSeconds: row.durationSeconds,
        priceFen: row.priceFen,
        priceNote: row.priceNote,
        sort: row.sort,
        testOnly: true
      }))
    },
    budget: emptyBudget()
  };
}

export async function createOrder(input: {
  orders: OrderWorkStore;
  members?: MemberReadStore;
  actorId: string;
  memberId: string;
  openId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
  configuredEnv: unknown;
  maintenance?: MaintenanceConfig;
}): Promise<PurchaseSuccess<ReturnType<typeof orderView>> | PurchaseFailure> {
  const blocked = purchaseCreateBlocked(input.maintenance);
  if (blocked) return blocked;
  const parsed = parseOrderCreateInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "ORDER_CREATE_INPUT_INVALID", { issues: parsed.issues });
  const env = resolveServerPayEnv(input.configuredEnv);
  if (!env.ok) return fail("PAYMENT_CHANNEL_UNAVAILABLE", env.reason);
  const capability = capabilityHints({ channel: parsed.clientChannel, environment: env.env });
  if (!capability.purchaseAvailable) {
    return fail("PAYMENT_CHANNEL_UNAVAILABLE", capability.reason, { details: { hint: capability.hint } });
  }
  const plan = await input.orders.getPlan(parsed.planId, parsed.planVersion);
  if (!plan) return fail("NOT_FOUND", "PLAN_NOT_FOUND");
  const frozen = freezePlanSnapshot({ plan, channel: parsed.clientChannel, environment: env.env });
  if (!frozen.ok) return fail("INVALID_ARGUMENT", frozen.reason);
  if (input.members) {
    const member = await input.members.getMember(input.memberId);
    if (!member) return fail("NOT_FOUND", "MEMBER_NOT_FOUND");
    if (member.status === "disabled") return fail("ACCOUNT_DISABLED", "ACCOUNT_DISABLED");
  }
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "order.create",
    idempotencyKey: input.idempotencyKey,
    payload: { memberId: input.memberId, planId: parsed.planId, planVersion: parsed.planVersion, channel: parsed.clientChannel },
    requestId: input.requestId
  });
  const placeholderId = `idem:${idemRecord.id}`;
  const { mutation, budget } = await input.orders.transactOrder({
    orderId: placeholderId,
    idempotencyId: idemRecord.id,
    mutate: (snap) => {
      const replay = replayOrConflict(snap.idem, idemRecord.payloadHash, () => null);
      if (!replay.ok) return { error: "IDEMPOTENCY_CONFLICT", result: null };
      if (replay.replayed && snap.idem?.resultRef && typeof snap.idem.resultRef === "object") {
        return { result: snap.idem.resultRef as ReturnType<typeof orderView>, replayed: true, idem: snap.idem };
      }
      const order = newOrderRecord({
        channelBizNo: newChannelBizNo(),
        memberId: input.memberId,
        openId: input.openId,
        snapshot: frozen.snapshot,
        now: input.now
      });
      const view = orderView(order);
      return {
        order,
        idem: { ...idemRecord, status: "succeeded", resultRef: view },
        audit: buildAuditEntry({
          actorType: "member",
          actorId: input.actorId,
          action: "order.create",
          target: order.orderId,
          reason: "freeze-plan",
          requestId: input.requestId,
          after: { amountFen: order.amountFen, planVersion: order.planSnapshot.planVersion },
          now: input.now
        }),
        result: view
      };
    }
  });
  if (mutation.error === "IDEMPOTENCY_CONFLICT") return fail("IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT");
  if (mutation.error) return fail("INVALID_ARGUMENT", mutation.error);
  if (mutation.order && mutation.order.orderId !== placeholderId) {
    await input.orders.transactOrder({
      orderId: mutation.order.orderId,
      mutate: () => ({ order: mutation.order, result: mutation.result })
    });
  }
  return { ok: true, data: mutation.result as ReturnType<typeof orderView>, replayed: mutation.replayed === true, budget };
}

export async function preparePayment(input: {
  orders: OrderWorkStore;
  memberId: string;
  cloudOpenId: string;
  data: Record<string, unknown>;
  now: Date;
  pay: VirtualPayRuntime;
}): Promise<PurchaseSuccess<Record<string, unknown>> | PurchaseFailure> {
  const parsed = parsePaymentPrepareInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "PAYMENT_PREPARE_INPUT_INVALID", { issues: parsed.issues });
  const order = await input.orders.getOrder(parsed.orderId);
  if (!order || order.memberId !== input.memberId) return fail("NOT_FOUND", "ORDER_NOT_FOUND");
  if (order.payState === "closed") return fail("INVALID_ARGUMENT", "ORDER_CLOSED");
  if (order.payState === "paid") return fail("ENTITLEMENT_PENDING", "ORDER_ALREADY_PAID");
  const env = resolveServerPayEnv(input.pay.configuredEnv);
  if (!env.ok) return fail("PAYMENT_CHANNEL_UNAVAILABLE", env.reason);
  if (order.environment !== env.env) return fail("FORBIDDEN", "ENV_MISMATCH");
  const session = await input.pay.code2Session(parsed.wxLoginCode);
  if (!session.ok) return fail("AUTH_REQUIRED", session.reason);
  if (!sessionOpenIdMatches(session.openid, input.cloudOpenId) || session.openid !== order.openId) {
    return fail("FORBIDDEN", "OPENID_MISMATCH");
  }
  const sign = buildGoodsSignData({
    offerId: input.pay.offerId,
    env: order.environment,
    productId: order.planSnapshot.productId,
    goodsPriceFen: order.amountFen,
    outTradeNo: order.channelBizNo,
    attach: order.orderId
  });
  if (!sign.ok) return fail("INTERNAL_ERROR", sign.reason);
  const paySig = calcPaySig(VIRTUAL_PAY_REQUEST_URI, sign.signData, input.pay.sandboxAppKey);
  const signature = calcUserSignature(sign.signData, session.sessionKey);
  await input.orders.transactOrder({
    orderId: order.orderId,
    mutate: () => ({
      order: {
        ...order,
        payState: order.payState === "pending" ? "pending" : order.payState,
        updatedAt: input.now.toISOString()
      },
      result: null
    })
  });
  return {
    ok: true,
    data: {
      orderId: order.orderId,
      mode: "short_series_goods",
      offerId: input.pay.offerId,
      buyQuantity: 1,
      env: order.environment,
      currencyType: "CNY",
      productId: order.planSnapshot.productId,
      goodsPrice: order.amountFen,
      outTradeNo: order.channelBizNo,
      attach: order.orderId,
      signData: sign.signData,
      paySig,
      signature,
      sessionKeyReturned: false
    },
    budget: emptyBudget()
  };
}

export async function getOrderForMember(input: {
  orders: OrderWorkStore;
  memberId: string;
  data: Record<string, unknown>;
}): Promise<PurchaseSuccess<ReturnType<typeof orderView>> | PurchaseFailure> {
  const parsed = parseOrderIdInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "ORDER_GET_INPUT_INVALID", { issues: parsed.issues });
  const order = await input.orders.getOrder(parsed.orderId);
  if (!order || order.memberId !== input.memberId) return fail("NOT_FOUND", "ORDER_NOT_FOUND");
  return { ok: true, data: orderView(order), budget: emptyBudget() };
}

export async function listOrdersForMember(input: {
  orders: OrderWorkStore;
  memberId: string;
  data: Record<string, unknown>;
}): Promise<PurchaseSuccess<{ items: ReturnType<typeof orderView>[]; nextCursor: string }> | PurchaseFailure> {
  const extra = Object.keys(input.data).filter((key) => key !== "cursor" && key !== "limit");
  if (extra.length) return fail("INVALID_ARGUMENT", "ORDER_LIST_INPUT_INVALID", { issues: [`unknown fields: ${extra.join(",")}`] });
  const limit = typeof input.data.limit === "number" && Number.isInteger(input.data.limit) ? input.data.limit : 20;
  const rows = await input.orders.listOrdersByMember(input.memberId, limit);
  return { ok: true, data: { items: rows.map(orderView), nextCursor: "" }, budget: emptyBudget() };
}

export async function refreshOrder(input: {
  orders: OrderWorkStore;
  vip: VipWorkStore;
  memberId?: string;
  data: Record<string, unknown>;
  now: Date;
  pay: VirtualPayRuntime;
  maintenance?: MaintenanceConfig;
  actorId: string;
}): Promise<PurchaseSuccess<ReturnType<typeof orderView> & { queryUnknown?: boolean }> | PurchaseFailure> {
  const parsed = parseOrderIdInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "ORDER_REFRESH_INPUT_INVALID", { issues: parsed.issues });
  const order = await input.orders.getOrder(parsed.orderId);
  if (!order) return fail("NOT_FOUND", "ORDER_NOT_FOUND");
  if (input.memberId && order.memberId !== input.memberId) return fail("NOT_FOUND", "ORDER_NOT_FOUND");
  if (order.lastQueryAt && Date.parse(order.lastQueryAt) + ORDER_REFRESH_MIN_INTERVAL_MS > input.now.getTime()) {
    return fail("RATE_LIMITED", "ORDER_REFRESH_RATE_LIMITED");
  }
  if (order.payState === "pending") {
    await input.orders.transactOrder({
      orderId: order.orderId,
      mutate: () => ({
        order: { ...order, payState: "confirming", lastQueryAt: input.now.toISOString(), updatedAt: input.now.toISOString() },
        result: null
      })
    });
  } else {
    await input.orders.transactOrder({
      orderId: order.orderId,
      mutate: () => ({
        order: { ...order, lastQueryAt: input.now.toISOString(), updatedAt: input.now.toISOString() },
        result: null
      })
    });
  }
  const queried = await input.pay.queryOrder({ openid: order.openId, orderId: order.channelBizNo });
  if (queried.paid) {
    const evidence = evidenceFromQuery(queried, order.channelBizNo, order.openId);
    if (evidence) {
      const fulfilled = await fulfillVerifiedPayment({
        orders: input.orders,
        vip: input.vip,
        evidence,
        now: input.now,
        actorId: input.actorId,
        maintenance: input.maintenance,
        pay: input.pay
      });
      const latest = fulfilled.order || (await input.orders.getOrder(order.orderId));
      if (!latest) return fail("NOT_FOUND", "ORDER_NOT_FOUND");
      return { ok: true, data: { ...orderView(latest), queryUnknown: false }, budget: emptyBudget() };
    }
  }
  const latest = await input.orders.getOrder(order.orderId);
  if (!latest) return fail("NOT_FOUND", "ORDER_NOT_FOUND");
  return {
    ok: true,
    data: { ...orderView(latest), queryUnknown: queried.unknown || !queried.paid },
    budget: emptyBudget()
  };
}

export async function closeOrder(input: {
  orders: OrderWorkStore;
  vip: VipWorkStore;
  memberId: string;
  data: Record<string, unknown>;
  now: Date;
  pay: VirtualPayRuntime;
  maintenance?: MaintenanceConfig;
  actorId: string;
}): Promise<PurchaseSuccess<ReturnType<typeof orderView>> | PurchaseFailure> {
  const parsed = parseOrderIdInput(input.data, ["confirmed"]);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "ORDER_CLOSE_INPUT_INVALID", { issues: parsed.issues });
  if (input.data.confirmed !== true) return fail("INVALID_ARGUMENT", "CLOSE_CONFIRM_REQUIRED");
  const refreshed = await refreshOrder({
    orders: input.orders,
    vip: input.vip,
    memberId: input.memberId,
    data: { orderId: parsed.orderId },
    now: input.now,
    pay: input.pay,
    maintenance: input.maintenance,
    actorId: input.actorId
  });
  if (!refreshed.ok) return refreshed;
  const order = await input.orders.getOrder(parsed.orderId);
  if (!order || order.memberId !== input.memberId) return fail("NOT_FOUND", "ORDER_NOT_FOUND");
  if (order.payState === "paid") return fail("FORBIDDEN", "PAID_ORDER_NOT_CLOSABLE");
  if (!canTransitionPayState(order.payState, "closed")) return fail("FORBIDDEN", "ORDER_NOT_CLOSABLE");
  const { mutation } = await input.orders.transactOrder({
    orderId: order.orderId,
    mutate: () => ({
      order: { ...order, payState: "closed", updatedAt: input.now.toISOString() },
      result: orderView({ ...order, payState: "closed" })
    })
  });
  return { ok: true, data: mutation.result as ReturnType<typeof orderView>, budget: emptyBudget() };
}

export async function publishPlan(input: {
  orders: OrderWorkStore;
  actorId: string;
  data: Record<string, unknown>;
  now: Date;
  enabled: boolean;
}): Promise<PurchaseSuccess<{ planId: string; planVersion: number; enabled: boolean }> | PurchaseFailure> {
  const parsed = parsePlanPublishInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "PLAN_INPUT_INVALID", { issues: parsed.issues });
  const existing = await input.orders.getPlan(parsed.plan.planId, parsed.plan.planVersion);
  if (existing) {
    if (
      existing.priceFen !== parsed.plan.priceFen ||
      existing.durationSeconds !== parsed.plan.durationSeconds ||
      existing.durationDays !== parsed.plan.durationDays
    ) {
      return fail("VERSION_CONFLICT", "PLAN_VERSION_MUST_BUMP");
    }
  }
  const row: VipPlanRecord = {
    planId: parsed.plan.planId,
    planVersion: parsed.plan.planVersion,
    title: parsed.plan.title,
    durationDays: parsed.plan.durationDays,
    durationSeconds: parsed.plan.durationSeconds,
    priceFen: parsed.plan.priceFen,
    productIds: parsed.plan.productIds,
    channels: parsed.plan.channels,
    enabled: input.enabled,
    testOnly: true,
    sort: parsed.plan.sort,
    priceNote: "TEST_PRICE",
    schemaVersion: 1,
    publishedAt: input.enabled ? input.now.toISOString() : existing?.publishedAt || null,
    updatedAt: input.now.toISOString()
  };
  await input.orders.savePlan(row);
  return {
    ok: true,
    data: { planId: row.planId, planVersion: row.planVersion, enabled: row.enabled },
    budget: emptyBudget()
  };
}

export async function disablePlan(input: {
  orders: OrderWorkStore;
  data: Record<string, unknown>;
  now: Date;
}): Promise<PurchaseSuccess<{ planId: string; planVersion: number; enabled: false }> | PurchaseFailure> {
  const planId = typeof input.data.planId === "string" ? input.data.planId.trim() : "";
  const planVersion = typeof input.data.planVersion === "number" ? input.data.planVersion : 0;
  if (!planId || !planVersion) return fail("INVALID_ARGUMENT", "PLAN_ID_REQUIRED");
  const existing = await input.orders.getPlan(planId, planVersion);
  if (!existing) return fail("NOT_FOUND", "PLAN_NOT_FOUND");
  await input.orders.savePlan({ ...existing, enabled: false, updatedAt: input.now.toISOString() });
  return { ok: true, data: { planId, planVersion, enabled: false }, budget: emptyBudget() };
}

export async function listAdminPlans(store: OrderWorkStore): Promise<PurchaseSuccess<{ items: VipPlanRecord[] }>> {
  return { ok: true, data: { items: await store.listPlans() }, budget: emptyBudget() };
}

export async function listAdminOrders(input: {
  orders: OrderWorkStore;
  data: Record<string, unknown>;
}): Promise<PurchaseSuccess<{ items: ReturnType<typeof orderView>[] }> | PurchaseFailure> {
  const memberId = typeof input.data.memberId === "string" ? input.data.memberId.trim() : "";
  if (!memberId) return fail("INVALID_ARGUMENT", "MEMBER_ID_REQUIRED");
  const rows = await input.orders.listOrdersByMember(memberId, 50);
  return { ok: true, data: { items: rows.map(orderView) }, budget: emptyBudget() };
}

export { planDocId, orderDocId };
