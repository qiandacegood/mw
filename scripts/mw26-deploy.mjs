import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseFunctionEnv, writeMw06Cloudbaserc } from "./mw06-lib.mjs";
import { MW05_OFFICIAL_FUNCTIONS } from "./mw05-lib.mjs";
import { MW26_DEPLOY_ENTRIES, mergeSandboxVirtualPayEnv26, mw26Tmp, redactMw26 } from "./mw26-lib.mjs";

const root = projectRoot();
const tmp = mw26Tmp();
const evidence = { startedAt: new Date().toISOString(), steps: [], deployed: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw26-deploy-evidence.json"), redactMw26(evidence));
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
const merged = mergeSandboxVirtualPayEnv26(existingEnvs);
writeMw06Cloudbaserc(merged.envs);
record("cloudbaserc", {
  written: true,
  deployEntries: MW26_DEPLOY_ENTRIES,
  sandbox: merged.sandbox,
  mergedPayEnvKeys: merged.mergedKeys
});

for (const name of MW26_DEPLOY_ENTRIES) {
  const deployed = await runTcb(["fn", "deploy", name, "--force"], { timeoutMs: 300000 });
  record(`deploy_${name}`, { code: deployed.code, ok: deployed.code === 0 });
  if (deployed.code !== 0) throw new Error(`deploy ${name} failed`);
  evidence.deployed.push(name);
}

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw26-deploy-evidence.json"), redactMw26(evidence));
console.log(
  JSON.stringify(
    redactMw26({
      ok: true,
      deployed: evidence.deployed,
      enableOverrun: ready.enableOverrun,
      otherEnvCount: ready.otherEnvCount,
      note: "未新建集合。ranking 分页与 ops.stats 截断标记随 mw-admin / mw-public / mw-jobs 发布。"
    }),
    null,
    2
  )
);
