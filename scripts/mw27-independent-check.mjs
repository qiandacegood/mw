import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw27Counts, MW27_ISOLATED_RESTORE_COLLECTIONS, MW27_LIVE_FIXTURE_COLLECTIONS, mw27Tmp, nosqlCountCommand, redactMw27 } from "./mw27-lib.mjs";

function loadState() {
  const path = join(projectRoot(), "configs", "mw27-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, resolved: false, counts: emptyMw27Counts() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    counts: { ...emptyMw27Counts(), ...(parsed.counts || {}) }
  };
}

async function countMarker(collection) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([nosqlCountCommand(collection, { fixtureRound: "MW27" })]),
    "--json"
  ]);
  return parseNosqlCount(result) || 0;
}

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadState();
if (!state.wroteDocs || !state.resolved) {
  const summary = redactMw27({
    ok: false,
    reason: state.wroteDocs ? "KNOWN_IDS_NOT_RESOLVED" : "WROTE_DOCS_FALSE",
    remain: -1,
    leftoverClaimedZero: false
  });
  writeJson(join(mw27Tmp(), "mw27-independent.json"), summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

const by = {};
let remain = 0;
for (const collection of MW27_LIVE_FIXTURE_COLLECTIONS) {
  by[collection] = await countMarker(collection);
  remain += by[collection];
}
let isolatedRemain = 0;
for (const collection of MW27_ISOLATED_RESTORE_COLLECTIONS) {
  by[collection] = await countMarker(collection);
  isolatedRemain += by[collection];
  remain += by[collection];
}

const summary = redactMw27({
  ok: remain === 0,
  remain,
  isolatedRemain,
  by,
  enableOverrun: ready.enableOverrun,
  leftoverClaimedZero: false,
  note: "独立按 fixtureRound=MW27 与隔离回档集合计数，不依赖 DELETE 成功计数。ranking_* 不计入。"
});
writeJson(join(mw27Tmp(), "mw27-independent.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if (remain !== 0) process.exit(1);
