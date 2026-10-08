import { describe, expect, it } from "vitest";
import {
  acquireLease,
  assertWritableLease,
  createJobRecord,
  markFailed,
  markSucceeded,
  resumeJob,
  saveCursor
} from "./jobs.js";

const now = new Date("2026-10-08T12:00:00.000Z");

describe("job lease and fencing", () => {
  it("lets exactly one acquire win while the lease is live", () => {
    const job = createJobRecord({
      jobId: "mw06/test/job_race",
      type: "mw06.demo.cursor",
      businessKey: "mw06/test/job_race",
      now
    });
    const first = acquireLease(job, now, 8000);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected first acquire");
    expect(first.job.fencingToken).toBe(1);
    expect(first.job.state).toBe("running");
    const second = acquireLease(first.job, now, 8000);
    expect(second).toEqual({ ok: false, reason: "LEASE_HELD" });
  });

  it("rejects stale fencing tokens after a later worker takes over", () => {
    const job = createJobRecord({
      jobId: "mw06/test/job_fence",
      type: "mw06.demo.cursor",
      businessKey: "mw06/test/job_fence",
      now
    });
    const workerA = acquireLease(job, now, 1000);
    if (!workerA.ok) throw new Error("expected A");
    const saved = saveCursor(workerA.job, workerA.job.fencingToken, { done: 1, total: 3 }, now);
    if (!saved.ok) throw new Error("expected cursor");
    const later = new Date(now.getTime() + 2000);
    const workerB = acquireLease(saved.job, later, 8000);
    if (!workerB.ok) throw new Error("expected B");
    expect(workerB.job.fencingToken).toBe(2);
    expect(workerB.job.cursor.done).toBe(1);
    const stale = saveCursor(workerB.job, 1, { done: 2, total: 3 }, later);
    expect(stale).toEqual({ ok: false, reason: "STALE_FENCING_TOKEN" });
    const expired = assertWritableLease(saved.job, 1, later);
    expect(expired).toEqual({ ok: false, reason: "LEASE_EXPIRED" });
  });

  it("moves exhausted retries into needsReview and resumes without marking success", () => {
    let job = createJobRecord({
      jobId: "mw06/test/job_retry",
      type: "mw06.demo.cursor",
      businessKey: "mw06/test/job_retry",
      now,
      maxAttempts: 2
    });
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const claimed = acquireLease(job, now, 8000);
      if (!claimed.ok) throw new Error("expected claim");
      const failed = markFailed(claimed.job, claimed.job.fencingToken, now, {
        code: "DEMO_FAIL",
        message: "synthetic"
      });
      if (!failed.ok) throw new Error("expected fail");
      job = failed.job;
    }
    expect(job.state).toBe("needsReview");
    expect(job.attempts).toBe(2);
    const successDenied = markSucceeded(job, job.fencingToken, now);
    expect(successDenied.ok).toBe(false);
    const resumed = resumeJob(job, now);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error("expected resume");
    expect(resumed.job.state).toBe("queued");
    expect(resumed.job.cursor).toEqual(job.cursor);
  });
});
