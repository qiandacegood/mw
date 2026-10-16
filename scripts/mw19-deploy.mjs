import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseFunctionEnv, writeMw06Cloudbaserc } from "./mw06-lib.mjs";
import { MW05_OFFICIAL_FUNCTIONS } from "./mw05-lib.mjs";
import {
  MW19_COLLECTIONS,
  MW19_DEPLOY_ENTRIES,
  MW19_INDEXES,
  createCollectionCommand,
  createIndexCommand,
  listIndexCommand,
  mw19Tmp,
  redactMw19
} from "./mw19-lib.mjs";

const root = projectRoot();
const tmp = mw19Tmp();
const evidence = { startedAt: new Date().toISOString(), steps: [], deployed: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw19-deploy-evidence.json"), redactMw19(evidence));
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
    keys: Object.keys(existingEnvs[name] || {}).filter((key) => key !== "MW_JOBS_INVOKE_TOKEN")
  });
}
writeMw06Cloudbaserc(existingEnvs);
record("cloudbaserc", { written: true, deployEntries: MW19_DEPLOY_ENTRIES });

for (const name of MW19_DEPLOY_ENTRIES) {
  const deployed = await runTcb(["fn", "deploy", name, "--force"], { timeoutMs: 300000 });
  record(`deploy_${name}`, { code: deployed.code, ok: deployed.code === 0 });
  if (deployed.code !== 0) throw new Error(`deploy ${name} failed`);
  evidence.deployed.push(name);
}

const created = {};
for (const name of MW19_COLLECTIONS) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([createCollectionCommand(name)]),
    "--json"
  ]);
  const text = `${result.stdout || ""}${result.stderr || ""}`;
  created[name] = {
    code: result.code,
    existed: /already exists|exists|NamespaceExists|already exist/i.test(text),
    ok: result.code === 0 || /already exists|exists|NamespaceExists/i.test(text)
  };
  record(`create_${name}`, created[name]);
  if (!created[name].ok) throw new Error(`create collection ${name} failed`);
}

const indexes = {};
for (const index of MW19_INDEXES) {
  const createdIndex = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([createIndexCommand(index)]),
    "--json"
  ]);
  const listed = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([listIndexCommand(index.collection)]),
    "--json"
  ]);
  indexes[index.name] = {
    createCode: createdIndex.code,
    listCode: listed.code,
    listed: JSON.stringify(listed.json || {}).includes(index.name),
    ok: createdIndex.code === 0 || listed.code === 0
  };
  record(`index_${index.name}`, indexes[index.name]);
}

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw19-deploy-evidence.json"), redactMw19(evidence));
console.log(
  JSON.stringify(
    redactMw19({
      ok: true,
      deployed: evidence.deployed,
      collections: created,
      indexes,
      enableOverrun: ready.enableOverrun,
      otherEnvCount: ready.otherEnvCount,
      note: "不预置纠错任务；不创建 orders/vip_*"
    }),
    null,
    2
  )
);
