import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseFunctionEnv, parseNosqlCount } from "./mw06-lib.mjs";
import { FORBIDDEN_COLLECTIONS, MW21_COLLECTIONS, mw21Tmp, redactMw21 } from "./mw21-lib.mjs";

const tmp = mw21Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW21", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw21-verify-evidence.json"), redactMw21(evidence));
}

function errorCode(payload) {
  return payload?.error?.code || payload?.reason || "";
}

function request(action, data = {}, extra = {}) {
  return { apiVersion: "1", action, requestId: `mw21/test/cli/${action}`, data, ...extra };
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

const unauthPublish = await invokeFn(
  "mw-admin",
  request("plan.publish", { planId: "plan_test_30d", planVersion: 1, title: "x", durationDays: 30, priceFen: 1, reason: "cli" }, { idempotencyKey: "mw21/cli/publish" })
);
record("cli_unauth_publish", {
  ok: errorCode(unauthPublish.payload) === "AUTH_REQUIRED" || errorCode(unauthPublish.payload) === "FORBIDDEN",
  code: errorCode(unauthPublish.payload)
});

const unauthCreate = await invokeFn(
  "mw-member",
  request("order.create", { planId: "plan_test_30d", planVersion: 1, clientChannel: "android" }, { idempotencyKey: "mw21/cli/create" })
);
record("cli_unauth_create", {
  ok:
    errorCode(unauthCreate.payload) === "AUTH_REQUIRED" ||
    errorCode(unauthCreate.payload) === "MEMBER_REQUIRED" ||
    errorCode(unauthCreate.payload) === "FORBIDDEN",
  code: errorCode(unauthCreate.payload)
});

const collections = {};
for (const name of MW21_COLLECTIONS) {
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
for (const name of FORBIDDEN_COLLECTIONS) {
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

const payHook = await runTcb(["fn", "detail", "mw-pay-hook", "--json"]);
const payEnv = parseFunctionEnv(payHook.json) || {};
const sandboxEnv = String(payEnv.VIRTUAL_PAY_ENV || "") === "1";
record("sandbox_env", { ok: sandboxEnv, virtualPayEnvIsSandbox: sandboxEnv });

const ok =
  evidence.steps.find((row) => row.name === "cli_unauth_publish")?.ok === true &&
  evidence.steps.find((row) => row.name === "cli_unauth_create")?.ok === true &&
  seedPresent === seedCategoryIds().length &&
  forbiddenPresent !== true &&
  ready.enableOverrun !== true &&
  sandboxEnv === true;

const summary = redactMw21({
  ok,
  unauthPublish: errorCode(unauthPublish.payload),
  unauthCreate: errorCode(unauthCreate.payload),
  collections,
  seedPresent,
  forbidden,
  sandboxEnv,
  enableOverrun: ready.enableOverrun
});
writeJson(join(tmp, "mw21-verify-evidence.json"), { ...evidence, finishedAt: new Date().toISOString(), summary });
console.log(JSON.stringify(summary, null, 2));
if (!ok) process.exit(1);
