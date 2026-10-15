import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./mw04-lib.mjs";
import {
  emptyMw17KnownIds,
  knownIdCountOf,
  mw17IndependentDecision,
  mw17LeftoverDecision,
  mw17VerifyDecision,
  parseLeftoverHashes,
  sweepTotal
} from "./mw17-lib.mjs";

assert.equal(parseLeftoverHashes({}).reason, "EMPTY_HASHES");
assert.equal(parseLeftoverHashes({ papers: ["paper_raw_id"] }).reason, "HASH_NOT_SHA256");
assert.equal(parseLeftoverHashes({ members: ["MemberRawId"] }).reason, "HASH_NOT_SHA256");
const okHashes = parseLeftoverHashes({
  papers: ["A".repeat(64)],
  attempts: ["b".repeat(64)],
  members: ["c".repeat(64)]
});
assert.equal(okHashes.ok, true, okHashes.reason);
assert.equal(okHashes.importedHashCount, 3);

// 后台「题库脱敏证据」的载荷只有 questions + versions（没有 papers），versions 属题目版本。
const questionOnly = parseLeftoverHashes({
  questions: ["d".repeat(64)],
  versions: ["e".repeat(64)]
});
assert.equal(questionOnly.ok, true, questionOnly.reason);
assert.equal(questionOnly.questions.length, 1);
assert.equal(questionOnly.questionVersions.length, 1);

// 后台「试卷 knownIds」同时含 papers 与 versions（试卷版本由 paperId 关系覆盖，不按 id 处理）。
const paperPayload = parseLeftoverHashes({
  papers: ["f".repeat(64)],
  versions: ["1".repeat(64)],
  questions: ["2".repeat(64)],
  questionVersions: ["3".repeat(64)]
});
assert.equal(paperPayload.ok, true, paperPayload.reason);
assert.equal(paperPayload.papers.length, 1);
assert.equal(paperPayload.questionVersions.length, 1);

const infra = {
  collectionNames: ["ranking_heads", "ranking_rows", "score_metrics"],
  collectionsConfirmed: true,
  seedPresent: true,
  seedCount: 10,
  clientDenied: true,
  enableOverrun: false,
  enableOverrunConfirmed: true,
  otherEnvChanged: false,
  futureCollectionsCreated: false,
  leftoverObjects: 0,
  leftoverObjectsConfirmed: true,
  indexConfirmed: true,
  independent: { confirmed: true, total: 0 },
  snapshotResidual: 0
};

const emptyNotClean = mw17LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: false,
  knownIdCount: 0
});
assert.equal(emptyNotClean.ok, false);
assert.ok(emptyNotClean.reasons.includes("WROTE_DOCS_FALSE"));

const pass = mw17LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 2
});
assert.equal(pass.ok, true, pass.reasons.join(","));
assert.equal(pass.independentTotal, 0);
assert.equal(pass.snapshotResidual, 0);

const missingSnapshot = mw17LeftoverDecision({ ...infra, snapshotResidual: 2 });
assert.equal(missingSnapshot.ok, false);
assert.ok(missingSnapshot.reasons.includes("SNAPSHOT_RESIDUAL_MEMBERS"));

const deployIndependentLeft = mw17LeftoverDecision({
  ...infra,
  independent: { confirmed: true, total: 3 },
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 2
});
assert.equal(deployIndependentLeft.ok, false);
assert.ok(deployIndependentLeft.reasons.includes("INDEPENDENT_SWEEP_LEFT"));

const verifyPass = mw17VerifyDecision({
  wroteDocs: true,
  cloudWriteClaimed: true,
  exactIdSweepOnly: true,
  knownIdLeftoverDocs: 0,
  independentTotal: 0,
  independentConfirmed: true,
  snapshotResidual: 0,
  snapshotConfirmed: true,
  seedPresent: true,
  forbiddenPresent: false
});
assert.equal(verifyPass.ok, true, verifyPass.reasons.join(","));
assert.equal(verifyPass.independentRequired, true);
assert.equal(verifyPass.snapshotRequired, true);

// 快照里还留着本轮测试身份 → 收口门禁必须失败（重建快照后才会回到 0）。
const verifySnapshotLeft = mw17VerifyDecision({
  wroteDocs: true,
  cloudWriteClaimed: true,
  exactIdSweepOnly: true,
  knownIdLeftoverDocs: 0,
  independentTotal: 0,
  independentConfirmed: true,
  snapshotResidual: 1,
  snapshotConfirmed: true,
  seedPresent: true,
  forbiddenPresent: false
});
assert.equal(verifySnapshotLeft.ok, false);
assert.ok(verifySnapshotLeft.reasons.includes("SNAPSHOT_RESIDUAL_MEMBERS"));

