import { randomBytes } from "node:crypto";
import {
  REFUND_SCHEMA_VERSION,
  SECONDS_PER_DAY,
  VIP_SOURCE_ORDER,
  appleInquiryEvidence,
  appleRefundGuidance,
  applyVipGrant,
  buildAuditEntry,
  projectVipLedger,
  callbackEventId,
  canTransitionGrantState,
  canTransitionRefundState,
  classifyRefundAmount,
  computeOrderDiffs,
  decideRefundNotifyWithoutRequest,
  durationSecondsFromDays,
  evaluateRefundAmountCut,
  merchantRefundSupported,
  nextRefundDocStateFromOutcome,
  nextRefundStateFromOutcome,
  newOrderRecord,
  orderDisplayStatus,
  orderGrantReason,
  orderGrantSourceId,
  parseRefundChannelResultInput,
  parseRefundExecuteInput,
  parseRefundFixtureInput,
  parseRefundRequestInput,
  parseRefundReviewInput,
  parseReconcileInput,
  reconcileDiffId,
  refundDocId,
  revokeVipOrderSource,
  shouldGrantAfterRefund,
  vipGrantId,
  VIRTUAL_PAY_PROVIDER,
  type CallbackEventRecord,
  type MaintenanceConfig,
  type OrderRecord,
  type RefundRecord,
  type RefundChannelOutcome
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { MemberReadStore } from "./member-stores.js";
import type { OrderWorkStore } from "./order-stores.js";
import type { VipWorkStore } from "./vip-stores.js";

export const MEMBER_REFUND_ACTIONS = ["refund.request"] as const;
export const ADMIN_REFUND_ACTIONS = [
  "refund.review",
  "refund.execute",
  "refund.list",
  "refund.fixturePrepare",
  "refund.recordChannelResult"
] as const;

export type RefundFailure = {
  ok: false;
  code: string;
  reason: string;
  issues?: string[];
  details?: Record<string, unknown>;
};

export type RefundSuccess<T> = {
  ok: true;
  data: T;
  replayed?: boolean;
  budget: TxBudget;
};

function emptyBudget(): TxBudget {
  return { reads: 0, writes: 0, total: 0, elapsedMs: 0 };
}

function fail(code: string, reason: string, extra?: { issues?: string[]; details?: Record<string, unknown> }): RefundFailure {
  return {
    ok: false,
    code,
    reason,
    ...(extra?.issues ? { issues: extra.issues } : {}),
    ...(extra?.details ? { details: extra.details } : {})
  };
}

function orderSummary(order: OrderRecord) {
  return {
    orderId: order.orderId,
    amountFen: order.amountFen,
    channel: order.channel,
    payState: order.payState,
    grantState: order.grantState,
    refundState: order.refundState,
    fixtureLedger: order.fixtureLedger === true,
    ...orderDisplayStatus(order)
  };
}

function refundView(refund: RefundRecord, order?: OrderRecord) {
  return {
    refundId: refund.refundId,
    orderId: refund.orderId,
    requestedFen: refund.requestedFen,
    confirmedFen: refund.confirmedFen,
    state: refund.state,
    kind: refund.kind,
    channel: refund.channel,
    appleGuidance: refund.appleGuidance ? appleRefundGuidance() : undefined,
    merchantRefundSupported: merchantRefundSupported(refund.channel),
    unknownResult: refund.unknownResult,
    reviewAdvice: refund.reviewAdvice,
    reason: refund.reason,
    order: order ? orderSummary(order) : undefined
  };
}

function newChannelNo(): string {
  return randomBytes(16).toString("hex");
}

export function evidenceFromRefundNotify(payload: Record<string, unknown>): {
  channelBizNo: string;
  outcome: RefundChannelOutcome;
  confirmedFen: number | null;
  eventKey: string;
} | undefined {
  const rec = payload;
  const nested = (key: string): Record<string, unknown> => {
    const value = rec[key];
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  };
  const refundInfo = nested("RefundInfo");
  const pay = nested("WeChatPayInfo");
  const text = (obj: Record<string, unknown>, keys: string[]): string => {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  const intOf = (obj: Record<string, unknown>, keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === "number" && Number.isInteger(value)) return value;
      if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
    }
    return undefined;
  };
  const channelBizNo =
    text(rec, ["OutTradeNo", "out_trade_no", "order_id"]) ||
    text(pay, ["OutTradeNo"]) ||
    text(refundInfo, ["OutTradeNo"]);
  if (!channelBizNo) return undefined;
  const statusText = (
    text(rec, ["RefundStatus", "Status", "refund_status"]) ||
    text(refundInfo, ["RefundStatus", "Status"]) ||
    "succeeded"
  ).toLowerCase();
  let outcome: RefundChannelOutcome = "succeeded";
  if (statusText.includes("fail")) outcome = "failed";
  else if (statusText.includes("process") || statusText.includes("accept")) outcome = "processing";
  else if (statusText.includes("success") || statusText === "succeeded" || statusText === "2") outcome = "succeeded";
  const confirmedFen = intOf(refundInfo, ["RefundFee", "refund_fee", "Amount"]) ?? intOf(rec, ["RefundFee", "Amount"]);
  const eventKey =
    text(rec, ["RefundId", "refund_id", "WxRefundId"]) ||
    text(refundInfo, ["RefundId"]) ||
    `refund-notify:${channelBizNo}`;
  return { channelBizNo, outcome, confirmedFen: confirmedFen ?? null, eventKey };
}

