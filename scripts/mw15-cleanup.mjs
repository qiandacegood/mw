import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { emptyMw15KnownIds, knownIdCountOf, mw15Tmp, redactMw15 } from "./mw15-lib.mjs";
import { isSeedCategoryId } from "../packages/shared/dist/category.js";

function loadState() {
  const path = join(projectRoot(), "configs", "mw15-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, resolved: false, knownIds: emptyMw15KnownIds() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: parsed.knownIds || emptyMw15KnownIds()
  };
}

async function deleteExact(collection, id) {
  if (!id || typeof id !== "string") return { id, ok: false, reason: "MISSING_ID" };
  if (collection === "categories" && isSeedCategoryId(id)) {
    return { id, collection, ok: false, reason: "SEED_CATEGORY_PROTECTED" };
  }
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
  return { collection, code: result.code, ok: result.code === 0 };
}

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadState();
if (!state.wroteDocs || !state.resolved || knownIdCountOf(state.knownIds) === 0) {
  const summary = {
    marker: "MW15",
    enableOverrun: ready.enableOverrun,
    deleted: 0,
    failed: 1,
    exactIdsOnly: true,
    wroteDocs: state.wroteDocs,
    reason: "KNOWN_IDS_NOT_RESOLVED"
  };
  writeJson(join(mw15Tmp(), "mw15-cleanup.json"), redactMw15(summary));
  console.log(JSON.stringify(redactMw15(summary), null, 2));
  process.exit(1);
}

const deleted = [];
const pairs = [
  ...(state.knownIds.metrics || []).map((id) => ["score_metrics", id]),
  ...(state.knownIds.events || []).map((id) => ["score_events", id]),
  ...(state.knownIds.bests || []).map((id) => ["paper_bests", id]),
  ...(state.knownIds.activeAttempts || []).map((id) => ["active_attempts", id]),
  ...(state.knownIds.attempts || []).map((id) => ["attempts", id]),
  ...(state.knownIds.answers || []).map((id) => ["paper_answers", id]),
  ...(state.knownIds.chunks || []).map((id) => ["paper_chunks", id]),
  ...(state.knownIds.versions || []).map((id) => ["paper_versions", id]),
  ...(state.knownIds.papers || []).map((id) => ["papers", id])
];
for (const [collection, id] of pairs) deleted.push(await deleteExact(collection, id));

const summary = {
  marker: "MW15",
  enableOverrun: ready.enableOverrun,
  deleted: deleted.length,
  failed: deleted.filter((item) => !item.ok).length,
  exactIdsOnly: true,
  wroteDocs: state.wroteDocs,
  knownIdCount: knownIdCountOf(state.knownIds)
};
writeJson(join(mw15Tmp(), "mw15-cleanup.json"), redactMw15(summary));
console.log(JSON.stringify(redactMw15(summary), null, 2));
if (summary.failed) process.exit(1);
