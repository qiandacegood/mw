import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw22KnownIds, knownIdCountOf, mw22LeftoverDecision, mw22Tmp, redactMw22 } from "./mw22-lib.mjs";

const tmp = mw22Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW22-leftover", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw22-leftover-evidence.json"), redactMw22(evidence));
}

function loadState() {
  const path = join(projectRoot(), "configs", "mw22-verify-state.json");
  if (!existsSync(path)) {
    return { wroteDocs: false, resolved: false, knownIds: emptyMw22KnownIds() };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: { ...emptyMw22KnownIds(), ...(parsed.knownIds || {}) }
  };
}

async function countExact(collection, ids) {
  let leftover = 0;
  for (const id of ids) {
    const result = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([{ TableName: collection, CommandType: "COMMAND", Command: JSON.stringify({ count: collection, query: { _id: id } }) }]),
      "--json"
    ]);
    leftover += parseNosqlCount(result) || 0;
  }
  return leftover;
}

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadState();
record("state", { wroteDocs: state.wroteDocs, resolved: state.resolved, knownIdCount: knownIdCountOf(state.knownIds) });

const leftoverByKey = {
  papers: await countExact("papers", state.knownIds.papers || []),
  questions: await countExact("questions", state.knownIds.questions || []),
  attempts: await countExact("attempts", state.knownIds.attempts || []),
  plans: await countExact("vip_plans", state.knownIds.plans || []),
  orders: await countExact("orders", state.knownIds.orders || []),
  receipts: await countExact("payment_receipts", state.knownIds.receipts || []),
  callbacks: await countExact("callback_events", state.knownIds.callbacks || []),
  refunds: await countExact("refunds", state.knownIds.refunds || []),
  diffs: await countExact("reconcile_diffs", state.knownIds.diffs || []),
  grants: await countExact("vip_grants", state.knownIds.grants || []),
  vipEvents: await countExact("vip_events", state.knownIds.vipEvents || [])
};
const leftoverDocs = Object.values(leftoverByKey).reduce((sum, n) => sum + n, 0);
record("known_ids_path", leftoverByKey);

const { seedCategoryIds } = await import("../packages/shared/dist/category.js");
let seedPresent = 0;
for (const id of seedCategoryIds()) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([{ TableName: "categories", CommandType: "COMMAND", Command: JSON.stringify({ count: "categories", query: { _id: id } }) }]),
    "--json"
  ]);
  seedPresent += parseNosqlCount(result) || 0;
}

let independentRemain = 0;
for (const id of state.knownIds.papers || []) {
  for (const [collection, query] of [
    ["papers", { _id: id }],
    ["attempts", { paperId: id }]
  ]) {
    const result = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([{ TableName: collection, CommandType: "COMMAND", Command: JSON.stringify({ count: collection, query }) }]),
      "--json"
    ]);
    independentRemain += parseNosqlCount(result) || 0;
  }
}
for (const id of state.knownIds.orders || []) {
  for (const [collection, query] of [
    ["orders", { _id: id }],
    ["payment_receipts", { orderId: id }],
    ["callback_events", { orderId: id }],
    ["refunds", { orderId: id }],
    ["reconcile_diffs", { orderId: id }]
  ]) {
    const result = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([{ TableName: collection, CommandType: "COMMAND", Command: JSON.stringify({ count: collection, query }) }]),
      "--json"
    ]);
    independentRemain += parseNosqlCount(result) || 0;
  }
}
for (const id of state.knownIds.refunds || []) {
  independentRemain += await countExact("refunds", [id]);
}
for (const id of state.knownIds.plans || []) {
  independentRemain += await countExact("vip_plans", [id]);
}
for (const id of state.knownIds.grants || []) {
  independentRemain += await countExact("vip_grants", [id]);
}
for (const id of state.knownIds.members || []) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: "vip_grants",
        CommandType: "COMMAND",
        Command: JSON.stringify({ count: "vip_grants", query: { memberId: id, sourceType: "order" } })
      }
    ]),
    "--json"
  ]);
  independentRemain += parseNosqlCount(result) || 0;
}

const remainIds = leftoverDocs > 0 ? { leftover: ["x"] } : emptyMw22KnownIds();
const decision = mw22LeftoverDecision({
  wroteDocs: state.wroteDocs,
  resolved: state.resolved,
  knownIds: remainIds,
  independentRemain,
  seedPresent: seedPresent === seedCategoryIds().length
});
record("decision", { ...decision, leftoverDocs, independentRemain, seedPresent });
writeJson(join(tmp, "mw22-leftover-evidence.json"), redactMw22({ ...evidence, finishedAt: new Date().toISOString() }));
console.log(JSON.stringify(redactMw22({ ...decision, leftoverDocs, independentRemain, leftoverByKey, seedPresent }), null, 2));
if (!decision.ok) process.exit(1);
