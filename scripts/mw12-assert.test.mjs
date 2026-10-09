import assert from "node:assert/strict";
import { mw12LeftoverDecision } from "./mw12-lib.mjs";

const infra = {
  collectionNames: ["import_batches", "import_rows", "source_keys", "categories"],
  collectionsConfirmed: true,
  indexConfirmed: true,
  seedPresent: true,
  seedCount: 10,
  clientDenied: true,
  enableOverrun: false,
  enableOverrunConfirmed: true,
  otherEnvChanged: false,
  futureCollectionsCreated: false,
  leftoverObjects: 0
};

const passNoWrite = mw12LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: false,
  knownIdCount: 0
});
assert.equal(passNoWrite.ok, true, passNoWrite.reasons.join(","));

const emptyAfterWrite = mw12LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 0
});
assert.equal(emptyAfterWrite.ok, false);
assert.ok(emptyAfterWrite.reasons.includes("KNOWN_IDS_MISSING_AFTER_WRITE"));

const leftover = mw12LeftoverDecision({
  ...infra,
  testDocCount: 1,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 3
});
assert.equal(leftover.ok, false);
assert.ok(leftover.reasons.includes("TEST_DOCS_LEFT"));

const cleanWrite = mw12LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 3
});
assert.equal(cleanWrite.ok, true, cleanWrite.reasons.join(","));
console.log("mw12-assert.test ok");
