import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, readEnvFile, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand } from "./mw06-lib.mjs";
import { mergeSandboxVirtualPayEnv, MW21_DEPLOY_ENTRIES } from "./mw21-lib.mjs";

export const MW22_DEPLOY_ENTRIES = MW21_DEPLOY_ENTRIES;
export const MW22_COLLECTIONS = ["refunds", "reconcile_diffs"];
export const MW22_INDEXES = [
  {
    collection: "refunds",
    name: "idx_refunds_order_updated",
    keys: [
      { name: "orderId", direction: 1 },
      { name: "updatedAt", direction: -1 },
      { name: "_id", direction: 1 }
    ]
  },
  {
    collection: "reconcile_diffs",
    name: "idx_reconcile_diffs_status_updated",
    keys: [
      { name: "status", direction: 1 },
      { name: "updatedAt", direction: -1 },
      { name: "_id", direction: 1 }
    ]
  }
];
export const MW22_NEVER_DELETE = [
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

export function mergeSandboxVirtualPayEnv22(existingEnvs = {}) {
  return mergeSandboxVirtualPayEnv(existingEnvs);
}

export function mw22Tmp() {
  const dir = join(projectRoot(), "tmp", "mw22");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw22(value) {
  return redact(value);
}

export function emptyMw22KnownIds() {
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
    refunds: [],
    diffs: [],
    sourceIds: []
  };
}

export function knownIdCountOf(knownIds) {
  return Object.values(knownIds || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

export function mw22LeftoverDecision(input) {
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
  return { ok: true, reason: "LEFTOVER_CLEARED", leftoverDocs: 0 };
}

export { createCollectionCommand, createIndexCommand, listIndexCommand, projectRoot, readEnvFile };