async function loadRefund(orders: OrderWorkStore, refundId: string, orderId: string): Promise<RefundRecord | undefined> {
  if (refundId) {
    const byId = await orders.getRefund(refundId);
    if (byId) return byId;
  }
  if (orderId) return orders.getRefundByOrder(orderId);
  return undefined;
}

export async function requestRefund(input: {
  orders: OrderWorkStore;
  memberId: string;
  data: Record<string, unknown>;
  now: Date;
  actorId: string;
  requestId: string;
}): Promise<RefundSuccess<ReturnType<typeof refundView>> | RefundFailure> {
  const parsed = parseRefundRequestInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "REFUND_REQUEST_INPUT_INVALID", { issues: parsed.issues });
  const order = await input.orders.getOrder(parsed.orderId);
  if (!order || order.memberId !== input.memberId) return fail("NOT_FOUND", "ORDER_NOT_FOUND");
  const refundId = refundDocId(order.orderId);
  const existing = await input.orders.getRefund(refundId);
  if (existing) {
    return { ok: true, data: refundView(existing, order), replayed: true, budget: emptyBudget() };
  }
  const apple = !merchantRefundSupported(order.channel);
  const kind = apple ? "apple_guidance" : "whole";
  const backfillSucceeded = order.refundState === "succeeded";
  const created: RefundRecord = {
    refundId,
    channelRefundNo: newChannelNo(),
    orderId: order.orderId,
    memberId: order.memberId,
    requestedFen: order.amountFen,
    confirmedFen: backfillSucceeded ? order.amountFen : null,
    state: backfillSucceeded ? "succeeded" : "requested",
    kind,
    channel: order.channel,
    channelRef: backfillSucceeded ? "channel-before-request" : "",
    reason: parsed.reason,
    reviewAdvice: "",
    reviewActorId: "",
    executeActorId: "",
    unknownResult: false,
    appleGuidance: apple,
    fixture: order.fixtureLedger === true,
    createdAt: input.now.toISOString(),
    updatedAt: input.now.toISOString(),
    schemaVersion: REFUND_SCHEMA_VERSION
  };
  const nextRefundState = backfillSucceeded
    ? order.refundState
    : canTransitionRefundState(order.refundState, "requested")
      ? "requested"
      : order.refundState;
  const { mutation, budget } = await input.orders.transactOrder({
    orderId: order.orderId,
    refundId,
    mutate: () => ({
      order: { ...order, refundState: nextRefundState, updatedAt: input.now.toISOString() },
      refund: created,
      audit: buildAuditEntry({
        actorType: "member",
        actorId: input.actorId,
        action: "refund.request",
        target: refundId,
        reason: parsed.reason,
        requestId: input.requestId,
        after: { kind, apple },
        now: input.now
      }),
      result: refundView(created, { ...order, refundState: nextRefundState })
    })
  });
  return { ok: true, data: mutation.result as ReturnType<typeof refundView>, budget };
}

