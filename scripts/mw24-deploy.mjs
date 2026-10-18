import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseFunctionEnv, writeMw06Cloudbaserc } from "./mw06-lib.mjs";
import { MW05_OFFICIAL_FUNCTIONS } from "./mw05-lib.mjs";
import {
  MW24_DEPLOY_ENTRIES,
  POLICIES_DOC_ID,
  mergeSandboxVirtualPayEnv24,
  mw24Tmp,
  policiesUpdateDoc,
  redactMw24
} from "./mw24-lib.mjs";

const root = projectRoot();
const tmp = mw24Tmp();
const evidence = { startedAt: new Date().toISOString(), steps: [], deployed: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw24-deploy-evidence.json"), redactMw24(evidence));
}

const ready = await assertMwTestReady();
if (ready.enableOverrun === true) throw new Error("EnableOverrun must stay false");
record("hard_check", { ok: ready.ok, enableOverrun: ready.enableOverrun, otherEnvCount: ready.otherEnvCount });
authorizedEnvId();

const shared = spawnSync(process.execPath, [join(root, "scripts", "ensure-shared-js.mjs")], { cwd: root, encoding: "utf8" });
if (shared.status !== 0) throw new Error("shared emit failed");
const emit = spawnSync(process.execPath, [join(root, "scripts", "mw05-emit-runtime.mjs")], { cwd: root, encoding: "utf8" });
if (emit.status !== 0) throw new Error("runtime emit failed");
record("emit_runtime", { ok: true });

const existingEnvs = {};
for (const name of MW05_OFFICIAL_FUNCTIONS) {
  const detail = await runTcb(["fn", "detail", name, "--json"]);
  existingEnvs[name] = parseFunctionEnv(detail.json);
  record(`env_snapshot_${name}`, {
    ok: detail.code === 0,
    keys: Object.keys(existingEnvs[name] || {}).filter((key) => !/KEY|TOKEN|SECRET|AES/i.test(key))
  });
}
const merged = mergeSandboxVirtualPayEnv24(existingEnvs);
writeMw06Cloudbaserc(merged.envs);
record("cloudbaserc", {
  written: true,
  deployEntries: MW24_DEPLOY_ENTRIES,
  sandbox: merged.sandbox,
  mergedPayEnvKeys: merged.mergedKeys
});

for (const name of MW24_DEPLOY_ENTRIES) {
  const deployed = await runTcb(["fn", "deploy", name, "--force"], { timeoutMs: 300000 });
  record(`deploy_${name}`, { code: deployed.code, ok: deployed.code === 0 });
  if (deployed.code !== 0) throw new Error(`deploy ${name} failed`);
  evidence.deployed.push(name);
}

const policies = policiesUpdateDoc(new Date());
if (Object.prototype.hasOwnProperty.call(policies, "_id")) {
  throw new Error("policies update payload must not include _id");
}
const seed = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([
    {
      TableName: "app_config",
      CommandType: "UPDATE",
      Command: JSON.stringify({
        update: "app_config",
        updates: [{ q: { _id: POLICIES_DOC_ID }, u: { $set: policies }, upsert: true }]
      })
    }
  ]),
  "--json"
]);
record("update_policies", { code: seed.code, ok: seed.code === 0, id: POLICIES_DOC_ID, wroteIdField: false });
if (seed.code !== 0) throw new Error("update app_config.policies failed");

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw24-deploy-evidence.json"), redactMw24(evidence));
console.log(
  JSON.stringify(
    redactMw24({
      ok: true,
      deployed: evidence.deployed,
      policiesUpdated: true,
      enableOverrun: ready.enableOverrun,
      otherEnvCount: ready.otherEnvCount
    }),
    null,
    2
  )
);
