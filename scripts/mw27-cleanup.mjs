import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { emptyMw27Counts, MW27_ISOLATED_RESTORE_COLLECTIONS, MW27_NEVER_DELETE, mw27Tmp, nosqlDeleteCommand, redactMw27 } from "./mw27-lib.mjs";

const statePath = join(projectRoot(), "configs", "mw27-verify-state.json");
if (!existsSync(statePath)) {
  console.error(JSON.stringify({ ok: false, reason: "STATE_MISSING" }, null, 2));
  process.exit(1);
}
const state = JSON.parse(readFileSync(statePath, "utf8"));
const counts = { ...emptyMw27Counts(), ...(state.counts || {}) };
if (state.wroteDocs && Object.values(counts).every((n) => !n)) {
  console.error(JSON.stringify({ ok: false, reason: "KNOWN_IDS_MISSING_AFTER_WRITE" }, null, 2));
  process.exit(1);
}
if (!state.resolved) {
  console.error(JSON.stringify({ ok: false, reason: "KNOWN_IDS_NOT_RESOLVED" }, null, 2));
  process.exit(1);
}

const ready = await assertMwTestReady();
authorizedEnvId();
const shared = spawnSync(process.execPath, [join(projectRoot(), "scripts", "ensure-shared-js.mjs")], {
  cwd: projectRoot(),
  encoding: "utf8"
});
if (shared.status !== 0) throw new Error("shared emit failed");
const restore = await import("../packages/shared/dist/mw27-restore.js");
const { seedCategoryIds } = await import("../packages/shared/dist/category.js");
const seeds = new Set(seedCategoryIds());

const pairs = [
  ["identities", restore.mw27IdentityId(0)],
  ["members", restore.mw27MemberId(0)],
  ["orders", restore.mw27OrderId("order_granted", 0)],
  ["orders", restore.mw27OrderId("order_pending", 0)],
  ["payment_receipts", restore.mw27ReceiptId(0)],
  ["callback_events", restore.mw27CallbackId("callback_paid", 0)],
  ["callback_events", restore.mw27CallbackId("callback_pending", 0)],
  ["refunds", restore.mw27RefundId(0)],
  ["vip_grants", restore.mw27GrantId(0)],
  ["vip_accounts", restore.mw27AccountId(0)],
  ["vip_events", restore.mw27EventId(0)],
  ["jobs", restore.mw27JobId("job_interrupted", 0)],
  ["jobs", restore.mw27JobId("job_review", 0)]
];
for (const [collection, id] of [...pairs]) {
  const isolated = restore.mw27IsolatedCollectionFor(collection);
  if (isolated) pairs.push([isolated, id]);
}

const skipped = [];
const deleted = [];
for (let i = 0; i < pairs.length; i += 10) {
  const chunk = pairs.slice(i, i + 10).filter(([collection, id]) => {
    if (MW27_NEVER_DELETE.includes(collection) || seeds.has(id) || collection === "ranking_heads" || collection === "ranking_rows") {
      skipped.push({ collection, id: "[redacted]", reason: "PROTECTED" });
      return false;
    }
    return true;
  });
  if (!chunk.length) continue;
  const result = await runTcb(
    ["db", "nosql", "execute", "--command", JSON.stringify(chunk.map(([collection, id]) => nosqlDeleteCommand(collection, id))), "--json"],
    { timeoutMs: 120000 }
  );
  deleted.push({ n: chunk.length, code: result.code, ok: result.code === 0 });
}

const summary = redactMw27({
  marker: "MW27",
  targetCount: pairs.length,
  deletedChunks: deleted,
  skipped,
  isolatedCollections: MW27_ISOLATED_RESTORE_COLLECTIONS,
  leftoverClaimedZero: false,
  enableOverrun: ready.enableOverrun,
  note: "只按再生 _id 精确删本轮夹具与隔离回档文档。独立核查才能报 0。ranking_* 未删。"
});
writeJson(join(mw27Tmp(), "mw27-cleanup.json"), summary);
console.log(JSON.stringify(summary, null, 2));
