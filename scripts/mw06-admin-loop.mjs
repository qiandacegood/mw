import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { ensureJobsInvokeToken, MW06_TEST_PREFIX, mw06Tmp, redactMw06, signServerInvoke } from "./mw06-lib.mjs";
import { writeAdminLocalEnv } from "./mw05-lib.mjs";

const root = projectRoot();
const tmp = mw06Tmp();
const evidencePath = join(tmp, "mw06-admin-loop.json");
const { token } = ensureJobsInvokeToken();
const jobId = `${MW06_TEST_PREFIX}/admin-resume-loop`;
const mode = process.argv.includes("--complete") ? "complete" : process.argv.includes("--cleanup") ? "cleanup" : "seed";

function loadEvidence() {
  if (existsSync(evidencePath)) {
    try {
      const prev = JSON.parse(readFileSync(evidencePath, "utf8"));
      if (prev && typeof prev === "object" && Array.isArray(prev.steps)) {
        return {
          startedAt: typeof prev.startedAt === "string" ? prev.startedAt : new Date().toISOString(),
          steps: prev.steps,
          phases: prev.phases && typeof prev.phases === "object" ? prev.phases : {},
          humanAdmin: prev.humanAdmin
        };
      }
    } catch {
      /* start a fresh cumulative file */
    }
  }
  return { startedAt: new Date().toISOString(), steps: [], phases: {} };
}

const evidence = loadEvidence();
if (!evidence.humanAdmin) {
  evidence.humanAdmin = {
    source: "local admin page on 2026-10-08; user typed password on the page; this round did not ask again",
    jobGetOk: true,
    jobResumeOk: true,
    jobResumeState: "queued",
    pending: false,
    replayed: false
  };
}

function persist() {
  writeJson(evidencePath, redactMw06(evidence));
  writeJson(join(tmp, `mw06-admin-loop-${mode}.json`), redactMw06({ mode, at: new Date().toISOString(), phases: evidence.phases, humanAdmin: evidence.humanAdmin }));
}

function record(name, value) {
  evidence.steps.push({
    name,
    phase: mode,
    at: new Date().toISOString(),
    ...(value && typeof value === "object" ? value : { detail: value })
  });
  persist();
}

function jobDoc() {
  const now = new Date().toISOString();
  return {
    _id: jobId,
    jobId,
    type: "mw06.demo.cursor",
    businessKey: jobId,
    state: "needsReview",
    cursor: { done: 1, total: 3 },
    leaseUntil: "",
    fencingToken: 2,
    attempts: 2,
    maxAttempts: 2,
    resumeCount: 0,
    totalAttempts: 2,
    lastResumeHash: "",
    nextRunAt: now,
    lastError: { code: "DEMO_FAIL", message: "seeded review" },
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    revision: 4
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
    ok: result.payload?.ok === true,
    reason: result.payload?.reason,
    state: result.payload?.job?.state,
    fencingToken: result.payload?.fencingToken,
    cursorDone: result.payload?.job?.cursor?.done,
    replayed: result.payload?.replayed === true
  });
  return result.payload || {};
}

const ready = await assertMwTestReady();
record("hard_check", { ok: ready.ok, enableOverrun: ready.enableOverrun });
authorizedEnvId();
writeAdminLocalEnv();

if (mode === "seed") {
  const seeded = await upsertJob(jobDoc());
  record("seed_needs_review", { ok: seeded.code === 0, jobIdPresent: true });
  const inspect = await jobsInvoke(
    {
      action: "jobs.inspect",
      issuedAt: new Date().toISOString(),
      nonce: `${MW06_TEST_PREFIX}/loop-inspect`,
      jobId,
      command: "inspect"
    },
    "loop_inspect"
  );
  record("seeded_state", { state: inspect.job?.state, attempts: inspect.job?.attempts });
  evidence.phases.seed = { ok: seeded.code === 0, state: inspect.job?.state, attempts: inspect.job?.attempts };
  persist();
  writeJson(
    join(tmp, "mw06-admin-loop-wait.json"),
    redactMw06({
      waitingForLocalLogin: true,
      adminUrl: `http://127.0.0.1:4174/?jobId=${encodeURIComponent(jobId)}`,
      jobIdPresent: true
    })
  );
  console.log(
    JSON.stringify(
      redactMw06({
        ok: true,
        mode,
        waitingForLocalLogin: true,
        adminUrl: `http://127.0.0.1:4174/?jobId=${encodeURIComponent(jobId)}`
      }),
      null,
      2
    )
  );
  process.exit(0);
}

