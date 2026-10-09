import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import {
  FORBIDDEN_FUTURE_COLLECTIONS,
  INITIAL_ROOT_SEEDS,
  MW13_COLLECTIONS,
  emptyMw13KnownIds,
  knownIdCountOf,
  mw13LeftoverDecision,
  redactMw13
} from "./mw13-lib.mjs";

function collectionNames(json) {
  const raw = json?.data?.results?.[0] || json?.data || json;
  const cursor = raw?.cursor || raw;
  const first = Array.isArray(cursor) ? cursor[0] : cursor;
  const cols = first?.cursor?.firstBatch || first?.firstBatch || first?.collections || [];
  if (Array.isArray(cols)) {
    return cols
      .map((item) => (typeof item === "string" ? item : item.name || item.Name || item._id))
      .filter(Boolean);
  }
  return [];
}

function loadState() {
  const path = join(projectRoot(), "configs", "mw13-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, resolved: false, knownIds: emptyMw13KnownIds() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: parsed.knownIds || emptyMw13KnownIds()
  };
}

const ready = await assertMwTestReady();
authorizedEnvId();
const { seedCategoryId } = await import("../packages/shared/dist/category.js");

const listed = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([{ TableName: MW13_COLLECTIONS[0], CommandType: "COMMAND", Command: JSON.stringify({ listCollections: 1 }) }]),
  "--json"
]);
let names = collectionNames(listed.json);
let collectionsConfirmed = listed.code === 0 && MW13_COLLECTIONS.every((name) => names.includes(name));
if (!collectionsConfirmed) {
  const present = [];
  for (const name of MW13_COLLECTIONS) {
    const probe = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([{ TableName: name, CommandType: "COMMAND", Command: JSON.stringify({ count: name, query: {}, limit: 1 }) }]),
      "--json"
    ]);
    const text = `${probe.stdout || ""}${probe.stderr || ""}${JSON.stringify(probe.json || {})}`;
    if (!/NamespaceNotFound|ns not found/i.test(text)) present.push(name);
  }
  names = [...new Set([...names, ...present])];
  collectionsConfirmed = MW13_COLLECTIONS.every((name) => names.includes(name));
}

let seedCount = 0;
for (const seed of INITIAL_ROOT_SEEDS) {
  const counted = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: "categories",
        CommandType: "COMMAND",
        Command: JSON.stringify({ count: "categories", query: { _id: seedCategoryId(seed.seedKey) } })
      }
    ]),
    "--json"
  ]);
  if (parseNosqlCount(counted) === 1) seedCount += 1;
}

const state = loadState();
const ids = state.knownIds;
const leftoverQueries = [
  ...(ids.papers || []).map((id) => ({ collection: "papers", query: { _id: id } })),
  ...(ids.versions || []).map((id) => ({ collection: "paper_versions", query: { _id: id } })),
  ...(ids.chunks || []).map((id) => ({ collection: "paper_chunks", query: { _id: id } })),
  ...(ids.answers || []).map((id) => ({ collection: "paper_answers", query: { _id: id } }))
];
const leftoverObjectIds = (ids.objects || []).filter((id) => typeof id === "string" && id.trim());
const leftoverObjects = leftoverObjectIds.length;
const leftoverObjectsConfirmed = leftoverObjectIds.length === 0;

let testDocCount = 0;
let testDocsConfirmed = true;
if (!state.wroteDocs || !state.resolved || leftoverQueries.length === 0) {
  testDocCount = 0;
  testDocsConfirmed = false;
} else {
  for (const item of leftoverQueries) {
    const counted = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([{ TableName: item.collection, CommandType: "COMMAND", Command: JSON.stringify({ count: item.collection, query: item.query }) }]),
      "--json"
    ]);
    const n = parseNosqlCount(counted);
    if (n === null) testDocsConfirmed = false;
    else testDocCount += n;
  }
}

let clientDenied = false;
try {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({ env: authorizedEnvId(), region: "ap-shanghai" });
  const results = [];
  for (const name of ["papers", "paper_answers"]) {
    try {
      await app.database().collection(name).add({ marker: "MW13" });
      results.push(false);
    } catch {
      results.push(true);
    }
  }
  clientDenied = results.every(Boolean);
} catch {
  clientDenied = false;
}

const futureCollectionsCreated = FORBIDDEN_FUTURE_COLLECTIONS.some((name) => names.includes(name));

const decision = mw13LeftoverDecision({
  collectionNames: names,
  collectionsConfirmed,
  testDocCount,
  testDocsConfirmed,
  leftoverObjects,
  leftoverObjectsConfirmed,
  clientDenied,
  enableOverrun: ready.enableOverrun,
  enableOverrunConfirmed: true,
  otherEnvChanged: false,
  wroteDocs: state.wroteDocs,
  knownIds: ids,
  seedPresent: seedCount === 10,
  seedCount,
  futureCollectionsCreated
});

console.log(
  JSON.stringify(
    redactMw13({
      ...decision,
      collectionNames: names,
      otherEnvCount: ready.otherEnvCount,
      knownIdCount: knownIdCountOf(ids),
      wroteDocs: state.wroteDocs,
      cloudWriteClaimed: state.wroteDocs,
      exactIdSweepOnly: true,
      leftoverObjectsConfirmed,
      seedCount
    }),
    null,
    2
  )
);
process.exit(decision.exitCode ?? 1);
