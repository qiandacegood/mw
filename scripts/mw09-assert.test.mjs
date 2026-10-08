import assert from "node:assert/strict";
import { mw09LeftoverDecision } from "./mw09-lib.mjs";

const infra = {
  collectionNames: ["categories", "category_names", "app_config"],
  collectionsConfirmed: true,
  indexConfirmed: true,
  seedPresent: true,
  seedCount: 10,
  clientDenied: true,
  aclObtained: true,
  acl: "ADMINONLY",
  enableOverrun: false,
  enableOverrunConfirmed: true,
  otherEnvChanged: false,
  futureCollectionsCreated: false
};

const passNoWrite = mw09LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: false,
  knownIdCount: 0
});
assert.equal(passNoWrite.ok, true, passNoWrite.reasons.join(","));

const emptyAfterWrite = mw09LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 0
});
assert.equal(emptyAfterWrite.ok, false);
assert.ok(emptyAfterWrite.reasons.includes("KNOWN_IDS_MISSING_AFTER_WRITE"));

const leftover = mw09LeftoverDecision({
  ...infra,
  testDocCount: 2,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 3
});
assert.ok(leftover.reasons.includes("TEST_DOCS_LEFT"));

const missingSeed = mw09LeftoverDecision({
  ...infra,
  seedPresent: false,
  seedCount: 0,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: false,
  knownIdCount: 0
});
assert.ok(missingSeed.reasons.includes("SEED_ROOTS_MISSING"));
console.log("mw09 leftover decision assertions passed");
