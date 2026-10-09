import assert from "node:assert/strict";
import { mw10LeftoverDecision } from "./mw10-lib.mjs";

const infra = {
  collectionNames: ["questions", "question_versions", "media_assets", "upload_tickets", "categories"],
  collectionsConfirmed: true,
  indexConfirmed: true,
  seedPresent: true,
  seedCount: 10,
  clientDenied: true,
  storageDenied: true,
  aclObtained: true,
  acl: "ADMINONLY",
  enableOverrun: false,
  enableOverrunConfirmed: true,
  otherEnvChanged: false,
  futureCollectionsCreated: false
};

const passNoWrite = mw10LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  testObjectCount: 0,
  testObjectsConfirmed: true,
  wroteDocs: false,
  knownIdCount: 0
});
assert.equal(passNoWrite.ok, true, passNoWrite.reasons.join(","));

const emptyAfterWrite = mw10LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  testObjectCount: 0,
  testObjectsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 0
});
assert.equal(emptyAfterWrite.ok, false);
assert.ok(emptyAfterWrite.reasons.includes("KNOWN_IDS_MISSING_AFTER_WRITE"));

const leftover = mw10LeftoverDecision({
  ...infra,
  testDocCount: 1,
  testDocsConfirmed: true,
  testObjectCount: 0,
  testObjectsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 3
});
assert.ok(leftover.reasons.includes("TEST_DOCS_LEFT"));

const papers = mw10LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  testObjectCount: 0,
  testObjectsConfirmed: true,
  wroteDocs: false,
  knownIdCount: 0,
  futureCollectionsCreated: true
});
assert.ok(papers.reasons.includes("FUTURE_COLLECTIONS_CREATED"));

console.log("mw10 leftover decision assertions passed");
