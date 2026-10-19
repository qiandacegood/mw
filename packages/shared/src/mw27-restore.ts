import { hashNamedFields } from "./canonical.js";
import {
  acquireLease,
  assertWritableLease,
  resumeJob,
  saveCursor,
  type JobRecord
} from "./jobs.js";
import {
  callbackEventId,
  orderDocId,
  paymentReceiptId,
  VIRTUAL_PAY_PROVIDER
} from "./vip-purchase.js";
import { refundDocId } from "./vip-refund.js";
import {
  applyVipGrant,
  VIP_SOURCE_ORDER,
  vipEventId,
  vipGrantId,
  type VipGrantRecord
} from "./vip.js";
import { MAINTENANCE_GATES, PAYMENT_NOTIFY_ENTRY, paymentNotifyBlockedByMaintenance, type MaintenanceConfig } from "./maintenance.js";

/**
 * MW27 备份恢复与发布回退演练契约。
 * 隔离目标 = mw-test 上回档新集合 / 本轮夹具。不得覆盖现库或其它环境。
 */

export const MW27_FIXTURE_ROUND = "MW27";
export const MW27_FIXTURE_MARKER = "mw27-restore";
export const MW27_IDENTITY_APP_ID = "wxmw27fixtureappid0001";
export const MW27_RESULT_VALUES = ["PASS", "FAIL", "BLOCKED", "NOT_RUN"] as const;
export type Mw27Result = (typeof MW27_RESULT_VALUES)[number];

export const MW27_ID_FIELDS = ["round", "kind", "index"] as const;
export const MW27_RPO_TARGET_MS = 24 * 60 * 60 * 1000;
export const MW27_RTO_TARGET_MS = 4 * 60 * 60 * 1000;

export const MW27_BASELINE_COLLECTIONS = [
  "identities",
  "members",
  "member_stats",
  "active_attempts",
  "admin_users",
  "app_config",
  "audit_logs",
  "idempotency",
  "jobs",
  "categories",
  "category_names",
  "questions",
  "question_versions",
  "papers",
  "paper_versions",
  "paper_chunks",
  "paper_answers",
  "media_assets",
  "upload_tickets",
  "attempts",
  "paper_bests",
  "score_events",
  "score_metrics",
  "medal_grants",
  "ranking_heads",
  "ranking_rows",
  "vip_plans",
  "orders",
  "payment_receipts",
  "callback_events",
  "refunds",
  "reconcile_diffs",
  "vip_accounts",
  "vip_grants",
  "vip_events",
  "import_batches",
  "import_rows",
  "source_keys",
  "feedbacks",
  "ops_stats_snapshots"
] as const;

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
] as const;

export const MW27_STORAGE_PREFIXES = [
  "mw-test/media/import/",
  "mw-test/media/analysis/",
  "mw-test/media/prompt/"
] as const;

export const MW27_APP_CONFIG_KEYS = ["maintenance", "catalog", "growth", "policies", "ranking"] as const;

export const MW27_ISOLATED_RESTORE_COLLECTIONS = [
  "mw27_rst_orders",
  "mw27_rst_payment_receipts",
  "mw27_rst_callback_events",
  "mw27_rst_refunds",
  "mw27_rst_vip_grants",
  "mw27_rst_jobs"
] as const;

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
] as const;

export const MW27_NEVER_DELETE = [
  "audit_logs",
  "idempotency",
  "ranking_heads",
  "ranking_rows",
  "app_config",
  "categories",
  "media_assets"
] as const;

export const MW27_RANKING_NOT_LEFTOVER = ["ranking_heads", "ranking_rows"] as const;

export const MW27_CODE_ROLLBACK_RULES = [
  { id: "R1", rule: "回滚函数包不回滚数据" },
  { id: "R2", rule: "schema 先扩展再收缩" },
  { id: "R3", rule: "旧代码读不了新 schema 时不得回退" },
  { id: "R4", rule: "本轮不把函数滚到更旧的损坏包" }
] as const;

export const MW27_MAINTENANCE_DRILL_GATES = [
  "contentWrites",
  "attemptStart",
  "attemptSubmit",
  "purchaseCreate",
  "entitlementApply"
] as const;

