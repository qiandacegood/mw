import { createHmac, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, projectRoot, readEnvFile, redact, writeJson } from "./mw04-lib.mjs";
import { functionConfigs, readMw05LocalConfig, redactMw05 } from "./mw05-lib.mjs";

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

export function writeMw06Cloudbaserc() {
  const envId = authorizedEnvId();
  const { allowedMiniAppIds } = readMw05LocalConfig();
  const { token } = ensureJobsInvokeToken();
  const config = {
    version: "2.0",
    envId,
    region: "ap-shanghai",
    functionRoot: "./cloudfunctions",
    functions: functionConfigs(allowedMiniAppIds, { MW_JOBS_INVOKE_TOKEN: token })
  };
  writeJson(join(projectRoot(), "cloudbaserc.json"), config);
  return { written: true, tokenPresent: true };
}

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

export function mw06LeftoverDecision(state) {
  const missingCollections = MW06_COLLECTIONS.filter((name) => !(state.collectionNames || []).includes(name));
  const leftoverDocs = Number(state.testDocCount || 0);
  const missingIndexes = (state.missingIndexes || []).length;
  const overrun = state.enableOverrun === true;
  const storageOpen = state.acl && state.acl !== "ADMINONLY";
  const timerDeployed = state.jobsTimerDeployed === true;
  const ok =
    missingCollections.length === 0 &&
    leftoverDocs === 0 &&
    missingIndexes === 0 &&
    !overrun &&
    !storageOpen &&
    !timerDeployed;
  return {
    ok,
    exitCode: ok ? 0 : 1,
    missingCollections,
    leftoverDocs,
    missingIndexes: state.missingIndexes || [],
    enableOverrun: Boolean(state.enableOverrun),
    acl: state.acl || "",
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
