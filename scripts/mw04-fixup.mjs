import { join } from "node:path";
import {
  assertMwTestReady,
  invokeFn,
  projectRoot,
  publicObjectUrls,
  recordStep,
  redact,
  runTcb,
  writeJson
} from "./mw04-lib.mjs";

const root = projectRoot();
const tmp = join(root, "tmp", "mw04");
const out = { startedAt: new Date().toISOString(), steps: [] };

function record(stepName, value) {
  recordStep(out.steps, stepName, value);
  writeJson(join(tmp, "mw04-fixup.json"), redact(out));
}

const ready = await assertMwTestReady();
record("hard_check", ready);

const acl = await runTcb(["storage", "rules", "update", "--acl", "ADMINONLY", "--json"]);
record("acl_update", { code: acl.code, json: acl.json, stdout: acl.stdout, stderr: acl.stderr });

const aclGet = await runTcb(["storage", "rules", "get", "--json"]);
record("acl_get", { code: aclGet.code, json: aclGet.json, stdout: aclGet.stdout, stderr: aclGet.stderr });

const publicChecks = [];
for (const url of publicObjectUrls(ready.storageHosts, "mw-test/validation/private-sample.txt")) {
  try {
    const response = await fetch(url, { redirect: "manual" });
    publicChecks.push({ http: response.status, redirected: response.redirected });
  } catch (error) {
    publicChecks.push({ error: { message: error && error.message } });
  }
}
record("public_get_after_acl", { results: publicChecks });

const storageB = await invokeFn("mw-validation-probe", { action: "storage", asOwner: "b" });
record("storage_b", { payload: storageB.payload });

const fnList = await runTcb(["fn", "list", "--json"]);
record("fn_list", { code: fnList.code, json: fnList.json, stdout: fnList.stdout });

const usage = await runTcb(["env", "usage", "--yes"]);
record("usage", { code: usage.code, stdout: usage.stdout });

out.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw04-fixup.json"), redact(out));
console.log(JSON.stringify(redact({ acl: aclGet.json?.data?.acl, publicChecks }), null, 2));
