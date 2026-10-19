import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand } from "./mw06-lib.mjs";
import { leftoverResolveDecision, isSha256Hex } from "./mw13-lib.mjs";
import { mergeSandboxVirtualPayEnv } from "./mw21-lib.mjs";

export const MW27_DEPLOY_ENTRIES = ["mw-admin", "mw-public", "mw-jobs", "mw-pay-hook"];
export const MW27_FIXTURE_ROUND = "MW27";
export const MW27_FIXTURE_MARKER = "mw27-restore";
export const MW27_ISOLATED_RESTORE_COLLECTIONS = [
  "mw27_rst_orders",
  "mw27_rst_payment_receipts",
  "mw27_rst_callback_events",
  "mw27_rst_refunds",
  "mw27_rst_vip_grants",
  "mw27_rst_jobs"
];
export const MW27_LIVE_FIXTURE_COLLECTIONS = [
  "members",
  "identities",
  "orders",
  "payment_receipts",
  "callback_events",
  "refunds",
  "vip_accounts",
  "vip_grants",
  "vip_events",
  "jobs"
];
export const MW27_NEVER_DELETE = [
  "audit_logs",
  "idempotency",
  "ranking_heads",
  "ranking_rows",
  "app_config",
  "categories",
  "media_assets"
];
export const MW27_STORAGE_PREFIXES = [
  "mw-test/media/import/",
  "mw-test/media/analysis/",
  "mw-test/media/prompt/"
];
export const MW27_APP_CONFIG_KEYS = ["maintenance", "catalog", "growth", "policies", "ranking"];
export const MW27_SPECIFIED_INDEXES = [
  { collection: "categories", name: "idx_categories_parent_deleted_sort_id" },
  { collection: "questions", name: "idx_questions_category_status_updated_id" },
  { collection: "papers", name: "idx_papers_status_category_published_id" },
  { collection: "papers", name: "idx_papers_status_sort_id" },
  { collection: "attempts", name: "idx_attempts_member_state_submitted_id" },
  { collection: "attempts", name: "idx_attempts_paper_state_id" },
  { collection: "paper_bests", name: "idx_paper_bests_member_paper" },
  { collection: "score_events", name: "idx_score_events_member_paper_seq" },
  { collection: "score_metrics", name: "idx_score_metrics_board_source" },
  { collection: "ranking_rows", name: "idx_ranking_rows_board_generation_ordinal" },
  { collection: "orders", name: "idx_orders_member_created" },
  { collection: "orders", name: "idx_orders_paystate_nextcheck" },
  { collection: "vip_grants", name: "idx_vip_grants_member_sequence" },
  { collection: "jobs", name: "idx_jobs_state_nextrun_id" },
  { collection: "import_rows", name: "idx_import_rows_batch_row" },
  { collection: "audit_logs", name: "idx_audit_target_created_id" },
  { collection: "refunds", name: "idx_refunds_order_updated" },
  { collection: "medal_grants", name: "idx_medal_grants_member_awarded" }
];

export function mergeSandboxVirtualPayEnv27(existingEnvs = {}) {
  return mergeSandboxVirtualPayEnv(existingEnvs);
}

export function mw27Tmp() {
  const dir = join(projectRoot(), "tmp", "mw27");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw27(value) {
  return redact(value);
}

export function emptyMw27Counts() {
  return {
    members: 0,
    identities: 0,
    orders: 0,
    payment_receipts: 0,
    callback_events: 0,
    refunds: 0,
    vip_accounts: 0,
    vip_grants: 0,
    vip_events: 0,
    jobs: 0,
    isolated: 0
  };
}

export function mw27LeftoverDecision(input) {
  const leftoverDocs = Math.max(
    Number(input.fixtureRemain || 0),
    Number(input.isolatedRemain || 0),
    Number(input.knownIdRemain || 0)
  );
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
  if (Number(input.isolatedRemain || 0) > 0) {
    return { ok: false, reason: "ISOLATED_RESTORE_REMAIN", leftoverDocs };
  }
  if (input.seedPresent !== true) {
    return { ok: false, reason: "SEED_CATEGORIES_MISSING", leftoverDocs: 0 };
  }
  return { ok: true, reason: "LEFTOVER_CLEARED", leftoverDocs: 0 };
}

export function omitDocId(payload) {
  const out = { ...payload };
  delete out._id;
  return out;
}

export function nosqlUpsertCommand(collection, id, payload) {
  const body = omitDocId(payload);
  if (Object.prototype.hasOwnProperty.call(body, "_id")) {
    throw new Error("MW27_ID_IN_PAYLOAD");
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

export function nosqlFindCommand(collection, query, limit = 1) {
  return {
    TableName: collection,
    CommandType: "COMMAND",
    Command: JSON.stringify({ find: collection, filter: query, limit })
  };
}

export function listCollectionsCommand() {
  return {
    TableName: "categories",
    CommandType: "COMMAND",
    Command: JSON.stringify({ listCollections: 1 })
  };
}

export function extractFirstDoc(result) {
  const first = result?.json?.data?.results?.[0] ?? result?.json?.results?.[0] ?? result?.json?.data;
  if (Array.isArray(first)) return first[0] || null;
  if (first && typeof first === "object") {
    if (Array.isArray(first.list)) return first.list[0] || null;
    if (Array.isArray(first.cursor)) return first.cursor[0] || null;
    if (first._id || first.data) return first.data || first;
  }
  return first && typeof first === "object" ? first : null;
}

export function extractIndexNames(result) {
  const raw = result?.json?.data?.results ?? result?.json?.results ?? result?.json?.data ?? [];
  const names = [];
  const walk = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "object") {
      if (typeof value.name === "string") names.push(value.name);
      Object.values(value).forEach(walk);
    }
  };
  walk(raw);
  return [...new Set(names)];
}

export { createCollectionCommand, createIndexCommand, listIndexCommand, leftoverResolveDecision, isSha256Hex, projectRoot };
