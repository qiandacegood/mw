import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, publicObjectUrls, runTcb, writeJson } from "./mw04-lib.mjs";
import { inspectOfficialJobsTokenPresence, parseFunctionEnv, parseNosqlCount } from "./mw06-lib.mjs";
import { MW05_OFFICIAL_FUNCTIONS } from "./mw05-lib.mjs";
import { MW26_SECURITY_IDS, mw26Tmp, redactMw26 } from "./mw26-lib.mjs";

const tmp = mw26Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW26", steps: [], matrix: {} };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw26-verify-evidence.json"), redactMw26(evidence));
}

function matrix(id, result, note) {
  evidence.matrix[id] = { id, result, note };
  record(`matrix_${id}`, { result, note });
}

function errorCode(payload) {
  return payload?.error?.code || payload?.reason || payload?.ErrCode || "";
}

function errorReason(payload) {
  return payload?.error?.details?.reason || payload?.reason || "";
}

function request(action, data = {}, extra = {}) {
  return { apiVersion: "1", action, requestId: `mw26/test/cli/${action}`, data, ...extra };
}

function shaOf(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function deniedAuth(payload) {
  const code = errorCode(payload);
  return code === "AUTH_REQUIRED" || code === "FORBIDDEN" || errorReason(payload) === "CLIENT_IDENTITY_IGNORED";
}

const ready = await assertMwTestReady();
record("hard_check", {
  ok: ready.ok,
  enableOverrun: ready.enableOverrun,
  otherEnvCount: ready.otherEnvCount,
  region: ready.region,
  envTouched: "mw-test-only"
});
authorizedEnvId();

const { seedCategoryIds } = await import("../packages/shared/dist/category.js");
const { mw26LoggedInRoleRow, mw26UnauthStorageVerdict } = await import("../packages/shared/dist/mw26-capacity.js");

const unauthUnknown = await invokeFn("mw-public", request("refund.execute", { orderId: "x" }));
record("cli_unknown_public_refund", { code: errorCode(unauthUnknown.payload), reason: errorReason(unauthUnknown.payload) });
matrix(
  "S04",
  errorReason(unauthUnknown.payload) === "ACTION_DENIED" || errorCode(unauthUnknown.payload) === "FORBIDDEN" ? "PASS" : "FAIL",
  `public refund.execute => ${errorCode(unauthUnknown.payload)}/${errorReason(unauthUnknown.payload)}`
);

const forged = await invokeFn(
  "mw-member",
  request("attempt.submit", { openid: "forged", FROM_OPENID: "forged", role: "super", score: 100 })
);
record("cli_forged_from", { code: errorCode(forged.payload), reason: errorReason(forged.payload), forgedFields: forged.payload?.error?.details?.forgedFields });
matrix(
  "S05",
  errorReason(forged.payload) === "CLIENT_IDENTITY_IGNORED" || deniedAuth(forged.payload) ? "PASS" : "FAIL",
  `forged identity => ${errorCode(forged.payload)}/${errorReason(forged.payload)}`
);

const unauthOrder = await invokeFn("mw-admin", request("order.list", {}));
const unauthRefund = await invokeFn(
  "mw-admin",
  request("refund.execute", { orderId: "x", amountFen: 1, reason: "no" }, { idempotencyKey: "mw26/cli/refund" })
);
const unauthCorrection = await invokeFn(
  "mw-admin",
  request("correction.preview", { paperId: "p", fromVersionId: "a", toVersionId: "b" }, { idempotencyKey: "mw26/cli/corr" })
);
const s06 = mw26LoggedInRoleRow("S06", deniedAuth(unauthOrder.payload), `unauth order.list=${errorCode(unauthOrder.payload)}`);
matrix(s06.id, s06.result, s06.note);
const s07 = mw26LoggedInRoleRow(
  "S07",
  deniedAuth(unauthRefund.payload) && deniedAuth(unauthCorrection.payload),
  `unauth refund=${errorCode(unauthRefund.payload)} correction=${errorCode(unauthCorrection.payload)}`
);
matrix(s07.id, s07.result, s07.note);

const noTicket = await invokeFn("mw-upload", { action: "upload", byteLength: 100 });
matrix(
  "S08",
  errorReason(noTicket.payload) === "TICKET_REQUIRED" || errorCode(noTicket.payload) === "FORBIDDEN" ? "PASS" : "FAIL",
  `no ticket => ${errorCode(noTicket.payload)}/${errorReason(noTicket.payload)}`
);
const oversize = await invokeFn("mw-upload", { action: "upload", uploadTicket: "ticket_fict", byteLength: 5347737 });
matrix(
  "S09",
  errorReason(oversize.payload) === "PAYLOAD_TOO_LARGE" || errorCode(oversize.payload) === "INVALID_ARGUMENT" || errorCode(oversize.payload) === "FORBIDDEN"
    ? "PASS"
    : "FAIL",
  `oversize => ${errorCode(oversize.payload)}/${errorReason(oversize.payload)}`
);

const csvInject = await invokeFn("mw-admin", request("import.validate", { csv: "=cmd|' /C calc'!A1,nickname\n=1+1" }));
matrix("S10", deniedAuth(csvInject.payload) ? "PASS" : "FAIL", `import.validate unauth => ${errorCode(csvInject.payload)}`);

const nickInject = await invokeFn("mw-member", request("member.updateProfile", { nickname: { $gt: "" } }));
matrix("S11", deniedAuth(nickInject.payload) ? "PASS" : "FAIL", `nickname inject unauth => ${errorCode(nickInject.payload)}`);

const fakePay = await invokeFn("mw-pay-hook", { action: "notify", nonce: "mw26-forged", timestamp: "1", signature: "00" });
const payDenied =
  fakePay.payload?.vipGranted === false ||
  /SIGN|signature|FORBIDDEN|INVALID/i.test(`${errorCode(fakePay.payload)} ${errorReason(fakePay.payload)} ${JSON.stringify(fakePay.payload || {})}`);
matrix("S13", payDenied ? "PASS" : "FAIL", `forged notify vipGranted=${fakePay.payload?.vipGranted} reason=${errorReason(fakePay.payload)}`);

const unsignedJobs = await invokeFn("mw-jobs", { action: "jobs.tick", fromClient: true });
matrix(
  "S14",
  unsignedJobs.payload?.ok === false || /DENIED|NO_TRUSTED/i.test(errorReason(unsignedJobs.payload)) ? "PASS" : "FAIL",
  `unsigned jobs => ${errorReason(unsignedJobs.payload) || errorCode(unsignedJobs.payload)}`
);

const idemUnauth = await invokeFn(
  "mw-admin",
  request("ranking.rebuild", { reason: "mw26" }, { idempotencyKey: "mw26/cli/rebuild" })
);
matrix("S15", deniedAuth(idemUnauth.payload) ? "PASS" : "FAIL", `unauth ranking.rebuild => ${errorCode(idemUnauth.payload)}`);

const tokenPresence = {};
for (const name of MW05_OFFICIAL_FUNCTIONS) {
  const detail = await runTcb(["fn", "detail", name, "--json"]);
  const env = parseFunctionEnv(detail.json) || {};
  tokenPresence[name] = Object.prototype.hasOwnProperty.call(env, "MW_JOBS_INVOKE_TOKEN");
}
const tokenInspect = inspectOfficialJobsTokenPresence(tokenPresence);
record("jobs_token_presence", { tokenPresent: tokenInspect.tokenPresent, tokenTargets: tokenInspect.tokenTargets });

const payHook = await runTcb(["fn", "detail", "mw-pay-hook", "--json"]);
const payEnv = parseFunctionEnv(payHook.json) || {};
const sandboxEnv = String(payEnv.VIRTUAL_PAY_ENV || "") === "1";
const liveKey = Object.prototype.hasOwnProperty.call(payEnv, "VIRTUAL_PAY_APP_KEY_LIVE");
matrix(
  "S16",
  ready.enableOverrun !== true && sandboxEnv && !liveKey && ready.otherEnvCount >= 0 ? "PASS" : "FAIL",
  `overrun=${ready.enableOverrun} sandbox=${sandboxEnv} liveKey=${liveKey} otherEnv=${ready.otherEnvCount}`
);

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
record("seed_categories", { seedPresent, expected: seedCategoryIds().length });

let clientDenied = false;
let queryInjectDenied = false;
try {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({ env: authorizedEnvId(), region: "ap-shanghai" });
  const denied = [];
  for (const name of ["paper_answers", "attempts", "score_metrics", "paper_bests", "members"]) {
    try {
      await app.database().collection(name).limit(1).get();
      denied.push({ name, denied: false, op: "get" });
    } catch {
      denied.push({ name, denied: true, op: "get" });
    }
    try {
      await app.database().collection(name).add({ marker: "MW26", score: 100 });
      denied.push({ name, denied: false, op: "add" });
    } catch {
      denied.push({ name, denied: true, op: "add" });
    }
  }
  clientDenied = denied.every((row) => row.denied === true);
  record("client_direct_db", { ok: clientDenied, rows: denied.length });
  try {
    await app.database().collection("paper_answers").where({ $where: "true" }).get();
    queryInjectDenied = false;
  } catch {
    queryInjectDenied = true;
  }
} catch (error) {
  clientDenied = false;
  queryInjectDenied = false;
  record("client_direct_db", { attempted: false, error: String(error && error.message) });
}
matrix("S01", clientDenied ? "PASS" : "FAIL", "unauth JS SDK get/add paper_answers and related");
matrix("S02", clientDenied ? "PASS" : "FAIL", "unauth JS SDK cannot add score docs");
matrix("S12", queryInjectDenied || clientDenied ? "PASS" : "FAIL", `query inject denied=${queryInjectDenied}`);

let storageUrlCount = 0;
let storageSaw200 = false;
let storageDeniedCount = 0;
let storageRequestFailed = false;
try {
  const urls = publicObjectUrls(ready.storageHosts, "mw-test/media/analysis/unauthorized-mw26");
  storageUrlCount = urls.length;
  for (const url of urls) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status === 200) storageSaw200 = true;
      else storageDeniedCount += 1;
    } catch {
      storageRequestFailed = true;
    }
  }
} catch {
  storageRequestFailed = true;
}
const s03 = mw26UnauthStorageVerdict({
  urlCount: storageUrlCount,
  saw200: storageSaw200,
  deniedCount: storageDeniedCount,
  requestFailed: storageRequestFailed
});
matrix("S03", s03.result, s03.note);

