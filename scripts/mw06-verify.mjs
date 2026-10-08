import { createHash } from "node:crypto";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import {
  ensureJobsInvokeToken,
  MW06_TEST_PREFIX,
  mw06Tmp,
  redactMw06,
  signServerInvoke
} from "./mw06-lib.mjs";

const root = projectRoot();
const tmp = mw06Tmp();
const evidence = { startedAt: new Date().toISOString(), steps: [], budgets: [] };
const { token } = ensureJobsInvokeToken();

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw06-verify-evidence.json"), redactMw06(evidence));
}

function jobDoc(id, extra = {}) {
  const now = new Date().toISOString();
  return {
    _id: id,
    jobId: id,
    type: "mw06.demo.cursor",
    businessKey: id,
    state: "queued",
    cursor: { done: 0, total: 3 },
    leaseUntil: "",
    fencingToken: 0,
    attempts: 0,
    maxAttempts: extra.maxAttempts ?? 3,
    resumeCount: extra.resumeCount ?? 0,
    totalAttempts: extra.totalAttempts ?? 0,
    lastResumeHash: "",
    nextRunAt: now,
    lastError: { code: "", message: "" },
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    revision: 1
  };
}

async function upsertJob(doc) {
  return runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: "jobs",
        CommandType: "UPDATE",
        Command: JSON.stringify({
          update: "jobs",
          updates: [{ q: { _id: doc._id }, u: { $set: doc }, upsert: true }]
        })
      }
    ]),
    "--json"
  ]);
}

async function deleteDoc(collection, id) {
  return runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: collection,
        CommandType: "DELETE",
        Command: JSON.stringify({
          delete: collection,
          deletes: [{ q: { _id: id }, limit: 1 }]
        })
      }
    ]),
    "--json"
  ]);
}

function idemId(actorId, action, key) {
  return createHash("sha256")
    .update(JSON.stringify({ actorId, action, idempotencyKey: key }))
    .digest("hex");
}

