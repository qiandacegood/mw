import { describe, expect, it } from "vitest";
import {
  OPS_STATS_NOTES,
  OPS_TUTORIAL_STEPS,
  aggregateOpsExceptions,
  aggregateOpsStats,
  canViewOpsStats,
  canViewOpsTutorial,
  isAbnormalGrantOrder,
  isRegisteredMemberStatus,
  isValidSubmittedAttempt,
  opsStatsSnapshotId,
  opsStatsSnapshotWrite,
  stripOpsStatsMoney,
  tutorialStepsForRoles
} from "./ops-stats.js";

const now = new Date("2026-10-19T02:00:00.000Z");

describe("MW25 ops stats口径", () => {
  it("counts registered members excluding deleted, and repeat practice into paper times", () => {
    const view = aggregateOpsStats({
      now,
      members: [
        { memberId: "a", status: "active" },
        { memberId: "b", status: "disabled" },
        { memberId: "c", status: "deleting" },
        { memberId: "d", status: "deleted" }
      ],
      attempts: [
        {
          attemptId: "t1",
          memberId: "a",
          paperId: "p1",
          paperTitle: "卷甲",
          score: 60,
          state: "submitted",
          submittedAt: "2026-10-18T18:10:00.000Z"
        },
        {
          attemptId: "t2",
          memberId: "a",
          paperId: "p1",
          paperTitle: "卷甲",
          score: 80,
          state: "submitted",
          submittedAt: "2026-10-18T20:10:00.000Z"
        },
        {
          attemptId: "t3",
          memberId: "b",
          paperId: "p1",
          paperTitle: "卷甲",
          score: 70,
          state: "submitted",
          submittedAt: "2026-10-17T12:00:00.000Z"
        },
        {
          attemptId: "draft",
          memberId: "a",
          paperId: "p1",
          score: null,
          state: "inProgress",
          submittedAt: ""
        }
      ],
      vipAccounts: [
        { memberId: "a", expiresAt: "2026-10-19T03:00:00.000Z" },
        { memberId: "b", expiresAt: "2026-10-19T02:00:00.000Z" },
        { memberId: "c", expiresAt: null }
      ],
      orders: [
        { orderId: "o1", payState: "paid", grantState: "granted", amountFen: 9900 },
        { orderId: "o2", payState: "paid", grantState: "error", amountFen: 26900 },
        { orderId: "o3", payState: "pending", grantState: "pending", amountFen: 9900 }
      ],
      refunds: [
        { refundId: "r1", orderId: "o1", state: "succeeded", confirmedFen: 1000 },
        { refundId: "r2", orderId: "o2", state: "requested", confirmedFen: null }
      ]
    });
    expect(view.registeredMembers).toBe(3);
    expect(view.completedRecordsTotal).toBe(3);
    expect(view.completedRecordsToday).toBe(2);
    expect(view.uniqueAnswerers).toBe(2);
    expect(view.papers).toEqual([
      { paperId: "p1", paperTitle: "卷甲", completedCount: 3, averageScore: 70, repeatPracticeCounts: true }
    ]);
    expect(view.activeVipCount).toBe(1);
    expect(view.paidOrderCount).toBe(2);
    expect(view.confirmedReceiptFen).toBe(36800);
    expect(view.refundedFen).toBe(1000);
    expect(view.abnormalGrantOrderCount).toBe(1);
    expect(view.turnoverIsNotProfit).toBe(true);
    expect(view.repeatPracticeCounts).toBe(true);
    expect(view.amountsUnit).toBe("fen");
    expect(view.vipRule).toBe("now < expiresAt");
    expect(view.notes.turnoverIsNotProfit).toContain("不是净利润");
    expect(view.notes.completedRecords).toContain("重复练习计入次数");
    expect(view.dayKey).toBe("2026-10-19");
  });

  it("does not treat turnover as profit and strips money fields for content projection", () => {
    const view = aggregateOpsStats({
      now,
      members: [],
      attempts: [],
      vipAccounts: [],
      orders: [{ orderId: "o1", payState: "paid", grantState: "granted", amountFen: 9900 }],
      refunds: []
    });
    expect(view.confirmedReceiptFen).toBe(9900);
    expect(view.turnoverIsNotProfit).toBe(true);
    const stripped = stripOpsStatsMoney(view);
    expect(stripped).not.toHaveProperty("confirmedReceiptFen");
    expect(stripped).not.toHaveProperty("paidOrderCount");
    expect(stripped).not.toHaveProperty("refundedFen");
    expect(stripped.turnoverIsNotProfit).toBe(true);
  });

  it("uses same VIP second boundary as MW20: now < expiresAt", () => {
    expect(isRegisteredMemberStatus("active")).toBe(true);
    expect(isRegisteredMemberStatus("deleted")).toBe(false);
    expect(isValidSubmittedAttempt({ state: "submitted", score: 0, submittedAt: "2026-10-19T00:00:00.000Z" })).toBe(true);
    expect(isAbnormalGrantOrder({ payState: "paid", grantState: "processing" })).toBe(true);
    expect(isAbnormalGrantOrder({ payState: "paid", grantState: "granted" })).toBe(false);
  });

  it("connects exceptions to existing actions and forbids placeholder tutorial steps", () => {
    const exceptions = aggregateOpsExceptions({
      orders: [{ orderId: "o2", payState: "paid", grantState: "error", amountFen: 1 }],
      refunds: [{ refundId: "r2", orderId: "o2", state: "requested", confirmedFen: null }],
      diffs: [{ diffId: "d1", orderId: "o2", diffKind: "paid_ungranted", status: "open" }],
      feedbacks: [{ feedbackId: "f1", status: "open" }]
    });
    expect(exceptions.fakeTickets).toBe(false);
    expect(exceptions.entries.map((row) => row.action)).toEqual([
      "order.reconcile",
      "order.list",
      "refund.list",
      "feedback.list"
    ]);
    expect(exceptions.entries.every((row) => row.count === 1)).toBe(true);
    expect(OPS_TUTORIAL_STEPS).toHaveLength(7);
    expect(OPS_TUTORIAL_STEPS.every((step) => step.placeholder === false && step.actions.length > 0)).toBe(true);
    expect(OPS_TUTORIAL_STEPS.map((step) => step.actions).flat()).toEqual(
      expect.arrayContaining([
        "import.validate",
        "paper.publish",
        "correction.preview",
        "category.change.preview",
        "vip.grant",
        "order.reconcile",
        "refund.execute"
      ])
    );
    expect(canViewOpsStats(["content"])).toBe(false);
    expect(canViewOpsStats(["operations"])).toBe(true);
    expect(canViewOpsTutorial(["content"])).toBe(true);
    const contentSteps = tutorialStepsForRoles(["content"]);
    expect(contentSteps.map((step) => step.id)).toEqual(["import", "publish", "correction", "category-change"]);
    expect(contentSteps.some((step) => step.id === "order-reconcile")).toBe(false);
    const opsSteps = tutorialStepsForRoles(["operations"]);
    expect(opsSteps.map((step) => step.id)).toEqual([
      "import",
      "publish",
      "correction",
      "category-change",
      "vip-gift",
      "order-reconcile",
      "refund"
    ]);
    expect(OPS_STATS_NOTES.turnoverIsNotProfit).toContain("流水");
  });

  it("builds deterministic snapshot payload without _id", () => {
    const idA = opsStatsSnapshotId("2026-10-19");
    const idB = opsStatsSnapshotId("2026-10-19");
    const idC = opsStatsSnapshotId("2026-10-20");
    expect(idA).toBe(idB);
    expect(idA).not.toBe(idC);
    expect(idA).toMatch(/^[0-9a-f]{64}$/);
    const payload = opsStatsSnapshotWrite({ dayKey: "2026-10-19", generatedAt: now.toISOString() });
    expect(payload).not.toHaveProperty("_id");
    expect(payload.schemaVersion).toBe(1);
    expect(payload.kind).toBe("ops_stats");
  });
});
