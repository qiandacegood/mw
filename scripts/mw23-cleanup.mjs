import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { emptyMw23KnownIds, knownIdCountOf, MW23_NEVER_DELETE, mw23Tmp, redactMw23 } from "./mw23-lib.mjs";
import { seedCategoryIds } from "../packages/shared/dist/category.js";

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
  ...(state.knownIds.feedbacks || []).map((id) => ["feedbacks", id]),
  ...(state.knownIds.answers || []).map((id) => ["paper_answers", id]),
  ...(state.knownIds.chunks || []).map((id) => ["paper_chunks", id]),
  ...(state.knownIds.versions || []).map((id) => ["paper_versions", id]),
  ...(state.knownIds.attempts || []).map((id) => ["attempts", id]),
  ...(state.knownIds.questionVersions || []).map((id) => ["question_versions", id]),
  ...(state.knownIds.questions || []).map((id) => ["questions", id]),
  ...(state.knownIds.papers || []).map((id) => ["papers", id])
];
const deleted = [];
const skipped = [];
for (const [collection, id] of pairs) {
  if (MW23_NEVER_DELETE.includes(collection)) {
    skipped.push({ collection, id, reason: "NEVER_DELETE" });
    continue;
  }
  deleted.push(await deleteExact(collection, id));
}

const summary = redactMw23({
  marker: "MW23",
  enableOverrun: ready.enableOverrun,
  deleted: deleted.length,
  failed: deleted.filter((row) => !row.ok).length,
  skippedMembers: (state.knownIds.members || []).length,
  skipped,
  note: "不删会员账号、种子十类、jobs/审计/幂等、ranking_*、VIP/订单/退款账本。停用/禁榜误伤须恢复。"
});
writeJson(join(mw23Tmp(), "mw23-cleanup.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if (summary.failed) process.exit(1);
