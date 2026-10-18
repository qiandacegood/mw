import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw22KnownIds, mw22Tmp, redactMw22 } from "./mw22-lib.mjs";

function loadState() {
  const path = join(projectRoot(), "configs", "mw22-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, resolved: false, knownIds: emptyMw22KnownIds() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: { ...emptyMw22KnownIds(), ...(parsed.knownIds || {}) }
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
  const summary = redactMw22({ ok: false, reason: state.wroteDocs ? "KNOWN_IDS_NOT_RESOLVED" : "WROTE_DOCS_FALSE", remain: -1 });
  writeJson(join(mw22Tmp(), "mw22-independent.json"), summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

const by = { papers: 0, attempts: 0, plans: 0, orders: 0, receipts: 0, callbacks: 0, refunds: 0, diffs: 0, grants: 0, vipEvents: 0 };
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
  by.refunds += await countQuery("refunds", { orderId: id });
  by.diffs += await countQuery("reconcile_diffs", { orderId: id });
}
for (const id of state.knownIds.refunds) {
  by.refunds += await countQuery("refunds", { _id: id });
}
for (const id of state.knownIds.diffs) {
  by.diffs += await countQuery("reconcile_diffs", { _id: id });
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
const summary = redactMw22({
  ok: remain === 0,
  remain,
  by,
  derivedIdsUsed: false,
  enableOverrun: ready.enableOverrun,
  note: "独立核查：按入册退款单/订单/order 账本/本轮卷计数，不采用 DELETE 成功数，不把 gift / 账号当 leftover"
});
writeJson(join(mw22Tmp(), "mw22-independent.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if (remain !== 0) process.exit(1);
