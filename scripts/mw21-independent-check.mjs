import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw21KnownIds, mw21Tmp, redactMw21 } from "./mw21-lib.mjs";

function loadState() {
  const path = join(projectRoot(), "configs", "mw21-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, resolved: false, knownIds: emptyMw21KnownIds() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: { ...emptyMw21KnownIds(), ...(parsed.knownIds || {}) }
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
  const summary = redactMw21({ ok: false, reason: state.wroteDocs ? "KNOWN_IDS_NOT_RESOLVED" : "WROTE_DOCS_FALSE", remain: -1 });
  writeJson(join(mw21Tmp(), "mw21-independent.json"), summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

const by = { papers: 0, attempts: 0, plans: 0, orders: 0, receipts: 0, callbacks: 0, grants: 0, vipEvents: 0 };
for (const id of state.knownIds.papers) {
  by.papers += await countQuery("papers", { _id: id });
  by.attempts += await countQuery("attempts", { paperId: id });
}
for (const id of state.knownIds.attempts) {
  by.attempts += await countQuery("attempts", { _id: id });
}
for (const id of state.knownIds.plans) {
  by.plans += await countQuery("vip_plans", { _id: id });
}
for (const id of state.knownIds.orders) {
  by.orders += await countQuery("orders", { _id: id });
  by.receipts += await countQuery("payment_receipts", { orderId: id });
  by.callbacks += await countQuery("callback_events", { orderId: id });
}
for (const id of state.knownIds.receipts) {
  by.receipts += await countQuery("payment_receipts", { _id: id });
}
for (const id of state.knownIds.callbacks) {
  by.callbacks += await countQuery("callback_events", { _id: id });
}
for (const id of state.knownIds.grants) {
  by.grants += await countQuery("vip_grants", { _id: id, sourceType: "order" });
}
for (const id of state.knownIds.vipEvents) {
  by.vipEvents += await countQuery("vip_events", { _id: id });
}
for (const id of state.knownIds.members) {
  by.grants += await countQuery("vip_grants", { memberId: id, sourceType: "order" });
}
const remain = Object.values(by).reduce((sum, n) => sum + n, 0);
const summary = redactMw21({
  ok: remain === 0,
  remain,
  by,
  derivedIdsUsed: false,
  enableOverrun: ready.enableOverrun,
  note: "独立核查：按入册套餐/订单/order 账本/本轮卷计数，不采用 DELETE 成功数，不把 gift / 账号当 leftover"
});
writeJson(join(mw21Tmp(), "mw21-independent.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if (remain !== 0) process.exit(1);
