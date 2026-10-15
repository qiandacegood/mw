import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw18KnownIds, knownIdCountOf, mw18LeftoverDecision, mw18Tmp, redactMw18 } from "./mw18-lib.mjs";

const tmp = mw18Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW18-leftover", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw18-leftover-evidence.json"), redactMw18(evidence));
}

function loadState() {
  const path = join(projectRoot(), "configs", "mw18-verify-state.json");
  if (!existsSync(path)) {
    return { wroteDocs: false, resolved: false, knownIds: emptyMw18KnownIds() };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: parsed.knownIds || emptyMw18KnownIds()
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
record("state", { wroteDocs: state.wroteDocs, resolved: state.resolved, knownIdCount: knownIdCountOf(state.knownIds) });

const leftoverByKey = {
  categories: await countExact("categories", state.knownIds.categories || []),
  questions: await countExact("questions", state.knownIds.questions || []),
  papers: await countExact("papers", state.knownIds.papers || []),
  previews: await countExact("catalog_change_previews", state.knownIds.previews || [])
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

const decision = mw18LeftoverDecision({
  wroteDocs: state.wroteDocs,
  resolved: state.resolved,
  knownIds: leftoverDocs > 0 ? { leftover: ["x"] } : emptyMw18KnownIds(),
  seedPresent: seedPresent === seedCategoryIds().length,
  forbiddenPresent: false
});
record("decision", { ...decision, leftoverDocs, seedPresent, note: "jobs/audit/ranking/seeds 不计入 leftover" });
writeJson(join(tmp, "mw18-leftover-evidence.json"), redactMw18({ ...evidence, finishedAt: new Date().toISOString() }));
console.log(JSON.stringify(redactMw18({ ok: decision.ok && leftoverDocs === 0, leftoverDocs, seedPresent, reason: decision.reason }), null, 2));
if (!decision.ok || leftoverDocs !== 0) process.exit(1);
