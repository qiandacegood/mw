import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import {
  CATEGORY_INDEX,
  INITIAL_ROOT_SEEDS,
  MW09_COLLECTIONS,
  emptyMw09KnownIds,
  knownIdCountOf,
  listIndexCommand,
  mw09LeftoverDecision,
  redactMw09
} from "./mw09-lib.mjs";

function parseAcl(aclResult) {
  if (!aclResult || aclResult.code !== 0) return { obtained: false, acl: "" };
  const raw = aclResult.json?.data?.acl ?? aclResult.json?.acl ?? aclResult.json?.data?.ACL ?? aclResult.json?.data;
  if (typeof raw === "string" && raw.trim()) return { obtained: true, acl: raw.trim() };
  if (raw && typeof raw === "object" && typeof raw.acl === "string" && raw.acl.trim()) {
    return { obtained: true, acl: raw.acl.trim() };
  }
  return { obtained: false, acl: "" };
}

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
  const path = join(projectRoot(), "configs", "mw09-verify-state.json");
  if (!existsSync(path)) {
    return { wroteDocs: false, knownIds: emptyMw09KnownIds() };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    knownIds: parsed.knownIds || emptyMw09KnownIds()
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
  JSON.stringify([
    {
      TableName: MW09_COLLECTIONS[0],
      CommandType: "COMMAND",
      Command: JSON.stringify({ listCollections: 1 })
    }
  ]),
  "--json"
]);

let names = collectionNames(listed.json);
let collectionsConfirmed = listed.code === 0 && MW09_COLLECTIONS.every((name) => names.includes(name));
if (!collectionsConfirmed) {
  const present = [];
  let probesOk = true;
  for (const name of MW09_COLLECTIONS) {
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
  collectionsConfirmed = probesOk && MW09_COLLECTIONS.every((name) => names.includes(name));
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

const indexList = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([listIndexCommand(CATEGORY_INDEX.collection)]),
  "--json"
]);
const indexText = JSON.stringify(indexList.json || {});
const indexConfirmed = indexList.code === 0 && indexText.includes(CATEGORY_INDEX.name);

const state = loadState();
const ids = state.knownIds;
const leftoverQueries = [
  ...(ids.categories || []).map((id) => ({ collection: "categories", query: { _id: id } })),
  ...(ids.names || []).map((id) => ({ collection: "category_names", query: { _id: id } })),
  ...(ids.idempotency || []).map((id) => ({ collection: "idempotency", query: { _id: id } })),
  ...(ids.audits || []).map((id) => ({ collection: "audit_logs", query: { _id: id } }))
];

let testDocCount = 0;
let testDocsConfirmed = true;
if (leftoverQueries.length === 0) {
  testDocCount = 0;
  testDocsConfirmed = true;
} else {
  for (const item of leftoverQueries) {
    const counted = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([
        {
          TableName: item.collection,
          CommandType: "COMMAND",
          Command: JSON.stringify({ count: item.collection, query: item.query })
        }
      ]),
      "--json"
    ]);
    const n = parseNosqlCount(counted);
    if (n === null) testDocsConfirmed = false;
    else testDocCount += n;
  }
}

const aclResult = await runTcb(["storage", "rules", "get", "--json"]);
const aclParsed = parseAcl(aclResult);

let clientDenied = false;
try {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({ env: authorizedEnvId(), region: "ap-shanghai" });
  try {
    await app.database().collection("categories").add({ marker: "MW09" });
    clientDenied = false;
  } catch {
    clientDenied = true;
  }
} catch {
  clientDenied = false;
}

const futureNames = ["questions", "papers", "attempts", "orders", "vip_accounts", "vip_plans", "vip_grants"];
const futureCollectionsCreated = futureNames.some((name) => names.includes(name));

const decision = mw09LeftoverDecision({
  collectionNames: names,
  collectionsConfirmed,
  testDocCount,
  testDocsConfirmed,
  clientDenied,
  aclObtained: aclParsed.obtained,
  acl: aclParsed.acl,
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
    redactMw09({
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
