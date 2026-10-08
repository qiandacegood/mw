import { authorizedEnvId, assertMwTestReady, redact, runTcb } from "./mw04-lib.mjs";
import {
  inspectOfficialJobsTokenPresence,
  listIndexCommand,
  MW05_OFFICIAL_FUNCTIONS,
  MW06_COLLECTIONS,
  MW06_INDEXES,
  MW06_TEST_PREFIX,
  mw06LeftoverDecision,
  parseFunctionEnv,
  parseNosqlCount
} from "./mw06-lib.mjs";

function parseAcl(aclResult) {
  if (!aclResult || aclResult.code !== 0) {
    return { obtained: false, acl: "" };
  }
  const raw = aclResult.json?.data?.acl ?? aclResult.json?.acl ?? aclResult.json?.data?.ACL ?? aclResult.json?.data;
  if (typeof raw === "string" && raw.trim()) {
    return { obtained: true, acl: raw.trim() };
  }
  if (raw && typeof raw === "object" && typeof raw.acl === "string" && raw.acl.trim()) {
    return { obtained: true, acl: raw.acl.trim() };
  }
  return { obtained: false, acl: "" };
}

function parseCount(result) {
  return parseNosqlCount(result);
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

let names = collectionNames(listed.json);
let collectionsConfirmed = listed.code === 0 && MW06_COLLECTIONS.every((name) => names.includes(name));
if (!collectionsConfirmed) {
  const present = [];
  let probesOk = true;
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
    if (/NamespaceNotFound|ns not found/i.test(text)) {
      probesOk = false;
      continue;
    }
    if (probe.code !== 0 && !/already exists|ok/i.test(text)) {
      probesOk = false;
      continue;
    }
    present.push(name);
  }
  names = [...new Set([...names, ...present])];
  collectionsConfirmed = probesOk && MW06_COLLECTIONS.every((name) => names.includes(name));
}

let testDocCount = 0;
let testDocsConfirmed = true;
const leftoverQueries = [
  { collection: "jobs", query: { jobId: { $regex: `^${MW06_TEST_PREFIX}` } } },
  { collection: "idempotency", query: { actorId: { $regex: `^${MW06_TEST_PREFIX}` } } },
  { collection: "idempotency", query: { idempotencyKey: { $regex: `^${MW06_TEST_PREFIX}` } } },
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
  const n = parseCount(counted);
  if (n === null) {
    testDocsConfirmed = false;
  } else {
    testDocCount += n;
  }
}

const missingIndexes = [];
let indexesConfirmed = true;
for (const index of MW06_INDEXES) {
  const listedIndex = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([listIndexCommand(index.collection)]),
    "--json"
  ]);
  if (listedIndex.code !== 0 || !listedIndex.json) {
    indexesConfirmed = false;
    missingIndexes.push(index.name);
    continue;
  }
  const text = JSON.stringify(listedIndex.json || listedIndex.stdout || "");
  if (!text.includes(index.name) && !text.includes(index.keys[0].name)) {
    missingIndexes.push(index.name);
  }
}

const fnDetail = await runTcb(["fn", "detail", "mw-jobs", "--json"]);
const timerConfirmed = fnDetail.code === 0 && Boolean(fnDetail.json);
const triggers = fnDetail.json?.data?.Triggers || fnDetail.json?.Triggers || [];
const jobsTimerDeployed = Array.isArray(triggers) && triggers.some((item) => /timer/i.test(JSON.stringify(item)));

const aclResult = await runTcb(["storage", "rules", "get", "--json"]);
const aclParsed = parseAcl(aclResult);

let clientDenied = false;
let clientAttempted = false;
try {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({ env: authorizedEnvId(), region: "ap-shanghai" });
  try {
    clientAttempted = true;
    await app.database().collection("jobs").limit(1).get();
    clientDenied = false;
  } catch {
    clientDenied = true;
  }
} catch {
  clientAttempted = false;
  clientDenied = false;
}

const tokenPresence = {};
let jobsTokenReadOk = true;
for (const name of MW05_OFFICIAL_FUNCTIONS) {
  const detail = await runTcb(["fn", "detail", name, "--json"]);
  if (detail.code !== 0 || !detail.json) {
    jobsTokenReadOk = false;
    continue;
  }
  const env = parseFunctionEnv(detail.json);
  tokenPresence[name] = Object.prototype.hasOwnProperty.call(env, "MW_JOBS_INVOKE_TOKEN");
}
const tokenInspect = inspectOfficialJobsTokenPresence(tokenPresence);

const enableOverrunConfirmed = typeof ready.enableOverrun === "boolean";
const decision = mw06LeftoverDecision({
  collectionNames: names,
  collectionsConfirmed,
  testDocCount,
  testDocsConfirmed,
  missingIndexes,
  indexesConfirmed,
  enableOverrun: ready.enableOverrun === true,
  enableOverrunConfirmed,
  acl: aclParsed.acl,
  aclObtained: aclParsed.obtained,
  clientDenied: clientAttempted && clientDenied,
  jobsTimerDeployed,
  timerConfirmed,
  jobsTokenConfirmed: jobsTokenReadOk && tokenInspect.jobsTokenConfirmed,
  tokenPresent: tokenInspect.tokenPresent,
  tokenTargets: tokenInspect.tokenTargets,
  tokenPresence
});

const printed = redact({
  ...decision,
  collectionNames: names.filter((name) => MW06_COLLECTIONS.includes(name) || name === "admin_users"),
  clientDenied: clientAttempted ? clientDenied : "NOT_CONFIRMED",
  otherEnvCount: ready.otherEnvCount
});
printed.tokenPresent = decision.tokenPresent === true;
printed.tokenTargets = Array.isArray(decision.tokenTargets) ? decision.tokenTargets.slice() : [];
console.log(JSON.stringify(printed, null, 2));
process.exit(decision.exitCode);
