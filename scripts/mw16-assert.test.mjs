import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./mw04-lib.mjs";
import {
  emptyMw16KnownIds,
  isRoundMedalGrant,
  knownIdCountOf,
  leftoverResolveDecision,
  mw16IndependentDecision,
  mw16LeftoverDecision,
  mw16VerifyDecision,
  parseLeftoverHashes,
  sweepTotal
} from "./mw16-lib.mjs";

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
assert.equal(questionOnly.importedHashCount, 2);

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
assert.equal(paperPayload.questionVersions[0], "3".repeat(64));
assert.equal(parseLeftoverHashes({ questions: ["not-a-hash"] }).reason, "HASH_NOT_SHA256");

assert.equal(
  leftoverResolveDecision({ importedHashCount: 2, matchedIdCount: 1, scanComplete: true }).reason,
  "HASH_UNMATCHED"
);

const infra = {
  collectionNames: ["medal_grants", "attempts", "score_events"],
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
  independent: { confirmed: true, total: 0 }
};

const emptyNotClean = mw16LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: false,
  knownIdCount: 0
});
assert.equal(emptyNotClean.ok, false);
assert.ok(emptyNotClean.reasons.includes("WROTE_DOCS_FALSE"));

const pass = mw16LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 2
});
assert.equal(pass.ok, true, pass.reasons.join(","));
assert.equal(pass.independentTotal, 0);

const missingIndependent = mw16LeftoverDecision({
  ...infra,
  independent: { confirmed: false, total: -1 },
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 2
});
assert.equal(missingIndependent.ok, false);
assert.ok(missingIndependent.reasons.includes("INDEPENDENT_CHECK_NOT_CONFIRMED"));

const deployIndependentLeft = mw16LeftoverDecision({
  ...infra,
  independent: { confirmed: true, total: 3 },
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 2
});
assert.equal(deployIndependentLeft.ok, false);
assert.ok(deployIndependentLeft.reasons.includes("INDEPENDENT_SWEEP_LEFT"));

assert.ok(
  mw16VerifyDecision({
    wroteDocs: false,
    cloudWriteClaimed: true,
    exactIdSweepOnly: true,
    knownIdLeftoverDocs: 0,
    independentTotal: 0,
    independentConfirmed: true,
    seedPresent: true,
    forbiddenPresent: false
  }).reasons.includes("WROTE_DOCS_FALSE")
);

const verifyPass = mw16VerifyDecision({
  wroteDocs: true,
  cloudWriteClaimed: true,
  exactIdSweepOnly: true,
  knownIdLeftoverDocs: 0,
  independentTotal: 0,
  independentConfirmed: true,
  seedPresent: true,
  forbiddenPresent: false
});
assert.equal(verifyPass.ok, true, verifyPass.reasons.join(","));
assert.equal(verifyPass.independentRequired, true);

const verifyNeedsIndependent = mw16VerifyDecision({
  wroteDocs: true,
  cloudWriteClaimed: true,
  exactIdSweepOnly: true,
  knownIdLeftoverDocs: 0,
  independentTotal: 0,
  independentConfirmed: false,
  seedPresent: true,
  forbiddenPresent: false
});
assert.equal(verifyNeedsIndependent.ok, false);
assert.ok(verifyNeedsIndependent.reasons.includes("INDEPENDENT_CHECK_NOT_CONFIRMED"));

const verifyKnownLeft = mw16VerifyDecision({
  wroteDocs: true,
  cloudWriteClaimed: true,
  exactIdSweepOnly: true,
  knownIdLeftoverDocs: 2,
  independentTotal: 2,
  independentConfirmed: true,
  seedPresent: true,
  forbiddenPresent: false
});
assert.equal(verifyKnownLeft.ok, false);
assert.ok(verifyKnownLeft.reasons.includes("TEST_DOCS_LEFT"));
assert.ok(verifyKnownLeft.reasons.includes("INDEPENDENT_SWEEP_LEFT"));

// 勋章授予：只把本轮来源（注册 / 重算 / 已标记的本轮 attempt）算作本轮对象。
const roundAttempts = new Set(["attempt_round_1"]);
assert.equal(isRoundMedalGrant({ sourceType: "register", sourceId: "member.register" }, roundAttempts), true);
assert.equal(isRoundMedalGrant({ sourceType: "recompute", sourceId: "growth@v2" }, roundAttempts), true);
assert.equal(isRoundMedalGrant({ sourceType: "submit", sourceId: "attempt_round_1" }, roundAttempts), true);
// 历史既得勋章（来自本轮之外的 attempt）不得计入本轮对象，避免被删除。
assert.equal(isRoundMedalGrant({ sourceType: "submit", sourceId: "attempt_other_round" }, roundAttempts), false);
assert.equal(isRoundMedalGrant({ sourceType: "submit", sourceId: "" }, roundAttempts), false);
assert.equal(isRoundMedalGrant({}, roundAttempts), false);

assert.equal(knownIdCountOf(emptyMw16KnownIds()), 0);
assert.equal(knownIdCountOf({ ...emptyMw16KnownIds(), members: ["a", "b"], grants: ["c"] }), 3);
assert.equal(sweepTotal({ attempts: 1, nested: { medals: 2 } }), 3);

const independentPass = mw16IndependentDecision({
  wroteDocs: true,
  resolved: true,
  independentTotal: 0,
  seedPresent: true,
  forbiddenPresent: false
});
assert.equal(independentPass.ok, true, independentPass.reasons.join(","));
assert.equal(independentPass.derivedIdsUsed, false);

