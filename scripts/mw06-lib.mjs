import { createHmac, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, projectRoot, readEnvFile, redact, writeJson } from "./mw04-lib.mjs";
import { functionConfigs, parseFunctionEnv, readMw05LocalConfig, redactMw05, MW05_OFFICIAL_FUNCTIONS } from "./mw05-lib.mjs";

export const MW06_COLLECTIONS = ["jobs", "idempotency", "audit_logs", "app_config"];
export const MW06_TEST_PREFIX = "mw06/test";
export const MW06_INDEXES = [
  {
    collection: "jobs",
    name: "idx_jobs_state_nextrun_id",
    keys: [
      { name: "state", direction: 1 },
      { name: "nextRunAt", direction: 1 },
      { name: "_id", direction: 1 }
    ]
  },
  {
    collection: "audit_logs",
    name: "idx_audit_target_created_id",
    keys: [
      { name: "target", direction: 1 },
      { name: "createdAt", direction: -1 },
      { name: "_id", direction: 1 }
    ]
  }
];

export function mw06Tmp() {
  const dir = join(projectRoot(), "tmp", "mw06");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
  return out;
}

export function signServerInvoke(secret, payload) {
  const body = { ...payload };
  const mac = createHmac("sha256", secret).update(JSON.stringify(canonicalize(body))).digest("hex");
  return { ...body, mac };
}

export function readJobsInvokeToken(root = projectRoot()) {
  const fileEnv = readEnvFile(join(root, ".env"));
  const raw = process.env.MW_JOBS_INVOKE_TOKEN || fileEnv.MW_JOBS_INVOKE_TOKEN || "";
  return raw.trim();
}

export function ensureJobsInvokeToken(root = projectRoot()) {
  const current = readJobsInvokeToken(root);
  if (current && !/placeholder|example|xxxx|your-/i.test(current) && current.length >= 24) {
    return { token: current, generated: false };
  }
  const token = randomBytes(32).toString("hex");
  appendFileSync(join(root, ".env"), `\nMW_JOBS_INVOKE_TOKEN=${token}\n`, "utf8");
  return { token, generated: true };
}

export function buildMw06FunctionConfigs(allowedMiniAppIds, token, existingEnvs = {}) {
  return functionConfigs(allowedMiniAppIds).map((fn) => {
    const existing = { ...(existingEnvs[fn.name] || {}) };
    delete existing.MW_JOBS_INVOKE_TOKEN;
    const envVariables = {
      ...existing,
      MW_ALLOWED_MINI_APPIDS: allowedMiniAppIds || existing.MW_ALLOWED_MINI_APPIDS || ""
    };
    if (fn.name === "mw-jobs") {
      envVariables.MW_JOBS_INVOKE_TOKEN = token;
    }
    return { ...fn, envVariables };
  });
}

export function writeMw06Cloudbaserc(existingEnvs = {}) {
  const envId = authorizedEnvId();
  const { allowedMiniAppIds } = readMw05LocalConfig();
  const { token } = ensureJobsInvokeToken();
  const functions = buildMw06FunctionConfigs(allowedMiniAppIds, token, existingEnvs);
  const config = {
    version: "2.0",
    envId,
    region: "ap-shanghai",
    functionRoot: "./cloudfunctions",
    functions
  };
  writeJson(join(projectRoot(), "cloudbaserc.json"), config);
  return {
    written: true,
    tokenPresent: true,
    tokenTargets: functions.filter((fn) => Object.prototype.hasOwnProperty.call(fn.envVariables, "MW_JOBS_INVOKE_TOKEN")).map((fn) => fn.name),
    functions
  };
}

export { parseFunctionEnv, MW05_OFFICIAL_FUNCTIONS };

export function redactMw06(value) {
  const hidden = [];
  const token = readJobsInvokeToken();
  if (token) hidden.push(token);
  const first = redactMw05(redact(value));
  return hideStrings(first, hidden);
}

function hideStrings(value, hidden) {
  if (value == null) return value;
  if (typeof value === "string") {
    let out = value;
    for (const item of hidden) {
      if (item && out.includes(item)) out = out.split(item).join("[redacted]");
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => hideStrings(item, hidden));
  if (typeof value === "object") {
    const out = {};
    for (const [key, next] of Object.entries(value)) out[key] = hideStrings(next, hidden);
    return out;
  }
  return value;
}

export function inspectOfficialJobsTokenPresence(presenceByFunction = {}) {
  const tokenTargets = [];
  let confirmed = true;
  for (const name of MW05_OFFICIAL_FUNCTIONS) {
    const present = presenceByFunction[name];
    if (present !== true && present !== false) {
      confirmed = false;
      continue;
    }
    if (present === true) tokenTargets.push(name);
  }
  return {
    jobsTokenConfirmed: confirmed,
    tokenPresent: tokenTargets.includes("mw-jobs"),
    tokenTargets
  };
}

export function parseNosqlCount(result) {
  if (!result || result.code !== 0) return null;
  const first = result.json?.data?.results?.[0] ?? result.json?.results?.[0];
  const raw = first?.n ?? first?.[0]?.n ?? result.json?.data?.n ?? result.json?.n;
  return bsonNumber(raw);
}

export function bsonNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value === "object") {
    if (typeof value.$numberInt === "string" || typeof value.$numberInt === "number") return Number(value.$numberInt);
    if (typeof value.$numberLong === "string" || typeof value.$numberLong === "number") return Number(value.$numberLong);
    if (typeof value.$numberDouble === "string" || typeof value.$numberDouble === "number") return Number(value.$numberDouble);
  }
  return null;
}

