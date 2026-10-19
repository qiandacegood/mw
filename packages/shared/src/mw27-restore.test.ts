import { describe, expect, it } from "vitest";
import { acquireLease, createJobRecord, markFailed, saveCursor } from "./jobs.js";
import { defaultMaintenanceConfig, setMaintenanceGate } from "./maintenance.js";
import { applyVipGrant, VIP_SOURCE_ORDER } from "./vip.js";
import {
  emptyMw27Counts,
  isMw27IsolatedCollection,
  mw27CallbackId,
  mw27ClosureCheck,
  mw27CodeRollbackAllowsCurrentPackageOnly,
  mw27FixtureId,
  mw27GrantId,
  mw27JobsInterruptContinue,
  mw27JobsResumeOnlyRestores,
  mw27LeftoverDecision,
  mw27LiveDocId,
  mw27OfficialRestoreDecision,
  mw27OrderId,
  mw27PaymentNotifyReceivable,
  mw27PendingPreserved,
  mw27RankingNotInLeftoverDelete,
  mw27ReplayEntitlement,
  mw27RpoRtoVerdict,
  mw27StaleTokenRejected,
  MW27_CODE_ROLLBACK_RULES,
  MW27_FIXTURE_ROUND,
  MW27_ISOLATED_RESTORE_COLLECTIONS,
  MW27_RANKING_NOT_LEFTOVER,
  MW27_RTO_TARGET_MS,
  omitDocId,
  plannedMw27Counts
} from "./mw27-restore.js";

const now = new Date("2026-10-19T08:00:00.000Z");

describe("mw27 leftover gates", () => {
  it("refuses leftover=0 when wroteDocs is false or list is empty-unresolved", () => {
    expect(mw27LeftoverDecision({ wroteDocs: false, resolved: true, fixtureRemain: 0, seedPresent: true }).reason).toBe(
      "WROTE_DOCS_FALSE"
    );
    expect(mw27LeftoverDecision({ wroteDocs: true, resolved: false, fixtureRemain: 0, seedPresent: true }).reason).toBe(
      "KNOWN_IDS_NOT_RESOLVED"
    );
    expect(mw27LeftoverDecision({ wroteDocs: true, resolved: true, fixtureRemain: 2, seedPresent: true }).reason).toBe(
      "INDEPENDENT_REMAIN"
    );
    expect(mw27LeftoverDecision({ wroteDocs: true, resolved: true, isolatedRemain: 1, seedPresent: true }).reason).toBe(
      "ISOLATED_RESTORE_REMAIN"
    );
    expect(mw27LeftoverDecision({ wroteDocs: true, resolved: true, seedPresent: false }).reason).toBe(
      "SEED_CATEGORIES_MISSING"
    );
    expect(mw27LeftoverDecision({ wroteDocs: true, resolved: true, fixtureRemain: 0, isolatedRemain: 0, seedPresent: true }).ok).toBe(
      true
    );
  });

  it("keeps ranking collections out of leftover delete lists", () => {
    expect(mw27RankingNotInLeftoverDelete(["orders", "mw27_rst_orders"])).toBe(true);
    expect(mw27RankingNotInLeftoverDelete(["ranking_rows"])).toBe(false);
    expect(MW27_RANKING_NOT_LEFTOVER).toEqual(["ranking_heads", "ranking_rows"]);
  });

  it("regenerates fixture ids from (round, kind, index)", () => {
    expect(mw27FixtureId("member", 0)).toBe(mw27FixtureId("member", 0, MW27_FIXTURE_ROUND));
    expect(mw27LiveDocId("order_granted", 0)).toBe(mw27OrderId("order_granted", 0));
    expect(mw27LiveDocId("vip_grant", 0)).toBe(mw27GrantId(0));
    expect(mw27CallbackId("callback_paid", 0)).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.prototype.hasOwnProperty.call(omitDocId({ _id: "x", fixtureRound: "MW27" }), "_id")).toBe(false);
    expect(emptyMw27Counts().orders).toBe(0);
    expect(plannedMw27Counts().isolated).toBe(9);
  });
});

describe("mw27 isolated restore", () => {
  it("blocks overwrite and other-env restore", () => {
    expect(
      mw27OfficialRestoreDecision({
        canRestoreToNewCollection: false,
        wouldOverwriteExisting: true,
        otherEnvTouched: false
      })
    ).toEqual({ result: "BLOCKED", reason: "RESTORE_WOULD_OVERWRITE", mode: "fixture-sim" });
    expect(
      mw27OfficialRestoreDecision({
        canRestoreToNewCollection: false,
        wouldOverwriteExisting: false,
        otherEnvTouched: true
      }).result
    ).toBe("FAIL");
    expect(MW27_ISOLATED_RESTORE_COLLECTIONS.every((name) => isMw27IsolatedCollection(name))).toBe(true);
    expect(isMw27IsolatedCollection("orders")).toBe(false);
  });
});

