import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, readEnvFile, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand } from "./mw06-lib.mjs";

const VIRTUAL_PAY_ENV_KEYS = [
  "VIRTUAL_PAY_OFFER_ID",
  "VIRTUAL_PAY_ENV",
  "VIRTUAL_PAY_APP_KEY",
  "VIRTUAL_PAY_NOTIFY_TOKEN",
  "VIRTUAL_PAY_ENCODING_AES_KEY",
  "WECHAT_APP_ID",
  "WECHAT_APP_SECRET"
];

export function mergeSandboxVirtualPayEnv(existingEnvs = {}) {
  const local = readEnvFile(join(projectRoot(), ".env"));
  const sandbox = String(local.VIRTUAL_PAY_ENV || "").trim();
  if (sandbox !== "1") {
    throw new Error("VIRTUAL_PAY_ENV must stay sandbox (1); refusing to merge live or empty env");
  }
  const patch = {};
  for (const key of VIRTUAL_PAY_ENV_KEYS) {
    const value = String(local[key] || "").trim();
    if (value) patch[key] = value;
  }
  if (!patch.VIRTUAL_PAY_APP_KEY || !patch.VIRTUAL_PAY_OFFER_ID || !patch.WECHAT_APP_ID) {
    throw new Error("sandbox virtual-pay local env incomplete");
  }
  const next = { ...existingEnvs };
  for (const name of MW21_DEPLOY_ENTRIES) {
    const current = { ...(next[name] || {}) };
    delete current.Variables;
    delete current.VIRTUAL_PAY_APP_KEY_LIVE;
    next[name] = { ...current, ...patch };
  }
  return { envs: next, sandbox: true, mergedKeys: Object.keys(patch) };
}

export const MW21_DEPLOY_ENTRIES = ["mw-admin", "mw-member", "mw-pay-hook"];
export const MW21_COLLECTIONS = ["vip_plans", "orders", "payment_receipts", "callback_events"];
export const FORBIDDEN_COLLECTIONS = ["refunds"];
export const MW21_INDEXES = [
  {
    collection: "orders",
    name: "idx_orders_member_created",
    keys: [
      { name: "memberId", direction: 1 },
      { name: "createdAt", direction: -1 },
      { name: "_id", direction: 1 }
    ]
  },
  {
    collection: "orders",
    name: "idx_orders_paystate_nextcheck",
    keys: [
      { name: "payState", direction: 1 },
      { name: "nextCheckAt", direction: 1 },
      { name: "_id", direction: 1 }
    ]
  }
];
export const MW21_NEVER_DELETE = [
  "jobs",
  "audit_logs",
  "idempotency",
  "ranking_heads",
  "ranking_rows",
  "app_config",
  "members",
  "member_stats",
  "identities",
  "categories"
];

export function mw21Tmp() {
  const dir = join(projectRoot(), "tmp", "mw21");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw21(value) {
  return redact(value);
}

export function emptyMw21KnownIds() {
  return {
    members: [],
    papers: [],
    questions: [],
    questionVersions: [],
    attempts: [],
    versions: [],
    chunks: [],
    answers: [],
    events: [],
    bests: [],
    grants: [],
    vipEvents: [],
    accounts: [],
    plans: [],
    orders: [],
    receipts: [],
    callbacks: [],
    sourceIds: []
  };
}

export function knownIdCountOf(knownIds) {
  return Object.values(knownIds || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

export function mw21LeftoverDecision(input) {
  const count = knownIdCountOf(input.knownIds);
  if (input.wroteDocs !== true) {
    return { ok: false, reason: "WROTE_DOCS_FALSE", leftoverDocs: count };
  }
  if (input.resolved !== true) {
    return { ok: false, reason: "KNOWN_IDS_NOT_RESOLVED", leftoverDocs: count };
  }
  if (count > 0) {
    return { ok: false, reason: "KNOWN_IDS_REMAIN", leftoverDocs: count };
  }
  if (input.independentRemain > 0) {
    return { ok: false, reason: "INDEPENDENT_REMAIN", leftoverDocs: input.independentRemain };
  }
  if (input.seedPresent !== true) {
    return { ok: false, reason: "SEED_CATEGORIES_MISSING", leftoverDocs: 0 };
  }
  if (input.forbiddenPresent === true) {
    return { ok: false, reason: "FORBIDDEN_COLLECTION_PRESENT", leftoverDocs: 0 };
  }
  return { ok: true, reason: "LEFTOVER_CLEARED", leftoverDocs: 0 };
}

export { createCollectionCommand, createIndexCommand, listIndexCommand };
