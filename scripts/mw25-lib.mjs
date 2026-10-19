import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand } from "./mw06-lib.mjs";
import { mergeSandboxVirtualPayEnv } from "./mw21-lib.mjs";

export const MW25_DEPLOY_ENTRIES = ["mw-admin"];
export const MW25_COLLECTIONS = ["ops_stats_snapshots"];
export const MW25_INDEXES = [];
export const MW25_NEVER_DELETE = [
  "jobs",
  "audit_logs",
  "idempotency",
  "ranking_heads",
  "ranking_rows",
  "app_config",
  "categories",
  "members",
  "member_stats",
  "identities",
  "attempts",
  "vip_accounts",
  "vip_grants",
  "vip_plans",
  "orders",
  "refunds",
  "payment_receipts",
  "callback_events"
];

export function mergeSandboxVirtualPayEnv25(existingEnvs = {}) {
  return mergeSandboxVirtualPayEnv(existingEnvs);
}

export function mw25Tmp() {
  const dir = join(projectRoot(), "tmp", "mw25");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw25(value) {
  return redact(value);
}

export function emptyMw25KnownIds() {
  return {
    snapshots: [],
    tutorialFixtures: []
  };
}

export function knownIdCountOf(knownIds) {
  return Object.values(knownIds || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

export function knownIdCountDeletable(knownIds) {
  const next = { ...emptyMw25KnownIds(), ...(knownIds || {}) };
  return (next.snapshots || []).length + (next.tutorialFixtures || []).length;
}

export function mw25LeftoverDecision(input) {
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
