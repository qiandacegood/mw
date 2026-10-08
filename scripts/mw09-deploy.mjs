import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseFunctionEnv, writeMw06Cloudbaserc } from "./mw06-lib.mjs";
import { MW05_OFFICIAL_FUNCTIONS } from "./mw05-lib.mjs";
import {
  CATALOG_DOC_ID,
  CATEGORY_INDEX,
  INITIAL_ROOT_SEEDS,
  MW09_COLLECTIONS,
  MW09_DEPLOY_ENTRIES,
  createCollectionCommand,
  createIndexCommand,
  listIndexCommand,
  mw09Tmp,
  redactMw09
} from "./mw09-lib.mjs";

const root = projectRoot();
const tmp = mw09Tmp();
const evidence = { startedAt: new Date().toISOString(), steps: [], deployed: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw09-deploy-evidence.json"), redactMw09(evidence));
}

const ready = await assertMwTestReady();
record("hard_check", { ok: ready.ok, enableOverrun: ready.enableOverrun, otherEnvCount: ready.otherEnvCount });
authorizedEnvId();

const shared = spawnSync(process.execPath, [join(root, "scripts", "ensure-shared-js.mjs")], {
  cwd: root,
  encoding: "utf8"
});
if (shared.status !== 0) {
  throw new Error("shared emit failed");
}
const emit = spawnSync(process.execPath, [join(root, "scripts", "mw05-emit-runtime.mjs")], {
  cwd: root,
  encoding: "utf8"
});
if (emit.status !== 0) {
  throw new Error("runtime emit failed");
}
record("emit_runtime", { ok: true });

const { seedCategoryId, categoryNameId } = await import("../packages/shared/dist/category.js");

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
const deployEntries = process.argv.includes("--admin-only")
  ? ["mw-admin"]
  : process.argv.includes("--public-only")
    ? ["mw-public"]
    : MW09_DEPLOY_ENTRIES;
record("cloudbaserc", { written: true, deployEntries });

for (const name of deployEntries) {
  const deployed = await runTcb(["fn", "deploy", name, "--force"], { timeoutMs: 300000 });
  record(`deploy_${name}`, { code: deployed.code, ok: deployed.code === 0 });
  if (deployed.code !== 0) {
    throw new Error(`deploy ${name} failed`);
  }
  evidence.deployed.push(name);
}

const created = {};
for (const name of MW09_COLLECTIONS) {
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

const createdIndex = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([createIndexCommand(CATEGORY_INDEX)]),
  "--json"
]);
const listed = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([listIndexCommand(CATEGORY_INDEX.collection)]),
  "--json"
]);
record("index_categories", {
  createCode: createdIndex.code,
  listCode: listed.code,
  keys: CATEGORY_INDEX.keys
});

const now = new Date().toISOString();
const catalogSeed = await runTcb([
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
            q: { _id: CATALOG_DOC_ID },
            u: {
              $setOnInsert: {
                _id: CATALOG_DOC_ID,
                kind: "catalog",
                treeVersion: 1,
                categoryMetricsGeneration: 0,
                seeded: true,
                seededAt: now,
                schemaVersion: 1,
                createdAt: now,
                updatedAt: now
              }
            },
            upsert: true
          }
        ]
      })
    }
  ]),
  "--json"
]);
record("seed_catalog", { code: catalogSeed.code, ok: catalogSeed.code === 0 });

const seeded = [];
for (const [index, seed] of INITIAL_ROOT_SEEDS.entries()) {
  const categoryId = seedCategoryId(seed.seedKey);
  const nameId = categoryNameId(null, seed.name);
  const categoryDoc = {
    _id: categoryId,
    categoryId,
    parentId: null,
    depth: 1,
    ancestorIds: [],
    name: seed.name,
    normalizedName: seed.name,
    sort: (index + 1) * 10,
    enabled: true,
    deletedAt: null,
    revision: 1,
    treeVersion: 1,
    seedKey: seed.seedKey,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now
  };
  const cat = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: "categories",
        CommandType: "UPDATE",
        Command: JSON.stringify({
          update: "categories",
          updates: [{ q: { _id: categoryId }, u: { $setOnInsert: categoryDoc }, upsert: true }]
        })
      }
    ]),
    "--json"
  ]);
  const name = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: "category_names",
        CommandType: "UPDATE",
        Command: JSON.stringify({
          update: "category_names",
          updates: [
            {
              q: { _id: nameId },
              u: {
                $setOnInsert: {
                  _id: nameId,
                  nameId,
                  parentId: "",
                  normalizedName: seed.name,
                  categoryId
                }
              },
              upsert: true
            }
          ]
        })
      }
    ]),
    "--json"
  ]);
  seeded.push({ seedKey: seed.seedKey, categoryOk: cat.code === 0, nameOk: name.code === 0 });
}
record("seed_roots", { count: seeded.length, items: seeded.map((item) => item.seedKey) });

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw09-deploy-evidence.json"), redactMw09(evidence));
console.log(
  JSON.stringify(
    redactMw09({
      ok: true,
      deployed: evidence.deployed,
      collections: created,
      seedCount: seeded.length,
      enableOverrun: ready.enableOverrun,
      otherEnvCount: ready.otherEnvCount
    }),
    null,
    2
  )
);
