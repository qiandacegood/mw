import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw23KnownIds, mw23Tmp, redactMw23 } from "./mw23-lib.mjs";

function loadState() {
  const path = join(projectRoot(), "configs", "mw23-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, resolved: false, knownIds: emptyMw23KnownIds() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: { ...emptyMw23KnownIds(), ...(parsed.knownIds || {}) }
  };
}

async function countQuery(collection, query) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([{ TableName: collection, CommandType: "COMMAND", Command: JSON.stringify({ count: collection, query }) }]),
    "--json"
  ]);
  return parseNosqlCount(result) || 0;
}

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadState();
if (!state.wroteDocs || !state.resolved) {
  const summary = redactMw23({ ok: false, reason: state.wroteDocs ? "KNOWN_IDS_NOT_RESOLVED" : "WROTE_DOCS_FALSE", remain: -1 });
  writeJson(join(mw23Tmp(), "mw23-independent.json"), summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

const by = { papers: 0, questions: 0, attempts: 0, versions: 0, chunks: 0, answers: 0, feedbacks: 0 };
for (const id of state.knownIds.papers) {
  by.papers += await countQuery("papers", { _id: id });
  by.attempts += await countQuery("attempts", { paperId: id });
}
for (const id of state.knownIds.questions) {
  by.questions += await countQuery("questions", { _id: id });
}
for (const id of state.knownIds.questionVersions) {
  by.questions += await countQuery("question_versions", { _id: id });
}
for (const id of state.knownIds.attempts) {
  by.attempts += await countQuery("attempts", { _id: id });
}
for (const id of state.knownIds.versions) {
  by.versions += await countQuery("paper_versions", { _id: id });
}
for (const id of state.knownIds.chunks) {
  by.chunks += await countQuery("paper_chunks", { _id: id });
}
for (const id of state.knownIds.answers) {
  by.answers += await countQuery("paper_answers", { _id: id });
}
for (const id of state.knownIds.feedbacks) {
  by.feedbacks += await countQuery("feedbacks", { _id: id });
}
const remain = Object.values(by).reduce((sum, n) => sum + n, 0);
const summary = redactMw23({
  ok: remain === 0,
  remain,
  by,
  membersNotDeleted: (state.knownIds.members || []).length,
  enableOverrun: ready.enableOverrun
});
writeJson(join(mw23Tmp(), "mw23-independent.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if (remain !== 0) process.exit(1);
