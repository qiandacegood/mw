import assert from "node:assert/strict";
import { mw08LeftoverDecision } from "./mw08-lib.mjs";

const infra = {
  collectionNames: ["identities", "members", "member_stats", "app_config"],
  collectionsConfirmed: true,
  clientDenied: true,
  aclObtained: true,
  acl: "ADMINONLY",
  enableOverrun: false,
  enableOverrunConfirmed: true,
  otherEnvChanged: false
};

const passNoWrite = mw08LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: false,
  knownIdCount: 0
});
assert.equal(passNoWrite.ok, true, passNoWrite.reasons.join(","));
assert.equal(passNoWrite.cloudWriteClaimed, false);
assert.equal(passNoWrite.exactIdSweepOnly, true);

const passAfterWrite = mw08LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 4
});
assert.equal(passAfterWrite.ok, true, passAfterWrite.reasons.join(","));
assert.equal(passAfterWrite.cloudWriteClaimed, true);

const emptyAfterWrite = mw08LeftoverDecision({
  ...infra,
  testDocCount: 0,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 0
});
assert.equal(emptyAfterWrite.ok, false);
assert.ok(emptyAfterWrite.reasons.includes("KNOWN_IDS_MISSING_AFTER_WRITE"));

const leftoverAfterWrite = mw08LeftoverDecision({
  ...infra,
  testDocCount: 2,
  testDocsConfirmed: true,
  wroteDocs: true,
  knownIdCount: 3
});
assert.ok(leftoverAfterWrite.reasons.includes("TEST_DOCS_LEFT"));

const fail = mw08LeftoverDecision({
  collectionNames: ["identities"],
  collectionsConfirmed: true,
  testDocCount: 2,
  testDocsConfirmed: true,
  clientDenied: false,
  aclObtained: true,
  acl: "ADMINONLY",
  enableOverrun: false,
  enableOverrunConfirmed: true,
  wroteDocs: true,
  knownIdCount: 2
});
assert.ok(fail.reasons.includes("COLLECTIONS_MISSING"));
assert.ok(fail.reasons.includes("TEST_DOCS_LEFT"));
assert.ok(fail.reasons.includes("CLIENT_WRITE_NOT_DENIED"));
console.log("mw08 leftover decision assertions passed");
