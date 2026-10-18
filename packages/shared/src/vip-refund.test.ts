import { describe, expect, it } from "vitest";
import {
  appleInquiryEvidence,
  appleRefundGuidance,
  canTransitionGrantState,
  canTransitionRefundState,
  classifyRefundAmount,
  computeOrderDiffs,
  decideRefundNotifyWithoutRequest,
  evaluateRefundAmountCut,
  merchantRefundSupported,
  parseRefundExecuteInput,
  parseRefundFixtureInput,
  parseRefundRequestInput,
  refundBeforeGrantDecision,
  refundDocId,
  shouldGrantAfterRefund,
  shouldRevokeOnChannelOutcome
} from "./vip-refund.js";

const now = new Date("2026-10-18T02:00:00.000Z");

describe("refund state machine and whole/partial", () => {
  it("allows defined refund migrations and rejects rewriting succeeded", () => {
    expect(canTransitionRefundState("none", "requested")).toBe(true);
    expect(canTransitionRefundState("none", "succeeded")).toBe(true);
    expect(canTransitionRefundState("requested", "processing")).toBe(true);
    expect(canTransitionRefundState("processing", "succeeded")).toBe(true);
    expect(canTransitionRefundState("succeeded", "failed")).toBe(false);
    expect(canTransitionGrantState("granted", "revokedRemaining")).toBe(true);
    expect(canTransitionGrantState("revokedRemaining", "granted")).toBe(false);
    expect(parseRefundFixtureInput({ targetMemberId: "m1", reason: "fixture" }).ok).toBe(true);
    expect(parseRefundFixtureInput({ memberId: "m1", reason: "fixture" }).ok).toBe(false);
    expect(classifyRefundAmount(9900, 9900)).toEqual({ ok: true, kind: "whole" });
    expect(classifyRefundAmount(100, 9900)).toEqual({ ok: true, kind: "partial" });
    expect(refundDocId("order-1")).toHaveLength(64);
  });

  it("revokes only after final whole success; accepted/processing/failed/partial do not cut days", () => {
    expect(shouldRevokeOnChannelOutcome("accepted")).toBe(false);
    expect(shouldRevokeOnChannelOutcome("processing")).toBe(false);
    expect(shouldRevokeOnChannelOutcome("failed")).toBe(false);
    expect(shouldRevokeOnChannelOutcome("succeeded")).toBe(true);
    expect(
      evaluateRefundAmountCut({ kind: "whole", outcome: "processing", confirmedFen: 9900, orderAmountFen: 9900 })
    ).toMatchObject({ revoke: false, reason: "NOT_FINAL_SUCCESS" });
    expect(
      evaluateRefundAmountCut({ kind: "partial", outcome: "succeeded", confirmedFen: 100, orderAmountFen: 9900 })
    ).toMatchObject({ revoke: false, manual: true, reason: "PARTIAL_REFUND_MANUAL" });
    expect(
      evaluateRefundAmountCut({ kind: "whole", outcome: "succeeded", confirmedFen: 9900, orderAmountFen: 9900 })
    ).toMatchObject({ revoke: true, manual: false });
  });
});

describe("refund vs grant ordering", () => {
  it("does not grant after a terminal refund and does not treat pending refund as revoke", () => {
    expect(shouldGrantAfterRefund("succeeded")).toBe(false);
    expect(shouldGrantAfterRefund("processing")).toBe(true);
    expect(shouldGrantAfterRefund("requested")).toBe(true);
    expect(refundBeforeGrantDecision({ grantState: "pending", refundState: "succeeded" })).toEqual({
      grant: false,
      reason: "REFUND_TERMINAL_NO_GRANT"
    });
    expect(refundBeforeGrantDecision({ grantState: "granted", refundState: "none" }).grant).toBe(true);
  });
});

describe("apple path and reconcile diffs", () => {
  it("refuses merchant refund on iOS and does not fabricate inquiry evidence", () => {
    expect(merchantRefundSupported("android")).toBe(true);
    expect(merchantRefundSupported("ios")).toBe(false);
    expect(appleRefundGuidance()).toContain("App Store");
    expect(appleInquiryEvidence({})).toMatchObject({ certain: false });
    expect(
      appleInquiryEvidence({
        order: { goodsNotified: true, grantState: "granted", payState: "paid" },
        grant: { grantedSeconds: 10, consumedSeconds: 2, remainingSeconds: 8 }
      })
    ).toMatchObject({ certain: true, delivery: true, granted: true, consumedSeconds: 2 });
  });

  it("lists diffs without changing amountFen", () => {
    const diffs = computeOrderDiffs({
      order: {
        orderId: "o1",
        amountFen: 9900,
        payState: "paid",
        grantState: "pending",
        refundState: "none",
        fixtureLedger: false
      },
      receipt: { amountFen: 100 },
      refund: { kind: "partial", state: "needsReview", unknownResult: false },
      now
    });
    expect(diffs.every((row) => row.localAmountFen === 9900)).toBe(true);
    expect(diffs.some((row) => row.diffKind === "amount_mismatch")).toBe(true);
    expect(diffs.some((row) => row.diffKind === "partial_refund_manual")).toBe(true);
    expect(diffs.some((row) => row.diffKind === "paid_ungranted")).toBe(true);
    expect(parseRefundRequestInput({ orderId: "o1" }).ok).toBe(false);
    expect(parseRefundExecuteInput({ orderId: "o1", amountFen: 9900, reason: "ok" }).ok).toBe(true);
    expect(
      decideRefundNotifyWithoutRequest({
        outcome: "processing",
        confirmedFen: null,
        orderAmountFen: 9900,
        orderRefundState: "none"
      })
    ).toMatchObject({ createRefund: false, revoke: false, reason: "NO_PRIOR_REFUND_REQUEST" });
    expect(
      decideRefundNotifyWithoutRequest({
        outcome: "succeeded",
        confirmedFen: 9900,
        orderAmountFen: 9900,
        orderRefundState: "none"
      })
    ).toMatchObject({
      createRefund: false,
      revoke: true,
      reason: "CHANNEL_REFUND_BEFORE_REQUEST",
      diffKind: "channel_refund_before_request"
    });
    const afterChannel = computeOrderDiffs({
      order: {
        orderId: "o2",
        amountFen: 9900,
        payState: "paid",
        grantState: "revokedRemaining",
        refundState: "succeeded"
      },
      refund: null,
      now
    });
    expect(afterChannel.some((row) => row.diffKind === "channel_refund_before_request")).toBe(true);
  });
});
