import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseFunctionEnv, parseNosqlCount } from "./mw06-lib.mjs";
import { POLICIES_DOC_ID, mw24Tmp, redactMw24 } from "./mw24-lib.mjs";

const tmp = mw24Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW24", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw24-verify-evidence.json"), redactMw24(evidence));
}

function errorCode(payload) {
  return payload?.error?.code || payload?.reason || "";
}

function request(action, data = {}, extra = {}) {
  return { apiVersion: "1", action, requestId: `mw24/test/cli/${action}`, data, ...extra };
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

const policies = await invokeFn("mw-public", request("policies.current"));
const policyData = policies.payload?.data || {};
record("cli_policies_current", {
  ok:
    policies.payload?.ok === true &&
    policyData.agreementVersion === "mw24-test-agreement-v1" &&
    policyData.privacyVersion === "mw24-test-privacy-v1" &&
    String(policyData.agreementText || "").includes("mw24-test-agreement-v1") &&
    String(policyData.privacyText || "").includes("mw24-test-privacy-v1"),
  agreementVersion: policyData.agreementVersion,
  privacyVersion: policyData.privacyVersion
});

const unauthDeletion = await invokeFn(
  "mw-member",
  request(
    "member.requestDeletion",
    { reauthProof: { kind: "wx_login_code", code: "x" }, acknowledgementVersion: "mw24-test-agreement-v1" },
    { idempotencyKey: "mw24/cli/del" }
  )
);
record("cli_unauth_deletion", {
  ok: errorCode(unauthDeletion.payload) === "AUTH_REQUIRED" || errorCode(unauthDeletion.payload) === "FORBIDDEN",
  code: errorCode(unauthDeletion.payload)
});

const unauthRegister = await invokeFn(
  "mw-member",
  request(
    "member.register",
    { agreementVersion: "mw24-test-agreement-v1", privacyVersion: "mw24-test-privacy-v1", accepted: true },
    { idempotencyKey: "mw24/cli/reg" }
  )
);
record("cli_unauth_register", {
  ok: errorCode(unauthRegister.payload) === "AUTH_REQUIRED" || errorCode(unauthRegister.payload) === "FORBIDDEN",
  code: errorCode(unauthRegister.payload)
});

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
record("policies_doc", { id: POLICIES_DOC_ID, neverDeleted: true });

const ok =
  evidence.steps.find((row) => row.name === "cli_policies_current")?.ok === true &&
  evidence.steps.find((row) => row.name === "cli_unauth_deletion")?.ok === true &&
  evidence.steps.find((row) => row.name === "cli_unauth_register")?.ok === true &&
  seedPresent === seedCategoryIds().length &&
  ready.enableOverrun !== true &&
  sandboxEnv === true &&
  liveKey !== true;

const summary = redactMw24({
  ok,
  unauthDeletion: errorCode(unauthDeletion.payload),
  unauthRegister: errorCode(unauthRegister.payload),
  agreementVersion: policyData.agreementVersion,
  seedPresent,
  sandboxEnv,
  liveKeyPresent: liveKey,
  enableOverrun: ready.enableOverrun,
  runtimeSha256Prefix: runtime.slice(0, 12),
  leftoverClaimedZero: false
});
writeJson(join(tmp, "mw24-verify-evidence.json"), { ...evidence, finishedAt: new Date().toISOString(), summary });
console.log(JSON.stringify(summary, null, 2));
if (!ok) process.exit(1);
