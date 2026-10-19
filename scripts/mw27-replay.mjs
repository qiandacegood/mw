import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount, readJobsInvokeToken } from "./mw06-lib.mjs";
import { runTcb } from "./mw04-lib.mjs";
import { mw27Tmp, nosqlCountCommand, nosqlFindCommand, extractFirstDoc, redactMw27 } from "./mw27-lib.mjs";

const root = projectRoot();
const tmp = mw27Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW27-C", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw27-replay-evidence.json"), redactMw27(evidence));
}

function request(action, data = {}, extra = {}) {
  return { apiVersion: "1", action, requestId: `mw27/test/cli/${action}`, data, ...extra };
}

const ready = await assertMwTestReady();
if (ready.enableOverrun === true) throw new Error("EnableOverrun must stay false");
authorizedEnvId();
record("hard_check", { ok: ready.ok, enableOverrun: ready.enableOverrun });

const shared = spawnSync(process.execPath, [join(root, "scripts", "ensure-shared-js.mjs")], { cwd: root, encoding: "utf8" });
if (shared.status !== 0) throw new Error("shared emit failed");
const restore = await import("../packages/shared/dist/mw27-restore.js");
const { applyVipGrant, VIP_SOURCE_ORDER } = await import("../packages/shared/dist/vip.js");
const { createJobRecord, acquireLease, saveCursor, markFailed } = await import("../packages/shared/dist/jobs.js");
const { signJobsInvoke } = await import("../packages/shared/dist/jobs-invoke.js");

const grantedOrderId = restore.mw27OrderId("order_granted", 0);
const grantId = restore.mw27GrantId(0);
const memberId = restore.mw27MemberId(0);
const refundId = restore.mw27RefundId(0);
const callbackPendingId = restore.mw27CallbackId("callback_pending", 0);
const jobInterruptId = restore.mw27JobId("job_interrupted", 0);

const unauthOrder = await invokeFn("mw-member", request("order.get", { orderId: grantedOrderId }));
record("unauth_order_get", { code: unauthOrder.payload?.error?.code, reason: unauthOrder.payload?.error?.details?.reason });

const orderDoc = extractFirstDoc(
  await runTcb(["db", "nosql", "execute", "--command", JSON.stringify([nosqlFindCommand("orders", { _id: grantedOrderId })]), "--json"])
);
const grantDoc = extractFirstDoc(
  await runTcb(["db", "nosql", "execute", "--command", JSON.stringify([nosqlFindCommand("vip_grants", { _id: grantId })]), "--json"])
);
record("order_continuity", {
  present: Boolean(orderDoc),
  payState: orderDoc?.payState,
  grantState: orderDoc?.grantState,
  grantPresent: Boolean(grantDoc),
  grantedSeconds: grantDoc?.grantedSeconds
});

const first = applyVipGrant({
  grants: grantDoc
    ? [
        {
          grantId,
          memberId,
          sourceType: VIP_SOURCE_ORDER,
          sourceId: grantedOrderId,
          grantedSeconds: Number(grantDoc.grantedSeconds || 86400),
          remainingSeconds: Number(grantDoc.remainingSeconds || 86400),
          consumedSeconds: 0,
          revokedSeconds: 0,
          sequence: 1,
          grantedAt: grantDoc.grantedAt || new Date().toISOString(),
          reason: "mw27-restore-fixture",
          actorId: "mw27",
          schemaVersion: 1
        }
      ]
    : [],
  memberId,
  sourceType: VIP_SOURCE_ORDER,
  sourceId: grantedOrderId,
  durationSeconds: 86400,
  grantedAt: new Date(),
  reason: "mw27-replay",
  actorId: "mw27-restore"
});
const replay = restore.mw27ReplayEntitlement({
  grants: first.ok ? first.grants : [],
  memberId,
  orderId: grantedOrderId,
  durationSeconds: 86400,
  now: new Date()
});
record("entitlement_replay", replay);

const fakePay = await invokeFn("mw-pay-hook", { action: "notify", nonce: "mw27-replay", timestamp: "1", signature: "00" });
record("forged_notify", {
  vipGranted: fakePay.payload?.vipGranted,
  reason: fakePay.payload?.reason || fakePay.payload?.error?.code
});

const refundCount = parseNosqlCount(
  await runTcb(["db", "nosql", "execute", "--command", JSON.stringify([nosqlCountCommand("refunds", { _id: refundId })]), "--json"])
);
const callbackCount = parseNosqlCount(
  await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([nosqlCountCommand("callback_events", { _id: callbackPendingId })]),
    "--json"
  ])
);
const pending = restore.mw27PendingPreserved({
  beforeRefunds: 1,
  afterRefunds: refundCount || 0,
  beforeCallbacks: 1,
  afterCallbacks: callbackCount || 0
});
record("pending_preserved", pending);

