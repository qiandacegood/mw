import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw25KnownIds, knownIdCountDeletable, mw25LeftoverDecision, mw25Tmp, redactMw25 } from "./mw25-lib.mjs";

const tmp = mw25Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW25-leftover", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw25-leftover-evidence.json"), redactMw25(evidence));
}

function loadState() {
  const path = join(projectRoot(), "configs", "mw25-verify-state.json");
  if (!existsSync(path)) {
    return { wroteDocs: false, resolved: false, knownIds: emptyMw25KnownIds() };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: { ...emptyMw25KnownIds(), ...(parsed.knownIds || {}) }
  };
}

async function countExact(collection, ids) {
  let leftover = 0;
  for (const id of ids) {
    const result = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([{ TableName: collection, CommandType: "COMMAND", Command: JSON.stringify({ count: collection, query: { _id: id } }) }]),
      "--json"
    ]);
    leftover += parseNosqlCount(result) || 0;
  }
  return leftover;
}

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadState();
record("state", { wroteDocs: state.wroteDocs, resolved: state.resolved, knownIdCount: knownIdCountDeletable(state.knownIds) });

const leftoverByKey = {
  snapshots: await countExact("ops_stats_snapshots", state.knownIds.snapshots || []),
  tutorialFixtures: await countExact("ops_stats_snapshots", state.knownIds.tutorialFixtures || [])
};
const leftoverDocs = Object.values(leftoverByKey).reduce((sum, n) => sum + n, 0);
record("known_ids_path", leftoverByKey);

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

const independentRemain = leftoverDocs;
const decision = mw25LeftoverDecision({
  wroteDocs: state.wroteDocs,
  resolved: state.resolved,
  knownIds: leftoverDocs > 0 ? { snapshots: ["remain"] } : emptyMw25KnownIds(),
  independentRemain,
  seedPresent: seedPresent === seedCategoryIds().length
});

const summary = redactMw25({
  ok: decision.ok && leftoverDocs === 0,
  reason: leftoverDocs > 0 ? "KNOWN_IDS_REMAIN" : decision.reason,
  leftoverDocs,
  leftoverByKey,
  independentRemain,
  seedPresent,
  enableOverrun: ready.enableOverrun,
  note: "空清单或 wroteDocs=false 不得 leftover=0。不删交易证据集合。"
});
writeJson(join(tmp, "mw25-leftover-evidence.json"), { ...evidence, finishedAt: new Date().toISOString(), summary });
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(1);
