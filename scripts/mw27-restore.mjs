import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listedCollectionNames } from "./mw04-assert.mjs";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import {
  extractFirstDoc,
  extractIndexNames,
  listCollectionsCommand,
  listIndexCommand,
  MW27_ISOLATED_RESTORE_COLLECTIONS,
  MW27_SPECIFIED_INDEXES,
  mw27Tmp,
  nosqlFindCommand,
  nosqlUpsertCommand,
  omitDocId,
  redactMw27
} from "./mw27-lib.mjs";

const root = projectRoot();
const tmp = mw27Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW27-B", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw27-restore-evidence.json"), redactMw27(evidence));
}

const ready = await assertMwTestReady();
if (ready.enableOverrun === true) throw new Error("EnableOverrun must stay false");
authorizedEnvId();
record("hard_check", { ok: ready.ok, enableOverrun: ready.enableOverrun, otherEnvCount: ready.otherEnvCount, envTouched: "mw-test-only" });

const shared = spawnSync(process.execPath, [join(root, "scripts", "ensure-shared-js.mjs")], { cwd: root, encoding: "utf8" });
if (shared.status !== 0) throw new Error("shared emit failed");
const restore = await import("../packages/shared/dist/mw27-restore.js");
const { seedCategoryIds } = await import("../packages/shared/dist/category.js");

const help = await runTcb(["-h"]);
const helpText = `${help.stdout || ""} ${help.stderr || ""}`;
const official = restore.mw27OfficialRestoreDecision({
  canRestoreToNewCollection: /restore.*new.?collection|回档.*新集合/i.test(helpText),
  wouldOverwriteExisting: true,
  otherEnvTouched: false
});
record("official_restore", {
  result: official.result,
  reason: official.reason,
  mode: official.mode,
  executedOverwrite: false,
  otherEnvTouched: false,
  note: "个人版不能安全回档到新集合。未调用覆盖现库的回档 API。"
});

const lastRecoverablePoint = existsSync(join(root, "configs", "mw27-state.json"))
  ? JSON.parse(readFileSync(join(root, "configs", "mw27-state.json"), "utf8")).inventoryAt
  : evidence.startedAt;

const seed = spawnSync(process.execPath, [join(root, "scripts", "mw27-seed.mjs")], { cwd: root, encoding: "utf8" });
if (seed.status !== 0) throw new Error(seed.stderr || seed.stdout || "mw27 seed failed");
record("fixture_sim", { ok: true, mode: official.mode });

const listed = await runTcb(["db", "nosql", "execute", "--command", JSON.stringify([listCollectionsCommand()]), "--json"]);
const collectionNames = listedCollectionNames(listed.json);
const isolatedPresent = MW27_ISOLATED_RESTORE_COLLECTIONS.filter((name) => collectionNames.includes(name));
const missingIsolated = MW27_ISOLATED_RESTORE_COLLECTIONS.filter((name) => !collectionNames.includes(name));

const indexRows = [];
for (const spec of MW27_SPECIFIED_INDEXES) {
  const listedIdx = await runTcb(["db", "nosql", "execute", "--command", JSON.stringify([listIndexCommand(spec.collection)]), "--json"]);
  const names = extractIndexNames(listedIdx);
  indexRows.push({ ...spec, present: names.includes(spec.name) });
}

let seedPresent = 0;
for (const id of seedCategoryIds()) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([{ TableName: "categories", CommandType: "COMMAND", Command: JSON.stringify({ count: "categories", query: { _id: id } }) }]),
    "--json"
  ]);
  seedPresent += parseNosqlCount(result) || 0;
}

