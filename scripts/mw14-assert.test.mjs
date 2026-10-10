import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./mw04-lib.mjs";
import {
  emptyMw14KnownIds,
  knownIdCountOf,
  leftoverResolveDecision,
  leftoverVerifyDecision,
  mw14LeftoverDecision,
  parseLeftoverHashes
} from "./mw14-lib.mjs";

assert.equal(parseLeftoverHashes({}).reason, "EMPTY_HASHES");
assert.equal(parseLeftoverHashes({ papers: [] }).reason, "EMPTY_HASHES");
assert.equal(parseLeftoverHashes({ papers: ["paper_raw_id"] }).reason, "HASH_NOT_SHA256");
assert.equal(parseLeftoverHashes({ attempts: ["not-hex"] }).reason, "HASH_NOT_SHA256");
const okHashes = parseLeftoverHashes({ papers: ["A".repeat(64)], attempts: ["b".repeat(64)] });
assert.equal(okHashes.ok, true, okHashes.reason);
assert.deepEqual(okHashes.papers, ["a".repeat(64)]);
assert.deepEqual(okHashes.attempts, ["b".repeat(64)]);

assert.equal(
  leftoverResolveDecision({ importedHashCount: 2, matchedIdCount: 1, scanComplete: true }).reason,
  "HASH_UNMATCHED"
);
assert.equal(
  leftoverResolveDecision({ importedHashCount: 2, matchedIdCount: 2, scanComplete: false }).reason,
  "SCAN_INCOMPLETE"
);
assert.equal(leftoverResolveDecision({ importedHashCount: 2, matchedIdCount: 2, scanComplete: true }).ok, true);

const infra = {
  collectionNames: ["attempts", "active_attempts", "papers"],
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

const emptyNotClean = mw14LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: false,
  knownIdCount: 0
});
assert.equal(emptyNotClean.ok, false);
assert.ok(emptyNotClean.reasons.includes("WROTE_DOCS_FALSE"));

const emptyAfterWrite = mw14LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 0
});
assert.ok(emptyAfterWrite.reasons.includes("KNOWN_IDS_MISSING_AFTER_WRITE"));

const leftover = mw14LeftoverDecision({
  ...infra,
  testDocCount: 1,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 2
});
assert.ok(leftover.reasons.includes("TEST_DOCS_LEFT"));

const objectsUnconfirmed = mw14LeftoverDecision({
  ...infra,
  leftoverObjectsConfirmed: false,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 2
});
assert.equal(objectsUnconfirmed.ok, false);
assert.ok(objectsUnconfirmed.reasons.includes("TEST_OBJECTS_NOT_CONFIRMED"));
assert.equal(objectsUnconfirmed.leftoverObjects, -1);

const pass = mw14LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 2
});
assert.equal(pass.ok, true, pass.reasons.join(","));
assert.equal(pass.leftoverObjects, 0);

const verifyDirty = leftoverVerifyDecision({
  wroteDocs: true,
  cloudWriteClaimed: true,
  exactIdSweepOnly: true,
  leftoverDocs: 1,
  leftoverObjectsConfirmed: true,
  seedPresent: true,
  forbiddenPresent: false
});
assert.equal(verifyDirty.ok, false);
assert.ok(verifyDirty.reasons.includes("TEST_DOCS_LEFT"));
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
assert.ok(
  leftoverVerifyDecision({
    wroteDocs: true,
    cloudWriteClaimed: false,
    exactIdSweepOnly: true,
    leftoverDocs: 0,
    leftoverObjectsConfirmed: true,
    seedPresent: true,
    forbiddenPresent: false
  }).reasons.includes("CLOUD_WRITE_NOT_CLAIMED")
);
assert.ok(
  leftoverVerifyDecision({
    wroteDocs: true,
    cloudWriteClaimed: true,
    exactIdSweepOnly: true,
    leftoverDocs: 0,
    leftoverObjectsConfirmed: true,
    seedPresent: false,
    forbiddenPresent: false
  }).reasons.includes("SEED_ROOTS_MISSING")
);
assert.ok(
  leftoverVerifyDecision({
    wroteDocs: true,
    cloudWriteClaimed: true,
    exactIdSweepOnly: true,
    leftoverDocs: 0,
    leftoverObjectsConfirmed: true,
    seedPresent: true,
    forbiddenPresent: true
  }).reasons.includes("FORBIDDEN_COLLECTIONS_PRESENT")
);
assert.equal(
  leftoverVerifyDecision({
    wroteDocs: true,
    cloudWriteClaimed: true,
    exactIdSweepOnly: true,
    leftoverDocs: 0,
    leftoverObjectsConfirmed: true,
    seedPresent: true,
    forbiddenPresent: false
  }).ok,
  true
);

assert.equal(knownIdCountOf(emptyMw14KnownIds()), 0);
assert.equal(
  knownIdCountOf({ ...emptyMw14KnownIds(), attempts: ["a"], activeAttempts: ["b"], papers: ["c"] }),
  3
);

const root = projectRoot();
const quiz = readFileSync(join(root, "apps/miniprogram/pages/quiz/index.ts"), "utf8");
const quizWxml = readFileSync(join(root, "apps/miniprogram/pages/quiz/index.wxml"), "utf8");
const official = readFileSync(join(root, "services/api/src/official.ts"), "utf8");
const resolve = readFileSync(join(root, "scripts/mw14-resolve-known-ids.mjs"), "utf8");
const leftoverVerify = readFileSync(join(root, "scripts/mw14-leftover-verify.mjs"), "utf8");
const cleanup = readFileSync(join(root, "scripts/mw14-cleanup.mjs"), "utf8");

assert.match(official, /["']attempt\.start["']/);
assert.match(official, /["']attempt\.questionPage["']/);
assert.match(official, /["']attempt\.save["']/);
assert.match(official, /["']attempt\.abandon["']/);

assert.match(quiz, /attempt\.save/);
assert.match(quiz, /attempt\.questionPage/);
assert.doesNotMatch(quiz, /attempt\.submit/);
assert.doesNotMatch(quiz, /correctOptionIds|paper_answers|analysis/);
assert.match(quizWxml, /MW15/);
assert.match(quizWxml, /记入本轮 leftover/);

assert.doesNotMatch(resolve, /findDocs\("papers", \{\}, 100\)/);
assert.doesNotMatch(leftoverVerify, /leftoverObjects:\s*0/);
assert.match(leftoverVerify, /leftoverObjectsConfirmed/);
assert.doesNotMatch(cleanup, /clearCollection|drop\b/);
assert.match(cleanup, /SEED_CATEGORY_PROTECTED/);

console.log("mw14 attempt and leftover assertions passed");