const verifySnapshotUnconfirmed = mw17VerifyDecision({
  wroteDocs: true,
  cloudWriteClaimed: true,
  exactIdSweepOnly: true,
  knownIdLeftoverDocs: 0,
  independentTotal: 0,
  independentConfirmed: true,
  snapshotResidual: -1,
  snapshotConfirmed: false,
  seedPresent: true,
  forbiddenPresent: false
});
assert.equal(verifySnapshotUnconfirmed.ok, false);
assert.ok(verifySnapshotUnconfirmed.reasons.includes("SNAPSHOT_CHECK_NOT_CONFIRMED"));

const verifyNeedsIndependent = mw17VerifyDecision({
  wroteDocs: true,
  cloudWriteClaimed: true,
  exactIdSweepOnly: true,
  knownIdLeftoverDocs: 0,
  independentTotal: 0,
  independentConfirmed: false,
  snapshotResidual: 0,
  snapshotConfirmed: true,
  seedPresent: true,
  forbiddenPresent: false
});
assert.equal(verifyNeedsIndependent.ok, false);
assert.ok(verifyNeedsIndependent.reasons.includes("INDEPENDENT_CHECK_NOT_CONFIRMED"));

const independentPass = mw17IndependentDecision({
  wroteDocs: true,
  resolved: true,
  independentTotal: 0,
  snapshotResidual: 0,
  seedPresent: true,
  forbiddenPresent: false
});
assert.equal(independentPass.ok, true, independentPass.reasons.join(","));
assert.equal(independentPass.derivedIdsUsed, false);

const independentSnapshotLeft = mw17IndependentDecision({
  wroteDocs: true,
  resolved: true,
  independentTotal: 0,
  snapshotResidual: 3,
  seedPresent: true,
  forbiddenPresent: false
});
assert.equal(independentSnapshotLeft.ok, false);
assert.ok(independentSnapshotLeft.reasons.includes("SNAPSHOT_RESIDUAL_MEMBERS"));

assert.equal(knownIdCountOf(emptyMw17KnownIds()), 0);
assert.equal(knownIdCountOf({ ...emptyMw17KnownIds(), members: ["a", "b"], grants: ["c"] }), 3);
assert.equal(sweepTotal({ attempts: 1, nested: { medals: 2 } }), 3);

const root = projectRoot();
const read = (path) => readFileSync(join(root, path), "utf8");
const official = read("services/api/src/official.ts");
const sharedRanking = read("packages/shared/src/ranking.ts");
const rankingModule = read("services/api/src/modules/ranking.ts");
const rankingStores = read("services/api/src/modules/ranking-stores.ts");
const cloudRanking = read("services/api/src/modules/cloud-ranking-stores.ts");
const cloudMain = read("services/api/src/cloud-main.ts");
const miniRanking = read("apps/miniprogram/services/ranking.ts");
const miniRankingPage = read("apps/miniprogram/pages/ranking/index.wxml");
const adminApp = read("apps/admin/src/App.vue");
const libSource = read("scripts/mw17-lib.mjs");
const sweepLib = read("scripts/mw17-sweep-lib.mjs");
const deploy = read("scripts/mw17-deploy.mjs");
const verify = read("scripts/mw17-verify.mjs");
const cleanup = read("scripts/mw17-cleanup.mjs");
const independent = read("scripts/mw17-independent-check.mjs");
const leftoverVerify = read("scripts/mw17-verify-leftovers.mjs");
const resolveScript = read("scripts/mw17-resolve-known-ids.mjs");
const tempAdmin = read("scripts/mw17-temp-admin.mjs");

