import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import {
  emptyMw27Counts,
  MW27_ISOLATED_RESTORE_COLLECTIONS,
  MW27_LIVE_FIXTURE_COLLECTIONS,
  mw27LeftoverDecision,
  mw27Tmp,
  nosqlCountCommand,
  redactMw27
} from "./mw27-lib.mjs";

const tmp = mw27Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW27-leftover", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw27-leftover-evidence.json"), redactMw27(evidence));
}

function loadState() {
  const path = join(projectRoot(), "configs", "mw27-verify-state.json");
  if (!existsSync(path)) {
    return { wroteDocs: false, resolved: false, counts: emptyMw27Counts() };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    counts: { ...emptyMw27Counts(), ...(parsed.counts || {}) }
  };
}

async function countMarker(collection) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([nosqlCountCommand(collection, { fixtureRound: "MW27" })]),
    "--json"
  ]);
  return parseNosqlCount(result) || 0;
}

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadState();
record("state", { wroteDocs: state.wroteDocs, resolved: state.resolved, counts: state.counts });

const leftoverByKey = {};
let fixtureRemain = 0;
for (const collection of MW27_LIVE_FIXTURE_COLLECTIONS) {
  leftoverByKey[collection] = await countMarker(collection);
  fixtureRemain += leftoverByKey[collection];
}
let isolatedRemain = 0;
for (const collection of MW27_ISOLATED_RESTORE_COLLECTIONS) {
  leftoverByKey[collection] = await countMarker(collection);
  isolatedRemain += leftoverByKey[collection];
}
record("independent_marker", leftoverByKey);

const { seedCategoryIds } = await import("../packages/shared/dist/category.js");
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

const decision = mw27LeftoverDecision({
  wroteDocs: state.wroteDocs,
  resolved: state.resolved,
  fixtureRemain,
  isolatedRemain,
  knownIdRemain: fixtureRemain + isolatedRemain,
  seedPresent: seedPresent === seedCategoryIds().length
});

const summary = redactMw27({
  ok: decision.ok && fixtureRemain === 0 && isolatedRemain === 0,
  reason: fixtureRemain > 0 || isolatedRemain > 0 ? (isolatedRemain > 0 ? "ISOLATED_RESTORE_REMAIN" : "INDEPENDENT_REMAIN") : decision.reason,
  leftoverDocs: fixtureRemain + isolatedRemain,
  leftoverByKey,
  independentRemain: fixtureRemain,
  isolatedRemain,
  seedPresent,
  enableOverrun: ready.enableOverrun,
  leftoverClaimedZero: false,
  note: "空清单或 wroteDocs=false 不得 leftover=0。E 未闭合前本脚本即使 remain=0 也不把整项标完成。"
});
writeJson(join(tmp, "mw27-leftover-evidence.json"), { ...evidence, finishedAt: new Date().toISOString(), summary });
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(1);
