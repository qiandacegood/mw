import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, runTcb, writeJson } from "./mw04-lib.mjs";
import { listIndexCommand, parseNosqlCount } from "./mw06-lib.mjs";
import {
  FORBIDDEN_FUTURE_COLLECTIONS,
  INITIAL_ROOT_SEEDS,
  MW17_COLLECTIONS,
  MW17_INDEXES,
  MW17_RUNTIME_DOC,
  mw17Tmp,
  redactMw17
} from "./mw17-lib.mjs";

const tmp = mw17Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW17", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw17-verify-evidence.json"), redactMw17(evidence));
}

function errorCode(payload) {
  return payload?.error?.code || payload?.reason || "";
}

function errorReason(payload) {
  return payload?.error?.details?.reason || payload?.reason || "";
}

function request(action, data = {}, extra = {}) {
  return { apiVersion: "1", action, requestId: `mw17/test/cli/${action}`, data, ...extra };
}

const ready = await assertMwTestReady();
record("hard_check", {
  ok: ready.ok,
  enableOverrun: ready.enableOverrun,
  otherEnvCount: ready.otherEnvCount,
  envTouched: "mw-test-only"
});
authorizedEnvId();

const { seedCategoryId } = await import("../packages/shared/dist/category.js");

// 公开只读：游客可读前百，无费用筛选控件，公开行不含成员标识。
const publicList = await invokeFn("mw-public", request("ranking.list", { scope: "total" }));
const publicRows = Array.isArray(publicList.payload?.data?.rows) ? publicList.payload.data.rows : [];
record("cli_public_ranking_list", {
  ok: publicList.payload?.ok === true,
  code: errorCode(publicList.payload),
  rowCount: publicRows.length,
  topLimit: publicList.payload?.data?.topLimit,
  feeFilterSupported: publicList.payload?.data?.feeFilter?.supported,
  refreshStatus: publicList.payload?.data?.refresh?.status,
  rowsExposeMemberId: publicRows.some((row) => Object.prototype.hasOwnProperty.call(row || {}, "memberId"))
});
record("cli_public_ranking_list_no_member_id", {
  ok: publicRows.every((row) => !Object.prototype.hasOwnProperty.call(row || {}, "memberId")),
  note: "公开行只给 rankKey(哈希)，不给 memberId / openId"
});

// 费用筛选：传入即 INVALID_ARGUMENT（免费与 VIP 统一计入）。
for (const key of ["access", "freeOnly", "vipOnly", "accessFilter"]) {
  const rejected = await invokeFn("mw-public", request("ranking.list", { scope: "total", [key]: true }));
  record(`cli_public_rejects_fee_filter_${key}`, {
    ok: errorCode(rejected.payload) === "INVALID_ARGUMENT",
    code: errorCode(rejected.payload)
  });
}

const badScope = await invokeFn("mw-public", request("ranking.list", { scope: "season" }));
record("cli_public_rejects_unknown_scope", {
  ok: errorCode(badScope.payload) === "INVALID_ARGUMENT",
  code: errorCode(badScope.payload)
});

const missingCategory = await invokeFn("mw-public", request("ranking.list", { scope: "category" }));
record("cli_public_rejects_category_without_id", {
  ok: errorCode(missingCategory.payload) === "INVALID_ARGUMENT",
  code: errorCode(missingCategory.payload)
});

const unknownCategory = await invokeFn(
  "mw-public",
  request("ranking.list", { scope: "category", categoryId: "cat_mw17_cli_unknown" })
);
record("cli_public_rejects_unknown_category", {
  ok: errorCode(unknownCategory.payload) === "CATEGORY_UNAVAILABLE",
  code: errorCode(unknownCategory.payload),
  reason: errorReason(unknownCategory.payload)
});

// 本人名次需要已注册会员；伪造身份字段直接拒绝。
const unauthMe = await invokeFn("mw-member", request("ranking.me", { scope: "total" }));
record("cli_unauth_ranking_me", {
  ok: errorCode(unauthMe.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthMe.payload),
  reason: errorReason(unauthMe.payload)
});

const forgedMe = await invokeFn("mw-member", request("ranking.me", { scope: "total", memberId: "forged", role: "super" }));
record("cli_forged_ranking_me", {
  ok: errorCode(forgedMe.payload) === "FORBIDDEN" && errorReason(forgedMe.payload) === "CLIENT_IDENTITY_IGNORED",
  code: errorCode(forgedMe.payload),
  reason: errorReason(forgedMe.payload)
});

// 入口隔离：公开入口不得调用会员 / 后台动作；会员入口不得调用公开动作。
const publicMe = await invokeFn("mw-public", request("ranking.me", { scope: "total" }));
record("cli_public_rejects_ranking_me", {
  ok: errorCode(publicMe.payload) === "FORBIDDEN",
  code: errorCode(publicMe.payload),
  reason: errorReason(publicMe.payload)
});

