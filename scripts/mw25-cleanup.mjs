import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { emptyMw25KnownIds, knownIdCountOf, MW25_NEVER_DELETE, mw25Tmp, redactMw25 } from "./mw25-lib.mjs";
import { seedCategoryIds } from "../packages/shared/dist/category.js";

function loadState() {
  const path = join(projectRoot(), "configs", "mw25-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, resolved: false, knownIds: emptyMw25KnownIds() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: { ...emptyMw25KnownIds(), ...(parsed.knownIds || {}) }
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
if ([...Object.values(state.knownIds)].flat().some((id) => seeds.has(id))) {
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
  ...(state.knownIds.snapshots || []).map((id) => ["ops_stats_snapshots", id]),
  ...(state.knownIds.tutorialFixtures || []).map((id) => ["ops_stats_snapshots", id])
];
const deleted = [];
const skipped = [];
for (const [collection, id] of pairs) {
  if (MW25_NEVER_DELETE.includes(collection)) {
    skipped.push({ collection, id, reason: "NEVER_DELETE" });
    continue;
  }
  deleted.push(await deleteExact(collection, id));
}

const summary = redactMw25({
  marker: "MW25",
  enableOverrun: ready.enableOverrun,
  deleted: deleted.length,
  failed: deleted.filter((row) => !row.ok).length,
  skipped,
  note: "只删本轮统计快照或教程夹具。不删审计/订单/退款/会员/vip_*/ranking/app_config。"
});
writeJson(join(mw25Tmp(), "mw25-cleanup.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if (summary.failed > 0) process.exit(1);
