import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand } from "./mw06-lib.mjs";
import { mergeSandboxVirtualPayEnv } from "./mw21-lib.mjs";
import { leftoverResolveDecision, isSha256Hex } from "./mw13-lib.mjs";

export const MW26_DEPLOY_ENTRIES = ["mw-admin", "mw-public", "mw-jobs"];
export const MW26_COLLECTIONS = [];
export const MW26_INDEXES = [];
export const MW26_FIXTURE_ROUND = "MW26";
export const MW26_FIXTURE_MARKER = "mw26-load";
export const MW26_TARGET = { members: 10000, papers: 1000, attempts: 100000 };
export const MW26_TARGET_CONCURRENCY = 50;
export const MW26_FIXTURE_COLLECTIONS = [
  "members",
  "identities",
  "member_stats",
  "papers",
  "paper_versions",
  "attempts",
  "score_metrics"
];
export const MW26_NEVER_DELETE = [
  "jobs",
  "audit_logs",
  "idempotency",
  "ranking_heads",
  "ranking_rows",
  "app_config",
  "categories",
  "orders",
  "refunds",
  "payment_receipts",
  "callback_events",
  "vip_accounts",
  "vip_grants",
  "vip_plans"
];

export const MW26_SECURITY_IDS = [
  "S01",
  "S02",
  "S03",
  "S04",
  "S05",
  "S06",
  "S07",
  "S08",
  "S09",
  "S10",
  "S11",
  "S12",
  "S13",
  "S14",
  "S15",
  "S16",
  "S17"
];

export function mergeSandboxVirtualPayEnv26(existingEnvs = {}) {
  return mergeSandboxVirtualPayEnv(existingEnvs);
}

export function mw26Tmp() {
  const dir = join(projectRoot(), "tmp", "mw26");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw26(value) {
  return redact(value);
}

export function emptyMw26Counts() {
  return {
    members: 0,
    identities: 0,
    member_stats: 0,
    papers: 0,
    paper_versions: 0,
    attempts: 0,
    score_metrics: 0
  };
}

export function mw26CleanupPeriodKeys(state) {
  const weekKey = typeof state?.weekKeyShanghai === "string" ? state.weekKeyShanghai.trim() : "";
  const monthKey = typeof state?.monthKeyShanghai === "string" ? state.monthKeyShanghai.trim() : "";
  if (!weekKey || !monthKey) {
    return { ok: false, reason: "PERIOD_KEYS_MISSING" };
  }
  return {
    ok: true,
    reason: "PERIOD_KEYS_OK",
    seededAt: typeof state?.seededAt === "string" ? state.seededAt : "",
    weekKeyShanghai: weekKey,
    monthKeyShanghai: monthKey
  };
}

export function mw26LeftoverDecision(input) {
  const leftoverDocs = Math.max(Number(input.fixtureRemain || 0), Number(input.knownIdRemain || 0));
  if (input.wroteDocs !== true) {
    return { ok: false, reason: "WROTE_DOCS_FALSE", leftoverDocs };
  }
  if (input.resolved !== true) {
    return { ok: false, reason: "KNOWN_IDS_NOT_RESOLVED", leftoverDocs };
  }
  if (Number(input.knownIdRemain || 0) > 0) {
    return { ok: false, reason: "KNOWN_IDS_REMAIN", leftoverDocs };
  }
  if (Number(input.fixtureRemain || 0) > 0) {
    return { ok: false, reason: "INDEPENDENT_REMAIN", leftoverDocs };
  }
  if (input.seedPresent !== true) {
    return { ok: false, reason: "SEED_CATEGORIES_MISSING", leftoverDocs: 0 };
  }
  return { ok: true, reason: "LEFTOVER_CLEARED", leftoverDocs: 0 };
}

export function mw26ScaleBlockedReason(actual, target = MW26_TARGET) {
  if (actual.members >= target.members && actual.papers >= target.papers && actual.attempts >= target.attempts) {
    return null;
  }
  return `SCALE_DEGRADED actual=${actual.members}/${actual.papers}/${actual.attempts} target=${target.members}/${target.papers}/${target.attempts}`;
}

export function percentileNearestRank(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

export function omitDocId(payload) {
  const out = { ...payload };
  delete out._id;
  return out;
}

export function nosqlUpsertCommand(collection, id, payload) {
  const body = omitDocId(payload);
  if (Object.prototype.hasOwnProperty.call(body, "_id")) {
    throw new Error("MW26_ID_IN_PAYLOAD");
  }
  return {
    TableName: collection,
    CommandType: "UPDATE",
    Command: JSON.stringify({
      update: collection,
      updates: [{ q: { _id: id }, u: { $set: body }, upsert: true }]
    })
  };
}

export function nosqlDeleteCommand(collection, id) {
  return {
    TableName: collection,
    CommandType: "DELETE",
    Command: JSON.stringify({
      delete: collection,
      deletes: [{ q: { _id: id }, limit: 1 }]
    })
  };
}

export function nosqlCountCommand(collection, query) {
  return {
    TableName: collection,
    CommandType: "COMMAND",
    Command: JSON.stringify({ count: collection, query })
  };
}

export { createCollectionCommand, createIndexCommand, listIndexCommand, leftoverResolveDecision, isSha256Hex, projectRoot };
