import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseFunctionEnv, parseNosqlCount } from "./mw06-lib.mjs";
import { mw25Tmp, redactMw25 } from "./mw25-lib.mjs";

const tmp = mw25Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW25", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw25-verify-evidence.json"), redactMw25(evidence));
}

function errorCode(payload) {
  return payload?.error?.code || payload?.reason || "";
}

function errorReason(payload) {
  return payload?.error?.details?.reason || "";
}

function request(action, data = {}, extra = {}) {
  return { apiVersion: "1", action, requestId: `mw25/test/cli/${action}`, data, ...extra };
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

const unauthStats = await invokeFn("mw-admin", request("ops.stats"));
record("cli_unauth_ops_stats", {
  ok: errorCode(unauthStats.payload) === "AUTH_REQUIRED" || errorCode(unauthStats.payload) === "FORBIDDEN",
  code: errorCode(unauthStats.payload)
});

const unauthTutorial = await invokeFn("mw-admin", request("ops.tutorial"));
record("cli_unauth_ops_tutorial", {
  ok: errorCode(unauthTutorial.payload) === "AUTH_REQUIRED" || errorCode(unauthTutorial.payload) === "FORBIDDEN",
  code: errorCode(unauthTutorial.payload)
});

const unauthRefund = await invokeFn(
  "mw-admin",
  request("refund.execute", { orderId: "x", amountFen: 1, reason: "no" }, { idempotencyKey: "mw25/cli/refund" })
);
record("cli_unauth_refund_execute", {
  ok: errorCode(unauthRefund.payload) === "AUTH_REQUIRED" || errorCode(unauthRefund.payload) === "FORBIDDEN",
  code: errorCode(unauthRefund.payload),
  reason: errorReason(unauthRefund.payload)
});

const unauthCorrection = await invokeFn(
  "mw-admin",
  request("correction.preview", { paperId: "p", fromVersionId: "a", toVersionId: "b" }, { idempotencyKey: "mw25/cli/corr" })
);
record("cli_unauth_correction", {
  ok: errorCode(unauthCorrection.payload) === "AUTH_REQUIRED" || errorCode(unauthCorrection.payload) === "FORBIDDEN",
  code: errorCode(unauthCorrection.payload),
  reason: errorReason(unauthCorrection.payload)
});

const unauthOrder = await invokeFn("mw-admin", request("order.list", {}));
record("cli_unauth_order_list", {
  ok: errorCode(unauthOrder.payload) === "AUTH_REQUIRED" || errorCode(unauthOrder.payload) === "FORBIDDEN",
  code: errorCode(unauthOrder.payload)
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

const ok =
  evidence.steps.find((row) => row.name === "cli_unauth_ops_stats")?.ok === true &&
  evidence.steps.find((row) => row.name === "cli_unauth_ops_tutorial")?.ok === true &&
  evidence.steps.find((row) => row.name === "cli_unauth_refund_execute")?.ok === true &&
  evidence.steps.find((row) => row.name === "cli_unauth_correction")?.ok === true &&
  evidence.steps.find((row) => row.name === "cli_unauth_order_list")?.ok === true &&
  seedPresent === seedCategoryIds().length &&
  ready.enableOverrun !== true &&
  sandboxEnv === true &&
  liveKey !== true;

const summary = redactMw25({
  ok,
  unauthStats: errorCode(unauthStats.payload),
  unauthTutorial: errorCode(unauthTutorial.payload),
  unauthRefund: errorCode(unauthRefund.payload),
  unauthCorrection: errorCode(unauthCorrection.payload),
  unauthOrder: errorCode(unauthOrder.payload),
  seedPresent,
  sandboxEnv,
  liveKeyPresent: liveKey,
  enableOverrun: ready.enableOverrun,
  runtimeSha256Prefix: runtime.slice(0, 12),
  leftoverClaimedZero: false,
  note: "content 看不到收款明细、operations 不能退款/改分由本地角色单测覆盖。执行者未冒充 super。E 未闭合不得 leftover=0。"
});
writeJson(join(tmp, "mw25-verify-evidence.json"), { ...evidence, finishedAt: new Date().toISOString(), summary });
console.log(JSON.stringify(summary, null, 2));
if (!ok) process.exit(1);