export async function reviewRefund(input: {
  orders: OrderWorkStore;
  actorId: string;
  data: Record<string, unknown>;
  now: Date;
  requestId: string;
}): Promise<RefundSuccess<ReturnType<typeof refundView>> | RefundFailure> {
  const parsed = parseRefundReviewInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "REFUND_REVIEW_INPUT_INVALID", { issues: parsed.issues });
  const refund = await loadRefund(input.orders, parsed.refundId, parsed.orderId);
  if (!refund) return fail("NOT_FOUND", "REFUND_NOT_FOUND");
  const order = await input.orders.getOrder(refund.orderId);
  if (!order) return fail("NOT_FOUND", "ORDER_NOT_FOUND");
  const next: RefundRecord = {
    ...refund,
    state: refund.state === "requested" ? "reviewed" : refund.state,
    reviewAdvice: parsed.advice,
    reviewActorId: input.actorId,
    reason: parsed.reason,
    updatedAt: input.now.toISOString()
  };
  const { mutation, budget } = await input.orders.transactOrder({
    orderId: order.orderId,
    refundId: refund.refundId,
    mutate: () => ({
      refund: next,
      audit: buildAuditEntry({
        actorType: "admin",
        actorId: input.actorId,
        action: "refund.review",
        target: refund.refundId,
        reason: parsed.reason,
        requestId: input.requestId,
        after: { advice: parsed.advice },
        now: input.now
      }),
      result: refundView(next, order)
    })
  });
  return { ok: true, data: mutation.result as ReturnType<typeof refundView>, budget };
}

export async function executeRefund(input: {
  orders: OrderWorkStore;
  actorId: string;
  data: Record<string, unknown>;
  now: Date;
  requestId: string;
}): Promise<RefundSuccess<ReturnType<typeof refundView>> | RefundFailure> {
  const parsed = parseRefundExecuteInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "REFUND_EXECUTE_INPUT_INVALID", { issues: parsed.issues });
  const refund = await loadRefund(input.orders, parsed.refundId, parsed.orderId);
  if (!refund) return fail("NOT_FOUND", "REFUND_NOT_FOUND");
  const order = await input.orders.getOrder(refund.orderId);
  if (!order) return fail("NOT_FOUND", "ORDER_NOT_FOUND");
  if (!merchantRefundSupported(order.channel) || refund.appleGuidance || refund.kind === "apple_guidance") {
    return fail("FORBIDDEN", "MERCHANT_REFUND_UNSUPPORTED", {
      details: { appleGuidance: appleRefundGuidance() }
    });
  }
  if (refund.state === "processing" && refund.unknownResult) {
    return { ok: true, data: refundView(refund, order), replayed: true, budget: emptyBudget() };
  }
  if (refund.state === "succeeded") {
    return { ok: true, data: refundView(refund, order), replayed: true, budget: emptyBudget() };
  }
  const classified = classifyRefundAmount(parsed.amountFen, order.amountFen);
  if (!classified.ok) return fail("INVALID_ARGUMENT", classified.reason);
  if (classified.kind === "partial") {
    const next: RefundRecord = {
      ...refund,
      kind: "partial",
      requestedFen: parsed.amountFen,
      state: "needsReview",
      executeActorId: input.actorId,
      reason: parsed.reason,
      updatedAt: input.now.toISOString()
    };
    const diffs = computeOrderDiffs({ order, refund: next, now: input.now });
    const { mutation, budget } = await input.orders.transactOrder({
      orderId: order.orderId,
      refundId: refund.refundId,
      mutate: () => ({
        order: { ...order, needsReview: true, reviewReason: "PARTIAL_REFUND_MANUAL", updatedAt: input.now.toISOString() },
        refund: next,
        diffs,
        audit: buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: "refund.execute",
          target: refund.refundId,
          reason: parsed.reason,
          requestId: input.requestId,
          after: { kind: "partial" },
          now: input.now
        }),
        result: refundView(next, { ...order, needsReview: true })
      })
    });
    return { ok: true, data: mutation.result as ReturnType<typeof refundView>, budget };
  }
  if (!canTransitionRefundState(order.refundState, "processing") && order.refundState !== "processing") {
    return fail("FORBIDDEN", "REFUND_STATE_INVALID");
  }
  const next: RefundRecord = {
    ...refund,
    kind: "whole",
    requestedFen: parsed.amountFen,
    state: "processing",
    executeActorId: input.actorId,
    reason: parsed.reason,
    unknownResult: true,
    channelRef: refund.channelRef || `sandbox:${refund.channelRefundNo}`,
    updatedAt: input.now.toISOString()
  };
  const { mutation, budget } = await input.orders.transactOrder({
    orderId: order.orderId,
    refundId: refund.refundId,
    mutate: () => ({
      order: { ...order, refundState: "processing", updatedAt: input.now.toISOString() },
      refund: next,
      diffs: computeOrderDiffs({ order: { ...order, refundState: "processing" }, refund: next, now: input.now }),
      audit: buildAuditEntry({
        actorType: "admin",
        actorId: input.actorId,
        action: "refund.execute",
        target: refund.refundId,
        reason: parsed.reason,
        requestId: input.requestId,
        after: { state: "processing", liveRefund: false },
        now: input.now
      }),
      result: refundView(next, { ...order, refundState: "processing" })
    })
  });
  return { ok: true, data: mutation.result as ReturnType<typeof refundView>, budget };
}

