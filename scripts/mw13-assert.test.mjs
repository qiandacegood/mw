import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./mw04-lib.mjs";
import { leftoverResolveDecision, mw13LeftoverDecision, parseLeftoverPaperHashes } from "./mw13-lib.mjs";

const infra = {
  collectionNames: ["papers", "paper_versions", "paper_chunks", "paper_answers", "categories"],
  collectionsConfirmed: true,
  seedPresent: true,
  seedCount: 10,
  clientDenied: true,
  enableOverrun: false,
  enableOverrunConfirmed: true,
  otherEnvChanged: false,
  futureCollectionsCreated: false,
  leftoverObjects: 0,
  leftoverObjectsConfirmed: true
};

const emptyNotClean = mw13LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: false,
  knownIdCount: 0
});
assert.equal(emptyNotClean.ok, false);
assert.ok(emptyNotClean.reasons.includes("WROTE_DOCS_FALSE"));

const emptyAfterWrite = mw13LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 0
});
assert.ok(emptyAfterWrite.reasons.includes("KNOWN_IDS_MISSING_AFTER_WRITE"));

const leftover = mw13LeftoverDecision({
  ...infra,
  testDocCount: 1,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 2
});
assert.ok(leftover.reasons.includes("TEST_DOCS_LEFT"));

const objectsUnconfirmed = mw13LeftoverDecision({
  ...infra,
  leftoverObjects: 0,
  leftoverObjectsConfirmed: false,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 2
});
assert.equal(objectsUnconfirmed.ok, false);
assert.ok(objectsUnconfirmed.reasons.includes("TEST_OBJECTS_NOT_CONFIRMED"));
assert.equal(objectsUnconfirmed.leftoverObjects, -1);

const pass = mw13LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 2
});
assert.equal(pass.ok, true, pass.reasons.join(","));

assert.equal(parseLeftoverPaperHashes({ papers: [] }).reason, "EMPTY_HASHES");
assert.equal(parseLeftoverPaperHashes({ papers: ["paper_raw_id"] }).reason, "HASH_NOT_SHA256");
assert.equal(
  parseLeftoverPaperHashes({
    papers: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
  }).ok,
  true
);
assert.equal(
  leftoverResolveDecision({ importedHashCount: 2, matchedIdCount: 1, scanComplete: true }).reason,
  "HASH_UNMATCHED"
);
assert.equal(
  leftoverResolveDecision({ importedHashCount: 2, matchedIdCount: 2, scanComplete: false }).reason,
  "SCAN_INCOMPLETE"
);
assert.equal(leftoverResolveDecision({ importedHashCount: 2, matchedIdCount: 2, scanComplete: true }).ok, true);

const root = projectRoot();
const scanned = [
  "services/api/src/official.ts",
  "services/api/src/modules/paper.ts",
  "apps/miniprogram/pages/paper/index.ts",
  "apps/miniprogram/pages/ranking/index.ts"
];
for (const rel of scanned) {
  const text = readFileSync(join(root, rel), "utf8");
  // MW14 起试卷详情与官方入口会合法接通 attempt.* 系列 action；此处不再拦截 attempt.start，
  // 改由 scripts/mw14-assert.test.mjs 正向核验，MW13 的 leftover 门禁保持不回退。
  assert.doesNotMatch(text, /freeOnly|accessFilter/);
  assert.doesNotMatch(text, /标通过|已通过 A0|T03 通过|T15 通过/);
}

const home = readFileSync(join(root, "apps/miniprogram/pages/home/index.ts"), "utf8");
const papers = readFileSync(join(root, "apps/miniprogram/pages/papers/index.ts"), "utf8");
const paper = readFileSync(join(root, "apps/miniprogram/pages/paper/index.ts"), "utf8");
const homeWxml = readFileSync(join(root, "apps/miniprogram/pages/home/index.wxml"), "utf8");
const paperWxml = readFileSync(join(root, "apps/miniprogram/pages/paper/index.wxml"), "utf8");
const resolve = readFileSync(join(root, "scripts/mw13-resolve-known-ids.mjs"), "utf8");
const leftoverVerify = readFileSync(join(root, "scripts/mw13-leftover-verify.mjs"), "utf8");
const knownIds = readFileSync(join(root, "apps/miniprogram/services/known-ids.ts"), "utf8");

assert.doesNotMatch(home, /rememberPapers|rememberPaperId/);
assert.doesNotMatch(papers, /rememberPapers|rememberPaperId/);
assert.doesNotMatch(paper, /rememberPaperId/);
assert.match(paper, /markLeftoverPaperId/);
assert.match(paperWxml, /记入本轮 leftover/);
assert.match(homeWxml, /复制本轮 leftover knownIds/);
assert.match(knownIds, /markLeftoverPaperId/);
assert.doesNotMatch(resolve, /findDocs\("papers", \{\}, 100\)/);
assert.doesNotMatch(leftoverVerify, /leftoverObjects:\s*0/);
assert.match(leftoverVerify, /leftoverObjectsConfirmed/);

console.log("mw13 leftover decision assertions passed");