export function mw06LeftoverDecision(state) {
  const collectionNames = Array.isArray(state.collectionNames) ? state.collectionNames : null;
  const missingCollections = collectionNames ? MW06_COLLECTIONS.filter((name) => !collectionNames.includes(name)) : MW06_COLLECTIONS.slice();
  const leftoverDocs = typeof state.testDocCount === "number" && Number.isFinite(state.testDocCount) ? state.testDocCount : null;
  const missingIndexList = Array.isArray(state.missingIndexes) ? state.missingIndexes : null;
  const aclObtained = state.aclObtained === true && typeof state.acl === "string" && state.acl.length > 0;
  const acl = aclObtained ? state.acl : "";
  const clientDenied = state.clientDenied === true;
  const collectionsConfirmed = state.collectionsConfirmed === true && collectionNames !== null;
  const indexesConfirmed = state.indexesConfirmed === true && missingIndexList !== null;
  const testDocsConfirmed = state.testDocsConfirmed === true && leftoverDocs !== null;
  const timerConfirmed = state.timerConfirmed === true && typeof state.jobsTimerDeployed === "boolean";
  const enableOverrunConfirmed = state.enableOverrunConfirmed === true && typeof state.enableOverrun === "boolean";
  const overrun = state.enableOverrun === true;
  const timerDeployed = state.jobsTimerDeployed === true;
  const reasons = [];
  if (!aclObtained) reasons.push("ACL_NOT_OBTAINED");
  if (aclObtained && acl !== "ADMINONLY") reasons.push("ACL_NOT_ADMINONLY");
  if (state.clientDenied !== true) reasons.push("CLIENT_READ_NOT_DENIED");
  if (!collectionsConfirmed) reasons.push("COLLECTIONS_NOT_CONFIRMED");
  if (collectionsConfirmed && missingCollections.length) reasons.push("COLLECTIONS_MISSING");
  if (!indexesConfirmed) reasons.push("INDEXES_NOT_CONFIRMED");
  if (indexesConfirmed && missingIndexList.length) reasons.push("INDEXES_MISSING");
  if (!testDocsConfirmed) reasons.push("TEST_DOCS_NOT_CONFIRMED");
  if (testDocsConfirmed && leftoverDocs !== 0) reasons.push("TEST_DOCS_LEFT");
  if (!timerConfirmed) reasons.push("TIMER_NOT_CONFIRMED");
  if (timerConfirmed && timerDeployed) reasons.push("TIMER_DEPLOYED");
  if (!enableOverrunConfirmed) reasons.push("OVERRUN_NOT_CONFIRMED");
  if (enableOverrunConfirmed && overrun) reasons.push("OVERRUN_ENABLED");
  const tokenInspect = inspectOfficialJobsTokenPresence(state.tokenPresence);
  if (state.jobsTokenConfirmed !== true && tokenInspect.jobsTokenConfirmed !== true) reasons.push("JOBS_TOKEN_NOT_CONFIRMED");
  const tokenPresent = state.tokenPresent === true || tokenInspect.tokenPresent;
  const tokenTargets = Array.isArray(state.tokenTargets) ? state.tokenTargets : tokenInspect.tokenTargets;
  const jobsTokenConfirmed = state.jobsTokenConfirmed === true || tokenInspect.jobsTokenConfirmed;
  if (jobsTokenConfirmed && tokenPresent !== true) reasons.push("JOBS_TOKEN_MISSING");
  if (jobsTokenConfirmed && tokenTargets.some((name) => name !== "mw-jobs")) reasons.push("JOBS_TOKEN_LEAKED");
  const ok = reasons.length === 0;
  return {
    ok,
    exitCode: ok ? 0 : 1,
    reasons,
    tokenPresent: tokenPresent === true,
    tokenTargets,
    jobsTokenConfirmed,
    missingCollections,
    leftoverDocs: leftoverDocs === null ? -1 : leftoverDocs,
    missingIndexes: missingIndexList || [],
    enableOverrun: Boolean(state.enableOverrun),
    acl,
    aclObtained,
    clientDenied,
    collectionsConfirmed,
    indexesConfirmed,
    testDocsConfirmed,
    timerConfirmed,
    enableOverrunConfirmed,
    jobsTimerDeployed: Boolean(state.jobsTimerDeployed)
  };
}

export function createCollectionCommand(name) {
  return {
    TableName: name,
    CommandType: "COMMAND",
    Command: JSON.stringify({ create: name })
  };
}

export function createIndexCommand(index) {
  const key = {};
  for (const item of index.keys) key[item.name] = item.direction;
  return {
    TableName: index.collection,
    CommandType: "COMMAND",
    Command: JSON.stringify({
      createIndexes: index.collection,
      indexes: [{ name: index.name, key }]
    })
  };
}

export function listIndexCommand(collection) {
  return {
    TableName: collection,
    CommandType: "COMMAND",
    Command: JSON.stringify({ listIndexes: collection })
  };
}

export function defaultMaintenanceDoc(now = new Date()) {
  const flag = { enabled: true, reason: "", jobId: "", revision: 1 };
  return {
    _id: "maintenance",
    schemaVersion: 1,
    kind: "maintenance",
    revision: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    contentWrites: { ...flag },
    attemptStart: { ...flag },
    attemptSubmit: { ...flag },
    purchaseCreate: { ...flag },
    entitlementApply: { ...flag }
  };
}

export function readLocalRulesExample() {
  const path = join(projectRoot(), "infra", "cloudbase", "security-rules.example.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}
