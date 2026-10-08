import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { MW08_COLLECTIONS, mw08LeftoverDecision, redactMw08 } from "./mw08-lib.mjs";

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

function knownIds() {
  const path = join(projectRoot(), "configs", "mw08-verify-state.json");
  if (!existsSync(path)) {
    return { identities: [], members: [], stats: [], idempotency: [], audits: [] };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return parsed.knownIds || { identities: [], members: [], stats: [], idempotency: [], audits: [] };
}

const ready = await assertMwTestReady();
const listed = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([
    {
      TableName: MW08_COLLECTIONS[0],
      CommandType: "COMMAND",
      Command: JSON.stringify({ listCollections: 1 })
    }
  ]),
  "--json"
]);

let names = collectionNames(listed.json);
let collectionsConfirmed = listed.code === 0 && MW08_COLLECTIONS.every((name) => names.includes(name));
if (!collectionsConfirmed) {
  const present = [];
  let probesOk = true;
  for (const name of MW08_COLLECTIONS) {
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
  collectionsConfirmed = probesOk && MW08_COLLECTIONS.every((name) => names.includes(name));
}

const ids = knownIds();
const leftoverQueries = [
  ...ids.identities.map((id) => ({ collection: "identities", query: { _id: id } })),
  ...ids.members.map((id) => ({ collection: "members", query: { _id: id } })),
  ...ids.stats.map((id) => ({ collection: "member_stats", query: { _id: id } })),
  ...ids.idempotency.map((id) => ({ collection: "idempotency", query: { _id: id } })),
  ...ids.audits.map((id) => ({ collection: "audit_logs", query: { _id: id } }))
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
    await app.database().collection("identities").add({ marker: "MW08" });
    clientDenied = false;
  } catch {
    clientDenied = true;
  }
} catch {
  clientDenied = false;
}

const decision = mw08LeftoverDecision({
  collectionNames: names,
  collectionsConfirmed,
  testDocCount,
  testDocsConfirmed,
  clientDenied,
  aclObtained: aclParsed.obtained,
  acl: aclParsed.acl,
  enableOverrun: ready.enableOverrun,
  enableOverrunConfirmed: true,
  otherEnvChanged: false
});

console.log(
  JSON.stringify(
    redactMw08({
      ...decision,
      collectionNames: names,
      otherEnvCount: ready.otherEnvCount,
      knownIdCount:
        ids.identities.length + ids.members.length + ids.stats.length + ids.idempotency.length + ids.audits.length
    }),
    null,
    2
  )
);
process.exit(decision.exitCode ?? 1);
