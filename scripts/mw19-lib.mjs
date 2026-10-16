import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand } from "./mw06-lib.mjs";

export const MW19_DEPLOY_ENTRIES = ["mw-admin", "mw-jobs", "mw-member", "mw-public"];
export const MW19_COLLECTIONS = ["correction_previews", "correction_jobs"];
export const FORBIDDEN_FUTURE_COLLECTIONS = [
  "orders",
  "vip_accounts",
  "vip_plans",
  "vip_grants",
  "vip_events"
];
export const MW19_INDEXES = [
  {
    collection: "correction_previews",
    name: "idx_correction_previews_expires",
    keys: [
      { name: "expiresAt", direction: 1 },
      { name: "_id", direction: 1 }
    ]
  },
  {
    collection: "attempts",
    name: "idx_attempts_paper_state_id",
    keys: [
      { name: "paperId", direction: 1 },
      { name: "state", direction: 1 },
      { name: "_id", direction: 1 }
    ]
  }
];
export const MW19_NEVER_DELETE = [
  "jobs",
  "audit_logs",
  "idempotency",
  "ranking_heads",
  "ranking_rows",
  "app_config",
  "members",
  "member_stats",
  "categories"
];

export function mw19Tmp() {
  const dir = join(projectRoot(), "tmp", "mw19");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw19(value) {
  return redact(value);
}

export function emptyMw19KnownIds() {
  return {
    papers: [],
    questions: [],
    questionVersions: [],
    attempts: [],
    previews: [],
    work: [],
    versions: [],
    chunks: [],
    answers: [],
    events: [],
    bests: []
  };
}

export function knownIdCountOf(knownIds) {
  return Object.values(knownIds || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

export function mw19LeftoverDecision(input) {
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
