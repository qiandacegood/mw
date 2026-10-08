import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import {
  createCollectionCommand,
  createIndexCommand,
  defaultMaintenanceDoc,
  listIndexCommand,
  MW06_COLLECTIONS,
  MW06_INDEXES,
  mw06Tmp,
  redactMw06,
  writeMw06Cloudbaserc
} from "./mw06-lib.mjs";
import { MW05_OFFICIAL_FUNCTIONS } from "./mw05-lib.mjs";

const root = projectRoot();
const tmp = mw06Tmp();
const evidence = { startedAt: new Date().toISOString(), steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw06-deploy-evidence.json"), redactMw06(evidence));
}

const ready = await assertMwTestReady();
record("hard_check", { ok: ready.ok, enableOverrun: ready.enableOverrun, otherEnvCount: ready.otherEnvCount });
authorizedEnvId();

const emit = spawnSync(process.execPath, [join(root, "scripts", "mw05-emit-runtime.mjs")], {
  cwd: root,
  encoding: "utf8"
});
if (emit.status !== 0) {
  throw new Error("runtime emit failed");
}
record("emit_runtime", { ok: true });

writeMw06Cloudbaserc();
record("cloudbaserc", { written: true, jobsTokenInGit: false });

for (const name of MW05_OFFICIAL_FUNCTIONS) {
  const deployed = await runTcb(["fn", "deploy", name, "--force"], { timeoutMs: 300000 });
  record(`deploy_${name}`, { code: deployed.code, ok: deployed.code === 0 });
  if (deployed.code !== 0) {
    throw new Error(`deploy ${name} failed`);
  }
}

const created = {};
for (const name of MW06_COLLECTIONS) {
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
}

const indexes = {};
for (const index of MW06_INDEXES) {
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
    collection: index.collection,
    createCode: createdIndex.code,
    listCode: listed.code,
    listed: Boolean(listed.json),
    keys: index.keys
  };
  record(`index_${index.name}`, indexes[index.name]);
}

const now = new Date().toISOString();
const maintenance = defaultMaintenanceDoc(new Date(now));
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
        updates: [
          {
            q: { _id: "maintenance" },
            u: { $set: maintenance, $setOnInsert: { createdAt: now } },
            upsert: true
          }
        ]
      })
    }
  ]),
  "--json"
]);
record("seed_maintenance", { code: seed.code, ok: seed.code === 0 });

const denyJobs = await invokeFn("mw-jobs", { fromClient: true, Type: "Timer", requestId: "req_mw06_cli_jobs" });
record("invoke_jobs_forged_timer", {
  code: denyJobs.code,
  reason: denyJobs.payload?.reason || denyJobs.payload?.error?.details?.reason
});

const usage = await runTcb(["env", "list", "--json"]);
const rows = usage.json?.data || [];
const self = rows.find((item) => item.EnvId === authorizedEnvId());
record("overrun_recheck", { enableOverrun: self?.EnableOverrun === false || self?.EnableOverrun === "false" });

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw06-deploy-evidence.json"), redactMw06(evidence));
writeJson(
  join(root, "configs", "mw06-state.json"),
  redactMw06({
    collections: created,
    indexes,
    maintenanceSeeded: seed.code === 0,
    enableOverrun: false,
    jobsTimerDeployed: false
  })
);
console.log(JSON.stringify(redactMw06({ ok: true, steps: evidence.steps.length, collections: Object.keys(created), indexes: Object.keys(indexes) }), null, 2));
