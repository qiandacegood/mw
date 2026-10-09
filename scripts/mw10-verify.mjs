import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { listIndexCommand } from "./mw06-lib.mjs";
import {
  FORBIDDEN_FUTURE_COLLECTIONS,
  INITIAL_ROOT_SEEDS,
  MW10_COLLECTIONS,
  MW10_MARKER,
  QUESTION_INDEX,
  mw10Tmp,
  redactMw10
} from "./mw10-lib.mjs";

const tmp = mw10Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: MW10_MARKER, steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw10-verify-evidence.json"), redactMw10(evidence));
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
  action: "question.save",
  requestId: "mw10/test/cli/unauth-save",
  idempotencyKey: "mw10/test/cli/unauth-save",
  data: { expectedRevision: 0, categoryId: "x", type: "single" }
});
record("cli_unauth_save", {
  ok: errorCode(unauthSave.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthSave.payload),
  reason: errorReason(unauthSave.payload)
});

const unauthUpload = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "upload.authorize",
  requestId: "mw10/test/cli/unauth-upload",
  idempotencyKey: "mw10/test/cli/unauth-upload",
  data: { purpose: "prompt", contentType: "image/png", size: 12, sha256: "a".repeat(64), caption: "x" }
});
record("cli_unauth_upload", {
  ok: errorCode(unauthUpload.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthUpload.payload)
});

const forgedSave = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "question.save",
  requestId: "mw10/test/cli/forged-save",
  idempotencyKey: "mw10/test/cli/forged-save",
  data: { expectedRevision: 0, role: "super", uid: "forged" }
});
record("cli_forged_save", {
  ok: errorCode(forgedSave.payload) === "FORBIDDEN" && errorReason(forgedSave.payload) === "CLIENT_IDENTITY_IGNORED",
  code: errorCode(forgedSave.payload),
  reason: errorReason(forgedSave.payload)
});

const forgedUpload = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "upload.authorize",
  requestId: "mw10/test/cli/forged-upload",
  idempotencyKey: "mw10/test/cli/forged-upload",
  data: { purpose: "prompt", contentType: "image/png", size: 12, sha256: "a".repeat(64), caption: "x", role: "super" }
});
record("cli_forged_upload", {
  ok: errorCode(forgedUpload.payload) === "FORBIDDEN",
  code: errorCode(forgedUpload.payload),
  reason: errorReason(forgedUpload.payload)
});

const noTicket = await invokeFn("mw-upload", { requestId: "mw10/test/cli/no-ticket", data: {} });
record("cli_upload_no_ticket", {
  ok: errorCode(noTicket.payload) === "FORBIDDEN" && errorReason(noTicket.payload) === "TICKET_REQUIRED",
  code: errorCode(noTicket.payload),
  reason: errorReason(noTicket.payload)
});

const publicHome = await invokeFn("mw-public", {
  apiVersion: "1",
  action: "home.get",
  requestId: "mw10/test/cli/public-home",
  data: {}
});
const publicText = JSON.stringify(publicHome.payload || {});
record("cli_public_no_secrets", {
  ok:
    publicHome.payload?.ok === true &&
    !/"answer"/.test(publicText) &&
    !/"analysis"/.test(publicText) &&
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
  const n = counted.json?.data?.results?.[0]?.n ?? counted.json?.data?.n;
  if (n === 1 || n?.$numberInt === "1") seedCount += 1;
}

const listed = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([{ TableName: "questions", CommandType: "COMMAND", Command: JSON.stringify({ listCollections: 1 }) }]),
  "--json"
]);
const listedText = JSON.stringify(listed.json || {});
const collectionsPresent = MW10_COLLECTIONS.every((name) => listedText.includes(name));
const futurePresent = FORBIDDEN_FUTURE_COLLECTIONS.some((name) => listedText.includes(`"${name}"`));

const indexList = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([listIndexCommand(QUESTION_INDEX.collection)]),
  "--json"
]);
record("collections", { present: collectionsPresent, futurePresent, seedCount, indexName: QUESTION_INDEX.name });
record("index_questions", {
  ok: indexList.code === 0 && JSON.stringify(indexList.json || {}).includes(QUESTION_INDEX.name)
});

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw10-verify-evidence.json"), redactMw10(evidence));
console.log(
  JSON.stringify(
    redactMw10({
      ok: evidence.steps.filter((step) => step.name.startsWith("cli_") && step.ok === false).length === 0,
      seedCount,
      collectionsPresent,
      futurePresent,
      enableOverrun: ready.enableOverrun
    }),
    null,
    2
  )
);
