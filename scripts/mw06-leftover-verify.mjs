import { authorizedEnvId, assertMwTestReady, redact, runTcb } from "./mw04-lib.mjs";
import { MW06_COLLECTIONS, MW06_INDEXES, MW06_TEST_PREFIX, listIndexCommand, mw06LeftoverDecision } from "./mw06-lib.mjs";

const ready = await assertMwTestReady();
const listed = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([
    {
      TableName: MW06_COLLECTIONS[0],
      CommandType: "COMMAND",
      Command: JSON.stringify({ listCollections: 1 })
    }
  ]),
  "--json"
]);

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

let names = collectionNames(listed.json);
if (!MW06_COLLECTIONS.every((name) => names.includes(name))) {
  const present = [];
  for (const name of MW06_COLLECTIONS) {
    const probe = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([
        {
          TableName: name,
          CommandType: "COMMAND",
          Command: JSON.stringify({ count: name, query: {}, limit: 1 })
        }
      ]),
      "--json"
    ]);
    const text = `${probe.stdout || ""}${probe.stderr || ""}${JSON.stringify(probe.json || {})}`;
    if (!/NamespaceNotFound|ns not found/i.test(text)) present.push(name);
  }
  names = [...new Set([...names, ...present])];
}
let testDocCount = 0;
const leftoverQueries = [
  { collection: "jobs", query: { jobId: { $regex: `^${MW06_TEST_PREFIX}` } } },
  { collection: "idempotency", query: { actorId: { $regex: `^${MW06_TEST_PREFIX}` } } },
  { collection: "audit_logs", query: { target: { $regex: `^jobs/${MW06_TEST_PREFIX}` } } }
];
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
  const n = counted.json?.data?.results?.[0]?.n ?? counted.json?.data?.n ?? 0;
  if (typeof n === "number") testDocCount += n;
}

const missingIndexes = [];
for (const index of MW06_INDEXES) {
  const listedIndex = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([listIndexCommand(index.collection)]),
    "--json"
  ]);
  const text = JSON.stringify(listedIndex.json || listedIndex.stdout || "");
  if (!text.includes(index.name) && !text.includes(index.keys[0].name)) {
    missingIndexes.push(index.name);
  }
}

const fnDetail = await runTcb(["fn", "detail", "mw-jobs", "--json"]);
const triggers = fnDetail.json?.data?.Triggers || fnDetail.json?.Triggers || [];
const jobsTimerDeployed = Array.isArray(triggers) && triggers.some((item) => /timer/i.test(JSON.stringify(item)));

const acl = await runTcb(["storage", "rules", "get", "--json"]);
let client = { attempted: false };
try {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({ env: authorizedEnvId(), region: "ap-shanghai" });
  try {
    await app.database().collection("jobs").limit(1).get();
    client = { attempted: true, ok: true };
  } catch (error) {
    client = { attempted: true, ok: false, code: error && error.code };
  }
} catch (error) {
  client = { attempted: false, error: { message: error && error.message } };
}

const decision = mw06LeftoverDecision({
  collectionNames: names,
  testDocCount,
  missingIndexes,
  enableOverrun: ready.enableOverrun,
  acl: acl.json?.data?.acl,
  jobsTimerDeployed
});

console.log(
  JSON.stringify(
    redact({
      ...decision,
      collectionNames: names.filter((name) => MW06_COLLECTIONS.includes(name) || name === "admin_users"),
      clientDenied: client.attempted ? client.ok === false : "NOT_CONFIRMED",
      otherEnvCount: ready.otherEnvCount
    }),
    null,
    2
  )
);
process.exit(decision.exitCode);
