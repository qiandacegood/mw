import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./mw04-lib.mjs";
import {
  emptyMw15KnownIds,
  knownIdCountOf,
  leftoverResolveDecision,
  leftoverVerifyDecision,
  mw15LeftoverDecision,
  parseLeftoverHashes
} from "./mw15-lib.mjs";

assert.equal(parseLeftoverHashes({}).reason, "EMPTY_HASHES");
assert.equal(parseLeftoverHashes({ papers: ["paper_raw_id"] }).reason, "HASH_NOT_SHA256");
const okHashes = parseLeftoverHashes({ papers: ["A".repeat(64)], attempts: ["b".repeat(64)] });
assert.equal(okHashes.ok, true, okHashes.reason);

assert.equal(
  leftoverResolveDecision({ importedHashCount: 2, matchedIdCount: 1, scanComplete: true }).reason,
  "HASH_UNMATCHED"
);

const infra = {
  collectionNames: ["paper_bests", "score_events", "score_metrics", "attempts"],
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
  indexConfirmed: true
};

const emptyNotClean = mw15LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: false,
  knownIdCount: 0
});
assert.equal(emptyNotClean.ok, false);
assert.ok(emptyNotClean.reasons.includes("WROTE_DOCS_FALSE"));

const pass = mw15LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 2
});
assert.equal(pass.ok, true, pass.reasons.join(","));
assert.equal(pass.leftoverObjects, 0);

assert.ok(
  leftoverVerifyDecision({
    wroteDocs: false,
    cloudWriteClaimed: true,
    exactIdSweepOnly: true,
    leftoverDocs: 0,
    leftoverObjectsConfirmed: true,
    seedPresent: true,
    forbiddenPresent: false
  }).reasons.includes("WROTE_DOCS_FALSE")
);

assert.equal(knownIdCountOf(emptyMw15KnownIds()), 0);

const root = projectRoot();
const official = readFileSync(join(root, "services/api/src/official.ts"), "utf8");
const quiz = readFileSync(join(root, "apps/miniprogram/pages/quiz/index.ts"), "utf8");
const quizWxml = readFileSync(join(root, "apps/miniprogram/pages/quiz/index.wxml"), "utf8");
const resolve = readFileSync(join(root, "scripts/mw15-resolve-known-ids.mjs"), "utf8");
const leftoverVerify = readFileSync(join(root, "scripts/mw15-leftover-verify.mjs"), "utf8");
const cleanup = readFileSync(join(root, "scripts/mw15-cleanup.mjs"), "utf8");
const deploy = readFileSync(join(root, "scripts/mw15-deploy.mjs"), "utf8");

assert.match(official, /["']attempt\.submit["']/);
assert.match(official, /["']attempt\.result["']/);
assert.match(official, /["']attempt\.analysis["']/);
assert.match(official, /["']attempt\.history["']/);
assert.match(quiz, /attempt\.submit/);
assert.match(quizWxml, /查看结果/);
assert.doesNotMatch(quiz, /correctOptionIds|paper_answers/);
assert.doesNotMatch(resolve, /findDocs\("papers", \{\}, 100\)/);
assert.doesNotMatch(leftoverVerify, /leftoverObjects:\s*0/);
assert.match(leftoverVerify, /leftoverObjectsConfirmed/);
assert.doesNotMatch(cleanup, /clearCollection|drop\b/);
assert.match(cleanup, /SEED_CATEGORY_PROTECTED/);
assert.doesNotMatch(deploy, /idx_attempts_member_state_submitted_id/);

console.log("mw15 submit and leftover assertions passed");