async function jobsInvoke(payload, label) {
  const event = { serverInvoke: signServerInvoke(token, payload), requestId: `req_${label}` };
  const result = await invokeFn("mw-jobs", event, { timeoutMs: 120000 });
  record(`jobs_${label}`, {
    code: result.code,
    ok: result.payload?.ok === true,
    reason: result.payload?.reason || result.payload?.error?.details?.reason,
    errorCode: result.payload?.error?.code,
    state: result.payload?.job?.state,
    cursorDone: result.payload?.job?.cursor?.done,
    fencingToken: result.payload?.fencingToken,
    txTotal: result.payload?.tx?.total,
    txMs: result.payload?.tx?.elapsedMs
  });
  if (result.payload?.tx) evidence.budgets.push(result.payload.tx);
  return result.payload || {};
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ready = await assertMwTestReady();
record("hard_check", { ok: ready.ok, enableOverrun: ready.enableOverrun });
authorizedEnvId();

const raceId = `${MW06_TEST_PREFIX}/lease-race`;
const fenceId = `${MW06_TEST_PREFIX}/fence-resume`;
const retryId = `${MW06_TEST_PREFIX}/retry-review`;
const created = await Promise.all([
  upsertJob(jobDoc(raceId)),
  upsertJob(jobDoc(fenceId)),
  upsertJob(jobDoc(retryId, { maxAttempts: 2 }))
]);
record("seed_jobs", { ok: created.every((item) => item.code === 0) });

const nowIso = new Date().toISOString();
const [left, right] = await Promise.all([
  jobsInvoke(
    {
      action: "jobs.process",
      issuedAt: nowIso,
      nonce: `${MW06_TEST_PREFIX}/race-a`,
      jobId: raceId,
      command: "acquire",
      leaseMs: 20000
    },
    "race_a"
  ),
  jobsInvoke(
    {
      action: "jobs.process",
      issuedAt: nowIso,
      nonce: `${MW06_TEST_PREFIX}/race-b`,
      jobId: raceId,
      command: "acquire",
      leaseMs: 20000
    },
    "race_b"
  )
]);
const raceWins = [left, right].filter((item) => item.ok === true);
const raceLosses = [left, right].filter((item) => item.ok === false);
record("race_summary", {
  winners: raceWins.length,
  losers: raceLosses.length,
  loserReason: raceLosses[0]?.reason,
  winnerToken: raceWins[0]?.fencingToken
});

const acquireAIssuedAt = new Date().toISOString();
const acquireA = await jobsInvoke(
  {
    action: "jobs.process",
    issuedAt: acquireAIssuedAt,
    nonce: `${MW06_TEST_PREFIX}/fence-a`,
    jobId: fenceId,
    command: "acquire",
    leaseMs: 8000
  },
  "fence_acquire_a"
);
const acquireAReplay = await jobsInvoke(
  {
    action: "jobs.process",
    issuedAt: acquireAIssuedAt,
    nonce: `${MW06_TEST_PREFIX}/fence-a`,
    jobId: fenceId,
    command: "acquire",
    leaseMs: 8000
  },
  "fence_acquire_a_replay"
);
record("nonce_replay", {
  firstToken: acquireA.fencingToken,
  replayToken: acquireAReplay.fencingToken,
  replayed: acquireAReplay.replayed === true,
  sameToken: acquireAReplay.fencingToken === acquireA.fencingToken
});
const interruptA = await jobsInvoke(
  {
    action: "jobs.process",
    issuedAt: new Date().toISOString(),
    nonce: `${MW06_TEST_PREFIX}/fence-int`,
    jobId: fenceId,
    command: "interruptAfterCursor",
    fencingToken: acquireA.fencingToken,
    cursor: { done: 1, total: 3 }
  },
  "fence_interrupt_a"
);
record("wait_lease", { ms: 9000 });
await sleep(9000);
const acquireB = await jobsInvoke(
  {
    action: "jobs.process",
    issuedAt: new Date().toISOString(),
    nonce: `${MW06_TEST_PREFIX}/fence-b`,
    jobId: fenceId,
    command: "acquire",
    leaseMs: 20000
  },
  "fence_acquire_b"
);
const staleA = await jobsInvoke(
  {
    action: "jobs.process",
    issuedAt: new Date().toISOString(),
    nonce: `${MW06_TEST_PREFIX}/fence-stale`,
    jobId: fenceId,
    command: "succeed",
    fencingToken: acquireA.fencingToken
  },
  "fence_stale_a"
);
const continueB = await jobsInvoke(
  {
    action: "jobs.process",
    issuedAt: new Date().toISOString(),
    nonce: `${MW06_TEST_PREFIX}/fence-cont`,
    jobId: fenceId,
    command: "continue",
    fencingToken: acquireB.fencingToken
  },
  "fence_continue_b"
);

const firstIdem = await jobsInvoke(
  {
    action: "idempotency.probe",
    issuedAt: new Date().toISOString(),
    nonce: `${MW06_TEST_PREFIX}/idem-1`,
    actorId: `${MW06_TEST_PREFIX}/actor_a`,
    idempotencyKey: `${MW06_TEST_PREFIX}/key_1`,
    payload: { step: 1 }
  },
  "idem_first"
);
const replayIdem = await jobsInvoke(
  {
    action: "idempotency.probe",
    issuedAt: new Date().toISOString(),
    nonce: `${MW06_TEST_PREFIX}/idem-2`,
    actorId: `${MW06_TEST_PREFIX}/actor_a`,
    idempotencyKey: `${MW06_TEST_PREFIX}/key_1`,
    payload: { step: 1 }
  },
  "idem_replay"
);
const conflictIdem = await jobsInvoke(
  {
    action: "idempotency.probe",
    issuedAt: new Date().toISOString(),
    nonce: `${MW06_TEST_PREFIX}/idem-3`,
    actorId: `${MW06_TEST_PREFIX}/actor_a`,
    idempotencyKey: `${MW06_TEST_PREFIX}/key_1`,
    payload: { step: 2 }
  },
  "idem_conflict"
);

let retryState = "";
for (let index = 0; index < 2; index += 1) {
  const claimed = await jobsInvoke(
    {
      action: "jobs.process",
      issuedAt: new Date().toISOString(),
      nonce: `${MW06_TEST_PREFIX}/retry-a-${index}`,
      jobId: retryId,
      command: "acquire",
      leaseMs: 20000
    },
    `retry_acquire_${index}`
  );
  const failed = await jobsInvoke(
    {
      action: "jobs.process",
      issuedAt: new Date().toISOString(),
      nonce: `${MW06_TEST_PREFIX}/retry-f-${index}`,
      jobId: retryId,
      command: "fail",
      fencingToken: claimed.fencingToken
    },
    `retry_fail_${index}`
  );
  retryState = failed.job?.state || "";
}
const inspectRetry = await jobsInvoke(
  {
    action: "jobs.inspect",
    issuedAt: new Date().toISOString(),
    nonce: `${MW06_TEST_PREFIX}/retry-inspect`,
    jobId: retryId,
    command: "inspect"
  },
  "retry_inspect"
);

const adminGet = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "job.get",
  requestId: "req_mw06_job_get",
  data: { jobId: fenceId }
});
record("admin_job_get_unauth", {
  code: adminGet.code,
  errorCode: adminGet.payload?.error?.code,
  reason: adminGet.payload?.error?.details?.reason
});
const adminResume = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "job.resume",
  requestId: "req_mw06_job_resume",
  idempotencyKey: `${MW06_TEST_PREFIX}/resume`,
  data: { jobId: retryId, reason: "continue", role: "super" }
});
record("admin_job_resume_forged", {
  code: adminResume.code,
  errorCode: adminResume.payload?.error?.code,
  reason: adminResume.payload?.error?.details?.reason
});

const inspectFence = await jobsInvoke(
  {
    action: "jobs.inspect",
    issuedAt: new Date().toISOString(),
    nonce: `${MW06_TEST_PREFIX}/fence-inspect`,
    jobId: fenceId,
    command: "inspect"
  },
  "fence_inspect"
);

