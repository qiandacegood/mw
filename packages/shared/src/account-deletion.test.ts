import { describe, expect, it } from "vitest";
import {
  DELETED_NICKNAME,
  accountDeletedBlocksRegister,
  collectDeletionPendingItems,
  deletionTerminalStatus,
  feedbackIsAnswerBank,
  markFeedbackSubmitterDeleted,
  matchAcknowledgementVersion,
  minimizeDeletedProfile,
  orderBlocksAccountDeletion,
  parseDeletionInput,
  publicProfileForStatus
} from "./account-deletion.js";
import { rankingPublicEligible } from "./ranking.js";

describe("deletion input and acknowledgement", () => {
  it("requires wx_login_code reauth and current agreement version", () => {
    expect(
      parseDeletionInput({
        reauthProof: { kind: "wx_login_code", code: "ok" },
        acknowledgementVersion: "mw24-test-agreement-v1"
      }).ok
    ).toBe(true);
    expect(parseDeletionInput({ acknowledgementVersion: "mw24-test-agreement-v1" }).ok).toBe(false);
    expect(
      parseDeletionInput({
        reauthProof: { kind: "wx_login_code", code: "ok" },
        acknowledgementVersion: "mw24-test-agreement-v1",
        openid: "forged"
      }).ok
    ).toBe(false);
    expect(matchAcknowledgementVersion("mw24-test-agreement-v1", "mw24-test-agreement-v1")).toEqual({ ok: true });
    expect(matchAcknowledgementVersion("mw08-test-agreement-v1", "mw24-test-agreement-v1")).toEqual({
      ok: false,
      reason: "POLICY_VERSION_MISMATCH"
    });
    expect(matchAcknowledgementVersion("x", "")).toEqual({ ok: false, reason: "POLICY_VERSION_MISSING" });
  });
});

describe("unfinished orders block deletion", () => {
  it("lists pending, confirming, paid-unsettled and open refunds; keeps completed evidence", () => {
    expect(orderBlocksAccountDeletion({ payState: "pending", grantState: "pending", refundState: "none" }).block).toBe(true);
    expect(orderBlocksAccountDeletion({ payState: "confirming", grantState: "pending", refundState: "none" }).block).toBe(true);
    expect(orderBlocksAccountDeletion({ payState: "paid", grantState: "processing", refundState: "none" }).block).toBe(true);
    expect(orderBlocksAccountDeletion({ payState: "paid", grantState: "granted", refundState: "processing" }).block).toBe(true);
    expect(orderBlocksAccountDeletion({ payState: "paid", grantState: "granted", refundState: "none" }).block).toBe(false);
    expect(orderBlocksAccountDeletion({ payState: "closed", grantState: "pending", refundState: "none" }).block).toBe(false);
    expect(orderBlocksAccountDeletion({ payState: "paid", grantState: "revokedRemaining", refundState: "succeeded" }).block).toBe(
      false
    );
    const items = collectDeletionPendingItems([
      { orderId: "o-pay", payState: "pending", grantState: "pending", refundState: "none" },
      { orderId: "o-done", payState: "paid", grantState: "granted", refundState: "none" }
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.orderId).toBe("o-pay");
    expect(JSON.stringify(items)).not.toMatch(/openid|OPENID/i);
  });
});

describe("deleted profile, ranking and feedback", () => {
  it("minimizes profile, leaves public ranking, and only marks feedback", () => {
    const now = "2026-10-19T01:00:00.000Z";
    const minimized = minimizeDeletedProfile({ nickname: "练习学员甲", avatarKey: "avatar.builtin.03", nowIso: now });
    expect(minimized).toMatchObject({
      nickname: DELETED_NICKNAME,
      avatarKey: "avatar.builtin.01",
      rankingOptIn: false,
      status: "deleted",
      deletedAt: now
    });
    expect(publicProfileForStatus({ status: "deleted", nickname: "甲", avatarKey: "avatar.builtin.02", rankingOptIn: true })).toEqual({
      nickname: DELETED_NICKNAME,
      avatarKey: "avatar.builtin.01",
      rankingOptIn: false
    });
    expect(rankingPublicEligible({ status: "deleted", rankingOptIn: true, rankingBanned: false })).toBe(false);
    expect(rankingPublicEligible({ status: "deleting", rankingOptIn: true })).toBe(false);
    expect(accountDeletedBlocksRegister("deleted")).toBe(true);
    expect(accountDeletedBlocksRegister("deleting")).toBe(true);
    expect(accountDeletedBlocksRegister("disabled")).toBe(false);
    expect(deletionTerminalStatus("deleted")).toBe(true);
    const marked = markFeedbackSubmitterDeleted(
      { submitterDeleted: false, submitterDeletedAt: "", updatedAt: "old", text: "题干有误" },
      now
    );
    expect(marked.submitterDeleted).toBe(true);
    expect(feedbackIsAnswerBank(marked)).toBe(false);
  });
});
