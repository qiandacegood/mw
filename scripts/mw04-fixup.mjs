import { join } from "node:path";
import { authorizedEnvId, invokeFn, projectRoot, redact, runTcb, writeJson } from "./mw04-lib.mjs";

const root = projectRoot();
const tmp = join(root, "tmp", "mw04");
const envId = authorizedEnvId();
const out = { startedAt: new Date().toISOString(), steps: [] };

function record(name, value) {
  out.steps.push({ name, ...value });
  writeJson(join(tmp, "mw04-fixup.json"), redact(out));
}

const acl = await runTcb(["storage", "rules", "update", "--acl", "ADMINONLY", "--json"]);
record("acl_update", { code: acl.code, json: acl.json, stdout: acl.stdout, stderr: acl.stderr });

const aclGet = await runTcb(["storage", "rules", "get", "--json"]);
record("acl_get", { code: aclGet.code, json: aclGet.json, stdout: aclGet.stdout, stderr: aclGet.stderr });

const publicUrl = `https://6d77-${envId}-1252343873.tcb.qcloud.la/mw-test/validation/private-sample.txt`;
let publicGet = {};
try {
  const response = await fetch(publicUrl, { redirect: "manual" });
  publicGet = { http: response.status, redirected: response.redirected };
} catch (error) {
  publicGet = { error: error && error.message };
}
record("public_get_after_acl", publicGet);

const cosUrl = `https://6d77-${envId}-1252343873.cos.ap-shanghai.myqcloud.com/mw-test/validation/private-sample.txt`;
let cosGet = {};
try {
  const response = await fetch(cosUrl, { redirect: "manual" });
  cosGet = { http: response.status, redirected: response.redirected };
} catch (error) {
  cosGet = { error: error && error.message };
}
record("cos_get_after_acl", cosGet);

const storageB = await invokeFn("mw-validation-probe", { action: "storage", asOwner: "b" });
record("storage_b", { payload: storageB.payload });

const fnList = await runTcb(["fn", "list", "--json"]);
record("fn_list", { code: fnList.code, json: fnList.json, stdout: fnList.stdout });

const detail22 = await runTcb(["fn", "detail", "mw-validation-runtime22", "--json"]);
record("fn_detail_22", { code: detail22.code, json: detail22.json, stdout: detail22.stdout });

const detailProbe = await runTcb(["fn", "detail", "mw-validation-probe", "--json"]);
record("fn_detail_probe", { code: detailProbe.code, json: detailProbe.json, stdout: detailProbe.stdout });

const usage = await runTcb(["env", "usage", "--yes"]);
record("usage", { code: usage.code, stdout: usage.stdout });

out.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw04-fixup.json"), redact(out));
console.log(JSON.stringify(redact({ acl: aclGet.stdout || aclGet.json, publicGet, cosGet }), null, 2));