const idemDocId = idemId(`${MW06_TEST_PREFIX}/actor_a`, "mw06.test.write", `${MW06_TEST_PREFIX}/key_1`);
const nonceKeys = [
  `${MW06_TEST_PREFIX}/race-a`,
  `${MW06_TEST_PREFIX}/race-b`,
  `${MW06_TEST_PREFIX}/fence-a`,
  `${MW06_TEST_PREFIX}/fence-int`,
  `${MW06_TEST_PREFIX}/fence-b`,
  `${MW06_TEST_PREFIX}/fence-stale`,
  `${MW06_TEST_PREFIX}/fence-cont`,
  `${MW06_TEST_PREFIX}/idem-1`,
  `${MW06_TEST_PREFIX}/idem-2`,
  `${MW06_TEST_PREFIX}/idem-3`,
  `${MW06_TEST_PREFIX}/retry-a-0`,
  `${MW06_TEST_PREFIX}/retry-f-0`,
  `${MW06_TEST_PREFIX}/retry-a-1`,
  `${MW06_TEST_PREFIX}/retry-f-1`,
  `${MW06_TEST_PREFIX}/retry-inspect`,
  `${MW06_TEST_PREFIX}/fence-inspect`
];
const cleanup = {};
for (const id of [raceId, fenceId, retryId]) {
  const deleted = await deleteDoc("jobs", id);
  cleanup[`jobs:${id}`] = deleted.code === 0;
}
const deletedIdem = await deleteDoc("idempotency", idemDocId);
cleanup["idempotency:probe"] = deletedIdem.code === 0;
for (const nonce of nonceKeys) {
  const deleted = await deleteDoc("idempotency", idemId("mw-jobs", "serverInvoke", nonce));
  cleanup[`idempotency:nonce:${nonce}`] = deleted.code === 0;
}
const deletedAudit = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([
    {
      TableName: "audit_logs",
      CommandType: "DELETE",
      Command: JSON.stringify({
        delete: "audit_logs",
        deletes: [{ q: { target: { $regex: `^jobs/${MW06_TEST_PREFIX}` } }, limit: 0 }]
      })
    }
  ]),
  "--json"
]);
cleanup["audit_logs:test"] = deletedAudit.code === 0;
record("cleanup", cleanup);

const usage = await runTcb(["env", "list", "--json"]);
const rows = usage.json?.data || [];
const self = rows.find((item) => item.EnvId === authorizedEnvId());
const maxBudget = evidence.budgets.reduce((max, item) => Math.max(max, item.total || 0), 0);
const maxMs = evidence.budgets.reduce((max, item) => Math.max(max, item.elapsedMs || 0), 0);

const continuedCursor = interruptA.job?.cursor?.done === 1 && continueB.job?.cursor?.done === 2;
const summary = {
  raceExactlyOne: raceWins.length === 1 && raceLosses.length === 1,
  interruptSavedCursor: interruptA.ok === true && interruptA.job?.cursor?.done === 1,
  laterTokenHigher: acquireB.ok === true && acquireB.fencingToken > (acquireA.fencingToken || 0),
  staleRejected: staleA.ok === false && staleA.reason === "STALE_FENCING_TOKEN",
  continued: continueB.ok === true && continuedCursor,
  continuedCursor: continuedCursor ? "1->2" : `${interruptA.job?.cursor?.done}->${continueB.job?.cursor?.done}`,
  nonceReplay: acquireAReplay.ok === true && acquireAReplay.replayed === true && acquireAReplay.fencingToken === acquireA.fencingToken,
  idemReplay: firstIdem.ok === true && replayIdem.ok === true && replayIdem.data?.replayed === true,
  idemConflict: conflictIdem.ok === false && conflictIdem.code === "IDEMPOTENCY_CONFLICT",
  needsReview: inspectRetry.job?.state === "needsReview" || retryState === "needsReview",
  jobInspected: Boolean(inspectFence.job?.state),
  adminGetDenied: adminGet.payload?.error?.code === "AUTH_REQUIRED" || adminGet.payload?.error?.code === "FORBIDDEN",
  adminResumeDenied: adminResume.payload?.ok === false,
  budgetOk: maxBudget <= 60,
  maxBudget,
  maxMs,
  enableOverrun: self?.EnableOverrun === false || self?.EnableOverrun === "false",
  cleaned: Object.values(cleanup).every(Boolean),
  realTimerVerified: false
};
const required = [
  "raceExactlyOne",
  "interruptSavedCursor",
  "laterTokenHigher",
  "staleRejected",
  "continued",
  "nonceReplay",
  "idemReplay",
  "idemConflict",
  "needsReview",
  "jobInspected",
  "adminGetDenied",
  "adminResumeDenied",
  "budgetOk",
  "enableOverrun",
  "cleaned"
];
const failed = required.filter((key) => summary[key] !== true);
record("summary", summary);
evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw06-verify-evidence.json"), redactMw06(evidence));
writeJson(join(root, "configs", "mw06-verify-state.json"), redactMw06(summary));
if (failed.length) {
  console.log(JSON.stringify(redactMw06({ ok: false, failed, summary }), null, 2));
  process.exit(1);
}
console.log(JSON.stringify(redactMw06({ ok: true, summary }), null, 2));
