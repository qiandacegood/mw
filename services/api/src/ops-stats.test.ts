import { describe, expect, it } from "vitest";
import { handleOfficial, type AdminUserRecord, type OfficialContext } from "./official.js";
import { memoryOpsStatsStore } from "./modules/ops-stats.js";
import { memoryMemberBundle } from "./modules/member-stores.js";
import { memoryOrderStore } from "./modules/order-stores.js";

const allowedAppIds = ["wxmwallowedappid0001"];
const now = new Date("2026-10-19T02:00:00.000Z");

function req(action: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    apiVersion: "1",
    action,
    requestId: extra.requestId || `req_${action.replace(/\./g, "_")}`,
    data,
    ...extra
  };
}

function adminCtx(
  event: unknown,
  roles: string[],
  extra: Partial<OfficialContext> = {}
): OfficialContext {
  return {
    entry: "mw-admin",
    event,
    allowedAppIds,
    now,
    authUid: "uid_mw25_admin",
    adminStore: {
      async getByUid(uid) {
        return { uid, roles: roles as AdminUserRecord["roles"], enabled: true, authVersion: 1 };
      }
    },
    memberStore: memoryMemberBundle(),
    ...extra
  };
}

function seedStore() {
  return memoryOpsStatsStore({
    members: [
      { memberId: "m1", status: "active" },
      { memberId: "m2", status: "deleted" }
    ],
    attempts: [
      {
        attemptId: "a1",
        memberId: "m1",
        paperId: "p1",
        paperTitle: "MW25虚构卷",
        score: 60,
        state: "submitted",
        submittedAt: "2026-10-18T18:30:00.000Z"
      },
      {
        attemptId: "a2",
        memberId: "m1",
        paperId: "p1",
        paperTitle: "MW25虚构卷",
        score: 80,
        state: "submitted",
        submittedAt: "2026-10-18T20:30:00.000Z"
      }
    ],
    vipAccounts: [{ memberId: "m1", expiresAt: "2026-10-20T00:00:00.000Z" }],
    orders: [
      { orderId: "o1", payState: "paid", grantState: "granted", amountFen: 9900 },
      { orderId: "o2", payState: "paid", grantState: "error", amountFen: 26900 }
    ],
    refunds: [
      { refundId: "r1", orderId: "o1", state: "succeeded", confirmedFen: 1000 },
      { refundId: "r2", orderId: "o2", state: "requested", confirmedFen: null }
    ],
    diffs: [{ diffId: "d1", orderId: "o2", diffKind: "paid_ungranted", status: "open" }],
    feedbacks: [{ feedbackId: "f1", status: "open" }]
  });
}

