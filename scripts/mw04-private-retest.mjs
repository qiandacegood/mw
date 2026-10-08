import { join } from "node:path";
import { writeFileSync } from "node:fs";
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
  writeJson(join(tmp, "mw04-private-retest.json"), redact(out));
}

const ready = await assertMwTestReady();
record("hard_check", ready);

const local = join(tmp, "mw_validation_after_acl.txt");
writeFileSync(local, "mw_validation_private_after_adminonly");
const upload = await runTcb(
  ["storage", "upload", local, "mw-test/validation/after-acl.txt", "--json"],
  { timeoutMs: 60000 }
);
record("upload_after_acl", { code: upload.code, json: upload.json, stdout: upload.stdout, stderr: upload.stderr });

async function probe(url) {
  try {
    const response = await fetch(url, { redirect: "manual" });
    return { http: response.status, redirected: response.redirected };
  } catch (error) {
    return { error: { message: error && error.message } };
  }
}

const cdnNew = [];
for (const url of publicObjectUrls(ready.storageHosts, "mw-test/validation/after-acl.txt")) {
  cdnNew.push(await probe(url));
}
record("url_probes", { afterAcl: cdnNew, hostCount: ready.storageHosts.length });

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
console.log(JSON.stringify(redact({ afterAcl: cdnNew, hostCount: ready.storageHosts.length }), null, 2));
