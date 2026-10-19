import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import {
  emptyMw27Counts,
  leftoverResolveDecision,
  MW27_ISOLATED_RESTORE_COLLECTIONS,
  MW27_LIVE_FIXTURE_COLLECTIONS,
  mw27Tmp,
  nosqlCountCommand,
  redactMw27
} from "./mw27-lib.mjs";

const statePath = join(projectRoot(), "configs", "mw27-verify-state.json");
if (!existsSync(statePath)) {
  console.error(JSON.stringify({ ok: false, reason: "STATE_MISSING" }, null, 2));
  process.exit(1);
}
const state = JSON.parse(readFileSync(statePath, "utf8"));
const counts = { ...emptyMw27Counts(), ...(state.counts || {}) };
const imported = Object.values(counts).reduce((sum, n) => sum + Number(n || 0), 0);
if (!state.wroteDocs) {
  console.error(JSON.stringify({ ok: false, reason: "WROTE_DOCS_FALSE" }, null, 2));
  process.exit(1);
}
if (imported <= 0) {
  console.error(JSON.stringify({ ok: false, reason: "EMPTY_IMPORT" }, null, 2));
  process.exit(1);
}

await assertMwTestReady();
authorizedEnvId();

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

const matched = {};
let matchedLive = 0;
for (const collection of MW27_LIVE_FIXTURE_COLLECTIONS) {
  matched[collection] = await countMarker(collection);
  matchedLive += matched[collection];
}
let isolated = 0;
for (const collection of MW27_ISOLATED_RESTORE_COLLECTIONS) {
  const n = await countMarker(collection);
  matched[collection] = n;
  isolated += n;
}
const matchedTotal = matchedLive + isolated;

const gate = leftoverResolveDecision({ importedHashCount: imported, matchedIdCount: matchedTotal, scanComplete: true });
const next = {
  ...state,
  resolved: gate.ok === true,
  matched,
  matchedTotal,
  resolveReason: gate.ok ? "COUNTS_MATCH" : gate.reason,
  leftoverClaimedZero: false
};
writeFileSync(statePath, `${JSON.stringify(next, null, 2)}\n`);
writeJson(join(mw27Tmp(), "mw27-resolve.json"), redactMw27(next));
console.log(JSON.stringify(redactMw27({ ok: gate.ok, reason: next.resolveReason, imported, matchedTotal, matched }), null, 2));
if (!gate.ok) process.exit(1);
