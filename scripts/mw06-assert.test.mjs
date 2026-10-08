import assert from "node:assert/strict";
import { buildMw06FunctionConfigs, mw06LeftoverDecision, parseNosqlCount } from "./mw06-lib.mjs";

const confirmed = {
  collectionNames: ["jobs", "idempotency", "audit_logs", "app_config", "admin_users"],
  collectionsConfirmed: true,
  testDocCount: 0,
  testDocsConfirmed: true,
  missingIndexes: [],
  indexesConfirmed: true,
  enableOverrun: false,
  enableOverrunConfirmed: true,
  acl: "ADMINONLY",
  aclObtained: true,
  clientDenied: true,
  jobsTimerDeployed: false,
  timerConfirmed: true
};

const clean = mw06LeftoverDecision(confirmed);
assert.equal(clean.ok, true);
assert.equal(clean.exitCode, 0);
assert.equal(clean.acl, "ADMINONLY");
assert.equal(clean.clientDenied, true);

const dirty = mw06LeftoverDecision({
  ...confirmed,
  collectionNames: ["jobs"],
  testDocCount: 2,
  missingIndexes: ["idx_jobs_state_nextrun_id"],
  jobsTimerDeployed: true
});
assert.equal(dirty.ok, false);
assert.equal(dirty.exitCode, 1);
assert.deepEqual(dirty.missingCollections, ["idempotency", "audit_logs", "app_config"]);
assert.equal(dirty.leftoverDocs, 2);
assert.equal(dirty.jobsTimerDeployed, true);

assert.equal(mw06LeftoverDecision({ ...confirmed, aclObtained: false, acl: "" }).ok, false);
assert.equal(mw06LeftoverDecision({ ...confirmed, acl: "READONLY" }).ok, false);
assert.equal(mw06LeftoverDecision({ ...confirmed, acl: undefined, aclObtained: true }).ok, false);
assert.equal(mw06LeftoverDecision({ ...confirmed, clientDenied: false }).ok, false);
assert.equal(mw06LeftoverDecision({ ...confirmed, clientDenied: "NOT_CONFIRMED" }).ok, false);
assert.equal(mw06LeftoverDecision({ ...confirmed, collectionsConfirmed: false }).ok, false);
assert.equal(mw06LeftoverDecision({ ...confirmed, indexesConfirmed: false }).ok, false);
assert.equal(mw06LeftoverDecision({ ...confirmed, testDocsConfirmed: false }).ok, false);
assert.equal(mw06LeftoverDecision({ ...confirmed, timerConfirmed: false }).ok, false);
assert.equal(mw06LeftoverDecision({ ...confirmed, enableOverrunConfirmed: false }).ok, false);
assert.equal(mw06LeftoverDecision({ ...confirmed, enableOverrun: true }).ok, false);
assert.equal(mw06LeftoverDecision({ collectionNames: confirmed.collectionNames, testDocCount: 0 }).ok, false);

const functions = buildMw06FunctionConfigs(
  "wx-allowed",
  "jobs-token-value",
  {
    "mw-admin": { MW_ALLOWED_MINI_APPIDS: "old", MW_ADMIN_EXTRA: "keep", MW_JOBS_INVOKE_TOKEN: "should-strip" },
    "mw-jobs": { MW_ALLOWED_MINI_APPIDS: "old" },
    "mw-public": { MW_PUBLIC_EXTRA: "keep-public" }
  }
);
const byName = Object.fromEntries(functions.map((fn) => [fn.name, fn.envVariables]));
assert.equal(byName["mw-jobs"].MW_JOBS_INVOKE_TOKEN, "jobs-token-value");
assert.equal(byName["mw-admin"].MW_JOBS_INVOKE_TOKEN, undefined);
assert.equal(byName["mw-public"].MW_JOBS_INVOKE_TOKEN, undefined);
assert.equal(byName["cloudbase_auth"].MW_JOBS_INVOKE_TOKEN, undefined);
assert.equal(byName["mw-member"].MW_JOBS_INVOKE_TOKEN, undefined);
assert.equal(byName["mw-upload"].MW_JOBS_INVOKE_TOKEN, undefined);
assert.equal(byName["mw-pay-hook"].MW_JOBS_INVOKE_TOKEN, undefined);
assert.equal(byName["mw-admin"].MW_ADMIN_EXTRA, "keep");
assert.equal(byName["mw-public"].MW_PUBLIC_EXTRA, "keep-public");

assert.equal(parseNosqlCount({ code: 0, json: { data: { results: [[{ n: { $numberInt: "0" } }]] } } }), 0);
assert.equal(parseNosqlCount({ code: 0, json: { data: { results: [{ n: 2 }] } } }), 2);
assert.equal(parseNosqlCount({ code: 1, json: { data: { results: [{ n: 0 }] } } }), null);
assert.equal(parseNosqlCount({ code: 0, json: {} }), null);

console.log("mw06 leftover decision fixtures passed");
