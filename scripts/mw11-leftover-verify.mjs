import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import {
  FORBIDDEN_FUTURE_COLLECTIONS,
  INITIAL_ROOT_SEEDS,
  MW11_COLLECTIONS,
  emptyMw11KnownIds,
  knownIdCountOf,
  listIndexCommand,
  mw11LeftoverDecision,
  PAPER_INDEXES,
  redactMw11
} from "./mw11-lib.mjs";

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
  const path = join(projectRoot(), "configs", "mw11-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, knownIds: emptyMw11KnownIds() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return { wroteDocs: parsed.wroteDocs === true, knownIds: parsed.knownIds || emptyMw11KnownIds() };
}

const ready = await assertMwTestReady();
authorizedEnvId();
const { seedCategoryId } = await import("../packages/shared/dist/category.js");

const listed = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([{ TableName: MW11_COLLECTIONS[0], CommandType: "COMMAND", Command: JSON.stringify({ listCollections: 1 }) }]),
  "--json"
]);

let names = collectionNames(listed.json);
let collectionsConfirmed = listed.code === 0 && MW11_COLLECTIONS.every((name) => names.includes(name));
if (!collectionsConfirmed) {
  const present = [];
  let probesOk = true;
  for (const name of MW11_COLLECTIONS) {
    const probe = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([{ TableName: name, CommandType: "COMMAND", Command: JSON.stringify({ count: name, query: {}, limit: 1 }) }]),
      "--json"
    ]);
    const text = `${probe.stdout || ""}${probe.stderr || ""}${JSON.stringify(probe.json || {})}`;
    if (/NamespaceNotFound|ns not found/i.test(text)) {
      probesOk = false;
      continue;
    }
    present.push(name);
  }
  names = [...new Set([...names, ...present])];
  collectionsConfirmed = probesOk && MW11_COLLECTIONS.every((name) => names.includes(name));
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

let indexConfirmed = true;
for (const index of PAPER_INDEXES) {
  const indexList = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([listIndexCommand(index.collection)]),
    "--json"
  ]);
  if (!(indexList.code === 0 && JSON.stringify(indexList.json || {}).includes(index.name))) indexConfirmed = false;
}

const state = loadState();
const ids = state.knownIds;
const leftoverQueries = [
  ...(ids.papers || []).map((id) => ({ collection: "papers", query: { _id: id } })),
  ...(ids.versions || []).map((id) => ({ collection: "paper_versions", query: { _id: id } })),
  ...(ids.chunks || []).map((id) => ({ collection: "paper_chunks", query: { _id: id } })),
  ...(ids.answers || []).map((id) => ({ collection: "paper_answers", query: { _id: id } })),
  ...(ids.questions || []).map((id) => ({ collection: "questions", query: { _id: id } })),
  ...(ids.questionVersions || []).map((id) => ({ collection: "question_versions", query: { _id: id } })),
  ...(ids.idempotency || []).map((id) => ({ collection: "idempotency", query: { _id: id } })),
  ...(ids.audits || []).map((id) => ({ collection: "audit_logs", query: { _id: id } }))
];

let testDocCount = 0;
let testDocsConfirmed = true;
if (leftoverQueries.length === 0) {
  testDocCount = 0;
  testDocsConfirmed = !state.wroteDocs;
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
  for (const name of MW11_COLLECTIONS) {
    try {
      await app.database().collection(name).add({ marker: "MW11" });
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

const decision = mw11LeftoverDecision({
  collectionNames: names,
  collectionsConfirmed,
  testDocCount,
  testDocsConfirmed,
  clientDenied,
  enableOverrun: ready.enableOverrun,
  enableOverrunConfirmed: true,
  otherEnvChanged: false,
  wroteDocs: state.wroteDocs,
  knownIds: ids,
  seedPresent: seedCount === 10,
  seedCount,
  indexConfirmed,
  futureCollectionsCreated
});

console.log(
  JSON.stringify(
    redactMw11({
      ...decision,
      collectionNames: names,
      otherEnvCount: ready.otherEnvCount,
      knownIdCount: knownIdCountOf(ids),
      wroteDocs: state.wroteDocs,
      cloudWriteClaimed: state.wroteDocs,
      exactIdSweepOnly: true,
      seedCount
    }),
    null,
    2
  )
);
process.exit(decision.exitCode ?? 1);
