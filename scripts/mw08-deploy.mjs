import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { createCollectionCommand, parseFunctionEnv, writeMw06Cloudbaserc } from "./mw06-lib.mjs";
import { MW05_OFFICIAL_FUNCTIONS } from "./mw05-lib.mjs";
import {
  defaultPoliciesDoc,
  MW08_COLLECTIONS,
  MW08_DEPLOY_ENTRIES,
  mw08Tmp,
  POLICIES_DOC_ID,
  redactMw08
} from "./mw08-lib.mjs";

const root = projectRoot();
const tmp = mw08Tmp();
const evidence = { startedAt: new Date().toISOString(), steps: [], deployed: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw08-deploy-evidence.json"), redactMw08(evidence));
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
const deployEntries = process.argv.includes("--member-only") ? ["mw-member"] : MW08_DEPLOY_ENTRIES;
record("cloudbaserc", { written: true, deployEntries });

for (const name of deployEntries) {
  const deployed = await runTcb(["fn", "deploy", name, "--force"], { timeoutMs: 300000 });
  record(`deploy_${name}`, { code: deployed.code, ok: deployed.code === 0 });
  if (deployed.code !== 0) {
    throw new Error(`deploy ${name} failed`);
  }
  evidence.deployed.push(name);
}

if (process.argv.includes("--member-only")) {
  evidence.finishedAt = new Date().toISOString();
  writeJson(join(tmp, "mw08-deploy-evidence.json"), redactMw08(evidence));
  console.log(
    JSON.stringify(
      redactMw08({
        ok: true,
        deployed: evidence.deployed,
        memberOnly: true,
        enableOverrun: ready.enableOverrun,
        otherEnvCount: ready.otherEnvCount
      }),
      null,
      2
    )
  );
  process.exit(0);
}

const created = {};
for (const name of MW08_COLLECTIONS) {
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
  if (!created[name].ok) {
    throw new Error(`create collection ${name} failed`);
  }
}

const now = new Date().toISOString();
const policies = defaultPoliciesDoc(new Date(now));
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
            q: { _id: POLICIES_DOC_ID },
            u: { $setOnInsert: policies },
            upsert: true
          }
        ]
      })
    }
  ]),
  "--json"
]);
record("seed_policies", { code: seed.code, ok: seed.code === 0, id: POLICIES_DOC_ID });

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw08-deploy-evidence.json"), redactMw08(evidence));
console.log(
  JSON.stringify(
    redactMw08({
      ok: true,
      deployed: evidence.deployed,
      collections: created,
      enableOverrun: ready.enableOverrun,
      otherEnvCount: ready.otherEnvCount
    }),
    null,
    2
  )
);
