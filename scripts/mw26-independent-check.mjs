import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { MW26_FIXTURE_COLLECTIONS, emptyMw26Counts, mw26Tmp, nosqlCountCommand, redactMw26 } from "./mw26-lib.mjs";

function loadState() {
  const path = join(projectRoot(), "configs", "mw26-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, resolved: false, counts: emptyMw26Counts() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    counts: { ...emptyMw26Counts(), ...(parsed.counts || {}) }
  };
}

async function countMarker(collection) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([nosqlCountCommand(collection, { fixtureRound: "MW26" })]),
    "--json"
  ]);
  return parseNosqlCount(result) || 0;
}

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadState();
if (!state.wroteDocs || !state.resolved) {
  const summary = redactMw26({
    ok: false,
    reason: state.wroteDocs ? "KNOWN_IDS_NOT_RESOLVED" : "WROTE_DOCS_FALSE",
    remain: -1
  });
  writeJson(join(mw26Tmp(), "mw26-independent.json"), summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

const by = {};
let remain = 0;
for (const collection of MW26_FIXTURE_COLLECTIONS) {
  by[collection] = await countMarker(collection);
  remain += by[collection];
}

const summary = redactMw26({
  ok: remain === 0,
  remain,
  by,
  enableOverrun: ready.enableOverrun,
  note: "独立按 fixtureRound=MW26 计数，不依赖 DELETE 成功计数。不扫 orders/refunds/vip_*。"
});
writeJson(join(mw26Tmp(), "mw26-independent.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if (remain !== 0) process.exit(1);
