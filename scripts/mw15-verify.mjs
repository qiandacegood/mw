import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, runTcb, writeJson } from "./mw04-lib.mjs";
import { listIndexCommand, parseNosqlCount } from "./mw06-lib.mjs";
import {
  SCORE_INDEXES,
  FORBIDDEN_FUTURE_COLLECTIONS,
  INITIAL_ROOT_SEEDS,
  MW15_COLLECTIONS,
  mw15Tmp,
  redactMw15
} from "./mw15-lib.mjs";

const tmp = mw15Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW15", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw15-verify-evidence.json"), redactMw15(evidence));
}

function errorCode(payload) {
  return payload?.error?.code || payload?.reason || "";
}

function errorReason(payload) {
  return payload?.error?.details?.reason || payload?.reason || "";
}

const ready = await assertMwTestReady();
record("hard_check", {
  ok: ready.ok,
  enableOverrun: ready.enableOverrun,
  otherEnvCount: ready.otherEnvCount,
  envTouched: "mw-test-only"
});
authorizedEnvId();

const { seedCategoryId } = await import("../packages/shared/dist/category.js");

const unauthSubmit = await invokeFn("mw-member", {
  apiVersion: "1",
  action: "attempt.submit",
  requestId: "mw15/test/cli/unauth-submit",
  idempotencyKey: "mw15/test/cli/unauth-submit",
  data: { attemptId: "x", expectedRevision: 0, answers: [], confirmUnanswered: true }
});
record("cli_unauth_submit", {
  ok: errorCode(unauthSubmit.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthSubmit.payload),
  reason: errorReason(unauthSubmit.payload)
});

const unauthResult = await invokeFn("mw-member", {
  apiVersion: "1",
  action: "attempt.result",
  requestId: "mw15/test/cli/unauth-result",
  data: { attemptId: "x" }
});
record("cli_unauth_result", {
  ok: errorCode(unauthResult.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthResult.payload)
});

const forgedSubmit = await invokeFn("mw-member", {
  apiVersion: "1",
  action: "attempt.submit",
  requestId: "mw15/test/cli/forged-submit",
  idempotencyKey: "mw15/test/cli/forged-submit",
  data: { attemptId: "x", expectedRevision: 0, answers: [], confirmUnanswered: true, role: "super", uid: "forged" }
});
record("cli_forged_submit", {
  ok: errorCode(forgedSubmit.payload) === "FORBIDDEN" && errorReason(forgedSubmit.payload) === "CLIENT_IDENTITY_IGNORED",
  code: errorCode(forgedSubmit.payload),
  reason: errorReason(forgedSubmit.payload)
});

const publicSubmit = await invokeFn("mw-public", {
  apiVersion: "1",
  action: "attempt.submit",
  requestId: "mw15/test/cli/public-submit",
  data: { attemptId: "x", expectedRevision: 0, answers: [], confirmUnanswered: true }
});
record("cli_public_rejects_submit", {
  ok: errorCode(publicSubmit.payload) === "FORBIDDEN",
  code: errorCode(publicSubmit.payload),
  reason: errorReason(publicSubmit.payload)
});

let seedCount = 0;
for (const seed of INITIAL_ROOT_SEEDS) {
  const counted = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: "categories",
        CommandType: "COMMAND",
        Command: JSON.stringify({ count: "categories", query: { _id: seedCategoryId(seed.seedKey) } })
      }
    ]),
    "--json"
  ]);
  if (parseNosqlCount(counted) === 1) seedCount += 1;
}

const listed = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([{ TableName: MW15_COLLECTIONS[0], CommandType: "COMMAND", Command: JSON.stringify({ listCollections: 1 }) }]),
  "--json"
]);
const listedText = JSON.stringify(listed.json || {});
const collectionsPresent = MW15_COLLECTIONS.every((name) => listedText.includes(name));
const futurePresent = FORBIDDEN_FUTURE_COLLECTIONS.some((name) => listedText.includes(`"${name}"`));

let indexesOk = true;
for (const index of SCORE_INDEXES) {
  const indexList = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([listIndexCommand(index.collection)]),
    "--json"
  ]);
  const ok = indexList.code === 0 && JSON.stringify(indexList.json || {}).includes(index.name);
  record(`index_${index.name}`, { ok });
  if (!ok) indexesOk = false;
}

let clientDenied = false;
try {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({ env: authorizedEnvId(), region: "ap-shanghai" });
  const results = [];
  for (const name of ["attempts", "paper_answers", "paper_bests", "score_events", "score_metrics"]) {
    try {
      await app.database().collection(name).add({ marker: "MW15" });
      results.push(false);
    } catch {
      results.push(true);
    }
  }
  clientDenied = results.every(Boolean);
} catch {
  clientDenied = false;
}
record("client_direct_write", { ok: clientDenied });

record("collections", { present: collectionsPresent, futurePresent, seedCount, indexesOk });

const cliOk = evidence.steps.filter((step) => step.name.startsWith("cli_") && step.ok === false).length === 0;
const ok = cliOk && collectionsPresent && !futurePresent && seedCount === 10 && indexesOk && clientDenied;

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw15-verify-evidence.json"), redactMw15(evidence));
console.log(
  JSON.stringify(
    redactMw15({
      ok,
      cliOk,
      collectionsPresent,
      futurePresent,
      seedCount,
      indexesOk,
      clientDenied,
      enableOverrun: ready.enableOverrun
    }),
    null,
    2
  )
);
process.exit(ok ? 0 : 1);
