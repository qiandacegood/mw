import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import {
  MW26_FIXTURE_COLLECTIONS,
  emptyMw26Counts,
  mw26LeftoverDecision,
  mw26Tmp,
  nosqlCountCommand,
  redactMw26
} from "./mw26-lib.mjs";

const tmp = mw26Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW26-leftover", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw26-leftover-evidence.json"), redactMw26(evidence));
}

function loadState() {
  const path = join(projectRoot(), "configs", "mw26-verify-state.json");
  if (!existsSync(path)) {
    return { wroteDocs: false, resolved: false, counts: emptyMw26Counts() };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    counts: { ...emptyMw26Counts(), ...(parsed.counts || {}) }
  };
}

async function countMarker(collection) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([nosqlCountCommand(collection, { fixtureRound: "MW26" })]),
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
for (const collection of MW26_FIXTURE_COLLECTIONS) {
  leftoverByKey[collection] = await countMarker(collection);
  fixtureRemain += leftoverByKey[collection];
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

const decision = mw26LeftoverDecision({
  wroteDocs: state.wroteDocs,
  resolved: state.resolved,
  fixtureRemain,
  knownIdRemain: fixtureRemain,
  seedPresent: seedPresent === seedCategoryIds().length
});

const summary = redactMw26({
  ok: decision.ok && fixtureRemain === 0,
  reason: fixtureRemain > 0 ? "INDEPENDENT_REMAIN" : decision.reason,
  leftoverDocs: fixtureRemain,
  leftoverByKey,
  independentRemain: fixtureRemain,
  seedPresent,
  enableOverrun: ready.enableOverrun,
  leftoverClaimedZero: false,
  note: "空清单或 wroteDocs=false 不得 leftover=0。E 未闭合前本脚本即使 remain=0 也不把整项标完成。"
});
writeJson(join(tmp, "mw26-leftover-evidence.json"), { ...evidence, finishedAt: new Date().toISOString(), summary });
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(1);