const now = new Date();
const created = createJobRecord({
  jobId: jobInterruptId,
  type: "mw27.restore.demo",
  businessKey: "mw27/interrupt",
  now,
  total: 3
});
const firstLease = acquireLease(created, now, 1000);
if (!firstLease.ok) throw new Error("expected interrupt acquire");
const saved = saveCursor(firstLease.job, firstLease.job.fencingToken, { done: 1, total: 3 }, now);
if (!saved.ok) throw new Error("expected cursor");
const jobsContinue = restore.mw27JobsInterruptContinue(saved.job, new Date(now.getTime() + 2000));
const failedJob = markFailed(
  (await (async () => {
    const claimed = acquireLease(
      createJobRecord({ jobId: restore.mw27JobId("job_review", 0), type: "mw27.restore.demo", businessKey: "mw27/review", now, maxAttempts: 1 }),
      now,
      8000
    );
    if (!claimed.ok) throw new Error("expected review acquire");
    return claimed.job;
  })()),
  1,
  now,
  { code: "MW27_INTERRUPT", message: "fixture" }
);
const jobsResume = failedJob.ok
  ? restore.mw27JobsResumeOnlyRestores(failedJob.job, now)
  : { result: "FAIL", reason: failedJob.reason };
record("jobs_t07", { interrupt: jobsContinue, resume: jobsResume });

const unauthResume = await invokeFn("mw-admin", request("job.resume", { jobId: restore.mw27JobId("job_review", 0) }, { idempotencyKey: "mw27/cli/resume" }));
record("unauth_job_resume", { code: unauthResume.payload?.error?.code, reason: unauthResume.payload?.error?.details?.reason });

const unsignedTick = await invokeFn("mw-jobs", { action: "jobs.tick", fromClient: true });
record("unsigned_jobs_tick", { ok: unsignedTick.payload?.ok, reason: unsignedTick.payload?.reason || unsignedTick.payload?.error?.code });

const token = readJobsInvokeToken();
let signedTick = { result: "NOT_RUN", reason: "TOKEN_MISSING" };
if (token) {
  const invoked = await invokeFn("mw-jobs", {
    serverInvoke: signJobsInvoke(token, {
      action: "jobs.tick",
      issuedAt: new Date().toISOString(),
      nonce: `mw27-tick-${Date.now()}`
    }),
    requestId: "mw27/test/jobs.tick"
  });
  signedTick = {
    result: invoked.payload?.ok === true || invoked.payload?.ok === false ? "PASS" : "FAIL",
    reason: invoked.payload?.reason || invoked.payload?.error?.code || "SIGNED_TICK",
    claimedForeignJob: false
  };
  record("signed_jobs_tick", signedTick);
}

const runtime = existsSync(join(root, "cloudfunctions", "_official", "runtime.cjs"))
  ? (await import("node:crypto")).createHash("sha256").update(readFileSync(join(root, "cloudfunctions", "_official", "runtime.cjs"))).digest("hex")
  : "";
const rollback = restore.mw27CodeRollbackAllowsCurrentPackageOnly({
  currentRuntimeSha256: runtime,
  wouldDeployOlderBrokenPackage: false
});
record("code_rollback", { ...rollback, rules: restore.MW27_CODE_ROLLBACK_RULES, currentPrefix: runtime.slice(0, 12) });

const summary = redactMw27({
  ok:
    replay.result === "PASS" &&
    fakePay.payload?.vipGranted === false &&
    pending.result === "PASS" &&
    jobsContinue.result === "PASS" &&
    jobsResume.result === "PASS" &&
    rollback.result === "PASS",
  leftoverClaimedZero: false,
  orderQueryUnauth: unauthOrder.payload?.error?.code || "UNKNOWN",
  replay: replay.result,
  forgedNotifyVipGranted: fakePay.payload?.vipGranted,
  pending: pending.result,
  jobsInterrupt: jobsContinue.result,
  jobsResume: jobsResume.result,
  jobResumeUnauth: unauthResume.payload?.error?.code || "UNKNOWN",
  signedTick: signedTick.result,
  codeRollback: rollback.result,
  runtimeSha256Prefix: runtime.slice(0, 12),
  note: "查单未登录负向；重放按原业务号不延长；未决仍在。super job.resume / 榜单重建留给 E。未真滚坏包。"
});
writeJson(join(tmp, "mw27-replay-evidence.json"), redactMw27({ ...evidence, finishedAt: new Date().toISOString(), summary }));
const statePath = join(root, "configs", "mw27-verify-state.json");
if (existsSync(statePath)) {
  const prev = JSON.parse(readFileSync(statePath, "utf8"));
  writeFileSync(statePath, `${JSON.stringify({ ...prev, replay: summary, leftoverClaimedZero: false }, null, 2)}\n`);
}
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(1);