async function revokeOrderSourceIfNeeded(input: {
  vip: VipWorkStore;
  order: OrderRecord;
  now: Date;
  reason: string;
}): Promise<{ revokedSeconds: number; replayed: boolean; error?: string }> {
  const sourceId = orderGrantSourceId(input.order);
  const grantId = vipGrantId(VIP_SOURCE_ORDER, sourceId);
  const existing = await input.vip.listGrants(input.order.memberId);
  if (!existing.some((row) => row.grantId === grantId || row.sourceId === sourceId)) {
    return { revokedSeconds: 0, replayed: true };
  }
  const { mutation } = await input.vip.transactLedger({
    memberId: input.order.memberId,
    grantIds: [...new Set([grantId, ...existing.map((row) => row.grantId)])],
    mutate: (snap) => {
      const revoked = revokeVipOrderSource({
        account: snap.account,
        grants: snap.grants,
        sourceId,
        now: input.now,
        reason: input.reason
      });
      if (!revoked.ok) return { error: revoked.reason, result: null };
      return {
        account: revoked.account,
        grants: revoked.grants,
        events: revoked.events,
        result: { revokedSeconds: revoked.revokedSeconds, replayed: revoked.replayed },
        replayed: revoked.replayed
      };
    }
  });
  if (mutation.error) return { revokedSeconds: 0, replayed: false, error: mutation.error };
  const result = mutation.result as { revokedSeconds: number; replayed: boolean } | null;
  return { revokedSeconds: result?.revokedSeconds || 0, replayed: result?.replayed === true };
}