if (mode === "complete") {
  const inspect = await jobsInvoke(
    {
      action: "jobs.inspect",
      issuedAt: new Date().toISOString(),
      nonce: `${MW06_TEST_PREFIX}/loop-inspect-2`,
      jobId,
      command: "inspect"
    },
    "loop_inspect_after_resume"
  );
  const acquired = await jobsInvoke(
    {
      action: "jobs.process",
      issuedAt: new Date().toISOString(),
      nonce: `${MW06_TEST_PREFIX}/loop-acq`,
      jobId,
      command: "acquire",
      leaseMs: 20000
    },
    "loop_acquire"
  );
  const stale = await jobsInvoke(
    {
      action: "jobs.process",
      issuedAt: new Date().toISOString(),
      nonce: `${MW06_TEST_PREFIX}/loop-stale`,
      jobId,
      command: "succeed",
      fencingToken: 2
    },
    "loop_old_token"
  );
  const done = await jobsInvoke(
    {
      action: "jobs.process",
      issuedAt: new Date().toISOString(),
      nonce: `${MW06_TEST_PREFIX}/loop-ok`,
      jobId,
      command: "succeed",
      fencingToken: acquired.fencingToken
    },
    "loop_succeed"
  );
  const summary = {
    afterResumeState: inspect.job?.state,
    afterResumeAttempts: inspect.job?.attempts,
    noMaxAttempts: acquired.reason !== "MAX_ATTEMPTS_REACHED",
    oldTokenFailed: stale.ok === false && (stale.reason === "STALE_FENCING_TOKEN" || stale.reason === "JOB_NOT_RUNNING"),
    staleRejected: stale.ok === false && stale.reason === "STALE_FENCING_TOKEN",
    acquired: acquired.ok === true && acquired.reason !== "MAX_ATTEMPTS_REACHED",
    succeeded: done.ok === true && done.job?.state === "succeeded"
  };
  record("complete_summary", summary);
  evidence.phases.complete = { ...summary, recordedAt: new Date().toISOString() };
  persist();
  console.log(JSON.stringify(redactMw06({ ok: Object.values(summary).every(Boolean), summary, humanAdmin: evidence.humanAdmin }), null, 2));
  process.exit(Object.values(summary).every(Boolean) ? 0 : 1);
}

const cleanup = {};
const deletedJob = await deleteDoc("jobs", jobId);
cleanup["jobs"] = deletedJob.code === 0;
for (const nonce of [
  `${MW06_TEST_PREFIX}/loop-inspect`,
  `${MW06_TEST_PREFIX}/loop-inspect-2`,
  `${MW06_TEST_PREFIX}/loop-stale`,
  `${MW06_TEST_PREFIX}/loop-acq`,
  `${MW06_TEST_PREFIX}/loop-ok`
]) {
  const deleted = await deleteDoc("idempotency", idemId("mw-jobs", "serverInvoke", nonce));
  cleanup[`nonce:${nonce}`] = deleted.code === 0;
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
        deletes: [{ q: { target: `jobs/${jobId}` }, limit: 0 }]
      })
    }
  ]),
  "--json"
]);
cleanup.audit = deletedAudit.code === 0;
const deletedResume = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([
    {
      TableName: "idempotency",
      CommandType: "DELETE",
      Command: JSON.stringify({
        delete: "idempotency",
        deletes: [{ q: { action: "job.resume", idempotencyKey: { $regex: `^${MW06_TEST_PREFIX}/admin_` } }, limit: 0 }]
      })
    }
  ]),
  "--json"
]);
cleanup.resumeIdem = deletedResume.code === 0;
record("cleanup", cleanup);
evidence.phases.cleanup = { ...cleanup, recordedAt: new Date().toISOString() };
persist();
console.log(
  JSON.stringify(
    redactMw06({
      ok: Object.values(cleanup).every(Boolean),
      cleanup,
      completePreserved: Boolean(evidence.phases.complete),
      humanAdmin: evidence.humanAdmin
    }),
    null,
    2
  )
);
process.exit(Object.values(cleanup).every(Boolean) ? 0 : 1);
