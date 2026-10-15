import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { emptyMw18KnownIds, knownIdCountOf, mw18Tmp, redactMw18 } from "./mw18-lib.mjs";

function loadState() {
  const path = join(projectRoot(), "configs", "mw18-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, resolved: false, knownIds: emptyMw18KnownIds() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: parsed.knownIds || emptyMw18KnownIds()
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
const { seedCategoryIds } = await import("../packages/shared/dist/category.js");
const seeds = new Set(seedCategoryIds());
const blocked = (state.knownIds.categories || []).filter((id) => seeds.has(id));
if (blocked.length) {
  console.error(JSON.stringify({ ok: false, reason: "SEED_CATEGORY_PROTECTED", count: blocked.length }, null, 2));
  process.exit(1);
}
if (state.wroteDocs && knownIdCountOf(state.knownIds) === 0) {
  console.error(JSON.stringify({ ok: false, reason: "KNOWN_IDS_MISSING_AFTER_WRITE" }, null, 2));
  process.exit(1);
}

const pairs = [
  ...(state.knownIds.questions || []).map((id) => ["questions", id]),
  ...(state.knownIds.papers || []).map((id) => ["papers", id]),
  ...(state.knownIds.categories || []).map((id) => ["categories", id]),
  ...(state.knownIds.previews || []).map((id) => ["catalog_change_previews", id]),
  ...(state.knownIds.work || []).map((id) => ["catalog_change_jobs", id])
];
const deleted = [];
for (const [collection, id] of pairs) {
  deleted.push(await deleteExact(collection, id));
}

const summary = {
  marker: "MW18",
  enableOverrun: ready.enableOverrun,
  targetCount: pairs.length,
  deleted: deleted.filter((row) => row.ok).length,
  failed: deleted.filter((row) => !row.ok).length,
  exactIdsOnly: true,
  neverDeleted: ["jobs", "audit_logs", "idempotency", "ranking_heads", "ranking_rows", "app_config", "score_metrics", "paper_bests", "members"]
};
writeJson(join(mw18Tmp(), "mw18-cleanup.json"), redactMw18(summary));
console.log(JSON.stringify(redactMw18(summary), null, 2));
if (summary.failed) process.exit(1);
