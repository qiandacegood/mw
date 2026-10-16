import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { emptyMw19KnownIds, knownIdCountOf, MW19_NEVER_DELETE, mw19Tmp, redactMw19 } from "./mw19-lib.mjs";
import { seedCategoryIds } from "../packages/shared/dist/category.js";

function loadState() {
  const path = join(projectRoot(), "configs", "mw19-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, resolved: false, knownIds: emptyMw19KnownIds() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: { ...emptyMw19KnownIds(), ...(parsed.knownIds || {}) }
  };
}

async function deleteExact(collection, id) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: collection,
        CommandType: "DELETE",
        Command: JSON.stringify({ delete: collection, deletes: [{ q: { _id: id }, limit: 1 }] })
      }
    ]),
    "--json"
  ]);
  return { id, collection, code: result.code, ok: result.code === 0 };
}

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadState();
const seeds = new Set(seedCategoryIds());
if ((state.knownIds.papers || []).some((id) => seeds.has(id))) {
  console.error(JSON.stringify({ ok: false, reason: "SEED_PROTECTED" }, null, 2));
  process.exit(1);
}
if (state.wroteDocs && knownIdCountOf(state.knownIds) === 0) {
  console.error(JSON.stringify({ ok: false, reason: "KNOWN_IDS_MISSING_AFTER_WRITE" }, null, 2));
  process.exit(1);
}
if (!state.resolved) {
  console.error(JSON.stringify({ ok: false, reason: "KNOWN_IDS_NOT_RESOLVED" }, null, 2));
  process.exit(1);
}

const pairs = [
  ...(state.knownIds.events || []).map((id) => ["score_events", id]),
  ...(state.knownIds.bests || []).map((id) => ["paper_bests", id]),
  ...(state.knownIds.attempts || []).map((id) => ["attempts", id]),
  ...(state.knownIds.answers || []).map((id) => ["paper_answers", id]),
  ...(state.knownIds.chunks || []).map((id) => ["paper_chunks", id]),
  ...(state.knownIds.versions || []).map((id) => ["paper_versions", id]),
  ...(state.knownIds.questions || []).map((id) => ["questions", id]),
  ...(state.knownIds.questionVersions || []).map((id) => ["question_versions", id]),
  ...(state.knownIds.papers || []).map((id) => ["papers", id]),
  ...(state.knownIds.previews || []).map((id) => ["correction_previews", id]),
  ...(state.knownIds.work || []).map((id) => ["correction_jobs", id])
];
const deleted = [];
for (const [collection, id] of pairs) {
  deleted.push(await deleteExact(collection, id));
}

const summary = redactMw19({
  marker: "MW19",
  enableOverrun: ready.enableOverrun,
  targetCount: pairs.length,
  deleted: deleted.filter((row) => row.ok).length,
  failed: deleted.filter((row) => !row.ok).length,
  exactIdsOnly: true,
  neverDeleted: MW19_NEVER_DELETE
});
writeJson(join(mw19Tmp(), "mw19-cleanup.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if (summary.failed) process.exit(1);