// 服务端：动作、入口与权限
assert.match(official, /["']ranking\.list["']/);
assert.match(official, /["']ranking\.me["']/);
assert.match(official, /["']member\.setRanking["']/);
assert.match(official, /["']ranking\.status["']/);
assert.match(official, /["']ranking\.rebuild["']/);
assert.match(official, /SUPER_REQUIRED/);
assert.match(sharedRanking, /RANKING_FORBIDDEN_FILTERS/);
assert.doesNotMatch(sharedRanking, /accessFilter\s*:/);
assert.match(rankingModule, /RANKING_HISTORY_GAP_NOTE/);
assert.match(rankingModule, /historyGapMembers/);
assert.match(rankingModule, /markRankingDirty/);
assert.match(rankingModule, /RANKING_BUILD_SCAN_LIMIT/);
assert.doesNotMatch(rankingModule, /memberStats\.totalScore\s*=/);
assert.match(rankingStores, /ranking_heads/);
assert.match(rankingStores, /ranking_rows/);
assert.match(cloudRanking, /RANKING_RUNTIME_DOC_ID/);
assert.match(cloudRanking, /runTransaction/);
assert.match(cloudMain, /cloudRankingStore/);

// 云库写入：`_id` 只能由 doc(id) 决定，载荷里再带 `_id` 会被 CloudBase 拒绝。
// MW17 手点首次暴露：ranking_rows 行写失败 → 每次重建都 RANKING_ROWS_WRITE_FAILED。
assert.match(cloudRanking, /doc\(row\.rowId\)\.set\(\{ \.\.\.row \}\)/);
assert.match(cloudRanking, /purgeRowsOf/);
{
  const modulesDir = join(root, "services/api/src/modules");
  const stores = readdirSync(modulesDir).filter((name) => name.startsWith("cloud-") && name.endsWith(".ts"));
  assert.ok(stores.length >= 8, `cloud-* stores 数量异常：${stores.length}`);
  for (const file of stores) {
    const text = readFileSync(join(modulesDir, file), "utf8");
    assert.doesNotMatch(
      text,
      /\.set\(\{\s*\.\.\.\w+\s*,\s*_id:/,
      `${file} 不得在 set() 载荷里带 _id（CloudBase 会拒绝写入）`
    );
  }
}

// 小程序与后台：真实接线
assert.match(miniRanking, /ranking\.list/);
assert.match(miniRanking, /ranking\.me/);
assert.match(miniRanking, /member\.setRanking/);
assert.match(miniRankingPage, /mw-ranking/);
assert.match(miniRankingPage, /公开排行/);
assert.match(read("apps/miniprogram/pages/ranking/index.json"), /排行榜/);
assert.match(read("apps/miniprogram/pages/ranking/index.ts"), /refresh|更新/);
assert.match(adminApp, /ranking\.rebuild/);
assert.match(adminApp, /榜单治理/);

// 部署：只建快照集合与指定索引，不预置任何榜单文档
assert.match(libSource, /ranking_heads/);
assert.match(libSource, /ranking_rows/);
assert.match(libSource, /idx_ranking_rows_board_generation_ordinal/);
assert.match(libSource, /MW17_SNAPSHOT_COLLECTIONS/);
assert.match(libSource, /MW17_DEPLOY_ENTRIES = \["mw-member", "mw-admin", "mw-public"\]/);
assert.match(deploy, /MW17_INDEXES/);
assert.doesNotMatch(deploy, /vip_accounts|orders/);
assert.doesNotMatch(deploy, /setOnInsert|upsert:\s*true/);

// 负向核验：费用筛选 / 类目不可用 / 入口隔离
assert.match(verify, /cli_public_rejects_fee_filter/);
assert.match(verify, /INVALID_ARGUMENT/);
assert.match(verify, /CATEGORY_UNAVAILABLE/);
assert.match(verify, /client_direct_write/);
assert.match(verify, /rowsExposeMemberId/);

// leftover：快照永久保护 + 额外残留核查
assert.match(cleanup, /PROTECTED_COLLECTIONS/);
assert.match(cleanup, /MW17_SNAPSHOT_COLLECTIONS/);
assert.match(cleanup, /member_stats/);
assert.match(cleanup, /independentAfterTotal/);
assert.match(cleanup, /snapshotDeleted: 0/);
assert.doesNotMatch(cleanup, /clearCollection|drop\b/);
assert.doesNotMatch(cleanup, /ranking_rows"\s*:\s*"ranking_rows"/);
assert.doesNotMatch(cleanup, /members:\s*"members"/);
assert.doesNotMatch(leftoverVerify, /members:\s*"members"/);
assert.doesNotMatch(leftoverVerify, /leftoverObjects:\s*0/);
assert.match(leftoverVerify, /knownIdLeftoverDocs/);
assert.match(leftoverVerify, /independentTotal/);
assert.match(leftoverVerify, /countSnapshotResidual/);
assert.match(leftoverVerify, /snapshotResidual/);
assert.match(independent, /resolveScopes/);
assert.match(independent, /countSnapshotResidual/);
assert.doesNotMatch(independent, /scoreEventId|scoreMetricId|paperBestId/);
assert.doesNotMatch(resolveScript, /scoreEventId|scoreMetricId|paperBestId/);
assert.match(sweepLib, /countSnapshotResidual/);
assert.match(sweepLib, /resolveScopes/);
assert.doesNotMatch(sweepLib, /scoreEventId|scoreMetricId|paperBestId/);

// 临时非 super 账号脚本：只按 UID 精确增删查，输出只出现 SHA-256 前缀
assert.match(tempAdmin, /MW17_TEST_ADMIN_UID/);
assert.match(tempAdmin, /uidHash/);
assert.match(tempAdmin, /verifiedByCount/);
assert.doesNotMatch(tempAdmin, /\bJSON\.stringify\(\s*uid\s*[,)]/);

console.log("mw17 ranking and leftover assertions passed");
