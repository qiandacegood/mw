import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw19KnownIds, knownIdCountOf, mw19LeftoverDecision, mw19Tmp, redactMw19 } from "./mw19-lib.mjs";
import { FORBIDDEN_FUTURE_COLLECTIONS } from "./mw19-lib.mjs";

const tmp = mw19Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW19-leftover", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw19-leftover-evidence.json"), redactMw19(evidence));
}

function loadState() {
  const path = join(projectRoot(), "configs", "mw19-verify-state.json");
  if (!existsSync(path)) {
    return { wroteDocs: false, resolved: false, knownIds: emptyMw19KnownIds() };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: { ...emptyMw19KnownIds(), ...(parsed.knownIds || {}) }
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
  papers: await countExact("papers", state.knownIds.papers || []),
  questions: await countExact("questions", state.knownIds.questions || []),
  questionVersions: await countExact("question_versions", state.knownIds.questionVersions || []),
  attempts: await countExact("attempts", state.knownIds.attempts || []),
  previews: await countExact("correction_previews", state.knownIds.previews || []),
  work: await countExact("correction_jobs", state.knownIds.work || []),
  versions: await countExact("paper_versions", state.knownIds.versions || []),
  chunks: await countExact("paper_chunks", state.knownIds.chunks || []),
  answers: await countExact("paper_answers", state.knownIds.answers || []),
  events: await countExact("score_events", state.knownIds.events || []),
  bests: await countExact("paper_bests", state.knownIds.bests || [])
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

let independentRemain = 0;
for (const id of state.knownIds.papers || []) {
  const paperCount = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([{ TableName: "papers", CommandType: "COMMAND", Command: JSON.stringify({ count: "papers", query: { _id: id } }) }]),
    "--json"
  ]);
  independentRemain += parseNosqlCount(paperCount) || 0;
  for (const [collection, query] of [
    ["attempts", { paperId: id }],
    ["score_events", { paperId: id }],
    ["paper_bests", { paperId: id }],
    ["correction_previews", { paperId: id }],
    ["correction_jobs", { paperId: id }]
  ]) {
    const result = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([{ TableName: collection, CommandType: "COMMAND", Command: JSON.stringify({ count: collection, query }) }]),
      "--json"
    ]);
    independentRemain += parseNosqlCount(result) || 0;
  }
}

let forbiddenPresent = false;
for (const name of FORBIDDEN_FUTURE_COLLECTIONS) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([{ TableName: name, CommandType: "COMMAND", Command: JSON.stringify({ count: name, query: {} }) }]),
    "--json"
  ]);
  if ((parseNosqlCount(result) || 0) > 0) forbiddenPresent = true;
}

const remainIds = leftoverDocs > 0 ? { leftover: ["x"] } : emptyMw19KnownIds();
const decision = mw19LeftoverDecision({
  wroteDocs: state.wroteDocs,
  resolved: state.resolved,
  knownIds: remainIds,
  independentRemain,
  seedPresent: seedPresent === seedCategoryIds().length,
  forbiddenPresent
});
record("decision", { ...decision, leftoverDocs, independentRemain, seedPresent });
writeJson(join(tmp, "mw19-leftover-evidence.json"), redactMw19({ ...evidence, finishedAt: new Date().toISOString() }));
console.log(JSON.stringify(redactMw19({ ...decision, leftoverDocs, independentRemain, leftoverByKey, seedPresent }), null, 2));
if (!decision.ok) process.exit(1);
