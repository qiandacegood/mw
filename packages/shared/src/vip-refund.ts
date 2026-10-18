import { hashNamedFields } from "./canonical.js";
import type { GrantState, PayState, RefundState } from "./types.js";
import { rejectUnknownKeys } from "./validate.js";

export type RefundChannel = "android" | "harmony" | "windows" | "ios";

const FULFILL_FORBIDDEN = [
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

function clientFulfillmentRejected(data: Record<string, unknown>): string[] {
  return FULFILL_FORBIDDEN.filter((key) => key in data);
}

export const REFUND_SCHEMA_VERSION = 1;
export const REFUND_ID_FIELDS = ["kind", "orderId"] as const;
export const REFUND_DIFF_ID_FIELDS = ["kind", "orderId", "diffKind"] as const;
export const REFUND_REQUEST_FIELDS = ["orderId", "reason"] as const;
export const REFUND_REVIEW_FIELDS = ["refundId", "orderId", "advice", "reason"] as const;
export const REFUND_EXECUTE_FIELDS = ["refundId", "orderId", "amountFen", "reason"] as const;
export const REFUND_CHANNEL_RESULT_FIELDS = ["refundId", "orderId", "outcome", "confirmedFen", "eventKey", "reason"] as const;
export const REFUND_FIXTURE_FIELDS = ["targetMemberId", "reason"] as const;
export const RECONCILE_FIELDS = ["orderId", "dayKey"] as const;
export const APPLE_REFUND_GUIDANCE =
  "请到 App Store 的购买记录申请退款。后台不能替你向 Apple 发起商户退款，最终由 Apple 决定。";

export const REFUND_DOC_STATES = ["requested", "reviewed", "processing", "succeeded", "failed", "needsReview"] as const;
export type RefundDocState = (typeof REFUND_DOC_STATES)[number];

export const REFUND_KINDS = ["whole", "partial", "apple_guidance"] as const;
export type RefundKind = (typeof REFUND_KINDS)[number];

export const REFUND_CHANNEL_OUTCOMES = ["accepted", "processing", "succeeded", "failed"] as const;
export type RefundChannelOutcome = (typeof REFUND_CHANNEL_OUTCOMES)[number];

export const RECONCILE_DIFF_KINDS = [
  "paid_ungranted",
  "local_paid_no_receipt",
  "amount_mismatch",
  "partial_refund_manual",
  "refund_grant_conflict",
  "grant_after_refund",
  "unknown_refund_result",
  "channel_refund_before_request"
] as const;
export type ReconcileDiffKind = (typeof RECONCILE_DIFF_KINDS)[number];

export type RefundRecord = {
  refundId: string;
  channelRefundNo: string;
  orderId: string;
  memberId: string;
  requestedFen: number;
  confirmedFen: number | null;
  state: RefundDocState;
  kind: RefundKind;
  channel: RefundChannel;
  channelRef: string;
  reason: string;
  reviewAdvice: string;
  reviewActorId: string;
  executeActorId: string;
  unknownResult: boolean;
  appleGuidance: boolean;
  fixture: boolean;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
};

export type ReconcileDiffRecord = {
  diffId: string;
  orderId: string;
  diffKind: ReconcileDiffKind;
  status: "open" | "resolved";
  localAmountFen: number;
  channelAmountFen: number | null;
  localPayState: string;
  localGrantState: string;
  localRefundState: string;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export function refundDocId(orderId: string): string {
  return hashNamedFields({ kind: "mw_refund", orderId }, REFUND_ID_FIELDS);
}

export function reconcileDiffId(orderId: string, diffKind: string): string {
  return hashNamedFields({ kind: "mw_reconcile", orderId, diffKind }, REFUND_DIFF_ID_FIELDS);
}

export function merchantRefundSupported(channel: RefundChannel): boolean {
  return channel !== "ios";
}

export function appleRefundGuidance(): string {
  return APPLE_REFUND_GUIDANCE;
}

export function canTransitionRefundState(from: RefundState, to: RefundState): boolean {
  if (from === to) return true;
  if (from === "succeeded") return false;
  if (from === "none") return to === "requested" || to === "processing" || to === "succeeded" || to === "failed";
  if (from === "requested") return to === "processing" || to === "succeeded" || to === "failed";
  if (from === "processing") return to === "succeeded" || to === "failed";
  if (from === "failed") return to === "processing" || to === "succeeded";
  return false;
}

export function canTransitionGrantState(from: GrantState, to: GrantState): boolean {
  if (from === to) return true;
  if (from === "revokedRemaining") return false;
  if (from === "pending") return to === "processing" || to === "granted" || to === "error";
  if (from === "processing") return to === "granted" || to === "error" || to === "pending";
  if (from === "granted") return to === "revokedRemaining";
  if (from === "error") return to === "processing" || to === "granted" || to === "pending";
  return false;
}

export function classifyRefundAmount(
  requestedFen: number,
  orderAmountFen: number
): { ok: true; kind: "whole" | "partial" } | { ok: false; reason: string } {
  if (!Number.isInteger(requestedFen) || requestedFen <= 0) return { ok: false, reason: "AMOUNT_INVALID" };
  if (requestedFen === orderAmountFen) return { ok: true, kind: "whole" };
  return { ok: true, kind: "partial" };
}

export function shouldGrantAfterRefund(refundState: RefundState): boolean {
  return refundState !== "succeeded";
}

export function shouldRevokeOnChannelOutcome(outcome: RefundChannelOutcome): boolean {
  return outcome === "succeeded";
}

/** 无事先 refund.request 时，渠道通知不得 insert/set 新退款单。 */
export function decideRefundNotifyWithoutRequest(input: {
  outcome: RefundChannelOutcome;
  confirmedFen: number | null;
  orderAmountFen: number;
  orderRefundState: RefundState;
}): {
  createRefund: false;
  revoke: boolean;
  replayed: boolean;
  nextRefundState: RefundState | null;
  reason: "NO_PRIOR_REFUND_REQUEST" | "CHANNEL_REFUND_BEFORE_REQUEST";
  diffKind: ReconcileDiffKind;
  note: string;
} {
  if (input.outcome !== "succeeded") {
    return {
      createRefund: false,
      revoke: false,
      replayed: false,
      nextRefundState: null,
      reason: "NO_PRIOR_REFUND_REQUEST",
      diffKind: "unknown_refund_result",
      note: "无申请且结果非最终成功：只记冲突/差异，不新建退款单"
    };
  }
  const cut = evaluateRefundAmountCut({
    kind: "whole",
    outcome: "succeeded",
    confirmedFen: input.confirmedFen,
    orderAmountFen: input.orderAmountFen
  });
  const already = input.orderRefundState === "succeeded";
  return {
    createRefund: false,
    revoke: cut.revoke && !already && !cut.manual,
    replayed: already,
    nextRefundState: cut.manual ? null : "succeeded",
    reason: "CHANNEL_REFUND_BEFORE_REQUEST",
    diffKind: cut.manual ? "partial_refund_manual" : "channel_refund_before_request",
    note: cut.manual
      ? "渠道成功但非整笔：转人工，不自动削天数，不新建退款单"
      : "渠道最终成功早于本系统申请：识别并处理权益，补单只绑定已发生结果，不得用未知结果路径另建单"
  };
}

export function refundBeforeGrantDecision(input: { grantState: GrantState; refundState: RefundState }): {
  grant: boolean;
  reason: string;
} {
  if (input.refundState === "succeeded") {
    return { grant: false, reason: "REFUND_TERMINAL_NO_GRANT" };
  }
  return { grant: true, reason: "GRANT_ALLOWED" };
}

export function evaluateRefundAmountCut(input: {
  kind: RefundKind;
  outcome: RefundChannelOutcome;
  confirmedFen: number | null;
  orderAmountFen: number;
}): { revoke: boolean; manual: boolean; reason: string } {
  if (input.outcome === "accepted" || input.outcome === "processing" || input.outcome === "failed") {
    return { revoke: false, manual: false, reason: "NOT_FINAL_SUCCESS" };
  }
  if (input.kind === "partial") {
    return { revoke: false, manual: true, reason: "PARTIAL_REFUND_MANUAL" };
  }
  if (input.confirmedFen !== null && input.confirmedFen !== input.orderAmountFen) {
    return { revoke: false, manual: true, reason: "PARTIAL_REFUND_MANUAL" };
  }
  return { revoke: true, manual: false, reason: "WHOLE_REFUND_SUCCESS" };
}

export function orderRefundDisplay(refundState: RefundState): { displayStatus: string; userHint?: string } {
  if (refundState === "requested") return { displayStatus: "申请处理中" };
  if (refundState === "processing") return { displayStatus: "渠道处理中" };
  if (refundState === "succeeded") return { displayStatus: "退款成功" };
  if (refundState === "failed") return { displayStatus: "退款失败" };
  return { displayStatus: "无退款" };
}

export function computeOrderDiffs(input: {
  order: {
    orderId: string;
    amountFen: number;
    payState: PayState;
    grantState: GrantState;
    refundState: RefundState;
    fixtureLedger?: boolean;
  };
  receipt?: { amountFen: number } | null;
  refund?: Pick<RefundRecord, "kind" | "state" | "unknownResult"> | null;
  grantRemainingSeconds?: number;
  now: Date;
}): ReconcileDiffRecord[] {
  const diffs: ReconcileDiffRecord[] = [];
  const push = (kind: ReconcileDiffKind, note: string, channelAmountFen: number | null = null) => {
    diffs.push({
      diffId: reconcileDiffId(input.order.orderId, kind),
      orderId: input.order.orderId,
      diffKind: kind,
      status: "open",
      localAmountFen: input.order.amountFen,
      channelAmountFen,
      localPayState: input.order.payState,
      localGrantState: input.order.grantState,
      localRefundState: input.order.refundState,
      note,
      createdAt: input.now.toISOString(),
      updatedAt: input.now.toISOString()
    });
  };
  if (input.order.payState === "paid" && !input.receipt && input.order.fixtureLedger !== true) {
    push("local_paid_no_receipt", "本地已付但无渠道回执");
  }
  if (input.receipt && input.receipt.amountFen !== input.order.amountFen) {
    push("amount_mismatch", "回执金额与订单金额不一致，不改金额", input.receipt.amountFen);
  }
  if (
    input.order.payState === "paid" &&
    input.order.grantState !== "granted" &&
    input.order.grantState !== "revokedRemaining" &&
    input.order.refundState !== "succeeded"
  ) {
    push("paid_ungranted", "已支付未开通");
  }
  if (input.refund?.kind === "partial" || input.refund?.state === "needsReview") {
    push("partial_refund_manual", "非整笔退款转人工，不自动削天数");
  }
  if (input.order.refundState === "succeeded" && input.order.grantState === "granted" && (input.grantRemainingSeconds || 0) > 0) {
    push("refund_grant_conflict", "退款已成功但仍有该来源未用时长待撤销");
  }
  if (input.order.refundState === "succeeded" && input.order.grantState === "granted") {
    push("grant_after_refund", "已退款后不得再开通；若已发放只扣该来源未用");
  }
  if (input.refund?.unknownResult === true && input.refund.state === "processing") {
    push("unknown_refund_result", "退款结果未知，不新建退款单");
  }
  if (!input.refund && input.order.refundState === "succeeded") {
    push("channel_refund_before_request", "渠道最终成功早于本系统申请；补单只绑定已发生结果，不得用未知结果路径另建退款单");
  }
  return diffs;
}

export function appleInquiryEvidence(input: {
  order?: { goodsNotified: boolean; grantState: GrantState; payState: PayState };
  grant?: { remainingSeconds: number; consumedSeconds: number; grantedSeconds: number };
}): {
  certain: boolean;
  delivery?: boolean;
  granted?: boolean;
  consumedSeconds?: number;
  remainingSeconds?: number;
  grantedSeconds?: number;
  note: string;
} {
  if (!input.order) {
    return { certain: false, note: "无订单证据，返回不确定结果，不编造使用记录" };
  }
  return {
    certain: true,
    delivery: input.order.goodsNotified === true,
    granted: input.order.grantState === "granted" || input.order.grantState === "revokedRemaining",
    consumedSeconds: input.grant?.consumedSeconds,
    remainingSeconds: input.grant?.remainingSeconds,
    grantedSeconds: input.grant?.grantedSeconds,
    note: "返回实际发货、开通和消耗证据"
  };
}

function token(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function parseRefundRequestInput(
  data: Record<string, unknown>
): { ok: true; orderId: string; reason: string } | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...REFUND_REQUEST_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  issues.push(...clientFulfillmentRejected(data).map((key) => `client fulfillment forbidden: ${key}`));
  const orderId = token(data.orderId, 128);
  const reason = token(data.reason, 200);
  if (!orderId) issues.push("orderId required");
  if (!reason) issues.push("reason required");
  if (issues.length) return { ok: false, issues };
  return { ok: true, orderId, reason };
}

export function parseRefundReviewInput(data: Record<string, unknown>):
  | { ok: true; refundId: string; orderId: string; advice: string; reason: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...REFUND_REVIEW_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const refundId = token(data.refundId, 128);
  const orderId = token(data.orderId, 128);
  const advice = token(data.advice, 200);
  const reason = token(data.reason, 200);
  if (!refundId && !orderId) issues.push("refundId or orderId required");
  if (!advice) issues.push("advice required");
  if (!reason) issues.push("reason required");
  if (issues.length) return { ok: false, issues };
  return { ok: true, refundId, orderId, advice, reason };
}

export function parseRefundExecuteInput(data: Record<string, unknown>):
  | { ok: true; refundId: string; orderId: string; amountFen: number; reason: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...REFUND_EXECUTE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const refundId = token(data.refundId, 128);
  const orderId = token(data.orderId, 128);
  const amountFen = asPositiveInt(data.amountFen);
  const reason = token(data.reason, 200);
  if (!refundId && !orderId) issues.push("refundId or orderId required");
  if (amountFen === undefined) issues.push("amountFen must be a positive integer");
  if (!reason) issues.push("reason required");
  if (issues.length) return { ok: false, issues };
  return { ok: true, refundId, orderId, amountFen: amountFen as number, reason };
}

export function parseRefundChannelResultInput(data: Record<string, unknown>):
  | {
      ok: true;
      refundId: string;
      orderId: string;
      outcome: RefundChannelOutcome;
      confirmedFen: number | null;
      eventKey: string;
      reason: string;
    }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...REFUND_CHANNEL_RESULT_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const refundId = token(data.refundId, 128);
  const orderId = token(data.orderId, 128);
  const outcome = data.outcome;
  const reason = token(data.reason, 200);
  const eventKey = token(data.eventKey, 128) || `refund:${orderId || refundId}`;
  if (!refundId && !orderId) issues.push("refundId or orderId required");
  if (typeof outcome !== "string" || !(REFUND_CHANNEL_OUTCOMES as readonly string[]).includes(outcome)) {
    issues.push("outcome must be accepted|processing|succeeded|failed");
  }
  if (!reason) issues.push("reason required");
  const confirmedFen =
    data.confirmedFen === undefined || data.confirmedFen === null ? null : asPositiveInt(data.confirmedFen);
  if (data.confirmedFen !== undefined && data.confirmedFen !== null && confirmedFen === undefined) {
    issues.push("confirmedFen must be a positive integer");
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    refundId,
    orderId,
    outcome: outcome as RefundChannelOutcome,
    confirmedFen: confirmedFen ?? null,
    eventKey,
    reason
  };
}

export function parseRefundFixtureInput(
  data: Record<string, unknown>
): { ok: true; memberId: string; reason: string } | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...REFUND_FIXTURE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const memberId = token(data.targetMemberId, 128);
  const reason = token(data.reason, 200);
  if (!memberId) issues.push("targetMemberId required");
  if (!reason) issues.push("reason required");
  if (issues.length) return { ok: false, issues };
  return { ok: true, memberId, reason };
}

export function parseReconcileInput(data: Record<string, unknown>):
  | { ok: true; orderId: string; dayKey: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...RECONCILE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  issues.push(...clientFulfillmentRejected(data).map((key) => `client fulfillment forbidden: ${key}`));
  if ("amountFen" in data) issues.push("order.reconcile must not change amount");
  const orderId = token(data.orderId, 128);
  const dayKey = token(data.dayKey, 16);
  if (issues.length) return { ok: false, issues };
  return { ok: true, orderId, dayKey };
}

export function nextRefundStateFromOutcome(outcome: RefundChannelOutcome): RefundState {
  if (outcome === "succeeded") return "succeeded";
  if (outcome === "failed") return "failed";
  return "processing";
}

export function nextRefundDocStateFromOutcome(outcome: RefundChannelOutcome): RefundDocState {
  if (outcome === "succeeded") return "succeeded";
  if (outcome === "failed") return "failed";
  return "processing";
}

export type { PayState };
