import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand } from "./mw06-lib.mjs";

export const MW20_DEPLOY_ENTRIES = ["mw-admin", "mw-member"];
export const MW20_COLLECTIONS = ["vip_accounts", "vip_grants", "vip_events"];
export const FORBIDDEN_FUTURE_COLLECTIONS = [
  "orders",
  "vip_plans",
  "payment_receipts",
  "callback_events",
  "refunds"
];
export const MW20_INDEXES = [
  {
    collection: "vip_grants",
    name: "idx_vip_grants_member_sequence",
    keys: [
      { name: "memberId", direction: 1 },
      { name: "sequence", direction: 1 }
    ]
  }
];
export const MW20_NEVER_DELETE = [
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

export function mw20Tmp() {
  const dir = join(projectRoot(), "tmp", "mw20");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw20(value) {
  return redact(value);
}

export function emptyMw20KnownIds() {
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
    sourceIds: []
  };
}

export function knownIdCountOf(knownIds) {
  return Object.values(knownIds || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

export function mw20LeftoverDecision(input) {
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
