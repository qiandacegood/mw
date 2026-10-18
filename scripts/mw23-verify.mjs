import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseFunctionEnv, parseNosqlCount } from "./mw06-lib.mjs";
import { MW23_COLLECTIONS, mw23Tmp, redactMw23 } from "./mw23-lib.mjs";

const tmp = mw23Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW23", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw23-verify-evidence.json"), redactMw23(evidence));
}

function errorCode(payload) {
  return payload?.error?.code || payload?.reason || "";
}

function request(action, data = {}, extra = {}) {
  return { apiVersion: "1", action, requestId: `mw23/test/cli/${action}`, data, ...extra };
}

function shaOf(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
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

const unauthDisable = await invokeFn(
  "mw-admin",
  request("member.disable", { targetMemberId: "x", disabled: true, reason: "cli" }, { idempotencyKey: "mw23/cli/disable" })
);
record("cli_unauth_disable", {
  ok: errorCode(unauthDisable.payload) === "AUTH_REQUIRED" || errorCode(unauthDisable.payload) === "FORBIDDEN",
  code: errorCode(unauthDisable.payload)
});

const unauthFeedback = await invokeFn(
  "mw-member",
  request("feedback.create", { type: "question_error", paperId: "p", questionId: "q", versionId: "v", text: "cli" }, {
    idempotencyKey: "mw23/cli/feedback"
  })
);
record("cli_unauth_feedback", {
  ok:
    errorCode(unauthFeedback.payload) === "AUTH_REQUIRED" ||
    errorCode(unauthFeedback.payload) === "MEMBER_REQUIRED" ||
    errorCode(unauthFeedback.payload) === "FORBIDDEN",
  code: errorCode(unauthFeedback.payload)
});

const collections = {};
for (const name of MW23_COLLECTIONS) {
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

const runtime = shaOf(join(projectRoot(), "cloudfunctions", "_official", "runtime.cjs"));
record("runtime_sha256", { prefix: runtime.slice(0, 12) });

const ok =
  evidence.steps.find((row) => row.name === "cli_unauth_disable")?.ok === true &&
  evidence.steps.find((row) => row.name === "cli_unauth_feedback")?.ok === true &&
  seedPresent === seedCategoryIds().length &&
  ready.enableOverrun !== true &&
  sandboxEnv === true &&
  liveKey !== true;

const summary = redactMw23({
  ok,
  unauthDisable: errorCode(unauthDisable.payload),
  unauthFeedback: errorCode(unauthFeedback.payload),
  collections,
  seedPresent,
  sandboxEnv,
  liveKeyPresent: liveKey,
  enableOverrun: ready.enableOverrun,
  runtimeSha256Prefix: runtime.slice(0, 12)
});
writeJson(join(tmp, "mw23-verify-evidence.json"), { ...evidence, finishedAt: new Date().toISOString(), summary });
console.log(JSON.stringify(summary, null, 2));
if (!ok) process.exit(1);