export type Mw27FixtureKind =
  | "member"
  | "identity"
  | "order_granted"
  | "order_pending"
  | "receipt"
  | "callback_paid"
  | "callback_pending"
  | "refund_pending"
  | "vip_grant"
  | "vip_account"
  | "vip_event"
  | "job_interrupted"
  | "job_review";

export const MW27_FIXTURE_KINDS: readonly Mw27FixtureKind[] = [
  "member",
  "identity",
  "order_granted",
  "order_pending",
  "receipt",
  "callback_paid",
  "callback_pending",
  "refund_pending",
  "vip_grant",
  "vip_account",
  "vip_event",
  "job_interrupted",
  "job_review"
];

export type Mw27FixtureCounts = {
  members: number;
  identities: number;
  orders: number;
  payment_receipts: number;
  callback_events: number;
  refunds: number;
  vip_accounts: number;
  vip_grants: number;
  vip_events: number;
  jobs: number;
  isolated: number;
};

export function emptyMw27Counts(): Mw27FixtureCounts {
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

export function plannedMw27Counts(): Mw27FixtureCounts {
  return {
    members: 1,
    identities: 1,
    orders: 2,
    payment_receipts: 1,
    callback_events: 2,
    refunds: 1,
    vip_accounts: 1,
    vip_grants: 1,
    vip_events: 1,
    jobs: 2,
    isolated: 9
  };
}

export function isMw27Result(value: string): value is Mw27Result {
  return (MW27_RESULT_VALUES as readonly string[]).includes(value);
}

export function mw27FixtureId(kind: string, index: number, round = MW27_FIXTURE_ROUND): string {
  return hashNamedFields({ round, kind, index }, MW27_ID_FIELDS);
}

export function mw27OpenId(index = 0, round = MW27_FIXTURE_ROUND): string {
  return hashNamedFields({ round, kind: "openid", index }, MW27_ID_FIELDS);
}

export function mw27ChannelBizNo(index: number, round = MW27_FIXTURE_ROUND): string {
  return `MW27${mw27FixtureId("biz", index, round).slice(0, 24)}`;
}

export function mw27StableEventKey(kind: "pay" | "refund" | "pending", index = 0, round = MW27_FIXTURE_ROUND): string {
  return `${round}/${kind}/${index}`;
}

export function mw27OrderId(kind: "order_granted" | "order_pending", index = 0, round = MW27_FIXTURE_ROUND): string {
  return orderDocId(mw27ChannelBizNo(kind === "order_granted" ? index : index + 10, round));
}

export function mw27GrantId(index = 0, round = MW27_FIXTURE_ROUND): string {
  return vipGrantId(VIP_SOURCE_ORDER, mw27OrderId("order_granted", index, round));
}

export function mw27ReceiptId(index = 0, round = MW27_FIXTURE_ROUND): string {
  return paymentReceiptId(VIRTUAL_PAY_PROVIDER, 1, mw27FixtureId("txn", index, round));
}

export function mw27CallbackId(kind: "callback_paid" | "callback_pending", index = 0, round = MW27_FIXTURE_ROUND): string {
  const eventKind = kind === "callback_paid" ? "pay" : "pending";
  return callbackEventId(VIRTUAL_PAY_PROVIDER, mw27StableEventKey(eventKind, index, round));
}

export function mw27RefundId(index = 0, round = MW27_FIXTURE_ROUND): string {
  return refundDocId(mw27OrderId("order_granted", index, round));
}

export function mw27MemberId(index = 0, round = MW27_FIXTURE_ROUND): string {
  return mw27FixtureId("member", index, round);
}

export function mw27IdentityId(index = 0, round = MW27_FIXTURE_ROUND): string {
  return mw27FixtureId("identity", index, round);
}

export function mw27AccountId(index = 0, round = MW27_FIXTURE_ROUND): string {
  return mw27MemberId(index, round);
}

export function mw27EventId(index = 0, round = MW27_FIXTURE_ROUND): string {
  return vipEventId({
    memberId: mw27MemberId(index, round),
    type: "grant",
    sourceId: mw27OrderId("order_granted", index, round),
    accountRevision: 1
  });
}

export function mw27JobId(kind: "job_interrupted" | "job_review", index = 0, round = MW27_FIXTURE_ROUND): string {
  return mw27FixtureId(kind, index, round);
}

export function mw27LiveDocId(kind: Mw27FixtureKind, index = 0, round = MW27_FIXTURE_ROUND): string {
  switch (kind) {
    case "member":
      return mw27MemberId(index, round);
    case "identity":
      return mw27IdentityId(index, round);
    case "order_granted":
      return mw27OrderId("order_granted", index, round);
    case "order_pending":
      return mw27OrderId("order_pending", index, round);
    case "receipt":
      return mw27ReceiptId(index, round);
    case "callback_paid":
      return mw27CallbackId("callback_paid", index, round);
    case "callback_pending":
      return mw27CallbackId("callback_pending", index, round);
    case "refund_pending":
      return mw27RefundId(index, round);
    case "vip_grant":
      return mw27GrantId(index, round);
    case "vip_account":
      return mw27AccountId(index, round);
    case "vip_event":
      return mw27EventId(index, round);
    case "job_interrupted":
    case "job_review":
      return mw27JobId(kind, index, round);
    default:
      return mw27FixtureId(kind, index, round);
  }
}

export function mw27IsolatedCollectionFor(live: string): string | null {
  const map: Record<string, string> = {
    orders: "mw27_rst_orders",
    payment_receipts: "mw27_rst_payment_receipts",
    callback_events: "mw27_rst_callback_events",
    refunds: "mw27_rst_refunds",
    vip_grants: "mw27_rst_vip_grants",
    jobs: "mw27_rst_jobs"
  };
  return map[live] || null;
}

export function isMw27IsolatedCollection(name: string): boolean {
  return name.startsWith("mw27_rst_");
}

export function omitDocId<T extends Record<string, unknown>>(payload: T): Omit<T, "_id"> {
  const out = { ...payload };
  delete (out as { _id?: unknown })._id;
  return out;
}

export function mw27FixturePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return omitDocId({
    ...payload,
    fixtureRound: MW27_FIXTURE_ROUND,
    fixtureMarker: MW27_FIXTURE_MARKER,
    schemaVersion: 1
  });
}

