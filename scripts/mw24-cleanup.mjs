import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { emptyMw24KnownIds, knownIdCountOf, MW24_NEVER_DELETE, mw24Tmp, redactMw24 } from "./mw24-lib.mjs";
import { seedCategoryIds } from "../packages/shared/dist/category.js";

function loadState() {
  const path = join(projectRoot(), "configs", "mw24-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, resolved: false, knownIds: emptyMw24KnownIds() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: { ...emptyMw24KnownIds(), ...(parsed.knownIds || {}) }
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
if ((state.knownIds.members || []).some((id) => seeds.has(id))) {
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
  ...(state.knownIds.medalGrants || []).map((id) => ["medal_grants", id]),
  ...(state.knownIds.stats || []).map((id) => ["member_stats", id]),
  ...(state.knownIds.identities || []).map((id) => ["identities", id]),
  ...(state.knownIds.members || []).map((id) => ["members", id])
];
const deleted = [];
const skipped = [];
for (const [collection, id] of pairs) {
  if (MW24_NEVER_DELETE.includes(collection)) {
    skipped.push({ collection, id, reason: "NEVER_DELETE" });
    continue;
  }
  deleted.push(await deleteExact(collection, id));
}

const summary = redactMw24({
  marker: "MW24",
  enableOverrun: ready.enableOverrun,
  deleted: deleted.length,
  failed: deleted.filter((row) => !row.ok).length,
  skipped,
  note: "只删本轮入册测试会员与反馈。不删审计/订单/退款/receipts/vip_grants/app_config/ranking/非本轮会员。"
});
writeJson(join(mw24Tmp(), "mw24-cleanup.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if (summary.failed > 0) process.exit(1);
