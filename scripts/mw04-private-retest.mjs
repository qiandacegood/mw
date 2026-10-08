import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { authorizedEnvId, invokeFn, projectRoot, redact, runTcb, writeJson } from "./mw04-lib.mjs";

const root = projectRoot();
const tmp = join(root, "tmp", "mw04");
const envId = authorizedEnvId();
const out = { startedAt: new Date().toISOString(), steps: [] };

function record(name, value) {
  out.steps.push({ name, ...value });
  writeJson(join(tmp, "mw04-private-retest.json"), redact(out));
}

const local = join(tmp, "mw_validation_after_acl.txt");
writeFileSync(local, "mw_validation_private_after_adminonly");
const upload = await runTcb(
  ["storage", "upload", local, "mw-test/validation/after-acl.txt", "--json"],
  { timeoutMs: 60000 }
);
record("upload_after_acl", { code: upload.code, json: upload.json, stdout: upload.stdout, stderr: upload.stderr });

async function probe(name, url) {
  try {
    const response = await fetch(url, { redirect: "manual" });
    return { name, http: response.status, redirected: response.redirected };
  } catch (error) {
    return { name, error: error && error.message };
  }
}

const cdnOld = await probe(
  "cdn_old",
  `https://6d77-${envId}-1252343873.tcb.qcloud.la/mw-test/validation/private-sample.txt`
);
const cdnNew = await probe(
  "cdn_new",
  `https://6d77-${envId}-1252343873.tcb.qcloud.la/mw-test/validation/after-acl.txt`
);
const cosNew = await probe(
  "cos_new",
  `https://6d77-${envId}-1252343873.cos.ap-shanghai.myqcloud.com/mw-test/validation/after-acl.txt`
);
record("url_probes", { cdnOld, cdnNew, cosNew });

const txHeavy = await invokeFn("mw-validation-probe", { action: "tx_ops_extra" }, { timeoutMs: 60000 }).catch(() => null);
if (!txHeavy || !txHeavy.payload) {
  const heavy = await invokeFn(
    "mw-validation-probe",
    { action: "tx_ops" },
    { timeoutMs: 180000 }
  );
  record("tx_ops_repeat", { note: "101 already succeeded; no extra action", code: heavy.code });
}

const uploadEntry49 = await invokeFn("mw-validation-upload", {
  action: "upload",
  uploadTicket: "ticket_fict",
  byteLength: 5138022
});
const uploadEntry51 = await invokeFn("mw-validation-upload", {
  action: "upload",
  uploadTicket: "ticket_fict",
  byteLength: 5347737
});
record("upload_entry", { size49: uploadEntry49.payload, size51: uploadEntry51.payload });

out.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw04-private-retest.json"), redact(out));
console.log(JSON.stringify(redact({ cdnOld, cdnNew, cosNew, uploadEntry49: uploadEntry49.payload, uploadEntry51: uploadEntry51.payload }), null, 2));
