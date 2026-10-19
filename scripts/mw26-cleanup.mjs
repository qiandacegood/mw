import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { emptyMw26Counts, MW26_NEVER_DELETE, mw26Tmp, nosqlDeleteCommand, redactMw26 } from "./mw26-lib.mjs";

const statePath = join(projectRoot(), "configs", "mw26-verify-state.json");
if (!existsSync(statePath)) {
  console.error(JSON.stringify({ ok: false, reason: "STATE_MISSING" }, null, 2));
  process.exit(1);
}
const state = JSON.parse(readFileSync(statePath, "utf8"));
const counts = { ...emptyMw26Counts(), ...(state.counts || {}) };
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

const { mw26AttemptId, mw26CleanupMetricIds, mw26IdentityId, mw26MemberId, mw26PaperId, mw26PaperVersionIdOf, mw26RequirePeriodState } =
  await import("../packages/shared/dist/mw26-capacity.js");
const { seedCategoryIds } = await import("../packages/shared/dist/category.js");
const seeds = new Set(seedCategoryIds());
let period;
try {
  period = mw26RequirePeriodState(state);
} catch {
  console.error(JSON.stringify({ ok: false, reason: "PERIOD_KEYS_MISSING" }, null, 2));
  process.exit(1);
}

const pairs = [];
for (let i = 0; i < counts.identities; i += 1) pairs.push(["identities", mw26IdentityId(i)]);
for (let i = 0; i < counts.members; i += 1) pairs.push(["members", mw26MemberId(i)]);
for (let i = 0; i < counts.member_stats; i += 1) pairs.push(["member_stats", mw26MemberId(i)]);
for (let i = 0; i < counts.papers; i += 1) pairs.push(["papers", mw26PaperId(i)]);
for (let i = 0; i < counts.paper_versions; i += 1) pairs.push(["paper_versions", mw26PaperVersionIdOf(i)]);
for (let i = 0; i < counts.attempts; i += 1) {
  const memberIndex = i % Math.max(1, counts.members);
  const paperIndex = i % Math.max(1, counts.papers);
  pairs.push(["attempts", mw26AttemptId(memberIndex, paperIndex, i)]);
}
for (let i = 0; i < counts.members; i += 1) {
  const ids = mw26CleanupMetricIds(i, period);
  pairs.push(["score_metrics", ids.total]);
  pairs.push(["score_metrics", ids.week]);
  pairs.push(["score_metrics", ids.month]);
}

const skipped = [];
const deleted = [];
for (let i = 0; i < pairs.length; i += 10) {
  const chunk = pairs.slice(i, i + 10).filter(([collection, id]) => {
    if (MW26_NEVER_DELETE.includes(collection) || seeds.has(id)) {
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

const summary = redactMw26({
  marker: "MW26",
  enableOverrun: ready.enableOverrun,
  targetCount: pairs.length,
  batches: deleted.length,
  failed: deleted.filter((row) => !row.ok).length,
  skipped: skipped.length,
  note: "只删本轮夹具确定性 _id。不删审计/订单/退款/种子十类/非本轮会员/ranking 快照。"
});
writeJson(join(mw26Tmp(), "mw26-cleanup.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if (summary.failed > 0) process.exit(1);
