import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw24KnownIds, mw24Tmp, redactMw24 } from "./mw24-lib.mjs";

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
  const summary = redactMw24({ ok: false, reason: state.wroteDocs ? "KNOWN_IDS_NOT_RESOLVED" : "WROTE_DOCS_FALSE", remain: -1 });
  writeJson(join(mw24Tmp(), "mw24-independent.json"), summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

const by = { members: 0, identities: 0, stats: 0, medalGrants: 0, feedbacks: 0 };
for (const id of state.knownIds.members) {
  by.members += await countQuery("members", { _id: id });
  by.stats += await countQuery("member_stats", { _id: id });
  by.identities += await countQuery("identities", { memberId: id });
  by.feedbacks += await countQuery("feedbacks", { memberId: id });
  by.medalGrants += await countQuery("medal_grants", { memberId: id });
}
for (const id of state.knownIds.identities) {
  by.identities += await countQuery("identities", { _id: id });
}
for (const id of state.knownIds.stats) {
  by.stats += await countQuery("member_stats", { _id: id });
}
for (const id of state.knownIds.medalGrants) {
  by.medalGrants += await countQuery("medal_grants", { _id: id });
}
for (const id of state.knownIds.feedbacks) {
  by.feedbacks += await countQuery("feedbacks", { _id: id });
}
const remain = Object.values(by).reduce((sum, n) => sum + n, 0);
const summary = redactMw24({
  ok: remain === 0,
  remain,
  by,
  enableOverrun: ready.enableOverrun,
  note: "独立按 member/feedback 关系核查，不依赖 DELETE 成功计数"
});
writeJson(join(mw24Tmp(), "mw24-independent.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if (remain !== 0) process.exit(1);
