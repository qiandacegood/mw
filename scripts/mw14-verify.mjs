import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, runTcb, writeJson } from "./mw04-lib.mjs";
import { listIndexCommand, parseNosqlCount } from "./mw06-lib.mjs";
import {
  ATTEMPT_INDEXES,
  FORBIDDEN_FUTURE_COLLECTIONS,
  INITIAL_ROOT_SEEDS,
  MW14_COLLECTIONS,
  mw14Tmp,
  redactMw14
} from "./mw14-lib.mjs";

const tmp = mw14Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW14", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw14-verify-evidence.json"), redactMw14(evidence));
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

const unauthStart = await invokeFn("mw-member", {
  apiVersion: "1",
  action: "attempt.start",
  requestId: "mw14/test/cli/unauth-start",
  idempotencyKey: "mw14/test/cli/unauth-start",
  data: { paperId: "x" }
});
record("cli_unauth_start", {
  ok: errorCode(unauthStart.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthStart.payload),
  reason: errorReason(unauthStart.payload)
});

const unauthSave = await invokeFn("mw-member", {
  apiVersion: "1",
  action: "attempt.save",
  requestId: "mw14/test/cli/unauth-save",
  idempotencyKey: "mw14/test/cli/unauth-save",
  data: { attemptId: "x", expectedRevision: 0, answers: [] }
});
record("cli_unauth_save", {
  ok: errorCode(unauthSave.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthSave.payload)
});

const forgedStart = await invokeFn("mw-member", {
  apiVersion: "1",
  action: "attempt.start",
  requestId: "mw14/test/cli/forged-start",
  idempotencyKey: "mw14/test/cli/forged-start",
  data: { paperId: "x", role: "super", uid: "forged" }
});
record("cli_forged_start", {
  ok: errorCode(forgedStart.payload) === "FORBIDDEN" && errorReason(forgedStart.payload) === "CLIENT_IDENTITY_IGNORED",
  code: errorCode(forgedStart.payload),
  reason: errorReason(forgedStart.payload)
});

const publicAttempt = await invokeFn("mw-public", {
  apiVersion: "1",
  action: "attempt.start",
  requestId: "mw14/test/cli/public-attempt",
  data: { paperId: "x" }
});
record("cli_public_rejects_attempt", {
  ok: errorCode(publicAttempt.payload) === "FORBIDDEN",
  code: errorCode(publicAttempt.payload),
  reason: errorReason(publicAttempt.payload)
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
  JSON.stringify([{ TableName: MW14_COLLECTIONS[0], CommandType: "COMMAND", Command: JSON.stringify({ listCollections: 1 }) }]),
  "--json"
]);
const listedText = JSON.stringify(listed.json || {});
const collectionsPresent = MW14_COLLECTIONS.every((name) => listedText.includes(name));
const futurePresent = FORBIDDEN_FUTURE_COLLECTIONS.some((name) => listedText.includes(`"${name}"`));

let indexesOk = true;
for (const index of ATTEMPT_INDEXES) {
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
  for (const name of ["attempts", "active_attempts", "paper_answers"]) {
    try {
      await app.database().collection(name).add({ marker: "MW14" });
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
writeJson(join(tmp, "mw14-verify-evidence.json"), redactMw14(evidence));
console.log(
  JSON.stringify(
    redactMw14({
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
// 显式退出：@cloudbase/js-sdk 会保留长连接句柄，若不退出，进程在打印汇总后会一直挂住。
process.exit(ok ? 0 : 1);