const rankingList = await invokeFn("mw-public", request("ranking.list", { scope: "total" }));
const rankingText = JSON.stringify(rankingList.payload || {});
const rankingRedacted = !/openid|OPENID|AppKey|FROM_OPENID/i.test(rankingText);
matrix("S17", rankingRedacted ? "PASS" : "FAIL", "ranking.list payload has no OPENID/AppKey; audit sanitizer covered by unit tests");

if (tokenInspect.tokenPresent !== true || tokenInspect.tokenTargets.some((name) => name !== "mw-jobs")) {
  evidence.matrix.S14 = {
    id: "S14",
    result: "FAIL",
    note: `jobs token present=${tokenInspect.tokenPresent} targets=${(tokenInspect.tokenTargets || []).join(",")}`
  };
}

const runtime = shaOf(join(projectRoot(), "cloudfunctions", "_official", "runtime.cjs"));
record("runtime_sha256", { prefix: runtime.slice(0, 12) });

const missing = MW26_SECURITY_IDS.filter((id) => !evidence.matrix[id]);
for (const id of missing) matrix(id, "NOT_RUN", "not recorded");

const failRows = Object.values(evidence.matrix).filter((row) => row.result === "FAIL");
const ok =
  ready.enableOverrun !== true &&
  sandboxEnv === true &&
  liveKey !== true &&
  seedPresent === seedCategoryIds().length &&
  failRows.length === 0;

const summary = redactMw26({
  ok,
  leftoverClaimedZero: false,
  enableOverrun: ready.enableOverrun,
  sandboxEnv,
  liveKeyPresent: liveKey,
  seedPresent,
  runtimeSha256Prefix: runtime.slice(0, 12),
  matrix: evidence.matrix,
  failCount: failRows.length,
  note: "E 未闭合不得 leftover=0。S03 无 URL/请求失败不得 PASS。S06/S07 已登录 NOT_RUN（E），未登录负向不得写成整行产品 PASS。模拟不得写成平台验收通过。"
});
writeJson(join(tmp, "mw26-verify-evidence.json"), { ...evidence, finishedAt: new Date().toISOString(), summary });
console.log(JSON.stringify(summary, null, 2));
process.exit(ok ? 0 : 1);
