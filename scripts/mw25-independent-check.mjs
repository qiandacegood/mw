import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw25KnownIds, mw25Tmp, redactMw25 } from "./mw25-lib.mjs";

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
  const summary = redactMw25({ ok: false, reason: state.wroteDocs ? "KNOWN_IDS_NOT_RESOLVED" : "WROTE_DOCS_FALSE", remain: -1 });
  writeJson(join(mw25Tmp(), "mw25-independent.json"), summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

const by = { snapshots: 0, tutorialFixtures: 0 };
for (const id of state.knownIds.snapshots) {
  by.snapshots += await countQuery("ops_stats_snapshots", { _id: id });
}
for (const id of state.knownIds.tutorialFixtures) {
  by.tutorialFixtures += await countQuery("ops_stats_snapshots", { _id: id });
}
const remain = Object.values(by).reduce((sum, n) => sum + n, 0);
const summary = redactMw25({
  ok: remain === 0,
  remain,
  by,
  enableOverrun: ready.enableOverrun,
  note: "独立按 snapshot _id 核查，不依赖 DELETE 成功计数。不扫 members/orders/refunds。"
});
writeJson(join(mw25Tmp(), "mw25-independent.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if (remain !== 0) process.exit(1);
