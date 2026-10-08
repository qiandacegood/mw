import assert from "node:assert/strict";
import { extractFnResult, recordStep } from "./mw04-lib.mjs";

const steps = [];
recordStep(steps, "client_direct_db", {
  name: "Error",
  message: "Credentials missing",
  code: "MISSING_CREDENTIALS"
});

assert.equal(steps[0].name, "client_direct_db");
assert.equal(steps[0].detailName, "Error");
assert.equal(steps[0].code, "MISSING_CREDENTIALS");
assert.notEqual(steps[0].name, "Error");
console.log("recordStep keeps step name when value.name is present");

const extracted = extractFnResult({
  json: {
    data: {
      RetMsg: JSON.stringify({ ok: false, reason: "CLIENT_INVOKE_DENIED" }),
      Duration: 12
    }
  }
});
assert.equal(extracted.ok, false);
assert.equal(extracted.reason, "CLIENT_INVOKE_DENIED");
console.log("extractFnResult reads RetMsg business payload");
