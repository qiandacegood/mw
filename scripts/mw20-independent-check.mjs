import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw20KnownIds, mw20Tmp, redactMw20 } from "./mw20-lib.mjs";

function loadState() {
  const path = join(projectRoot(), "configs", "mw20-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, resolved: false, knownIds: emptyMw20KnownIds() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: { ...emptyMw20KnownIds(), ...(parsed.knownIds || {}) }
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
  const summary = redactMw20({ ok: false, reason: state.wroteDocs ? "KNOWN_IDS_NOT_RESOLVED" : "WROTE_DOCS_FALSE", remain: -1 });
  writeJson(join(mw20Tmp(), "mw20-independent.json"), summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

const by = { papers: 0, attempts: 0, events: 0, bests: 0, grants: 0, vipEvents: 0, accounts: 0 };
for (const id of state.knownIds.papers) {
  by.papers += await countQuery("papers", { _id: id });
  by.attempts += await countQuery("attempts", { paperId: id });
  by.events += await countQuery("score_events", { paperId: id });
  by.bests += await countQuery("paper_bests", { paperId: id });
}
for (const id of state.knownIds.attempts) {
  by.attempts += await countQuery("attempts", { _id: id });
}
for (const id of state.knownIds.members) {
  by.grants += await countQuery("vip_grants", { memberId: id, sourceType: "gift" });
  by.vipEvents += await countQuery("vip_events", { memberId: id });
  by.accounts += await countQuery("vip_accounts", { _id: id });
}
for (const id of state.knownIds.grants) {
  by.grants += await countQuery("vip_grants", { _id: id });
}
const remain = Object.values(by).reduce((sum, n) => sum + n, 0);
const summary = redactMw20({
  ok: remain === 0,
  remain,
  by,
  derivedIdsUsed: false,
  enableOverrun: ready.enableOverrun,
  note: "独立核查：按 member/paper 关系计数 gift 账本与本轮卷/答题，不采用 DELETE 成功数"
});
writeJson(join(mw20Tmp(), "mw20-independent.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if (remain !== 0) process.exit(1);
