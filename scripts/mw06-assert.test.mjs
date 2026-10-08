import assert from "node:assert/strict";
import { mw06LeftoverDecision } from "./mw06-lib.mjs";

const clean = mw06LeftoverDecision({
  collectionNames: ["jobs", "idempotency", "audit_logs", "app_config", "admin_users"],
  testDocCount: 0,
  missingIndexes: [],
  enableOverrun: false,
  acl: "ADMINONLY",
  jobsTimerDeployed: false
});
assert.equal(clean.ok, true);
assert.equal(clean.exitCode, 0);

const dirty = mw06LeftoverDecision({
  collectionNames: ["jobs"],
  testDocCount: 2,
  missingIndexes: ["idx_jobs_state_nextrun_id"],
  enableOverrun: false,
  acl: "ADMINONLY",
  jobsTimerDeployed: true
});
assert.equal(dirty.ok, false);
assert.equal(dirty.exitCode, 1);
assert.deepEqual(dirty.missingCollections, ["idempotency", "audit_logs", "app_config"]);
assert.equal(dirty.leftoverDocs, 2);
assert.equal(dirty.jobsTimerDeployed, true);

console.log("mw06 leftover decision fixtures passed");
