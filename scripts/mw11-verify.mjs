import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { listIndexCommand, parseNosqlCount } from "./mw06-lib.mjs";
import {
  FORBIDDEN_FUTURE_COLLECTIONS,
  INITIAL_ROOT_SEEDS,
  MW11_COLLECTIONS,
  MW11_MARKER,
  PAPER_INDEXES,
  mw11Tmp,
  redactMw11
} from "./mw11-lib.mjs";

const tmp = mw11Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: MW11_MARKER, steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw11-verify-evidence.json"), redactMw11(evidence));
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

const unauthSave = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "paper.save",
  requestId: "mw11/test/cli/unauth-save",
  idempotencyKey: "mw11/test/cli/unauth-save",
  data: { expectedRevision: 0, title: "x", summary: "x", goal: "x", categoryId: "x", access: "free", difficulty: "beginner", sort: 10 }
});
record("cli_unauth_save", {
  ok: errorCode(unauthSave.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthSave.payload),
  reason: errorReason(unauthSave.payload)
});

const unauthPublish = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "paper.publish",
  requestId: "mw11/test/cli/unauth-publish",
  idempotencyKey: "mw11/test/cli/unauth-publish",
  data: { paperId: "x", expectedRevision: 1 }
});
record("cli_unauth_publish", {
  ok: errorCode(unauthPublish.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthPublish.payload)
});

const forgedSave = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "paper.save",
  requestId: "mw11/test/cli/forged-save",
  idempotencyKey: "mw11/test/cli/forged-save",
  data: { expectedRevision: 0, role: "super", uid: "forged" }
});
record("cli_forged_save", {
  ok: errorCode(forgedSave.payload) === "FORBIDDEN" && errorReason(forgedSave.payload) === "CLIENT_IDENTITY_IGNORED",
  code: errorCode(forgedSave.payload),
  reason: errorReason(forgedSave.payload)
});

const forgedPublish = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "paper.publish",
  requestId: "mw11/test/cli/forged-publish",
  idempotencyKey: "mw11/test/cli/forged-publish",
  data: { paperId: "x", expectedRevision: 1, role: "super", uid: "forged" }
});
record("cli_forged_publish", {
  ok: errorCode(forgedPublish.payload) === "FORBIDDEN",
  code: errorCode(forgedPublish.payload),
  reason: errorReason(forgedPublish.payload)
});

const publicList = await invokeFn("mw-public", {
  apiVersion: "1",
  action: "paper.list",
  requestId: "mw11/test/cli/public-list",
  data: {}
});
const publicText = JSON.stringify(publicList.payload || {});
record("cli_public_no_secrets", {
  ok:
    publicList.payload?.ok === true &&
    !/"answer"/.test(publicText) &&
    !/"analysis"/.test(publicText) &&
    !/"paper_answers"/.test(publicText) &&
    !/"question_versions"/.test(publicText)
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
  JSON.stringify([{ TableName: "papers", CommandType: "COMMAND", Command: JSON.stringify({ listCollections: 1 }) }]),
  "--json"
]);
const listedText = JSON.stringify(listed.json || {});
const collectionsPresent = MW11_COLLECTIONS.every((name) => listedText.includes(name));
const futurePresent = FORBIDDEN_FUTURE_COLLECTIONS.some((name) => listedText.includes(`"${name}"`));

let indexesOk = true;
for (const index of PAPER_INDEXES) {
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
writeJson(join(tmp, "mw11-verify-evidence.json"), redactMw11(evidence));
console.log(
  JSON.stringify(
    redactMw11({
      ok: evidence.steps.filter((step) => step.name.startsWith("cli_") && step.ok === false).length === 0 && indexesOk,
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
