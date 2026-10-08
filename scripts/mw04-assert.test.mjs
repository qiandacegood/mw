import assert from "node:assert/strict";
import {
  assertTeardownEndState,
  assertUnauthorizedStatuses,
  describeUnauthenticatedClient,
  interpretCollectionDrop,
  leftoverDecision,
  requireQueryOk
} from "./mw04-assert.mjs";

const dropped = interpretCollectionDrop({
  code: 0,
  json: {
    data: {
      results: [[{ ok: { $numberDouble: "1.0" } }]]
    }
  }
});
assert.equal(dropped.accepted, true);
assert.equal(dropped.status, "dropped");

const absent = interpretCollectionDrop({
  code: 5,
  json: { error: { message: "[RunCommands] (NamespaceNotFound) ns not found" } }
});
assert.equal(absent.accepted, true);
assert.equal(absent.status, "absent");

assert.throws(
  () =>
    interpretCollectionDrop({
      code: 5,
      json: { error: { message: "PermissionDenied: no access" } }
    }),
  /permission, parameter, or parse error/
);

assert.throws(
  () =>
    interpretCollectionDrop({
      code: 5,
      json: { error: { message: "[RunCommands] (FailedToParse) The limit field" } }
    }),
  /permission, parameter, or parse error/
);

assert.throws(
  () => interpretCollectionDrop({ code: 7, json: { error: { message: "unknown cloud error" } } }),
  /unknown result/
);

assert.throws(() => requireQueryOk({ code: 1 }, "fn list"), /fn list query failed/);
assert.equal(requireQueryOk({ code: 0 }, "fn list").code, 0);

const clean = leftoverDecision({
  remainingValidationFunctions: 0,
  storageObjectCount: 0,
  listedCollectionNames: ["orders"],
  acl: "ADMINONLY",
  enableOverrun: false
});
assert.equal(clean.ok, true);
assert.equal(clean.exitCode, 0);
assert.equal(assertTeardownEndState(clean && {
  remainingValidationFunctions: 0,
  storageObjectCount: 0,
  listedCollectionNames: [],
  acl: "ADMINONLY",
  enableOverrun: false
}), true);

assert.equal(
  leftoverDecision({
    remainingValidationFunctions: 1,
    storageObjectCount: 0,
    listedCollectionNames: [],
    acl: "ADMINONLY",
    enableOverrun: false
  }).exitCode,
  1
);
assert.equal(
  leftoverDecision({
    remainingValidationFunctions: 0,
    storageObjectCount: 2,
    listedCollectionNames: [],
    acl: "ADMINONLY",
    enableOverrun: false
  }).exitCode,
  1
);
assert.equal(
  leftoverDecision({
    remainingValidationFunctions: 0,
    storageObjectCount: 0,
    listedCollectionNames: ["mw_validation_tx"],
    acl: "ADMINONLY",
    enableOverrun: false
  }).exitCode,
  1
);
assert.equal(
  leftoverDecision({
    remainingValidationFunctions: 0,
    storageObjectCount: 0,
    listedCollectionNames: [],
    acl: "READONLY",
    enableOverrun: false
  }).exitCode,
  1
);
assert.equal(
  leftoverDecision({
    remainingValidationFunctions: 0,
    storageObjectCount: 0,
    listedCollectionNames: [],
    acl: "ADMINONLY",
    enableOverrun: true
  }).exitCode,
  1
);

assert.equal(assertUnauthorizedStatuses([{ http: 403 }, { http: 404 }]), true);
assert.throws(() => assertUnauthorizedStatuses([{ http: 200 }]), /2xx\/3xx/);
assert.throws(() => assertUnauthorizedStatuses([{ http: 302 }]), /2xx\/3xx/);

const client = describeUnauthenticatedClient({
  attempted: true,
  ok: false,
  error: { code: "MISSING_CREDENTIALS", message: "Credentials missing" }
});
assert.equal(client.unauthenticatedClientDenied, true);
assert.equal(client.collectionRulesVerified, false);
assert.equal(client.note, "未登录客户端被拒绝");

console.log("mw04-assert covers drop, query, leftover, and unauthorized HTTP outcomes");
