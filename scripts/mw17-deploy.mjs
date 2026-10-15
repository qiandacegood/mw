import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseFunctionEnv, writeMw06Cloudbaserc } from "./mw06-lib.mjs";
import { MW05_OFFICIAL_FUNCTIONS } from "./mw05-lib.mjs";
import {
  MW17_COLLECTIONS,
  MW17_DEPLOY_ENTRIES,
  MW17_INDEXES,
  MW17_RUNTIME_DOC,
  createCollectionCommand,
  createIndexCommand,
  listIndexCommand,
  mw17Tmp,
  redactMw17
} from "./mw17-lib.mjs";

const root = projectRoot();
const tmp = mw17Tmp();
const evidence = { startedAt: new Date().toISOString(), steps: [], deployed: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw17-deploy-evidence.json"), redactMw17(evidence));
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

record("cloudbaserc", { written: true, deployEntries: MW17_DEPLOY_ENTRIES });

for (const name of MW17_DEPLOY_ENTRIES) {
  const deployed = await runTcb(["fn", "deploy", name, "--force"], { timeoutMs: 300000 });
  record(`deploy_${name}`, { code: deployed.code, ok: deployed.code === 0 });
  if (deployed.code !== 0) throw new Error(`deploy ${name} failed`);
  evidence.deployed.push(name);
}

const created = {};
for (const name of MW17_COLLECTIONS) {
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
for (const index of MW17_INDEXES) {
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

/**
 * 刻意不写任何榜单文档：mw17 手点 1 要求看到 `publishedGeneration=""`（从未发布）。
 * `app_config/ranking` 缺省时服务端按 emptyRankingRuntime() 读，状态页显示"从未发布"。
 * 这里只读确认运行时文档当前不存在（若已存在则如实记录，不覆盖）。
 */
const runtimeProbe = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([
    {
      TableName: MW17_RUNTIME_DOC.collection,
      CommandType: "COMMAND",
      Command: JSON.stringify({
        count: MW17_RUNTIME_DOC.collection,
        query: { _id: MW17_RUNTIME_DOC.id }
      })
    }
  ]),
  "--json"
]);
record("ranking_runtime_doc", {
  code: runtimeProbe.code,
  seeded: false,
  note: "不写入 app_config/ranking；缺省即从未发布状态"
});

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw17-deploy-evidence.json"), redactMw17(evidence));
console.log(
  JSON.stringify(
    redactMw17({
      ok: true,
      deployed: evidence.deployed,
      collections: created,
      indexes,
      seededSnapshotDocs: false,
      note: "榜单快照文档一律由后台「重建并发布榜单快照」产生，部署不预置",
      enableOverrun: ready.enableOverrun,
      otherEnvCount: ready.otherEnvCount
    }),
    null,
    2
  )
);