const envId = authorizedEnvId();
async function describeAcl(collection) {
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
async function ensureAdminOnly(collection) {
  const before = await describeAcl(collection);
  if (before === "ADMINONLY") return before;
  await runTcb(
    [
      "api",
      "tcb",
      "ModifyDatabaseACL",
      "--api-version",
      "2018-06-08",
      "--json",
      "--body",
      JSON.stringify({ EnvId: envId, CollectionName: collection, AclTag: "ADMINONLY" })
    ],
    { timeoutMs: 60000 }
  );
  return describeAcl(collection);
}
const isolatedAcl = [];
for (const name of isolatedPresent) {
  isolatedAcl.push({ collection: name, acl: await ensureAdminOnly(name) });
}
const answersAcl = await describeAcl("paper_answers");
const ordersAcl = await describeAcl("orders");
const isolatedAclDenied = isolatedAcl.length === MW27_ISOLATED_RESTORE_COLLECTIONS.length && isolatedAcl.every((row) => row.acl === "ADMINONLY");

const closure = restore.mw27ClosureCheck({
  seedPresent,
  seedExpected: seedCategoryIds().length,
  missingCollections: missingIsolated,
  missingIndexes: indexRows.filter((row) => !row.present).map((row) => row.name),
  isolatedAclDenied,
  baselineAnswersAclDenied: answersAcl === "ADMINONLY"
});
record("closure", {
  result: closure.result,
  reason: closure.reason,
  seedPresent,
  isolatedPresent,
  missingIndexes: indexRows.filter((row) => !row.present).map((row) => row.name),
  isolatedAcl,
  answersAcl,
  ordersAcl,
  baselinePrivateLimitation: ordersAcl === "PRIVATE" ? "EXISTING_PRIVATE_NOT_CHANGED" : ordersAcl
});

const maintFound = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([nosqlFindCommand("app_config", { _id: "maintenance" })]),
  "--json"
]);
const originalMaint = extractFirstDoc(maintFound);
let maintenanceRestored = false;
let notifyDuringMaint = { result: "NOT_RUN", reason: "MAINT_DOC_MISSING" };
if (originalMaint && typeof originalMaint === "object") {
  const closed = omitDocId({
    contentWrites: { ...(originalMaint.contentWrites || {}), enabled: false, reason: restore.mw27MaintenanceDrillReason(), jobId: "mw27-restore" },
    attemptStart: { ...(originalMaint.attemptStart || {}), enabled: false, reason: restore.mw27MaintenanceDrillReason(), jobId: "mw27-restore" },
    attemptSubmit: { ...(originalMaint.attemptSubmit || {}), enabled: false, reason: restore.mw27MaintenanceDrillReason(), jobId: "mw27-restore" },
    purchaseCreate: { ...(originalMaint.purchaseCreate || {}), enabled: false, reason: restore.mw27MaintenanceDrillReason(), jobId: "mw27-restore" },
    entitlementApply: { ...(originalMaint.entitlementApply || {}), enabled: false, reason: restore.mw27MaintenanceDrillReason(), jobId: "mw27-restore" },
    updatedAt: new Date().toISOString()
  });
  try {
    const close = await runTcb(["db", "nosql", "execute", "--command", JSON.stringify([nosqlUpsertCommand("app_config", "maintenance", closed)]), "--json"]);
    record("maintenance_close", { ok: close.code === 0, reason: restore.mw27MaintenanceDrillReason() });
    const fakePay = await invokeFn("mw-pay-hook", { action: "notify", nonce: "mw27-maint", timestamp: "1", signature: "00" });
    notifyDuringMaint = {
      result: fakePay.payload?.vipGranted === false ? "PASS" : "FAIL",
      reason: fakePay.payload?.reason || fakePay.payload?.error?.code || "NOTIFY",
      vipGranted: fakePay.payload?.vipGranted
    };
    record("notify_during_maintenance", notifyDuringMaint);
  } finally {
    const restoreMaint = omitDocId({
      contentWrites: originalMaint.contentWrites,
      attemptStart: originalMaint.attemptStart,
      attemptSubmit: originalMaint.attemptSubmit,
      purchaseCreate: originalMaint.purchaseCreate,
      entitlementApply: originalMaint.entitlementApply,
      updatedAt: new Date().toISOString()
    });
    const opened = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([nosqlUpsertCommand("app_config", "maintenance", restoreMaint)]),
      "--json"
    ]);
    maintenanceRestored = opened.code === 0;
    record("maintenance_restore", { ok: maintenanceRestored });
  }
}

const finishedAt = new Date().toISOString();
const rtoMs = Date.parse(finishedAt) - Date.parse(evidence.startedAt);
const rpoMs = lastRecoverablePoint ? Date.parse(evidence.startedAt) - Date.parse(lastRecoverablePoint) : null;
const rpoRto = restore.mw27RpoRtoVerdict({
  officialBackupConfirmed: official.result === "PASS",
  rpoMs: Number.isFinite(rpoMs) ? rpoMs : null,
  rtoMs,
  packageLimitation: "personal edition cannot restore to new collections without overwrite; no package upgrade"
});
record("rpo_rto", { official: rpoRto.official, fixtureRto: rpoRto.fixtureRto, reason: rpoRto.reason, rtoMs, rpoMs });

const summary = redactMw27({
  ok: official.result !== "FAIL" && closure.result !== "FAIL" && maintenanceRestored !== false && notifyDuringMaint.result !== "FAIL",
  leftoverClaimedZero: false,
  officialRestore: official.result,
  officialReason: official.reason,
  mode: official.mode,
  closure: closure.result,
  seedPresent,
  isolatedPresent: isolatedPresent.length,
  rpoRto,
  notifyDuringMaint: notifyDuringMaint.result,
  maintenanceReason: restore.mw27MaintenanceDrillReason(),
  maintenanceRestored,
  enableOverrun: ready.enableOverrun,
  note: "未覆盖现库，未触碰其它环境。官方回档 BLOCKED 时用夹具模拟。E 前不得 leftover=0。"
});
writeJson(join(tmp, "mw27-restore-evidence.json"), redactMw27({ ...evidence, finishedAt, summary }));
const statePath = join(root, "configs", "mw27-verify-state.json");
if (existsSync(statePath)) {
  const prev = JSON.parse(readFileSync(statePath, "utf8"));
  writeFileSync(
    statePath,
    `${JSON.stringify({ ...prev, restoreAt: finishedAt, officialRestore: official, rpoRto, leftoverClaimedZero: false }, null, 2)}\n`
  );
}
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(1);
