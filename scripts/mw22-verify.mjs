import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseFunctionEnv, parseNosqlCount } from "./mw06-lib.mjs";
import { MW22_COLLECTIONS, mw22Tmp, redactMw22 } from "./mw22-lib.mjs";

const tmp = mw22Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW22", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw22-verify-evidence.json"), redactMw22(evidence));
}

function errorCode(payload) {
  return payload?.error?.code || payload?.reason || "";
}

function request(action, data = {}, extra = {}) {
  return { apiVersion: "1", action, requestId: `mw22/test/cli/${action}`, data, ...extra };
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

const unauthExecute = await invokeFn(
  "mw-admin",
  request("refund.execute", { orderId: "x", amountFen: 1, reason: "cli" }, { idempotencyKey: "mw22/cli/execute" })
);
record("cli_unauth_execute", {
  ok: errorCode(unauthExecute.payload) === "AUTH_REQUIRED" || errorCode(unauthExecute.payload) === "FORBIDDEN",
  code: errorCode(unauthExecute.payload)
});

const unauthRequest = await invokeFn("mw-member", request("refund.request", { orderId: "x", reason: "cli" }));
record("cli_unauth_request", {
  ok:
    errorCode(unauthRequest.payload) === "AUTH_REQUIRED" ||
    errorCode(unauthRequest.payload) === "MEMBER_REQUIRED" ||
    errorCode(unauthRequest.payload) === "FORBIDDEN",
  code: errorCode(unauthRequest.payload)
});

const collections = {};
for (const name of MW22_COLLECTIONS) {
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

const payHook = await runTcb(["fn", "detail", "mw-pay-hook", "--json"]);
const payEnv = parseFunctionEnv(payHook.json) || {};
const sandboxEnv = String(payEnv.VIRTUAL_PAY_ENV || "") === "1";
const liveKey = Object.prototype.hasOwnProperty.call(payEnv, "VIRTUAL_PAY_APP_KEY_LIVE");
record("sandbox_env", { ok: sandboxEnv && !liveKey, virtualPayEnvIsSandbox: sandboxEnv, liveKeyPresent: liveKey });

const ok =
  evidence.steps.find((row) => row.name === "cli_unauth_execute")?.ok === true &&
  evidence.steps.find((row) => row.name === "cli_unauth_request")?.ok === true &&
  seedPresent === seedCategoryIds().length &&
  ready.enableOverrun !== true &&
  sandboxEnv === true &&
  liveKey !== true;

const summary = redactMw22({
  ok,
  unauthExecute: errorCode(unauthExecute.payload),
  unauthRequest: errorCode(unauthRequest.payload),
  collections,
  seedPresent,
  sandboxEnv,
  liveKeyPresent: liveKey,
  enableOverrun: ready.enableOverrun
});
writeJson(join(tmp, "mw22-verify-evidence.json"), { ...evidence, finishedAt: new Date().toISOString(), summary });
console.log(JSON.stringify(summary, null, 2));
if (!ok) process.exit(1);
