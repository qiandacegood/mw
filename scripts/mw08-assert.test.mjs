import assert from "node:assert/strict";
import { mw08LeftoverDecision } from "./mw08-lib.mjs";

const pass = mw08LeftoverDecision({
  collectionNames: ["identities", "members", "member_stats", "app_config"],
  collectionsConfirmed: true,
  testDocCount: 0,
  testDocsConfirmed: true,
  clientDenied: true,
  aclObtained: true,
  acl: "ADMINONLY",
  enableOverrun: false,
  enableOverrunConfirmed: true,
  otherEnvChanged: false
});
assert.equal(pass.ok, true, pass.reasons.join(","));

const fail = mw08LeftoverDecision({
  collectionNames: ["identities"],
  collectionsConfirmed: true,
  testDocCount: 2,
  testDocsConfirmed: true,
  clientDenied: false,
  aclObtained: true,
  acl: "ADMINONLY",
  enableOverrun: false,
  enableOverrunConfirmed: true
});
assert.ok(fail.reasons.includes("COLLECTIONS_MISSING"));
assert.ok(fail.reasons.includes("TEST_DOCS_LEFT"));
assert.ok(fail.reasons.includes("CLIENT_WRITE_NOT_DENIED"));
console.log("mw08 leftover decision assertions passed");