export function mw27LeftoverDecision(input: {
  wroteDocs?: boolean;
  resolved?: boolean;
  fixtureRemain?: number;
  isolatedRemain?: number;
  knownIdRemain?: number;
  seedPresent?: boolean;
}): { ok: boolean; reason: string; leftoverDocs: number } {
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

export function mw27OfficialRestoreDecision(input: {
  canRestoreToNewCollection: boolean;
  wouldOverwriteExisting: boolean;
  otherEnvTouched: boolean;
}): { result: Mw27Result; reason: string; mode: "official-new-collection" | "fixture-sim" } {
  if (input.otherEnvTouched) {
    return { result: "FAIL", reason: "OTHER_ENV_TOUCHED", mode: "fixture-sim" };
  }
  if (input.wouldOverwriteExisting) {
    return { result: "BLOCKED", reason: "RESTORE_WOULD_OVERWRITE", mode: "fixture-sim" };
  }
  if (!input.canRestoreToNewCollection) {
    return { result: "BLOCKED", reason: "NO_RESTORE_TO_NEW_COLLECTION", mode: "fixture-sim" };
  }
  return { result: "PASS", reason: "OFFICIAL_NEW_COLLECTION", mode: "official-new-collection" };
}

export function mw27ReplayEntitlement(input: {
  grants: readonly VipGrantRecord[];
  memberId: string;
  orderId: string;
  durationSeconds: number;
  now: Date;
}): {
  result: Mw27Result;
  replayed: boolean;
  grantCount: number;
  durationIncreased: boolean;
  grantId: string;
} {
  const grantId = vipGrantId(VIP_SOURCE_ORDER, input.orderId);
  const beforeSeconds = input.grants.find((row) => row.grantId === grantId)?.grantedSeconds ?? 0;
  const applied = applyVipGrant({
    grants: input.grants,
    memberId: input.memberId,
    sourceType: VIP_SOURCE_ORDER,
    sourceId: input.orderId,
    durationSeconds: input.durationSeconds,
    grantedAt: input.now,
    reason: "mw27-replay",
    actorId: "mw27-restore"
  });
  if (!applied.ok) {
    return { result: "FAIL", replayed: false, grantCount: input.grants.length, durationIncreased: false, grantId };
  }
  const afterSeconds = applied.grant.grantedSeconds;
  const durationIncreased = afterSeconds > beforeSeconds && applied.replayed === true;
  const extraGrant = applied.grants.length > input.grants.length && applied.replayed === true;
  return {
    result: applied.replayed && !durationIncreased && !extraGrant ? "PASS" : "FAIL",
    replayed: applied.replayed,
    grantCount: applied.grants.length,
    durationIncreased,
    grantId
  };
}

export function mw27PendingPreserved(input: {
  beforeRefunds: number;
  afterRefunds: number;
  beforeCallbacks: number;
  afterCallbacks: number;
}): { result: Mw27Result; reason: string } {
  if (input.afterRefunds < input.beforeRefunds || input.afterCallbacks < input.beforeCallbacks) {
    return { result: "FAIL", reason: "PENDING_LOST" };
  }
  return { result: "PASS", reason: "PENDING_PRESERVED" };
}

export function mw27JobsInterruptContinue(job: JobRecord, now: Date): {
  result: Mw27Result;
  cursorContinued: boolean;
  staleRejected: boolean;
  reason: string;
} {
  const later = new Date(now.getTime() + 2_000);
  const next = acquireLease(job, later, 8_000);
  if (!next.ok) {
    return { result: "FAIL", cursorContinued: false, staleRejected: false, reason: next.reason };
  }
  const cursorContinued = next.job.cursor.done === job.cursor.done;
  const stale = saveCursor(next.job, job.fencingToken, { done: job.cursor.done + 1, total: job.cursor.total }, later);
  const staleRejected = stale.ok === false && stale.reason === "STALE_FENCING_TOKEN";
  const currentOk = saveCursor(next.job, next.job.fencingToken, { done: job.cursor.done + 1, total: job.cursor.total }, later);
  return {
    result: cursorContinued && staleRejected && currentOk.ok ? "PASS" : "FAIL",
    cursorContinued,
    staleRejected,
    reason: staleRejected ? "CURSOR_AND_STALE_TOKEN" : stale.ok ? "STALE_NOT_REJECTED" : stale.reason
  };
}

export function mw27JobsResumeOnlyRestores(job: JobRecord, now: Date): {
  result: Mw27Result;
  restored: boolean;
  markedSuccess: boolean;
  reason: string;
} {
  const resumed = resumeJob(job, now, "mw27-resume");
  if (job.state !== "needsReview" && job.state !== "retryable") {
    return {
      result: !resumed.ok && resumed.reason === "JOB_NOT_RESUMABLE" ? "PASS" : "FAIL",
      restored: false,
      markedSuccess: false,
      reason: resumed.ok ? "RESUME_SKIPPED_CHECK" : resumed.reason
    };
  }
  if (!resumed.ok) {
    return { result: "FAIL", restored: false, markedSuccess: false, reason: resumed.reason };
  }
  const markedSuccess = resumed.job.state === "succeeded";
  return {
    result: resumed.job.state === "queued" && !markedSuccess ? "PASS" : "FAIL",
    restored: resumed.job.state === "queued",
    markedSuccess,
    reason: markedSuccess ? "RESUME_MARKED_SUCCESS" : "RESUME_ONLY"
  };
}

export function mw27StaleTokenRejected(job: JobRecord, staleToken: number, now: Date): {
  result: Mw27Result;
  reason: string;
} {
  const checked = assertWritableLease(job, staleToken, now);
  if (!checked.ok && (checked.reason === "STALE_FENCING_TOKEN" || checked.reason === "LEASE_EXPIRED")) {
    return { result: "PASS", reason: checked.reason };
  }
  return { result: "FAIL", reason: checked.ok ? "STALE_TOKEN_ACCEPTED" : checked.reason };
}

export function mw27RpoRtoVerdict(input: {
  officialBackupConfirmed: boolean;
  rpoMs: number | null;
  rtoMs: number | null;
  packageLimitation?: string;
}): {
  official: Mw27Result;
  fixtureRto: Mw27Result;
  reason: string;
} {
  if (input.officialBackupConfirmed !== true) {
    const fixtureRto =
      input.rtoMs != null && input.rtoMs <= MW27_RTO_TARGET_MS ? "PASS" : input.rtoMs == null ? "NOT_RUN" : "BLOCKED";
    return {
      official: "BLOCKED",
      fixtureRto,
      reason: input.packageLimitation || "OFFICIAL_RESTORE_UNAVAILABLE"
    };
  }
  const officialOk =
    input.rpoMs != null &&
    input.rpoMs <= MW27_RPO_TARGET_MS &&
    input.rtoMs != null &&
    input.rtoMs <= MW27_RTO_TARGET_MS;
  return {
    official: officialOk ? "PASS" : "BLOCKED",
    fixtureRto: input.rtoMs != null && input.rtoMs <= MW27_RTO_TARGET_MS ? "PASS" : "BLOCKED",
    reason: officialOk ? "WITHIN_TARGET" : input.packageLimitation || "TARGET_NOT_MET"
  };
}

export function mw27PaymentNotifyReceivable(config: MaintenanceConfig): { result: Mw27Result; reason: string } {
  const checked = paymentNotifyBlockedByMaintenance(config, PAYMENT_NOTIFY_ENTRY);
  if (checked.blocked) {
    return { result: "FAIL", reason: checked.reason };
  }
  return { result: "PASS", reason: checked.reason || "PAYMENT_NOTIFY_NOT_GATED" };
}

export function mw27MaintenanceDrillReason(): string {
  return "MW27 restore drill; payment notify kept open";
}

export function mw27ClosureCheck(input: {
  seedPresent: number;
  seedExpected: number;
  missingCollections: readonly string[];
  missingIndexes: readonly string[];
  isolatedAclDenied: boolean;
  baselineAnswersAclDenied: boolean;
}): { result: Mw27Result; reason: string } {
  if (input.seedPresent !== input.seedExpected) {
    return { result: "FAIL", reason: "SEED_CATEGORIES_CHANGED" };
  }
  if (input.missingCollections.length) {
    return { result: "FAIL", reason: "COLLECTION_CLOSURE_MISSING" };
  }
  if (input.missingIndexes.length) {
    return { result: "FAIL", reason: "INDEX_MISSING" };
  }
  if (input.baselineAnswersAclDenied !== true) {
    return { result: "FAIL", reason: "BASELINE_ANSWERS_ACL_REGRESSED" };
  }
  if (input.isolatedAclDenied !== true) {
    return { result: "FAIL", reason: "ISOLATED_ACL_NOT_DENIED" };
  }
  return { result: "PASS", reason: "CLOSURE_OK" };
}

export function mw27RankingNotInLeftoverDelete(collections: readonly string[]): boolean {
  return collections.every((name) => !MW27_RANKING_NOT_LEFTOVER.includes(name as (typeof MW27_RANKING_NOT_LEFTOVER)[number]));
}

export function mw27CodeRollbackAllowsCurrentPackageOnly(input: {
  currentRuntimeSha256: string;
  wouldDeployOlderBrokenPackage: boolean;
}): { result: Mw27Result; reason: string } {
  if (!input.currentRuntimeSha256 || input.currentRuntimeSha256.length < 12) {
    return { result: "FAIL", reason: "RUNTIME_HASH_MISSING" };
  }
  if (input.wouldDeployOlderBrokenPackage) {
    return { result: "FAIL", reason: "MUST_NOT_ROLLBACK_BROKEN_PACKAGE" };
  }
  return { result: "PASS", reason: "KEEP_CURRENT_PACKAGE" };
}

export { MAINTENANCE_GATES, PAYMENT_NOTIFY_ENTRY };
