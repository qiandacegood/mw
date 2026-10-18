import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand } from "./mw06-lib.mjs";
import { mergeSandboxVirtualPayEnv } from "./mw21-lib.mjs";

export const MW23_DEPLOY_ENTRIES = ["mw-admin", "mw-member", "mw-public"];
export const MW23_COLLECTIONS = ["feedbacks"];
export const MW23_INDEXES = [
  {
    collection: "feedbacks",
    name: "idx_feedbacks_status_created",
    keys: [
      { name: "status", direction: 1 },
      { name: "createdAt", direction: -1 },
      { name: "_id", direction: 1 }
    ]
  },
  {
    collection: "feedbacks",
    name: "idx_feedbacks_member_created",
    keys: [
      { name: "memberId", direction: 1 },
      { name: "createdAt", direction: -1 },
      { name: "_id", direction: 1 }
    ]
  }
];
export const MW23_NEVER_DELETE = [
  "jobs",
  "audit_logs",
  "idempotency",
  "ranking_heads",
  "ranking_rows",
  "app_config",
  "members",
  "member_stats",
  "identities",
  "categories",
  "vip_accounts",
  "vip_grants",
  "vip_plans",
  "orders",
  "refunds"
];

export function mergeSandboxVirtualPayEnv23(existingEnvs = {}) {
  return mergeSandboxVirtualPayEnv(existingEnvs);
}

export function mw23Tmp() {
  const dir = join(projectRoot(), "tmp", "mw23");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw23(value) {
  return redact(value);
}

export function emptyMw23KnownIds() {
  return {
    members: [],
    papers: [],
    questions: [],
    questionVersions: [],
    attempts: [],
    versions: [],
    chunks: [],
    answers: [],
    feedbacks: []
  };
}

export function knownIdCountOf(knownIds) {
  return Object.values(knownIds || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

export function knownIdCountDeletable(knownIds) {
  const next = { ...emptyMw23KnownIds(), ...(knownIds || {}) };
  return (
    (next.papers || []).length +
    (next.questions || []).length +
    (next.questionVersions || []).length +
    (next.attempts || []).length +
    (next.versions || []).length +
    (next.chunks || []).length +
    (next.answers || []).length +
    (next.feedbacks || []).length
  );
}

export function mw23LeftoverDecision(input) {
  const count = knownIdCountDeletable(input.knownIds);
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

export { createCollectionCommand, createIndexCommand, listIndexCommand, projectRoot };