const independentLeft = mw16IndependentDecision({
  wroteDocs: true,
  resolved: true,
  independentTotal: 1,
  seedPresent: true,
  forbiddenPresent: false
});
assert.equal(independentLeft.ok, false);
assert.ok(independentLeft.reasons.includes("INDEPENDENT_SWEEP_LEFT"));

const root = projectRoot();
const official = readFileSync(join(root, "services/api/src/official.ts"), "utf8");
const sharedMember = readFileSync(join(root, "packages/shared/src/member.ts"), "utf8");
const sharedGrowth = readFileSync(join(root, "packages/shared/src/growth.ts"), "utf8");
const submit = readFileSync(join(root, "services/api/src/modules/attempt.ts"), "utf8");
const growthModule = readFileSync(join(root, "services/api/src/modules/growth.ts"), "utf8");
const miniMe = readFileSync(join(root, "apps/miniprogram/pages/me/index.ts"), "utf8");
const miniWxml = readFileSync(join(root, "apps/miniprogram/pages/me/index.wxml"), "utf8");
const miniBrowse = readFileSync(join(root, "apps/miniprogram/services/browse.ts"), "utf8");
const adminApp = readFileSync(join(root, "apps/admin/src/App.vue"), "utf8");
const cleanup = readFileSync(join(root, "scripts/mw16-cleanup.mjs"), "utf8");
const independent = readFileSync(join(root, "scripts/mw16-independent-check.mjs"), "utf8");
const leftoverVerify = readFileSync(join(root, "scripts/mw16-verify-leftovers.mjs"), "utf8");
const deploy = readFileSync(join(root, "scripts/mw16-deploy.mjs"), "utf8");
const resolveScript = readFileSync(join(root, "scripts/mw16-resolve-known-ids.mjs"), "utf8");
const sweepLib = readFileSync(join(root, "scripts/mw16-sweep-lib.mjs"), "utf8");
const libSource = readFileSync(join(root, "scripts/mw16-lib.mjs"), "utf8");
const tempAdmin = readFileSync(join(root, "scripts/mw16-temp-admin.mjs"), "utf8");

assert.match(sharedMember, /levelIdForScore/);
assert.doesNotMatch(sharedMember, /return DEFAULT_LEVEL_ID;/);
assert.match(sharedGrowth, /planMedalGrants/);
assert.match(sharedGrowth, /GROWTH_CONFIG_DOC_ID/);

assert.match(official, /["']member\.growth["']/);
assert.match(official, /["']growth\.config["']/);
assert.match(official, /["']growth\.preview["']/);
assert.match(official, /["']growth\.publish["']/);
assert.match(official, /["']growth\.recompute["']/);
assert.match(official, /resolveGrowthConfig/);

assert.match(submit, /MEDAL_GRANT_SOURCE_SUBMIT/);
assert.match(submit, /planMedalGrants/);
assert.match(submit, /levelIdForScore/);
assert.doesNotMatch(submit, /levelIdFromTotalScore\(totalScore\)/);

assert.match(growthModule, /wroteDocs: false/);
assert.match(growthModule, /MEDAL_GRANT_SOURCE_RECOMPUTE/);
assert.match(growthModule, /GROWTH_SCAN_LIMIT/);
assert.match(official, /SUPER_REQUIRED/);

assert.match(miniBrowse, /member\.growth/);
assert.match(miniMe, /memberGrowth/);
assert.match(miniWxml, /个人成长展示/);
assert.match(miniWxml, /勋章/);

assert.match(adminApp, /growth\.publish/);
assert.match(adminApp, /growth\.preview/);
assert.match(adminApp, /growth\.recompute/);
assert.match(adminApp, /复制等级配置证据/);

assert.doesNotMatch(cleanup, /clearCollection|drop\b/);
assert.match(cleanup, /PROTECTED_COLLECTIONS/);
assert.match(cleanup, /member_stats/);
// 会员账号与 member_stats 永不作为 leftover 计数，也永不删除。
assert.doesNotMatch(cleanup, /members:\s*"members"/);
assert.doesNotMatch(leftoverVerify, /members:\s*"members"/);
assert.match(cleanup, /independentAfterTotal/);
assert.doesNotMatch(independent, /scoreEventId|scoreMetricId|paperBestId/);
assert.match(independent, /resolveScopes/);
assert.match(leftoverVerify, /independentTotal/);
assert.match(leftoverVerify, /knownIdLeftoverDocs/);
assert.doesNotMatch(leftoverVerify, /leftoverObjects:\s*0/);
assert.doesNotMatch(resolveScript, /scoreEventId|scoreMetricId|paperBestId/);
assert.match(libSource, /byMarkedPaper/);
assert.match(libSource, /byMarkedQuestion/);
assert.match(libSource, /isRoundMedalGrant/);
assert.match(sweepLib, /isRoundMedalGrant/);
assert.match(sweepLib, /scopedPaperIds/);
assert.match(sweepLib, /markedPaperIds/);
assert.match(sweepLib, /markedQuestionIds/);
assert.match(sweepLib, /question_versions/);
assert.doesNotMatch(sweepLib, /scoreEventId|scoreMetricId|paperBestId/);
// 临时非 super 账号脚本：只按 UID 精确增删查，输出只出现 SHA-256 前缀，不含明文 UID。
assert.match(tempAdmin, /MW16_TEST_ADMIN_UID/);
assert.match(tempAdmin, /uidHash/);
assert.match(tempAdmin, /verifiedByCount/);
assert.doesNotMatch(tempAdmin, /\bJSON\.stringify\(\s*uid\s*[,)]/);
assert.doesNotMatch(deploy, /vip_accounts|orders/);
assert.doesNotMatch(deploy, /idx_attempts_member_state_submitted_id/);

console.log("mw16 growth and leftover assertions passed");
