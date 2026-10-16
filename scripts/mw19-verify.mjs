import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { FORBIDDEN_FUTURE_COLLECTIONS, MW19_COLLECTIONS, mw19Tmp, redactMw19 } from "./mw19-lib.mjs";

const tmp = mw19Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW19", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw19-verify-evidence.json"), redactMw19(evidence));
}

function errorCode(payload) {
  return payload?.error?.code || payload?.reason || "";
}

function request(action, data = {}, extra = {}) {
  return { apiVersion: "1", action, requestId: `mw19/test/cli/${action}`, data, ...extra };
}

const ready = await assertMwTestReady();
record("hard_check", {
  ok: ready.ok,
  enableOverrun: ready.enableOverrun,
  otherEnvCount: ready.otherEnvCount,
  envTouched: "mw-test-only"
});
authorizedEnvId();

const { seedCategoryIds } = await import("../packages/shared/dist/category.js");

const unauthPreview = await invokeFn(
  "mw-admin",
  request("correction.preview", { paperId: "x", fromVersionId: "a", toVersionId: "b" }, { idempotencyKey: "mw19/cli/preview" })
);
record("cli_unauth_preview", {
  ok: errorCode(unauthPreview.payload) === "AUTH_REQUIRED" || errorCode(unauthPreview.payload) === "FORBIDDEN",
  code: errorCode(unauthPreview.payload)
});

const forgedTimer = await invokeFn("mw-jobs", { Type: "Timer", TriggerName: "mw-jobs-tick" });
record("cli_forged_timer", {
  ok: forgedTimer.payload?.reason === "FORGED_TIMER_DENIED" || errorCode(forgedTimer.payload) === "FORBIDDEN",
  reason: forgedTimer.payload?.reason || errorCode(forgedTimer.payload)
});

const collections = {};
for (const name of MW19_COLLECTIONS) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([{ TableName: name, CommandType: "COMMAND", Command: JSON.stringify({ count: name, query: {} }) }]),
    "--json"
  ]);
  collections[name] = { code: result.code, count: parseNosqlCount(result) };
  record(`count_${name}`, collections[name]);
}

let seedPresent = 0;
for (const id of seedCategoryIds()) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([{ TableName: "categories", CommandType: "COMMAND", Command: JSON.stringify({ count: "categories", query: { _id: id } }) }]),
    "--json"
  ]);
  seedPresent += parseNosqlCount(result) || 0;
}

const forbidden = {};
let forbiddenPresent = false;
for (const name of FORBIDDEN_FUTURE_COLLECTIONS) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([{ TableName: name, CommandType: "COMMAND", Command: JSON.stringify({ count: name, query: {} }) }]),
    "--json"
  ]);
  const count = parseNosqlCount(result) || 0;
  forbidden[name] = count;
  if (count > 0) forbiddenPresent = true;
}

const ok =
  evidence.steps.find((row) => row.name === "cli_unauth_preview")?.ok === true &&
  evidence.steps.find((row) => row.name === "cli_forged_timer")?.ok === true &&
  seedPresent === seedCategoryIds().length &&
  forbiddenPresent === false &&
  ready.enableOverrun !== true;

const summary = redactMw19({
  ok,
  unauth: errorCode(unauthPreview.payload),
  forgedTimer: forgedTimer.payload?.reason || errorCode(forgedTimer.payload),
  collections,
  seedPresent,
  forbidden,
  enableOverrun: ready.enableOverrun
});
writeJson(join(tmp, "mw19-verify-evidence.json"), { ...evidence, finishedAt: new Date().toISOString(), summary });
console.log(JSON.stringify(summary, null, 2));
if (!ok) process.exit(1);
