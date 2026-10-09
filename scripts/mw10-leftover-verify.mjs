import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, publicObjectUrls, runTcb } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import {
  FORBIDDEN_FUTURE_COLLECTIONS,
  INITIAL_ROOT_SEEDS,
  MW10_COLLECTIONS,
  emptyMw10KnownIds,
  knownIdCountOf,
  listIndexCommand,
  mw10LeftoverDecision,
  QUESTION_INDEX,
  redactMw10
} from "./mw10-lib.mjs";

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
  const path = join(projectRoot(), "configs", "mw10-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, knownIds: emptyMw10KnownIds() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return { wroteDocs: parsed.wroteDocs === true, knownIds: parsed.knownIds || emptyMw10KnownIds() };
}

const ready = await assertMwTestReady();
authorizedEnvId();
const { seedCategoryId } = await import("../packages/shared/dist/category.js");

const listed = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([{ TableName: MW10_COLLECTIONS[0], CommandType: "COMMAND", Command: JSON.stringify({ listCollections: 1 }) }]),
  "--json"
]);

let names = collectionNames(listed.json);
let collectionsConfirmed = listed.code === 0 && MW10_COLLECTIONS.every((name) => names.includes(name));
if (!collectionsConfirmed) {
  const present = [];
  let probesOk = true;
  for (const name of MW10_COLLECTIONS) {
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
  collectionsConfirmed = probesOk && MW10_COLLECTIONS.every((name) => names.includes(name));
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
  JSON.stringify([listIndexCommand(QUESTION_INDEX.collection)]),
  "--json"
]);
const indexConfirmed = indexList.code === 0 && JSON.stringify(indexList.json || {}).includes(QUESTION_INDEX.name);

const state = loadState();
const ids = state.knownIds;
const leftoverQueries = [
  ...(ids.questions || []).map((id) => ({ collection: "questions", query: { _id: id } })),
  ...(ids.versions || []).map((id) => ({ collection: "question_versions", query: { _id: id } })),
  ...(ids.assets || []).map((id) => ({ collection: "media_assets", query: { _id: id } })),
  ...(ids.tickets || []).map((id) => ({ collection: "upload_tickets", query: { _id: id } })),
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

let testObjectCount = 0;
let testObjectsConfirmed = true;
if (!(ids.objects || []).length) {
  testObjectCount = 0;
  testObjectsConfirmed = !state.wroteDocs;
} else {
  for (const objectKey of ids.objects) {
    const listedObj = await runTcb(["storage", "list", objectKey, "--json"]);
    const text = JSON.stringify(listedObj.json || {});
    if (listedObj.code !== 0 && !/not found|NoSuchKey|404/i.test(`${listedObj.stderr || ""}${text}`)) {
      testObjectsConfirmed = false;
    } else if (/fileID|Key|cloudPath/i.test(text) && !/\[\]/.test(text)) {
      testObjectCount += 1;
    }
  }
}

const aclResult = await runTcb(["storage", "rules", "get", "--json"]);
const aclParsed = parseAcl(aclResult);

let clientDenied = false;
let storageDenied = false;
try {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({ env: authorizedEnvId(), region: "ap-shanghai" });
  try {
    await app.database().collection("questions").add({ marker: "MW10" });
    clientDenied = false;
  } catch {
    clientDenied = true;
  }
  try {
    await app.database().collection("question_versions").add({ marker: "MW10" });
    clientDenied = clientDenied && false;
  } catch {
    clientDenied = clientDenied && true;
  }
  try {
    await app.database().collection("media_assets").add({ marker: "MW10" });
    clientDenied = clientDenied && false;
  } catch {
    clientDenied = clientDenied && true;
  }
  try {
    await app.database().collection("upload_tickets").add({ marker: "MW10" });
    clientDenied = clientDenied && false;
  } catch {
    clientDenied = clientDenied && true;
  }
} catch {
  clientDenied = false;
}

storageDenied = false;
try {
  const urls = publicObjectUrls(ready.storageHosts, "mw-test/media/unauthorized-probe");
  let saw200 = false;
  let saw403 = false;
  for (const url of urls) {
    const response = await fetch(url, { redirect: "manual" });
    if (response.status === 200) saw200 = true;
    if (response.status === 403) saw403 = true;
  }
  storageDenied = !saw200 && (saw403 || aclParsed.acl === "ADMINONLY");
} catch {
  storageDenied = aclParsed.acl === "ADMINONLY";
}

const futureCollectionsCreated = FORBIDDEN_FUTURE_COLLECTIONS.some((name) => names.includes(name));

const decision = mw10LeftoverDecision({
  collectionNames: names,
  collectionsConfirmed,
  testDocCount,
  testDocsConfirmed,
  testObjectCount,
  testObjectsConfirmed,
  clientDenied,
  storageDenied,
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
    redactMw10({
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
