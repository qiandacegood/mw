import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand } from "./mw06-lib.mjs";

export const MW18_DEPLOY_ENTRIES = ["mw-admin", "mw-jobs", "mw-public", "mw-member"];
export const MW18_COLLECTIONS = ["catalog_change_previews", "catalog_change_jobs"];
export const MW18_KEEP_COLLECTIONS = [
  "categories",
  "category_names",
  "jobs",
  "idempotency",
  "audit_logs",
  "ranking_heads",
  "ranking_rows",
  "app_config",
  "score_metrics",
  "paper_bests",
  "members",
  "member_stats"
];
export const FORBIDDEN_FUTURE_COLLECTIONS = [
  "orders",
  "vip_accounts",
  "vip_plans",
  "vip_grants",
  "vip_events"
];
export const MW18_INDEXES = [
  {
    collection: "catalog_change_previews",
    name: "idx_catalog_change_previews_expires",
    keys: [
      { name: "expiresAt", direction: 1 },
      { name: "_id", direction: 1 }
    ]
  },
  {
    collection: "jobs",
    name: "idx_jobs_type_state_nextrun",
    keys: [
      { name: "type", direction: 1 },
      { name: "state", direction: 1 },
      { name: "nextRunAt", direction: 1 }
    ]
  }
];

export function mw18Tmp() {
  const dir = join(projectRoot(), "tmp", "mw18");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw18(value) {
  return redact(value);
}

export function emptyMw18KnownIds() {
  return {
    categories: [],
    questions: [],
    papers: [],
    previews: [],
    work: []
  };
}

export function knownIdCountOf(knownIds) {
  return Object.values(knownIds || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

export function mw18LeftoverDecision(input) {
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
  if (input.seedPresent !== true) {
    return { ok: false, reason: "SEED_CATEGORIES_MISSING", leftoverDocs: 0 };
  }
  if (input.forbiddenPresent === true) {
    return { ok: false, reason: "FORBIDDEN_COLLECTION_PRESENT", leftoverDocs: 0 };
  }
  return { ok: true, reason: "LEFTOVER_CLEARED", leftoverDocs: 0 };
}

export { createCollectionCommand, createIndexCommand, listIndexCommand };
