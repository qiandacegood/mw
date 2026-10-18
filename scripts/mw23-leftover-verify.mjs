import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw23KnownIds, knownIdCountDeletable, mw23LeftoverDecision, mw23Tmp, redactMw23 } from "./mw23-lib.mjs";

const tmp = mw23Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW23-leftover", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw23-leftover-evidence.json"), redactMw23(evidence));
}

function loadState() {
  const path = join(projectRoot(), "configs", "mw23-verify-state.json");
  if (!existsSync(path)) {
    return { wroteDocs: false, resolved: false, knownIds: emptyMw23KnownIds() };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: { ...emptyMw23KnownIds(), ...(parsed.knownIds || {}) }
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
  papers: await countExact("papers", state.knownIds.papers || []),
  questions: await countExact("questions", state.knownIds.questions || []),
  questionVersions: await countExact("question_versions", state.knownIds.questionVersions || []),
  attempts: await countExact("attempts", state.knownIds.attempts || []),
  versions: await countExact("paper_versions", state.knownIds.versions || []),
  chunks: await countExact("paper_chunks", state.knownIds.chunks || []),
  answers: await countExact("paper_answers", state.knownIds.answers || []),
  feedbacks: await countExact("feedbacks", state.knownIds.feedbacks || [])
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
  independentRemain += await countExact("papers", [id]);
  const attempts = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([{ TableName: "attempts", CommandType: "COMMAND", Command: JSON.stringify({ count: "attempts", query: { paperId: id } }) }]),
    "--json"
  ]);
  independentRemain += parseNosqlCount(attempts) || 0;
}
independentRemain += leftoverByKey.feedbacks;
independentRemain += leftoverByKey.questions;
independentRemain += leftoverByKey.questionVersions;
independentRemain += leftoverByKey.attempts;
independentRemain += leftoverByKey.versions;
independentRemain += leftoverByKey.chunks;
independentRemain += leftoverByKey.answers;

const knownIdsForDecision = leftoverDocs > 0 ? { feedbacks: ["remain"] } : emptyMw23KnownIds();
const decision = mw23LeftoverDecision({
  wroteDocs: state.wroteDocs,
  resolved: state.resolved,
  knownIds: leftoverDocs > 0 ? knownIdsForDecision : emptyMw23KnownIds(),
  independentRemain,
  seedPresent: seedPresent === seedCategoryIds().length
});

const summary = redactMw23({
  ok: decision.ok && leftoverDocs === 0,
  reason: leftoverDocs > 0 ? "KNOWN_IDS_REMAIN" : decision.reason,
  leftoverDocs,
  leftoverByKey,
  independentRemain,
  seedPresent,
  membersPreserved: (state.knownIds.members || []).length,
  enableOverrun: ready.enableOverrun
});
writeJson(join(tmp, "mw23-leftover-evidence.json"), { ...evidence, finishedAt: new Date().toISOString(), summary });
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(1);
