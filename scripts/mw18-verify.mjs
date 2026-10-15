import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { FORBIDDEN_FUTURE_COLLECTIONS, MW18_COLLECTIONS, mw18Tmp, redactMw18 } from "./mw18-lib.mjs";

const tmp = mw18Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW18", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw18-verify-evidence.json"), redactMw18(evidence));
}

function errorCode(payload) {
  return payload?.error?.code || payload?.reason || "";
}

function request(action, data = {}, extra = {}) {
  return { apiVersion: "1", action, requestId: `mw18/test/cli/${action}`, data, ...extra };
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
  request("category.change.preview", { expectedTreeVersion: 1, operations: [{ type: "move", categoryId: "x", parentId: null }] }, { idempotencyKey: "mw18/cli/preview" })
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

const publicTree = await invokeFn("mw-public", request("category.tree", {}));
record("cli_public_tree", {
  ok: publicTree.payload?.ok === true,
  updating: publicTree.payload?.data?.updating === true,
  nodeCount: Array.isArray(publicTree.payload?.data?.nodes) ? publicTree.payload.data.nodes.length : -1
});

const collections = {};
for (const name of MW18_COLLECTIONS) {
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

const forbidden = {};
for (const name of FORBIDDEN_FUTURE_COLLECTIONS) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([{ TableName: name, CommandType: "COMMAND", Command: JSON.stringify({ count: name, query: {} }) }]),
    "--json"
  ]);
  const text = `${result.stdout || ""}${result.stderr || ""}`;
  const count = parseNosqlCount(result) || 0;
  forbidden[name] = {
    existed: result.code === 0 && !/not found|does not exist|RESOURCE_NOT_FOUND/i.test(text),
    count,
    docsPresent: count > 0
  };
  record(`forbidden_${name}`, forbidden[name]);
}

const seeds = seedCategoryIds();
let seedPresent = 0;
for (const id of seeds) {
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
record("seed_categories", { expected: seeds.length, present: seedPresent });

const ok =
  ready.ok === true &&
  ready.enableOverrun !== true &&
  seedPresent === seeds.length &&
  Object.values(forbidden).every((row) => row.docsPresent !== true);

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw18-verify-evidence.json"), redactMw18(evidence));
console.log(JSON.stringify(redactMw18({ ok, seedPresent, collections, forbidden }), null, 2));
if (!ok) process.exit(1);
