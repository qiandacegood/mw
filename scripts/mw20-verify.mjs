import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { FORBIDDEN_FUTURE_COLLECTIONS, MW20_COLLECTIONS, mw20Tmp, redactMw20 } from "./mw20-lib.mjs";

const tmp = mw20Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW20", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw20-verify-evidence.json"), redactMw20(evidence));
}

function errorCode(payload) {
  return payload?.error?.code || payload?.reason || "";
}

function request(action, data = {}, extra = {}) {
  return { apiVersion: "1", action, requestId: `mw20/test/cli/${action}`, data, ...extra };
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

const unauthGrant = await invokeFn(
  "mw-admin",
  request("vip.grant", { memberId: "x", durationDays: 1, reason: "cli" }, { idempotencyKey: "mw20/cli/grant" })
);
record("cli_unauth_grant", {
  ok: errorCode(unauthGrant.payload) === "AUTH_REQUIRED" || errorCode(unauthGrant.payload) === "FORBIDDEN",
  code: errorCode(unauthGrant.payload)
});

const collections = {};
for (const name of MW20_COLLECTIONS) {
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
  evidence.steps.find((row) => row.name === "cli_unauth_grant")?.ok === true &&
  seedPresent === seedCategoryIds().length &&
  forbiddenPresent !== true &&
  ready.enableOverrun !== true;

const summary = redactMw20({
  ok,
  unauthGrant: errorCode(unauthGrant.payload),
  collections,
  seedPresent,
  forbidden,
  enableOverrun: ready.enableOverrun
});
writeJson(join(tmp, "mw20-verify-evidence.json"), { ...evidence, finishedAt: new Date().toISOString(), summary });
console.log(JSON.stringify(summary, null, 2));
if (!ok) process.exit(1);
