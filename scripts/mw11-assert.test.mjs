import assert from "node:assert/strict";
import { mw11LeftoverDecision } from "./mw11-lib.mjs";

const infra = {
  collectionNames: ["papers", "paper_versions", "paper_chunks", "paper_answers", "categories"],
  collectionsConfirmed: true,
  indexConfirmed: true,
  seedPresent: true,
  seedCount: 10,
  clientDenied: true,
  enableOverrun: false,
  enableOverrunConfirmed: true,
  otherEnvChanged: false,
  futureCollectionsCreated: false
};

const passNoWrite = mw11LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: false,
  knownIdCount: 0
});
assert.equal(passNoWrite.ok, true, passNoWrite.reasons.join(","));

const emptyAfterWrite = mw11LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 0
});
assert.equal(emptyAfterWrite.ok, false);
assert.ok(emptyAfterWrite.reasons.includes("KNOWN_IDS_MISSING_AFTER_WRITE"));

const leftover = mw11LeftoverDecision({
  ...infra,
  testDocCount: 1,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 3
});
assert.ok(leftover.reasons.includes("TEST_DOCS_LEFT"));

const attempts = mw11LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: false,
  knownIdCount: 0,
  futureCollectionsCreated: true
});
assert.ok(attempts.reasons.includes("FUTURE_COLLECTIONS_CREATED"));

console.log("mw11 leftover decision assertions passed");
