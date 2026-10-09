import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { listIndexCommand, parseNosqlCount } from "./mw06-lib.mjs";
import {
  FORBIDDEN_FUTURE_COLLECTIONS,
  IMPORT_INDEXES,
  INITIAL_ROOT_SEEDS,
  MW12_COLLECTIONS,
  MW12_MARKER,
  mw12Tmp,
  redactMw12
} from "./mw12-lib.mjs";

const tmp = mw12Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: MW12_MARKER, steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw12-verify-evidence.json"), redactMw12(evidence));
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

const unauthValidate = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "import.validate",
  requestId: "mw12/test/cli/unauth-validate",
  idempotencyKey: "mw12/test/cli/unauth-validate",
  data: { kind: "question", ticketId: "x" }
});
record("cli_unauth_validate", {
  ok: errorCode(unauthValidate.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthValidate.payload),
  reason: errorReason(unauthValidate.payload)
});

const unauthCommit = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "import.commit",
  requestId: "mw12/test/cli/unauth-commit",
  idempotencyKey: "mw12/test/cli/unauth-commit",
  data: { batchId: "x" }
});
record("cli_unauth_commit", {
  ok: errorCode(unauthCommit.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthCommit.payload)
});

const forgedValidate = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "import.validate",
  requestId: "mw12/test/cli/forged-validate",
  idempotencyKey: "mw12/test/cli/forged-validate",
  data: { kind: "question", ticketId: "x", role: "super", uid: "forged" }
});
record("cli_forged_validate", {
  ok: errorCode(forgedValidate.payload) === "FORBIDDEN" && errorReason(forgedValidate.payload) === "CLIENT_IDENTITY_IGNORED",
  code: errorCode(forgedValidate.payload),
  reason: errorReason(forgedValidate.payload)
});

const forgedCommit = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "import.commit",
  requestId: "mw12/test/cli/forged-commit",
  idempotencyKey: "mw12/test/cli/forged-commit",
  data: { batchId: "x", role: "super", uid: "forged" }
});
record("cli_forged_commit", {
  ok: errorCode(forgedCommit.payload) === "FORBIDDEN",
  code: errorCode(forgedCommit.payload),
  reason: errorReason(forgedCommit.payload)
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
  JSON.stringify([{ TableName: "import_batches", CommandType: "COMMAND", Command: JSON.stringify({ listCollections: 1 }) }]),
  "--json"
]);
const listedText = JSON.stringify(listed.json || {});
const collectionsPresent = MW12_COLLECTIONS.every((name) => listedText.includes(name));
const futurePresent = FORBIDDEN_FUTURE_COLLECTIONS.some((name) => listedText.includes(`"${name}"`));

let indexesOk = true;
for (const index of IMPORT_INDEXES) {
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

record("collections", { present: collectionsPresent, futurePresent, seedCount });

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw12-verify-evidence.json"), redactMw12(evidence));
const cliFailed = evidence.steps.filter((step) => step.name.startsWith("cli_") && step.ok === false).length;
console.log(
  JSON.stringify(
    redactMw12({
      ok: cliFailed === 0 && indexesOk,
      seedCount,
      collectionsPresent,
      futurePresent,
      indexesOk,
      enableOverrun: ready.enableOverrun
    }),
    null,
    2
  )
);
if (cliFailed || !indexesOk) process.exit(1);