export async function applyRefundChannelOutcome(input: {
  orders: OrderWorkStore;
  vip: VipWorkStore;
  order: OrderRecord;
  refund?: RefundRecord;
  outcome: RefundChannelOutcome;
  confirmedFen: number | null;
  eventKey: string;
  now: Date;
  actorId: string;
  reason: string;
}): Promise<{
  refund?: RefundRecord;
  order: OrderRecord;
  revokedSeconds: number;
  replayed: boolean;
  vipTouched: boolean;
  refundCreated: false;
  reason: string;
}> {
  const refundId = input.refund?.refundId || refundDocId(input.order.orderId);
  const existing = input.refund || (await input.orders.getRefund(refundId));
  const eventId = callbackEventId(VIRTUAL_PAY_PROVIDER, input.eventKey);
  const callback: CallbackEventRecord = {
    eventId,
    provider: VIRTUAL_PAY_PROVIDER,
    type: "xpay_refund_notify",
    orderId: input.order.orderId,
    payloadDigest: input.eventKey,
    status: "matched",
    createdAt: input.now.toISOString()
  };
  if (existing?.state === "succeeded") {
    return {
      refund: existing,
      order: input.order,
      revokedSeconds: 0,
      replayed: true,
      vipTouched: false,
      refundCreated: false,
      reason: "REPLAY"
    };
  }
  if (!existing) {
    const decision = decideRefundNotifyWithoutRequest({
      outcome: input.outcome,
      confirmedFen: input.confirmedFen,
      orderAmountFen: input.order.amountFen,
      orderRefundState: input.order.refundState
    });
    let grantState = input.order.grantState;
    let revokedSeconds = 0;
    let vipTouched = false;
    if (decision.revoke) {
      const revoked = await revokeOrderSourceIfNeeded({
        vip: input.vip,
        order: input.order,
        now: input.now,
        reason: input.reason
      });
      revokedSeconds = revoked.revokedSeconds;
      vipTouched = true;
      if (input.order.grantState === "granted" && canTransitionGrantState("granted", "revokedRemaining")) {
        grantState = "revokedRemaining";
      }
    }
    const nextRefundState =
      decision.nextRefundState && canTransitionRefundState(input.order.refundState, decision.nextRefundState)
        ? decision.nextRefundState
        : input.order.refundState;
    const order: OrderRecord = {
      ...input.order,
      refundState: nextRefundState,
      grantState,
      needsReview: decision.diffKind === "partial_refund_manual" || input.order.needsReview,
      reviewReason: decision.diffKind === "partial_refund_manual" ? "PARTIAL_REFUND_MANUAL" : input.order.reviewReason,
      updatedAt: input.now.toISOString()
    };
    await input.orders.transactOrder({
      orderId: order.orderId,
      callbackId: eventId,
      mutate: (snap) => {
        const diffs = computeOrderDiffs({
          order,
          refund: null,
          grantRemainingSeconds: decision.revoke ? 0 : undefined,
          now: input.now
        });
        if (!diffs.some((row) => row.diffKind === decision.diffKind)) {
          diffs.push({
            diffId: reconcileDiffId(order.orderId, decision.diffKind),
            orderId: order.orderId,
            diffKind: decision.diffKind,
            status: "open",
            localAmountFen: order.amountFen,
            channelAmountFen: input.confirmedFen,
            localPayState: order.payState,
            localGrantState: order.grantState,
            localRefundState: order.refundState,
            note: decision.note,
            createdAt: input.now.toISOString(),
            updatedAt: input.now.toISOString()
          });
        }
        return {
          order,
          callback: snap.callback || callback,
          diffs,
          result: null,
          replayed: snap.callback !== undefined
        };
      }
    });
    return {
      refund: undefined,
      order,
      revokedSeconds,
      replayed: decision.replayed,
      vipTouched,
      refundCreated: false,
      reason: decision.reason
    };
  }
  const kind = existing.kind;
  const cut = evaluateRefundAmountCut({
    kind,
    outcome: input.outcome,
    confirmedFen: input.confirmedFen,
    orderAmountFen: input.order.amountFen
  });
  const nextDocState = cut.manual ? "needsReview" : nextRefundDocStateFromOutcome(input.outcome);
  const nextOrderRefund = cut.manual
    ? input.order.refundState
    : canTransitionRefundState(input.order.refundState, nextRefundStateFromOutcome(input.outcome))
      ? nextRefundStateFromOutcome(input.outcome)
      : input.order.refundState;
  const refund: RefundRecord = {
    ...existing,
    confirmedFen: input.confirmedFen,
    state: nextDocState,
    kind: cut.manual ? "partial" : kind === "apple_guidance" ? "apple_guidance" : "whole",
    channelRef: existing.channelRef || input.eventKey,
    reason: input.reason,
    unknownResult: input.outcome === "processing" || input.outcome === "accepted",
    updatedAt: input.now.toISOString()
  };
  let grantState = input.order.grantState;
  let revokedSeconds = 0;
  let replayed = false;
  let vipTouched = false;
  if (cut.revoke) {
    const revoked = await revokeOrderSourceIfNeeded({
      vip: input.vip,
      order: input.order,
      now: input.now,
      reason: input.reason
    });
    revokedSeconds = revoked.revokedSeconds;
    replayed = revoked.replayed;
    vipTouched = true;
    if (input.order.grantState === "granted" && canTransitionGrantState("granted", "revokedRemaining")) {
      grantState = "revokedRemaining";
    }
  }
  const order: OrderRecord = {
    ...input.order,
    refundState: nextOrderRefund,
    grantState,
    needsReview: cut.manual || input.order.needsReview,
    reviewReason: cut.manual ? "PARTIAL_REFUND_MANUAL" : input.order.reviewReason,
    updatedAt: input.now.toISOString()
  };
  await input.orders.transactOrder({
    orderId: order.orderId,
    refundId,
    callbackId: eventId,
    mutate: (snap) => ({
      order,
      refund,
      callback: snap.callback || callback,
      diffs: computeOrderDiffs({
        order,
        refund,
        grantRemainingSeconds: cut.revoke ? 0 : undefined,
        now: input.now
      }),
      result: null,
      replayed: snap.callback !== undefined
    })
  });
  return {
    refund,
    order,
    revokedSeconds,
    replayed,
    vipTouched,
    refundCreated: false,
    reason: cut.manual ? "PARTIAL_REFUND_MANUAL" : "APPLIED"
  };
}

