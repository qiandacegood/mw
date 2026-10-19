import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { inspectOfficialJobsTokenPresence, parseFunctionEnv, parseNosqlCount } from "./mw06-lib.mjs";
import { MW05_OFFICIAL_FUNCTIONS } from "./mw05-lib.mjs";
import { mw27Tmp, redactMw27 } from "./mw27-lib.mjs";

const tmp = mw27Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW27-D", steps: [], matrix: {} };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw27-verify-evidence.json"), redactMw27(evidence));
}

function request(action, data = {}, extra = {}) {
  return { apiVersion: "1", action, requestId: `mw27/test/cli/${action}`, data, ...extra };
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

const unauthOrder = await invokeFn("mw-member", request("order.get", { orderId: "x" }));
const unauthResume = await invokeFn("mw-admin", request("job.resume", { jobId: "x" }, { idempotencyKey: "mw27/cli/resume" }));
const unauthRebuild = await invokeFn("mw-admin", request("ranking.rebuild", { reason: "mw27" }, { idempotencyKey: "mw27/cli/rebuild" }));
const forged = await invokeFn("mw-member", request("order.get", { openid: "forged", FROM_OPENID: "forged", role: "super" }));
const fakePay = await invokeFn("mw-pay-hook", { action: "notify", nonce: "mw27-verify", timestamp: "1", signature: "00" });
const unsignedJobs = await invokeFn("mw-jobs", { action: "jobs.tick", fromClient: true });

record("negatives", {
  unauthOrder: unauthOrder.payload?.error?.code,
  unauthResume: unauthResume.payload?.error?.code,
  unauthRebuild: unauthRebuild.payload?.error?.code,
  forged: forged.payload?.error?.details?.reason || forged.payload?.error?.code,
  forgedNotifyVipGranted: fakePay.payload?.vipGranted,
  unsignedJobs: unsignedJobs.payload?.reason || unsignedJobs.payload?.error?.code
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

const tokenPresence = {};
for (const name of MW05_OFFICIAL_FUNCTIONS) {
  const detail = await runTcb(["fn", "detail", name, "--json"]);
  const env = parseFunctionEnv(detail.json) || {};
  tokenPresence[name] = Object.prototype.hasOwnProperty.call(env, "MW_JOBS_INVOKE_TOKEN");
}
const tokenInspect = inspectOfficialJobsTokenPresence(tokenPresence);
const payHook = await runTcb(["fn", "detail", "mw-pay-hook", "--json"]);
const payEnv = parseFunctionEnv(payHook.json) || {};
const sandboxEnv = String(payEnv.VIRTUAL_PAY_ENV || "") === "1";
const liveKey = Object.prototype.hasOwnProperty.call(payEnv, "VIRTUAL_PAY_APP_KEY_LIVE");
const runtime = shaOf(join(projectRoot(), "cloudfunctions", "_official", "runtime.cjs"));
record("runtime_sha256", { prefix: runtime.slice(0, 12) });

const denied =
  ["AUTH_REQUIRED", "FORBIDDEN"].includes(unauthOrder.payload?.error?.code) &&
  ["AUTH_REQUIRED", "FORBIDDEN"].includes(unauthResume.payload?.error?.code) &&
  ["AUTH_REQUIRED", "FORBIDDEN"].includes(unauthRebuild.payload?.error?.code);

const ok =
  ready.enableOverrun !== true &&
  sandboxEnv === true &&
  liveKey !== true &&
  seedPresent === seedCategoryIds().length &&
  fakePay.payload?.vipGranted === false &&
  denied;

const summary = redactMw27({
  ok,
  leftoverClaimedZero: false,
  enableOverrun: ready.enableOverrun,
  sandboxEnv,
  liveKeyPresent: liveKey,
  seedPresent,
  otherEnvCount: ready.otherEnvCount,
  runtimeSha256Prefix: runtime.slice(0, 12),
  jobsTokenTargets: tokenInspect.tokenTargets,
  negatives: {
    orderGet: unauthOrder.payload?.error?.code,
    jobResume: unauthResume.payload?.error?.code,
    rankingRebuild: unauthRebuild.payload?.error?.code,
    forgedIdentity: forged.payload?.error?.details?.reason || forged.payload?.error?.code,
    forgedNotifyVipGranted: fakePay.payload?.vipGranted,
    unsignedJobs: unsignedJobs.payload?.reason || unsignedJobs.payload?.error?.code
  },
  note: "E 未闭合不得 leftover=0。模拟不得写成平台验收通过。未标 A27 / T07 / T28。"
});
writeJson(join(tmp, "mw27-verify-evidence.json"), { ...evidence, finishedAt: new Date().toISOString(), summary });
console.log(JSON.stringify(summary, null, 2));
process.exit(ok ? 0 : 1);
