import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseFunctionEnv, writeMw06Cloudbaserc } from "./mw06-lib.mjs";
import { MW05_OFFICIAL_FUNCTIONS } from "./mw05-lib.mjs";
import {
  GROWTH_CONFIG_DOC_ID,
  MEDAL_GRANT_INDEXES,
  MW16_COLLECTIONS,
  MW16_DEPLOY_ENTRIES,
  createCollectionCommand,
  createIndexCommand,
  growthSeedDoc,
  listIndexCommand,
  mw16Tmp,
  redactMw16
} from "./mw16-lib.mjs";

const root = projectRoot();
const tmp = mw16Tmp();
const evidence = { startedAt: new Date().toISOString(), steps: [], deployed: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw16-deploy-evidence.json"), redactMw16(evidence));
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

record("cloudbaserc", { written: true, deployEntries: MW16_DEPLOY_ENTRIES });

for (const name of MW16_DEPLOY_ENTRIES) {
  const deployed = await runTcb(["fn", "deploy", name, "--force"], { timeoutMs: 300000 });
  record(`deploy_${name}`, { code: deployed.code, ok: deployed.code === 0 });
  if (deployed.code !== 0) throw new Error(`deploy ${name} failed`);
  evidence.deployed.push(name);
}

const created = {};
for (const name of MW16_COLLECTIONS) {
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
for (const index of MEDAL_GRANT_INDEXES) {
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
  record(`index_${index.name}`, { createCode: createdIndex.code, listCode: listed.code, keys: index.keys });
}

// 种子当前生效门槛：$setOnInsert，不覆盖后台已发布的配置版本。
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
        updates: [{ q: { _id: GROWTH_CONFIG_DOC_ID }, u: { $setOnInsert: growthSeedDoc(new Date()) }, upsert: true }]
      })
    }
  ]),
  "--json"
]);
record("seed_growth_config", { code: seed.code, ok: seed.code === 0, id: GROWTH_CONFIG_DOC_ID });

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw16-deploy-evidence.json"), redactMw16(evidence));
console.log(
  JSON.stringify(
    redactMw16({
      ok: true,
      deployed: evidence.deployed,
      collections: created,
      indexes,
      seededGrowthConfig: seed.code === 0,
      enableOverrun: ready.enableOverrun,
      otherEnvCount: ready.otherEnvCount
    }),
    null,
    2
  )
);