describe("mw27 entitlement replay and pending", () => {
  it("replays the same order grant without extending duration", () => {
    const orderId = mw27OrderId("order_granted", 0);
    const first = applyVipGrant({
      grants: [],
      memberId: mw27LiveDocId("member", 0),
      sourceType: VIP_SOURCE_ORDER,
      sourceId: orderId,
      durationSeconds: 86400,
      grantedAt: now,
      reason: "first",
      actorId: "mw27"
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected first grant");
    const replay = mw27ReplayEntitlement({
      grants: first.grants,
      memberId: first.account.memberId,
      orderId,
      durationSeconds: 86400,
      now: new Date(now.getTime() + 60_000)
    });
    expect(replay.result).toBe("PASS");
    expect(replay.replayed).toBe(true);
    expect(replay.grantCount).toBe(1);
    expect(replay.durationIncreased).toBe(false);
    expect(replay.grantId).toBe(mw27GrantId(0));
  });

  it("keeps pending refund and callback counts", () => {
    expect(
      mw27PendingPreserved({ beforeRefunds: 1, afterRefunds: 1, beforeCallbacks: 1, afterCallbacks: 1 }).result
    ).toBe("PASS");
    expect(
      mw27PendingPreserved({ beforeRefunds: 1, afterRefunds: 0, beforeCallbacks: 1, afterCallbacks: 1 }).reason
    ).toBe("PENDING_LOST");
  });
});

describe("mw27 jobs T07", () => {
  it("continues from cursor and rejects the old fencingToken", () => {
    const created = createJobRecord({
      jobId: mw27LiveDocId("job_interrupted", 0),
      type: "mw27.restore.demo",
      businessKey: "mw27/interrupt",
      now,
      total: 3
    });
    const first = acquireLease(created, now, 1000);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected acquire");
    const savedCursor = saveCursor(first.job, first.job.fencingToken, { done: 1, total: 3 }, now);
    if (!savedCursor.ok) throw new Error("expected cursor");
    const saved = savedCursor.job;
    const later = new Date(now.getTime() + 2000);
    const check = mw27JobsInterruptContinue(saved, later);
    expect(check.result).toBe("PASS");
    expect(check.cursorContinued).toBe(true);
    expect(check.staleRejected).toBe(true);
  });

  it("resume only restores failed jobs and does not mark success", () => {
    let job = createJobRecord({
      jobId: mw27LiveDocId("job_review", 0),
      type: "mw27.restore.demo",
      businessKey: "mw27/review",
      now,
      maxAttempts: 1
    });
    const claimed = acquireLease(job, now, 8000);
    if (!claimed.ok) throw new Error("expected claim");
    const failed = markFailed(claimed.job, claimed.job.fencingToken, now, { code: "DEMO", message: "x" });
    if (!failed.ok) throw new Error("expected fail");
    const resumed = mw27JobsResumeOnlyRestores(failed.job, now);
    expect(resumed.result).toBe("PASS");
    expect(resumed.restored).toBe(true);
    expect(resumed.markedSuccess).toBe(false);
    const running = mw27JobsResumeOnlyRestores(claimed.job, now);
    expect(running.result).toBe("PASS");
    expect(running.reason).toBe("JOB_NOT_RESUMABLE");
  });

  it("rejects a stale fencingToken after lease expiry", () => {
    const created = createJobRecord({
      jobId: "mw27/stale",
      type: "mw27.restore.demo",
      businessKey: "mw27/stale",
      now
    });
    const first = acquireLease(created, now, 1000);
    if (!first.ok) throw new Error("expected");
    const later = new Date(now.getTime() + 2000);
    expect(mw27StaleTokenRejected(first.job, first.job.fencingToken, later).result).toBe("PASS");
  });
});

describe("mw27 ops gates", () => {
  it("keeps payment notify receivable while write gates are closed", () => {
    let config = defaultMaintenanceConfig(now);
    for (const gate of ["contentWrites", "attemptStart", "attemptSubmit", "purchaseCreate", "entitlementApply"] as const) {
      config = setMaintenanceGate(config, gate, { enabled: false, reason: "MW27", jobId: "mw27" }, now);
    }
    expect(mw27PaymentNotifyReceivable(config).result).toBe("PASS");
  });

  it("records official RPO/RTO as BLOCKED without adding resources", () => {
    const verdict = mw27RpoRtoVerdict({
      officialBackupConfirmed: false,
      rpoMs: null,
      rtoMs: 12_000,
      packageLimitation: "personal edition cannot restore to new collections"
    });
    expect(verdict.official).toBe("BLOCKED");
    expect(verdict.fixtureRto).toBe("PASS");
    expect(verdict.reason).toMatch(/personal edition/);
    expect(MW27_RTO_TARGET_MS).toBe(4 * 60 * 60 * 1000);
  });

  it("keeps the current package hash and forbids rolling a broken older pack", () => {
    expect(
      mw27CodeRollbackAllowsCurrentPackageOnly({
        currentRuntimeSha256: "a".repeat(64),
        wouldDeployOlderBrokenPackage: false
      }).result
    ).toBe("PASS");
    expect(
      mw27CodeRollbackAllowsCurrentPackageOnly({
        currentRuntimeSha256: "a".repeat(64),
        wouldDeployOlderBrokenPackage: true
      }).reason
    ).toBe("MUST_NOT_ROLLBACK_BROKEN_PACKAGE");
    expect(MW27_CODE_ROLLBACK_RULES.map((row) => row.id)).toEqual(["R1", "R2", "R3", "R4"]);
  });

  it("fails closure when seed count or indexes drift", () => {
    expect(
      mw27ClosureCheck({
        seedPresent: 10,
        seedExpected: 10,
        missingCollections: [],
        missingIndexes: [],
        isolatedAclDenied: true,
        baselineAnswersAclDenied: true
      }).result
    ).toBe("PASS");
    expect(
      mw27ClosureCheck({
        seedPresent: 9,
        seedExpected: 10,
        missingCollections: [],
        missingIndexes: [],
        isolatedAclDenied: true,
        baselineAnswersAclDenied: true
      }).reason
    ).toBe("SEED_CATEGORIES_CHANGED");
  });
});
