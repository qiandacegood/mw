import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw20KnownIds, FORBIDDEN_FUTURE_COLLECTIONS, knownIdCountOf, mw20LeftoverDecision, mw20Tmp, redactMw20 } from "./mw20-lib.mjs";

const tmp = mw20Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW20-leftover", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw20-leftover-evidence.json"), redactMw20(evidence));
}

function loadState() {
  const path = join(projectRoot(), "configs", "mw20-verify-state.json");
  if (!existsSync(path)) {
    return { wroteDocs: false, resolved: false, knownIds: emptyMw20KnownIds() };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: { ...emptyMw20KnownIds(), ...(parsed.knownIds || {}) }
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
  grants: await countExact("vip_grants", state.knownIds.grants || []),
  vipEvents: await countExact("vip_events", state.knownIds.vipEvents || []),
  accounts: await countExact("vip_accounts", state.knownIds.accounts || [])
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
    ["attempts", { paperId: id }],
    ["score_events", { paperId: id }],
    ["paper_bests", { paperId: id }]
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
for (const id of state.knownIds.members || []) {
  for (const [collection, query] of [
    ["vip_grants", { memberId: id, sourceType: "gift" }],
    ["vip_events", { memberId: id }],
    ["vip_accounts", { _id: id }]
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

let forbiddenPresent = false;
for (const name of FORBIDDEN_FUTURE_COLLECTIONS) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([{ TableName: name, CommandType: "COMMAND", Command: JSON.stringify({ count: name, query: {} }) }]),
    "--json"
  ]);
  if ((parseNosqlCount(result) || 0) > 0) forbiddenPresent = true;
}

const remainIds = leftoverDocs > 0 ? { leftover: ["x"] } : emptyMw20KnownIds();
const decision = mw20LeftoverDecision({
  wroteDocs: state.wroteDocs,
  resolved: state.resolved,
  knownIds: remainIds,
  independentRemain,
  seedPresent: seedPresent === seedCategoryIds().length,
  forbiddenPresent
});
record("decision", { ...decision, leftoverDocs, independentRemain, seedPresent });
writeJson(join(tmp, "mw20-leftover-evidence.json"), redactMw20({ ...evidence, finishedAt: new Date().toISOString() }));
console.log(JSON.stringify(redactMw20({ ...decision, leftoverDocs, independentRemain, leftoverByKey, seedPresent }), null, 2));
if (!decision.ok) process.exit(1);