const publicSetRanking = await invokeFn("mw-public", request("member.setRanking", { enabled: true, expectedRevision: 1 }));
record("cli_public_rejects_set_ranking", {
  ok: errorCode(publicSetRanking.payload) === "FORBIDDEN",
  code: errorCode(publicSetRanking.payload)
});

const memberList = await invokeFn("mw-member", request("ranking.list", { scope: "total" }));
record("cli_member_rejects_ranking_list", {
  ok: errorCode(memberList.payload) === "FORBIDDEN",
  code: errorCode(memberList.payload),
  reason: errorReason(memberList.payload)
});

// 后台榜单治理：状态只读、重建需 super，未登录一律 AUTH_REQUIRED。
const unauthStatus = await invokeFn("mw-admin", request("ranking.status"));
record("cli_unauth_admin_ranking_status", {
  ok: errorCode(unauthStatus.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthStatus.payload),
  reason: errorReason(unauthStatus.payload)
});

const unauthRebuild = await invokeFn(
  "mw-admin",
  request(
    "ranking.rebuild",
    { reason: "mw17 cli negative check" },
    { idempotencyKey: "mw17/test/cli/rebuild" }
  )
);
record("cli_unauth_admin_ranking_rebuild", {
  ok: errorCode(unauthRebuild.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthRebuild.payload),
  reason: errorReason(unauthRebuild.payload)
});

const publicStatus = await invokeFn("mw-public", request("ranking.status"));
record("cli_public_rejects_ranking_status", {
  ok: errorCode(publicStatus.payload) === "FORBIDDEN",
  code: errorCode(publicStatus.payload)
});

const memberRebuild = await invokeFn(
  "mw-member",
  request("ranking.rebuild", { reason: "x" }, { idempotencyKey: "mw17/test/cli/member-rebuild" })
);
record("cli_member_rejects_ranking_rebuild", {
  ok: errorCode(memberRebuild.payload) === "FORBIDDEN",
  code: errorCode(memberRebuild.payload)
});

// 负向核验不得改变任何状态：读一次运行时文档计数即可（部署不预置，重建前应为 0）。
const runtimeCounted = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([
    {
      TableName: MW17_RUNTIME_DOC.collection,
      CommandType: "COMMAND",
      Command: JSON.stringify({ count: MW17_RUNTIME_DOC.collection, query: { _id: MW17_RUNTIME_DOC.id } })
    }
  ]),
  "--json"
]);
record("ranking_runtime_doc_count", {
  code: runtimeCounted.code,
  count: parseNosqlCount(runtimeCounted),
  note: "以上负向调用不得写入榜单状态；计数应与部署或上一次手点后的真实值一致"
});

let seedCount = 0;
for (const seed of INITIAL_ROOT_SEEDS) {
  const counted = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: "categories",
        CommandType: "COMMAND",
        Command: JSON.stringify({ count: "categories", query: { _id: seedCategoryId(seed.seedKey) } })
      }
    ]),
    "--json"
  ]);
  if (parseNosqlCount(counted) === 1) seedCount += 1;
}

const listed = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([{ TableName: MW17_COLLECTIONS[0], CommandType: "COMMAND", Command: JSON.stringify({ listCollections: 1 }) }]),
  "--json"
]);
const listedText = JSON.stringify(listed.json || {});
const collectionsPresent = MW17_COLLECTIONS.every((name) => listedText.includes(name));
const futurePresent = FORBIDDEN_FUTURE_COLLECTIONS.some((name) => listedText.includes(`"${name}"`));

let indexesOk = true;
for (const index of MW17_INDEXES) {
  const indexList = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([listIndexCommand(index.collection)]),
    "--json"
  ]);
  const ok = indexList.code === 0 && JSON.stringify(indexList.json || {}).includes(index.name);
  record(`index_${index.name}`, { ok });
  if (!ok) indexesOk = false;
}

let clientDenied = false;
try {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({ env: authorizedEnvId(), region: "ap-shanghai" });
  const results = [];
  for (const name of ["ranking_heads", "ranking_rows", "score_metrics", "member_stats"]) {
    try {
      await app.database().collection(name).add({ marker: "MW17" });
      results.push(false);
    } catch {
      results.push(true);
    }
  }
  clientDenied = results.every(Boolean);
} catch {
  clientDenied = false;
}
record("client_direct_write", { ok: clientDenied });

record("collections", { present: collectionsPresent, futurePresent, seedCount, indexesOk });

const cliOk = evidence.steps.filter((step) => step.name.startsWith("cli_") && step.ok === false).length === 0;
const ok = cliOk && collectionsPresent && !futurePresent && seedCount === 10 && indexesOk && clientDenied;

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw17-verify-evidence.json"), redactMw17(evidence));
console.log(
  JSON.stringify(
    redactMw17({
      ok,
      cliOk,
      collectionsPresent,
      futurePresent,
      seedCount,
      indexesOk,
      clientDenied,
      enableOverrun: ready.enableOverrun
    }),
    null,
    2
  )
);
process.exit(ok ? 0 : 1);
