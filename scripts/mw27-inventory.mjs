import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listedCollectionNames } from "./mw04-assert.mjs";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseFunctionEnv } from "./mw06-lib.mjs";
import { MW05_OFFICIAL_FUNCTIONS } from "./mw05-lib.mjs";
import {
  extractFirstDoc,
  extractIndexNames,
  listCollectionsCommand,
  listIndexCommand,
  MW27_APP_CONFIG_KEYS,
  MW27_SPECIFIED_INDEXES,
  MW27_STORAGE_PREFIXES,
  mw27Tmp,
  nosqlFindCommand,
  redactMw27
} from "./mw27-lib.mjs";

const tmp = mw27Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW27-A", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw27-inventory-evidence.json"), redactMw27(evidence));
}

function shaOf(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function describeAcl(envId, collection) {
  const result = await runTcb(
    [
      "api",
      "tcb",
      "DescribeDatabaseACL",
      "--api-version",
      "2018-06-08",
      "--json",
      "--body",
      JSON.stringify({ EnvId: envId, CollectionName: collection })
    ],
    { timeoutMs: 60000 }
  );
  const body = result.json?.Response || result.json?.data || result.json || {};
  return body.AclTag || body.aclTag || "";
}

const ready = await assertMwTestReady();
if (ready.enableOverrun === true) throw new Error("EnableOverrun must stay false");
const envId = authorizedEnvId();
record("hard_check", {
  ok: ready.ok,
  enableOverrun: ready.enableOverrun,
  otherEnvCount: ready.otherEnvCount,
  envTouched: "mw-test-only"
});

const listed = await runTcb(["db", "nosql", "execute", "--command", JSON.stringify([listCollectionsCommand()]), "--json"]);
const collectionNames = listedCollectionNames(listed.json);
record("collections", { count: collectionNames.length, isolatedPresent: collectionNames.filter((name) => name.startsWith("mw27_rst_")) });

const indexRows = [];
for (const spec of MW27_SPECIFIED_INDEXES) {
  const listedIdx = await runTcb(["db", "nosql", "execute", "--command", JSON.stringify([listIndexCommand(spec.collection)]), "--json"]);
  const names = extractIndexNames(listedIdx);
  indexRows.push({ collection: spec.collection, name: spec.name, present: names.includes(spec.name) });
}
record("specified_indexes", { missing: indexRows.filter((row) => !row.present).map((row) => row.name), checked: indexRows.length });

const aclTargets = ["paper_answers", "attempts", "orders", "vip_grants", "jobs", "categories", "members"];
const aclRows = [];
for (const collection of aclTargets) {
  const acl = await describeAcl(envId, collection);
  aclRows.push({ collection, acl });
}
record("acl", { rows: aclRows, allAdminOnly: aclRows.every((row) => row.acl === "ADMINONLY") });

const storage = [];
for (const prefix of MW27_STORAGE_PREFIXES) {
  const listedStore = await runTcb(["storage", "list", "--cloudpath", `cloud://${prefix}`, "--json"], { timeoutMs: 60000 });
  storage.push({
    prefix,
    code: listedStore.code,
    ok: listedStore.code === 0,
    note: listedStore.code === 0 ? "listed" : "LIST_UNAVAILABLE"
  });
}
record("storage_prefixes", { rows: storage, secretExported: false });

const runtime = shaOf(join(projectRoot(), "cloudfunctions", "_official", "runtime.cjs"));
record("runtime_sha256", { prefix: runtime.slice(0, 12) });

const functionHashes = {};
for (const name of MW05_OFFICIAL_FUNCTIONS) {
  const detail = await runTcb(["fn", "detail", name, "--json"]);
  const env = parseFunctionEnv(detail.json) || {};
  functionHashes[name] = {
    present: detail.code === 0,
    hasJobsToken: Object.prototype.hasOwnProperty.call(env, "MW_JOBS_INVOKE_TOKEN"),
    sandbox: String(env.VIRTUAL_PAY_ENV || "") === "1",
    liveKey: Object.prototype.hasOwnProperty.call(env, "VIRTUAL_PAY_APP_KEY_LIVE")
  };
}
record("functions", functionHashes);

const appConfig = {};
for (const key of MW27_APP_CONFIG_KEYS) {
  const found = await runTcb(["db", "nosql", "execute", "--command", JSON.stringify([nosqlFindCommand("app_config", { _id: key })]), "--json"]);
  const doc = extractFirstDoc(found);
  appConfig[key] = {
    present: Boolean(doc),
    revision: doc?.revision ?? null,
    configVersion: doc?.configVersion ?? doc?.version ?? null,
    updatedAt: typeof doc?.updatedAt === "string" ? doc.updatedAt : null
  };
}
record("app_config_versions", appConfig);

const maintenance = extractFirstDoc(
  await runTcb(["db", "nosql", "execute", "--command", JSON.stringify([nosqlFindCommand("app_config", { _id: "maintenance" })]), "--json"])
);
record("maintenance", {
  present: Boolean(maintenance),
  contentWrites: maintenance?.contentWrites?.enabled,
  attemptStart: maintenance?.attemptStart?.enabled,
  attemptSubmit: maintenance?.attemptSubmit?.enabled,
  purchaseCreate: maintenance?.purchaseCreate?.enabled,
  entitlementApply: maintenance?.entitlementApply?.enabled,
  paymentNotifyMustStayOpen: true
});

const summary = redactMw27({
  ok: ready.enableOverrun !== true && ready.otherEnvCount >= 0,
  leftoverClaimedZero: false,
  enableOverrun: ready.enableOverrun,
  otherEnvCount: ready.otherEnvCount,
  collectionCount: collectionNames.length,
  missingIndexes: indexRows.filter((row) => !row.present).map((row) => row.name),
  aclAdminOnly: aclRows.every((row) => row.acl === "ADMINONLY"),
  runtimeSha256Prefix: runtime.slice(0, 12),
  restoreNotEqual: ["cloud-storage", "function-code", "deploy-config", "payment-channel"],
  secretsInPack: false,
  note: "只读清点。秘密不进普通资料包。回档≠文件/代码/渠道。E 前不得 leftover=0。"
});
evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw27-inventory-evidence.json"), redactMw27({ ...evidence, summary }));
writeJson(join(projectRoot(), "configs", "mw27-state.json"), redactMw27({
  inventoryAt: evidence.finishedAt,
  runtimeSha256Prefix: runtime.slice(0, 12),
  collectionCount: collectionNames.length,
  missingIndexes: summary.missingIndexes,
  enableOverrun: ready.enableOverrun
}));
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(1);