export async function recordRefundChannelResult(input: {
  orders: OrderWorkStore;
  vip: VipWorkStore;
  data: Record<string, unknown>;
  now: Date;
  actorId: string;
}): Promise<RefundSuccess<Record<string, unknown> & { revokedSeconds: number; refundCreated: false }> | RefundFailure> {
  const parsed = parseRefundChannelResultInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "REFUND_CHANNEL_RESULT_INVALID", { issues: parsed.issues });
  const refund = await loadRefund(input.orders, parsed.refundId, parsed.orderId);
  const orderId = parsed.orderId || refund?.orderId || "";
  const order = orderId ? await input.orders.getOrder(orderId) : undefined;
  if (!order) return fail("NOT_FOUND", "ORDER_NOT_FOUND");
  const applied = await applyRefundChannelOutcome({
    orders: input.orders,
    vip: input.vip,
    order,
    refund,
    outcome: parsed.outcome,
    confirmedFen: parsed.confirmedFen,
    eventKey: parsed.eventKey,
    now: input.now,
    actorId: input.actorId,
    reason: parsed.reason
  });
  return {
    ok: true,
    data: applied.refund
      ? { ...refundView(applied.refund, applied.order), revokedSeconds: applied.revokedSeconds, refundCreated: false }
      : {
          ...orderSummary(applied.order),
          revokedSeconds: applied.revokedSeconds,
          refundCreated: false,
          reason: applied.reason
        },
    replayed: applied.replayed,
    budget: emptyBudget()
  };
}

export async function listAdminRefunds(input: {
  orders: OrderWorkStore;
}): Promise<RefundSuccess<{ items: ReturnType<typeof refundView>[] }>> {
  const rows = await input.orders.listRefunds(50);
  const items = [];
  for (const row of rows) {
    const order = await input.orders.getOrder(row.orderId);
    items.push(refundView(row, order));
  }
  return { ok: true, data: { items }, budget: emptyBudget() };
}

export async function reconcileOrders(input: {
  orders: OrderWorkStore;
  vip?: VipWorkStore;
  data: Record<string, unknown>;
  now: Date;
}): Promise<
  | RefundSuccess<{
      amountFenUnchanged: true;
      order?: ReturnType<typeof orderSummary>;
      diffs: Awaited<ReturnType<OrderWorkStore["listDiffs"]>>;
    }>
  | RefundFailure
> {
  const parsed = parseReconcileInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "RECONCILE_INPUT_INVALID", { issues: parsed.issues });
  if (!parsed.orderId) {
    const diffs = await input.orders.listDiffs(50);
    return { ok: true, data: { amountFenUnchanged: true, diffs }, budget: emptyBudget() };
  }
  const order = await input.orders.getOrder(parsed.orderId);
  if (!order) return fail("NOT_FOUND", "ORDER_NOT_FOUND");
  const originalAmount = order.amountFen;
  const refund = await input.orders.getRefundByOrder(order.orderId);
  const grants = input.vip ? await input.vip.listGrants(order.memberId) : [];
  const sourceId = orderGrantSourceId(order);
  const grant = grants.find((row) => row.sourceType === VIP_SOURCE_ORDER && row.sourceId === sourceId);
  const diffs = computeOrderDiffs({
    order,
    refund,
    grantRemainingSeconds: grant?.remainingSeconds,
    now: input.now
  });
  await input.orders.transactOrder({
    orderId: order.orderId,
    refundId: refund?.refundId,
    mutate: (snap) => ({
      order: snap.order ? { ...snap.order, amountFen: originalAmount, updatedAt: snap.order.updatedAt } : order,
      diffs,
      result: { amountFen: originalAmount }
    })
  });
  const latest = (await input.orders.getOrder(order.orderId)) || order;
  if (latest.amountFen !== originalAmount) {
    return fail("INTERNAL_ERROR", "AMOUNT_CHANGED");
  }
  return {
    ok: true,
    data: { amountFenUnchanged: true, order: orderSummary(latest), diffs },
    budget: emptyBudget()
  };
}

export async function appleRefundInquiry(input: {
  orders: OrderWorkStore;
  vip: VipWorkStore;
  channelBizNo: string;
}): Promise<ReturnType<typeof appleInquiryEvidence>> {
  const order = await input.orders.getOrderByBizNo(input.channelBizNo);
  if (!order) return appleInquiryEvidence({});
  const grants = await input.vip.listGrants(order.memberId);
  const grant = grants.find((row) => row.sourceType === VIP_SOURCE_ORDER && row.sourceId === orderGrantSourceId(order));
  return appleInquiryEvidence({
    order,
    grant: grant
      ? {
          grantedSeconds: grant.grantedSeconds,
          consumedSeconds: grant.consumedSeconds,
          remainingSeconds: grant.remainingSeconds
        }
      : undefined
  });
}