describe("MW25 ops.stats / tutorial / exceptions", () => {
  it("lets operations read real口径 and refuses to treat turnover as profit", async () => {
    const store = seedStore();
    const res = (await handleOfficial(
      adminCtx(req("ops.stats"), ["operations"], { opsStatsStore: store })
    )) as { ok: true; data: Record<string, unknown> };
    expect(res.ok).toBe(true);
    expect(res.data.registeredMembers).toBe(1);
    expect(res.data.completedRecordsTotal).toBe(2);
    expect(res.data.uniqueAnswerers).toBe(1);
    expect(res.data.confirmedReceiptFen).toBe(36800);
    expect(res.data.refundedFen).toBe(1000);
    expect(res.data.abnormalGrantOrderCount).toBe(1);
    expect(res.data.turnoverIsNotProfit).toBe(true);
    expect(res.data.repeatPracticeCounts).toBe(true);
    expect(res.data.vipRule).toBe("now < expiresAt");
    expect(res.data.scanTruncated).toBe(false);
    expect(res.data.scanBudget).toBe(2000);
    expect(JSON.stringify(res.data)).toContain("重复练习计入次数");
    expect(JSON.stringify(res.data)).toContain("不是净利润");
    const papers = res.data.papers as Array<{ completedCount: number; averageScore: number }>;
    expect(papers[0]?.completedCount).toBe(2);
    expect(papers[0]?.averageScore).toBe(70);
  });

  it("hides money stats from content and still returns tutorial without order amounts", async () => {
    const store = seedStore();
    const stats = (await handleOfficial(
      adminCtx(req("ops.stats"), ["content"], { opsStatsStore: store })
    )) as { ok: false; error: { code: string; details?: { reason?: string } } };
    expect(stats.ok).toBe(false);
    expect(stats.error.code).toBe("FORBIDDEN");
    expect(stats.error.details?.reason).toBe("CONTENT_STATS_DENIED");
    expect(JSON.stringify(stats)).not.toMatch(/confirmedReceiptFen|amountFen|9900|36800/);

    const exceptions = (await handleOfficial(
      adminCtx(req("ops.exceptions"), ["content"], { opsStatsStore: store })
    )) as { ok: false; error: { details?: { reason?: string } } };
    expect(exceptions.ok).toBe(false);
    expect(exceptions.error.details?.reason).toBe("CONTENT_STATS_DENIED");

    const tutorial = (await handleOfficial(
      adminCtx(req("ops.tutorial"), ["content"], { opsStatsStore: store })
    )) as { ok: true; data: { steps: Array<{ id: string; actions: string[]; placeholder: boolean }>; mw12StillPartial: boolean } };
    expect(tutorial.ok).toBe(true);
    expect(tutorial.data.mw12StillPartial).toBe(true);
    expect(tutorial.data.steps.every((step) => step.placeholder === false)).toBe(true);
    expect(tutorial.data.steps.map((step) => step.id)).toEqual(["import", "publish", "correction", "category-change"]);
    expect(JSON.stringify(tutorial)).not.toMatch(/amountFen|confirmedReceiptFen/);
  });

  it("keeps refund execute and correction as super-only for operations", async () => {
    const refund = (await handleOfficial(
      adminCtx(req("refund.execute", { orderId: "o1", amountFen: 9900, reason: "x" }, { idempotencyKey: "ex" }), ["operations"], {
        orderStore: memoryOrderStore()
      })
    )) as { ok: false; error: { details?: { reason?: string } } };
    expect(refund.ok).toBe(false);
    expect(refund.error.details?.reason).toBe("SUPER_ROLE_REQUIRED");

    const correction = (await handleOfficial(
      adminCtx(req("correction.preview", { paperId: "p1", fromVersionId: "v1", toVersionId: "v2" }, { idempotencyKey: "c1" }), ["operations"])
    )) as { ok: false; error: { details?: { reason?: string } } };
    expect(correction.ok).toBe(false);
    expect(correction.error.details?.reason).toBe("SUPER_ROLE_REQUIRED");
  });

  it("returns exception entries that open existing actions, not fake tickets", async () => {
    const store = seedStore();
    const res = (await handleOfficial(
      adminCtx(req("ops.exceptions"), ["super"], { opsStatsStore: store })
    )) as { ok: true; data: { fakeTickets: boolean; entries: Array<{ action: string; count: number }> } };
    expect(res.ok).toBe(true);
    expect(res.data.fakeTickets).toBe(false);
    expect(res.data.entries.map((row) => row.action)).toEqual([
      "order.reconcile",
      "order.list",
      "refund.list",
      "feedback.list"
    ]);
    expect(res.data.entries.every((row) => row.count === 1)).toBe(true);
  });

  it("writes leftover fixture without putting _id into set payload", async () => {
    const store = seedStore();
    const res = (await handleOfficial(
      adminCtx(req("ops.stats", { persistFixture: true }), ["operations"], { opsStatsStore: store })
    )) as { ok: true; data: { leftoverSnapshotId: string } };
    expect(res.ok).toBe(true);
    expect(res.data.leftoverSnapshotId).toMatch(/^[0-9a-f]{64}$/);
    expect(store.snapshots.size).toBe(1);
    const payload = [...store.snapshots.values()][0];
    expect(payload).not.toHaveProperty("_id");
    expect(payload?.schemaVersion).toBe(1);
  });

  it("rejects unauthenticated ops.stats", async () => {
    const res = (await handleOfficial({
      entry: "mw-admin",
      event: req("ops.stats"),
      allowedAppIds,
      now
    })) as { ok: false; error: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("AUTH_REQUIRED");
  });
});
