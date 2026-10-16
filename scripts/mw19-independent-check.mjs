import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw19KnownIds, mw19Tmp, redactMw19 } from "./mw19-lib.mjs";

/**
 * 不依赖 DELETE 成功计数、不推导事件 id：按入册 paper/attempt/preview 关系精确计数残留。
 */
function loadState() {
  const path = join(projectRoot(), "configs", "mw19-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, resolved: false, knownIds: emptyMw19KnownIds() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: { ...emptyMw19KnownIds(), ...(parsed.knownIds || {}) }
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
  const summary = redactMw19({ ok: false, reason: state.wroteDocs ? "KNOWN_IDS_NOT_RESOLVED" : "WROTE_DOCS_FALSE", remain: -1 });
  writeJson(join(mw19Tmp(), "mw19-independent.json"), summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

let remain = 0;
const by = { papers: 0, attempts: 0, events: 0, bests: 0, previews: 0, work: 0 };
for (const id of state.knownIds.papers) {
  by.papers += await countQuery("papers", { _id: id });
  by.attempts += await countQuery("attempts", { paperId: id });
  by.events += await countQuery("score_events", { paperId: id });
  by.bests += await countQuery("paper_bests", { paperId: id });
  by.previews += await countQuery("correction_previews", { paperId: id });
}
for (const id of state.knownIds.attempts) {
  by.attempts += await countQuery("attempts", { _id: id });
}
for (const id of state.knownIds.previews) {
  by.previews += await countQuery("correction_previews", { _id: id });
}
for (const id of state.knownIds.work) {
  by.work += await countQuery("correction_jobs", { _id: id });
}
remain = Object.values(by).reduce((sum, n) => sum + n, 0);
const summary = redactMw19({
  ok: remain === 0,
  remain,
  by,
  enableOverrun: ready.enableOverrun,
  note: "独立核查：按 paper/attempt/preview 关系计数，不采用 DELETE 成功数"
});
writeJson(join(mw19Tmp(), "mw19-independent.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if (remain !== 0) process.exit(1);