function fixtureSnapshot(channel: "android" | "ios", durationDays: number, now: Date): OrderRecord["planSnapshot"] {
  return {
    planId: "plan_mw22_fixture",
    planVersion: 1,
    title: "MW22 测试夹具（非正式售价）",
    durationDays,
    durationSeconds: durationSecondsFromDays(durationDays),
    priceFen: 9900,
    productId: channel === "ios" ? "test_ios_fixture" : "test_android_fixture",
    channel,
    environment: 1,
    testOnly: true
  };
}

async function writeFixtureOrder(input: {
  orders: OrderWorkStore;
  vip: VipWorkStore;
  memberId: string;
  openId: string;
  channel: "android" | "ios";
  durationDays: number;
  grantedAt: Date;
  now: Date;
  grant: boolean;
}): Promise<OrderRecord> {
  const snapshot = fixtureSnapshot(input.channel, input.durationDays, input.now);
  const order = {
    ...newOrderRecord({
      channelBizNo: newChannelNo(),
      memberId: input.memberId,
      openId: input.openId,
      snapshot,
      now: input.grantedAt
    }),
    payState: "paid" as const,
    grantState: input.grant ? ("granted" as const) : ("pending" as const),
    paidAt: input.grantedAt.toISOString(),
    grantedAt: input.grant ? input.grantedAt.toISOString() : null,
    fixtureLedger: true,
    updatedAt: input.now.toISOString()
  };
  await input.orders.transactOrder({
    orderId: order.orderId,
    mutate: () => ({ order, result: null })
  });
  if (input.grant) {
    const sourceId = orderGrantSourceId(order);
    const grantId = vipGrantId(VIP_SOURCE_ORDER, sourceId);
    const existing = await input.vip.listGrants(input.memberId);
    await input.vip.transactLedger({
      memberId: input.memberId,
      grantIds: [...new Set([grantId, ...existing.map((row) => row.grantId)])],
      mutate: (snap) => {
        const applied = applyVipGrant({
          account: snap.account,
          grants: snap.grants,
          memberId: input.memberId,
          sourceType: VIP_SOURCE_ORDER,
          sourceId,
          durationSeconds: snapshot.durationSeconds,
          grantedAt: input.grantedAt,
          reason: orderGrantReason(order),
          actorId: "mw22-fixture"
        });
        if (!applied.ok) return { error: applied.reason, result: null };
        return { account: applied.account, grants: applied.grants, events: applied.events, result: applied.grant };
      }
    });
  }
  return order;
}

