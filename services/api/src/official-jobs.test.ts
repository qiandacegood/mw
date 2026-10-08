import { describe, expect, it } from "vitest";
import {
  createJobRecord,
  setMaintenanceGate,
  signJobsInvoke,
  type JobRecord
} from "@mw/shared";
import { handleOfficial, memoryAdminStore } from "./official.js";
import {
  memoryAuditStore,
  memoryIdempotencyStore,
  memoryJobStore,
  memoryMaintenanceStore
} from "./modules/job-stores.js";

const allowedAppIds = ["wxmwallowedappid0001"];
const secret = "test-jobs-invoke-token-not-real";
const now = new Date("2026-10-08T12:00:00.000Z");

function adminReq(action: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    apiVersion: "1",
    action,
    requestId: "req_mw06_admin",
    data,
    ...extra
  };
}

function signedEvent(input: Parameters<typeof signJobsInvoke>[1]) {
  return { serverInvoke: signJobsInvoke(secret, input) };
}

function stores(job?: JobRecord) {
  return {
    jobStore: memoryJobStore(job ? [job] : []),
    idempotencyStore: memoryIdempotencyStore(),
    auditStore: memoryAuditStore(),
    maintenanceStore: memoryMaintenanceStore()
  };
}

describe("MW06 jobs, idempotency and admin boundaries", () => {
  it("lets only one concurrent worker acquire the lease", async () => {
    const job = createJobRecord({
      jobId: "mw06/test/job_race",
      type: "mw06.demo.cursor",
      businessKey: "mw06/test/job_race",
      now
    });
    const ctxStores = stores(job);
    const [first, second] = await Promise.all([
      handleOfficial({
        entry: "mw-jobs",
        event: signedEvent({
          action: "jobs.process",
          issuedAt: now.toISOString(),
          nonce: "a",
          jobId: job.jobId,
          command: "acquire",
          leaseMs: 8000
        }),
        allowedAppIds,
        jobsSecret: secret,
        now,
        ...ctxStores
      }),
      handleOfficial({
        entry: "mw-jobs",
        event: signedEvent({
          action: "jobs.process",
          issuedAt: now.toISOString(),
          nonce: "b",
          jobId: job.jobId,
          command: "acquire",
          leaseMs: 8000
        }),
        allowedAppIds,
        jobsSecret: secret,
        now,
        ...ctxStores
      })
    ]);
    const results = [first, second] as Array<{ ok?: boolean; fencingToken?: number; reason?: string }>;
    const winners = results.filter((item) => item.ok === true);
    const losers = results.filter((item) => item.ok === false);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(winners[0]?.fencingToken).toBe(1);
    expect(losers[0]?.reason).toBe("LEASE_HELD");
  });

  it("continues from the saved cursor and rejects the old fencing token", async () => {
    const job = createJobRecord({
      jobId: "mw06/test/job_fence",
      type: "mw06.demo.cursor",
      businessKey: "mw06/test/job_fence",
      now
    });
    const ctxStores = stores(job);
    const acquired = (await handleOfficial({
      entry: "mw-jobs",
      event: signedEvent({
        action: "jobs.process",
        issuedAt: now.toISOString(),
        nonce: "a1",
        jobId: job.jobId,
        command: "acquire",
        leaseMs: 1000
      }),
      allowedAppIds,
      jobsSecret: secret,
      now,
      ...ctxStores
    })) as { fencingToken: number };
    const interrupted = (await handleOfficial({
      entry: "mw-jobs",
      event: signedEvent({
        action: "jobs.process",
        issuedAt: now.toISOString(),
        nonce: "a2",
        jobId: job.jobId,
        command: "interruptAfterCursor",
        fencingToken: acquired.fencingToken,
        cursor: { done: 1, total: 3 }
      }),
      allowedAppIds,
      jobsSecret: secret,
      now,
      ...ctxStores
    })) as { ok: boolean; job: { cursor: { done: number } } };
    expect(interrupted.ok).toBe(true);
    expect(interrupted.job.cursor.done).toBe(1);

    const later = new Date(now.getTime() + 2000);
    const resumed = (await handleOfficial({
      entry: "mw-jobs",
      event: signedEvent({
        action: "jobs.process",
        issuedAt: later.toISOString(),
        nonce: "b1",
        jobId: job.jobId,
        command: "acquire",
        leaseMs: 8000
      }),
      allowedAppIds,
      jobsSecret: secret,
      now: later,
      ...ctxStores
    })) as { ok: boolean; fencingToken: number; job: { cursor: { done: number } } };
    expect(resumed.ok).toBe(true);
    expect(resumed.fencingToken).toBe(2);
    expect(resumed.job.cursor.done).toBe(1);

    const stale = await handleOfficial({
      entry: "mw-jobs",
      event: signedEvent({
        action: "jobs.process",
        issuedAt: later.toISOString(),
        nonce: "a3",
        jobId: job.jobId,
        command: "succeed",
        fencingToken: 1
      }),
      allowedAppIds,
      jobsSecret: secret,
      now: later,
      ...ctxStores
    });
    expect(stale).toMatchObject({ ok: false, reason: "STALE_FENCING_TOKEN" });
  });

  it("replays the same idempotency input and conflicts on a different digest", async () => {
    const ctxStores = stores();
    const first = await handleOfficial({
      entry: "mw-jobs",
      event: signedEvent({
        action: "idempotency.probe",
        issuedAt: now.toISOString(),
        nonce: "i1",
        actorId: "mw06/test/actor_a",
        idempotencyKey: "mw06/test/key_1",
        payload: { step: 1 }
      }),
      allowedAppIds,
      jobsSecret: secret,
      now,
      ...ctxStores
    });
    const replay = await handleOfficial({
      entry: "mw-jobs",
      event: signedEvent({
        action: "idempotency.probe",
        issuedAt: now.toISOString(),
        nonce: "i2",
        actorId: "mw06/test/actor_a",
        idempotencyKey: "mw06/test/key_1",
        payload: { step: 1 }
      }),
      allowedAppIds,
      jobsSecret: secret,
      now,
      ...ctxStores
    });
    const conflict = await handleOfficial({
      entry: "mw-jobs",
      event: signedEvent({
        action: "idempotency.probe",
        issuedAt: now.toISOString(),
        nonce: "i3",
        actorId: "mw06/test/actor_a",
        idempotencyKey: "mw06/test/key_1",
        payload: { step: 2 }
      }),
      allowedAppIds,
      jobsSecret: secret,
      now,
      ...ctxStores
    });
    expect(first).toMatchObject({ ok: true, data: { replayed: false } });
    expect(replay).toMatchObject({ ok: true, data: { replayed: true } });
    expect(conflict).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("enters needsReview after limited retries", async () => {
    const job = createJobRecord({
      jobId: "mw06/test/job_retry",
      type: "mw06.demo.cursor",
      businessKey: "mw06/test/job_retry",
      now,
      maxAttempts: 2
    });
    const ctxStores = stores(job);
    let token = 0;
    for (let index = 0; index < 2; index += 1) {
      const claimed = (await handleOfficial({
        entry: "mw-jobs",
        event: signedEvent({
          action: "jobs.process",
          issuedAt: now.toISOString(),
          nonce: `f${index}`,
          jobId: job.jobId,
          command: "acquire",
          leaseMs: 8000
        }),
        allowedAppIds,
        jobsSecret: secret,
        now,
        ...ctxStores
      })) as { fencingToken: number };
      token = claimed.fencingToken;
      const failed = await handleOfficial({
        entry: "mw-jobs",
        event: signedEvent({
          action: "jobs.process",
          issuedAt: now.toISOString(),
          nonce: `x${index}`,
          jobId: job.jobId,
          command: "fail",
          fencingToken: token
        }),
        allowedAppIds,
        jobsSecret: secret,
        now,
        ...ctxStores
      });
      expect(failed).toMatchObject({ ok: true });
    }
    const inspect = (await handleOfficial({
      entry: "mw-jobs",
      event: signedEvent({
        action: "jobs.inspect",
        issuedAt: now.toISOString(),
        nonce: "inspect",
        jobId: job.jobId,
        command: "inspect"
      }),
      allowedAppIds,
      jobsSecret: secret,
      now,
      ...ctxStores
    })) as { job: { state: string; attempts: number } };
    expect(inspect.job).toMatchObject({ state: "needsReview", attempts: 2 });
  });

  it("rejects ordinary users, disabled admins and non-super resume", async () => {
    const job = createJobRecord({
      jobId: "mw06/test/job_admin",
      type: "mw06.demo.cursor",
      businessKey: "mw06/test/job_admin",
      now
    });
    job.state = "needsReview";
    job.attempts = 3;
    const ctxStores = stores(job);
    const adminUsers = memoryAdminStore([
      { uid: "uid_super_1", roles: ["super"], enabled: true, authVersion: 1 },
      { uid: "uid_ops_1", roles: ["operations"], enabled: true, authVersion: 1 },
      { uid: "uid_disabled", roles: ["super"], enabled: false, authVersion: 1 }
    ]);

    const ordinary = await handleOfficial({
      entry: "mw-admin",
      event: adminReq("job.get", { jobId: job.jobId }),
      allowedAppIds,
      authUid: "uid_plain_user",
      adminStore: adminUsers,
      now,
      ...ctxStores
    });
    expect(ordinary).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", details: { reason: "NOT_IN_ADMIN_WHITELIST" } }
    });

    const disabled = await handleOfficial({
      entry: "mw-admin",
      event: adminReq("job.get", { jobId: job.jobId }),
      allowedAppIds,
      authUid: "uid_disabled",
      adminStore: adminUsers,
      now,
      ...ctxStores
    });
    expect(disabled).toMatchObject({ ok: false, error: { code: "ACCOUNT_DISABLED" } });

    const forged = await handleOfficial({
      entry: "mw-admin",
      event: adminReq("job.get", { jobId: job.jobId, role: "super" }),
      allowedAppIds,
      authUid: "uid_super_1",
      adminStore: adminUsers,
      now,
      ...ctxStores
    });
    expect(forged).toMatchObject({
      ok: false,
      error: { details: { reason: "CLIENT_IDENTITY_IGNORED" } }
    });

    const got = await handleOfficial({
      entry: "mw-admin",
      event: adminReq("job.get", { jobId: job.jobId }),
      allowedAppIds,
      authUid: "uid_ops_1",
      adminStore: adminUsers,
      now,
      ...ctxStores
    });
    expect(got).toMatchObject({ ok: true, data: { jobId: job.jobId, state: "needsReview" } });

    const deniedResume = await handleOfficial({
      entry: "mw-admin",
      event: adminReq("job.resume", { jobId: job.jobId, reason: "continue" }, { idempotencyKey: "mw06/test/resume_1" }),
      allowedAppIds,
      authUid: "uid_ops_1",
      adminStore: adminUsers,
      now,
      ...ctxStores
    });
    expect(deniedResume).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", details: { reason: "SUPER_REQUIRED" } }
    });

    const resumed = await handleOfficial({
      entry: "mw-admin",
      event: adminReq("job.resume", { jobId: job.jobId, reason: "continue" }, { idempotencyKey: "mw06/test/resume_1" }),
      allowedAppIds,
      authUid: "uid_super_1",
      adminStore: adminUsers,
      now,
      ...ctxStores
    });
    expect(resumed).toMatchObject({ ok: true, data: { job: { state: "queued" }, replayed: false } });
    const replayed = await handleOfficial({
      entry: "mw-admin",
      event: adminReq("job.resume", { jobId: job.jobId, reason: "continue" }, { idempotencyKey: "mw06/test/resume_1" }),
      allowedAppIds,
      authUid: "uid_super_1",
      adminStore: adminUsers,
      now,
      ...ctxStores
    });
    expect(replayed).toMatchObject({ ok: true, data: { replayed: true } });
    const conflict = await handleOfficial({
      entry: "mw-admin",
      event: adminReq("job.resume", { jobId: job.jobId, reason: "other" }, { idempotencyKey: "mw06/test/resume_1" }),
      allowedAppIds,
      authUid: "uid_super_1",
      adminStore: adminUsers,
      now,
      ...ctxStores
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("keeps a signed serverInvoke when requestId is also present", async () => {
    const job = createJobRecord({
      jobId: "mw06/test/job_requestid",
      type: "mw06.demo.cursor",
      businessKey: "mw06/test/job_requestid",
      now
    });
    const ctxStores = stores(job);
    const acquired = await handleOfficial({
      entry: "mw-jobs",
      event: {
        requestId: "req_with_server_invoke",
        serverInvoke: signJobsInvoke(secret, {
          action: "jobs.process",
          issuedAt: now.toISOString(),
          nonce: "rid",
          jobId: job.jobId,
          command: "acquire",
          leaseMs: 8000
        })
      },
      allowedAppIds,
      jobsSecret: secret,
      now,
      ...ctxStores
    });
    expect(acquired).toMatchObject({ ok: true, fencingToken: 1 });
  });

  it("does not let content maintenance block payment notify", async () => {
    const maintenanceStore = memoryMaintenanceStore();
    const closed = setMaintenanceGate(
      await maintenanceStore.get(),
      "contentWrites",
      { enabled: false, reason: "move", jobId: "mw06/test/job_maint" },
      now
    );
    await maintenanceStore.save(closed);
    const pay = await handleOfficial({
      entry: "mw-pay-hook",
      event: { body: "unsigned" },
      allowedAppIds,
      now,
      maintenanceStore
    });
    expect(pay).toMatchObject({ ok: false, reason: "SIGNATURE_REQUIRED" });
    const forgedTimer = await handleOfficial({
      entry: "mw-jobs",
      event: { Type: "Timer", TriggerName: "mw-jobs-tick" },
      allowedAppIds,
      jobsSecret: secret,
      now,
      ...stores()
    });
    expect(forgedTimer).toMatchObject({ ok: false, reason: "FORGED_TIMER_DENIED" });
  });
});