export async function prepareRefundFixture(input: {
  orders: OrderWorkStore;
  vip: VipWorkStore;
  members?: MemberReadStore;
  data: Record<string, unknown>;
  now: Date;
  actorId: string;
  requestId: string;
  configuredEnv: unknown;
}): Promise<RefundSuccess<Record<string, unknown>> | RefundFailure> {
  if (String(input.configuredEnv) !== "1") return fail("FORBIDDEN", "LIVE_ENV_NOT_USED");
  const parsed = parseRefundFixtureInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "FIXTURE_INPUT_INVALID", { issues: parsed.issues });
  if (input.members) {
    const member = await input.members.getMember(parsed.memberId);
    if (!member) return fail("NOT_FOUND", "MEMBER_NOT_FOUND");
  }
  const day = SECONDS_PER_DAY * 1000;
  const keepAt = new Date(input.now.getTime() - 20 * day);
  const keepA = await writeFixtureOrder({
    orders: input.orders,
    vip: input.vip,
    memberId: parsed.memberId,
    openId: "mw22_fixture_openid",
    channel: "android",
    durationDays: 30,
    grantedAt: keepAt,
    now: input.now,
    grant: true
  });
  const keepB = await writeFixtureOrder({
    orders: input.orders,
    vip: input.vip,
    memberId: parsed.memberId,
    openId: "mw22_fixture_openid",
    channel: "android",
    durationDays: 30,
    grantedAt: keepAt,
    now: input.now,
    grant: true
  });
  const keepAccount = await input.vip.getAccount(parsed.memberId);
  const keepGrants = await input.vip.listGrants(parsed.memberId);
  const projectedKeep = projectVipLedger({ account: keepAccount, grants: keepGrants, now: input.now });
  await input.vip.transactLedger({
    memberId: parsed.memberId,
    grantIds: projectedKeep.grants.map((row) => row.grantId),
    mutate: () => ({
      account: {
        ...projectedKeep.account,
        settledAt: input.now.toISOString(),
        expiresAt: new Date(input.now.getTime() + projectedKeep.account.remainingSeconds * 1000).toISOString(),
        updatedAt: input.now.toISOString()
      },
      grants: projectedKeep.grants,
      result: null
    })
  });
  const remainingOf = (order: OrderRecord, rows: typeof projectedKeep.grants) =>
    rows.find((row) => row.sourceType === VIP_SOURCE_ORDER && row.sourceId === orderGrantSourceId(order))?.remainingSeconds ?? 0;
  const keepRemaining = {
    remainingASeconds: remainingOf(keepA, projectedKeep.grants),
    remainingBSeconds: remainingOf(keepB, projectedKeep.grants)
  };
  const usedA = await writeFixtureOrder({
    orders: input.orders,
    vip: input.vip,
    memberId: parsed.memberId,
    openId: "mw22_fixture_openid",
    channel: "android",
    durationDays: 10,
    grantedAt: input.now,
    now: input.now,
    grant: true
  });
  const usedB = await writeFixtureOrder({
    orders: input.orders,
    vip: input.vip,
    memberId: parsed.memberId,
    openId: "mw22_fixture_openid",
    channel: "android",
    durationDays: 30,
    grantedAt: input.now,
    now: input.now,
    grant: true
  });
  const afterUsed = await input.vip.listGrants(parsed.memberId);
  const usedGrantId = vipGrantId(VIP_SOURCE_ORDER, orderGrantSourceId(usedA));
  await input.vip.transactLedger({
    memberId: parsed.memberId,
    grantIds: afterUsed.map((row) => row.grantId),
    mutate: (snap) => {
      const grants = snap.grants.map((row) =>
        row.grantId === usedGrantId
          ? { ...row, remainingSeconds: 0, consumedSeconds: row.grantedSeconds }
          : row
      );
      const remaining = grants.reduce((sum, row) => sum + Math.max(0, row.remainingSeconds), 0);
      const account = snap.account
        ? {
            ...snap.account,
            remainingSeconds: remaining,
            settledAt: input.now.toISOString(),
            expiresAt: remaining > 0 ? new Date(input.now.getTime() + remaining * 1000).toISOString() : input.now.toISOString(),
            updatedAt: input.now.toISOString()
          }
        : snap.account;
      return { account, grants, result: null };
    }
  });
  const apple = await writeFixtureOrder({
    orders: input.orders,
    vip: input.vip,
    memberId: parsed.memberId,
    openId: "mw22_fixture_openid",
    channel: "ios",
    durationDays: 30,
    grantedAt: input.now,
    now: input.now,
    grant: true
  });
  const beforeGrant = await writeFixtureOrder({
    orders: input.orders,
    vip: input.vip,
    memberId: parsed.memberId,
    openId: "mw22_fixture_openid",
    channel: "android",
    durationDays: 30,
    grantedAt: input.now,
    now: input.now,
    grant: false
  });
  const grants = await input.vip.listGrants(parsed.memberId);
  return {
    ok: true,
    data: {
      fixture: true,
      livePayment: false,
      liveRefund: false,
      priceNote: "TEST_PRICE",
      keepB: {
        orderA: keepA.orderId,
        orderB: keepB.orderId,
        remainingASeconds: keepRemaining.remainingASeconds,
        remainingBSeconds: keepRemaining.remainingBSeconds
      },
      consumedA: {
        orderA: usedA.orderId,
        orderB: usedB.orderId,
        remainingASeconds: remainingOf(usedA, grants),
        remainingBSeconds: remainingOf(usedB, grants)
      },
      apple: {
        orderId: apple.orderId,
        merchantRefundSupported: false,
        appleGuidance: appleRefundGuidance()
      },
      beforeGrant: { orderId: beforeGrant.orderId, grantState: beforeGrant.grantState, payState: beforeGrant.payState },
      leftover: {
        orders: [keepA.orderId, keepB.orderId, usedA.orderId, usedB.orderId, apple.orderId, beforeGrant.orderId]
      }
    },
    budget: emptyBudget()
  };
}

export type { MaintenanceConfig };
