import {
  API_VERSION,
  MEMBER_WRITE_MAX_BYTES,
  NICKNAME_CONTENT_SAFETY,
  adminAuthorized,
  adminHasRole,
  cloudbaseAuthDecision,
  defaultPolicyRecord,
  errorMessage,
  forgedClientFields,
  looksLikeTimerEvent,
  memberWriteTooLarge,
  parseApiRequest,
  paymentNotifyBlockedByMaintenance,
  publicJobView,
  rejectUnknownKeys,
  sharedMiniIdentity,
  toUtcIso,
  CATEGORY_TREE_FIELDS,
  hasQuestionSecrets,
  hasPaperSecrets,
  redactUploadSecrets,
  isolatedEntitlementReader,
  type AdminRole,
  type ApiFailure,
  type ApiResponse,
  type ErrorCode,
  type PracticeEntitlementReader
} from "@mw/shared";
import type { AuditStore, IdempotencyStore, JobStore, MaintenanceStore, WorkStore } from "./modules/job-stores.js";
import type { MemberReadStore, MemberWorkStore, PolicyStore } from "./modules/member-stores.js";
import {
  readCurrentPolicies,
  readMemberGrowth,
  readMemberMe,
  readMemberSession,
  registerMember,
  trustedMemberIds,
  updateMemberProfile
} from "./modules/member.js";
import {
  GROWTH_ADMIN_READ_ACTIONS,
  GROWTH_ADMIN_WRITE_ACTIONS,
  previewGrowthChange,
  publishGrowthConfig,
  readGrowthConfigForAdmin,
  recomputeGrowth
} from "./modules/growth.js";
import { resolveGrowthConfig, type GrowthWorkStore } from "./modules/growth-stores.js";
import {
  listRanking,
  markRankingDirty,
  readRankingMe,
  readRankingStatus,
  rebuildRanking,
  setMemberRanking
} from "./modules/ranking.js";
import type { RankingWorkStore } from "./modules/ranking-stores.js";
import {
  budgetsWithinLimit,
  jobsTrustFromEvent,
  probeIdempotency,
  processSignedJobsCommand,
  readJob,
  resumeDefinedJob
} from "./modules/transaction-jobs.js";
import {
  contentWritesBlocked,
  createCategory,
  deleteCategory,
  readCategoryTree,
  seedInitialCategories,
  updateCategory
} from "./modules/category.js";
import { commitCategoryChange, previewCategoryChange, readCategoryChangeStatus, treeHiddenForStructureUpdate } from "./modules/category-change.js";
import { processDueCatalogJobs } from "./modules/category-change-job.js";
import type { CatalogChangeStore } from "./modules/category-change-stores.js";
import { commitCorrection, previewCorrection, readCorrectionStatus } from "./modules/correction.js";
import { processDueCorrectionJobs } from "./modules/correction-job.js";
import type { CorrectionStore } from "./modules/correction-stores.js";
import { grantVipGift, readVipStatus, revokeVipGiftAction, vipEntitlementReader } from "./modules/vip.js";
import type { VipWorkStore } from "./modules/vip-stores.js";
import type { CategoryUsageStore, CategoryWorkStore } from "./modules/category-stores.js";
import { emptyCategoryUsage } from "./modules/category-stores.js";
import { disableQuestion, getQuestion, listQuestions, saveQuestion } from "./modules/question.js";
import type { QuestionUsageStore, QuestionWorkStore } from "./modules/question-stores.js";
import { authorizeUpload, completeUpload, readUploadStatus } from "./modules/upload.js";
import type { UploadWorkStore } from "./modules/upload-stores.js";
import {
  getAdminPaper,
  getHome,
  getPublicPaper,
  listPapers,
  previewPaper,
  publishPaper,
  savePaper,
  unpublishPaper,
  withdrawPaper
} from "./modules/paper.js";
import type { PaperWorkStore } from "./modules/paper-stores.js";
import type { AttemptWorkStore } from "./modules/attempt-stores.js";
import {
  abandonAttempt,
  getAttempt,
  listAttemptHistory,
  readAttemptAnalysis,
  readAttemptResult,
  readQuestionPage,
  saveAttempt,
  startAttempt,
  startReplacingAttempt,
  submitAttempt
} from "./modules/attempt.js";
import { commitImport, previewImport, readImportStatus, validateImport } from "./modules/import.js";
import type { ImportWorkStore } from "./modules/import-stores.js";
import {
  isVirtualPayUrlVerify,
  verifyVirtualPayNotify,
  type VirtualPayNotifyConfig
} from "./modules/virtual-pay-notify.js";

export const UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;

export const PUBLIC_ACTIONS = [
  "public.ping",
  "home.get",
  "policies.current",
  "category.tree",
  "paper.list",
  "paper.detail",
  "ranking.list"
] as const;
export const MEMBER_ACTIONS = [
  "member.session",
  "member.register",
  "member.me",
  "member.updateProfile",
  "attempt.start",
  "attempt.startReplacing",
  "attempt.get",
  "attempt.questionPage",
  "attempt.save",
  "attempt.abandon",
  "attempt.submit",
  "attempt.result",
  "attempt.analysis",
  "attempt.history",
  "member.growth",
  "member.setRanking",
  "ranking.me",
  "vip.status"
] as const;
export const ADMIN_ACTIONS = [
  "admin.me",
  "job.get",
  "category.tree",
  "question.list",
  "question.get",
  "upload.status",
  "paper.list",
  "paper.get",
  "paper.preview",
  "import.preview",
  "import.status",
  "growth.config",
  "growth.preview",
  "ranking.status"
] as const;
export const ADMIN_WRITE_ACTIONS = [
  "job.resume",
  "category.create",
  "category.update",
  "category.delete",
  "category.seed",
  "question.save",
  "question.disable",
  "upload.authorize",
  "paper.save",
  "paper.publish",
  "paper.unpublish",
  "paper.withdraw",
  "import.validate",
  "import.commit",
  "growth.publish",
  "growth.recompute",
  "ranking.rebuild"
] as const;
export const ADMIN_MW18_ACTIONS = ["category.change.preview", "category.change.commit", "category.change.status"] as const;
export const ADMIN_MW19_ACTIONS = ["correction.preview", "correction.commit", "correction.status"] as const;
export const ADMIN_MW20_ACTIONS = ["vip.grant", "vip.revokeGift"] as const;

export type OfficialEntry =
  | "mw-public"
  | "mw-member"
  | "mw-admin"
  | "mw-upload"
  | "mw-pay-hook"
  | "mw-jobs"
  | "cloudbase_auth";

export interface AdminUserRecord {
  uid: string;
  roles: AdminRole[];
  enabled: boolean;
  authVersion: number;
}

export interface AdminUserStore {
  getByUid(uid: string): Promise<AdminUserRecord | undefined>;
}

export interface OfficialContext {
  entry: OfficialEntry;
  event: unknown;
  now?: Date;
  allowedAppIds: string[];
  fromAppId?: string;
  fromOpenId?: string;
  resourceAppId?: string;
  resourceOpenId?: string;
  authUid?: string;
  adminStore?: AdminUserStore;
  trustedScheduler?: boolean;
  jobsSecret?: string;
  jobStore?: JobStore;
  idempotencyStore?: IdempotencyStore;
  auditStore?: AuditStore;
  workStore?: WorkStore;
  maintenanceStore?: MaintenanceStore;
  policyStore?: PolicyStore;
  memberStore?: MemberReadStore & MemberWorkStore;
  categoryStore?: CategoryWorkStore;
  categoryUsage?: CategoryUsageStore;
  questionStore?: QuestionWorkStore;
  questionUsage?: QuestionUsageStore;
  uploadStore?: UploadWorkStore;
  paperStore?: PaperWorkStore;
  importStore?: ImportWorkStore;
  attemptStore?: AttemptWorkStore;
  growthStore?: GrowthWorkStore;
  rankingStore?: RankingWorkStore;
  catalogChangeStore?: CatalogChangeStore;
  correctionStore?: CorrectionStore;
  vipStore?: VipWorkStore;
  entitlement?: PracticeEntitlementReader;
  virtualPayNotify?: VirtualPayNotifyConfig;
}

export interface MemoryAdminStore extends AdminUserStore {
  users: Map<string, AdminUserRecord>;
}

export function memoryAdminStore(seed: AdminUserRecord[] = []): MemoryAdminStore {
  const users = new Map(seed.map((row) => [row.uid, { ...row }]));
  return {
    users,
    async getByUid(uid: string) {
      const row = users.get(uid);
      return row ? { ...row } : undefined;
    }
  };
}

function fail(requestId: string, code: ErrorCode, details?: Record<string, unknown>): ApiFailure {
  return {
    ok: false,
    requestId,
    error: {
      code,
      message: errorMessage(code),
      retryable: false,
      details
    }
  };
}

function ok<T>(requestId: string, now: Date, data: T): ApiResponse<T> {
  return {
    ok: true,
    requestId,
    serverTime: toUtcIso(now),
    data
  };
}

function publicSafe<T>(requestId: string, now: Date, data: T): ApiResponse<T> {
  if (hasQuestionSecrets(data).length > 0 || hasPaperSecrets(data).length > 0) {
    return fail(requestId, "INTERNAL_ERROR", { reason: "SECRET_LEAK_BLOCKED" }) as ApiResponse<T>;
  }
  return ok(requestId, now, data);
}

const ANALYSIS_ALLOWED_SECRET_KEYS = new Set(["analysis", "correctOptionIds"]);

function analysisSafe<T>(requestId: string, now: Date, data: T): ApiResponse<T> {
  const found = [...new Set([...hasQuestionSecrets(data), ...hasPaperSecrets(data)])];
  const blocked = found.filter((key) => !ANALYSIS_ALLOWED_SECRET_KEYS.has(key));
  if (blocked.length > 0) {
    return fail(requestId, "INTERNAL_ERROR", { reason: "SECRET_LEAK_BLOCKED", keys: blocked }) as ApiResponse<T>;
  }
  return ok(requestId, now, data);
}

const BUSINESS_KEYS = ["apiVersion", "action", "requestId", "idempotencyKey", "data"] as const;

export function unwrapFunctionEvent(event: unknown): unknown {
  if (!event || typeof event !== "object") {
    return event;
  }
  const rec = event as Record<string, unknown>;
  if (typeof rec.body === "string") {
    try {
      const parsed = JSON.parse(rec.body);
      if (parsed && typeof parsed === "object") {
        return unwrapFunctionEvent(parsed);
      }
    } catch {
      /* keep going */
    }
  }
  const nested = rec.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const inner = nested as Record<string, unknown>;
    if (
      inner.apiVersion !== undefined &&
      typeof inner.action === "string" &&
      typeof inner.requestId === "string" &&
      inner.data &&
      typeof inner.data === "object"
    ) {
      return unwrapFunctionEvent(inner);
    }
  }
  const out: Record<string, unknown> = {};
  let found = false;
  for (const key of BUSINESS_KEYS) {
    if (key in rec) {
      out[key] = rec[key];
      found = true;
    }
  }
  return found ? out : event;
}

function requestIdOf(event: unknown): string {
  const body = unwrapFunctionEvent(event);
  if (body && typeof body === "object" && "requestId" in body) {
    const value = (body as { requestId?: unknown }).requestId;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "unknown";
}

function forgedDenied(event: unknown): ApiFailure | undefined {
  const forged = forgedClientFields(event);
  if (!forged.length) return undefined;
  return fail(requestIdOf(event), "FORBIDDEN", {
    reason: "CLIENT_IDENTITY_IGNORED",
    forgedFields: forged
  });
}

async function requireAdmin(
  ctx: OfficialContext,
  requestId: string
): Promise<{ record: AdminUserRecord } | { failure: ApiFailure }> {
  const uid = present(ctx.authUid) ? String(ctx.authUid).trim() : "";
  if (!uid || !ctx.adminStore) {
    return { failure: fail(requestId, "AUTH_REQUIRED", { reason: "NO_AUTH_UID" }) };
  }
  const record = await ctx.adminStore.getByUid(uid);
  const decision = adminAuthorized({
    authUidPresent: true,
    whitelistHit: Boolean(record),
    enabled: Boolean(record?.enabled)
  });
  if (!decision.allowed) {
    const code: ErrorCode = decision.reason === "ADMIN_DISABLED" ? "ACCOUNT_DISABLED" : "FORBIDDEN";
    return { failure: fail(requestId, code, { reason: decision.reason }) };
  }
  return { record: record as AdminUserRecord };
}

function present(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function byteLength(event: unknown): number {
  if (!event || typeof event !== "object") return 0;
  const rec = event as Record<string, unknown>;
  if (typeof rec.byteLength === "number") return rec.byteLength;
  if (typeof rec.csv === "string") return Buffer.byteLength(rec.csv);
  try {
    return Buffer.byteLength(JSON.stringify(event));
  } catch {
    return 0;
  }
}

export function handleCloudbaseAuth(ctx: OfficialContext): {
  errCode: number;
  errMsg: string;
  auth: string;
} {
  const decision = cloudbaseAuthDecision({
    fromAppId: ctx.fromAppId,
    fromOpenId: ctx.fromOpenId,
    resourceAppId: ctx.resourceAppId,
    resourceOpenId: ctx.resourceOpenId,
    allowedAppIds: ctx.allowedAppIds
  });
  return {
    errCode: decision.errCode,
    errMsg: decision.errMsg,
    auth: JSON.stringify({
      mw: decision.allow,
      source: "shared-mini",
      allow: decision.allowedFunctions
    })
  };
}

export async function handleOfficial(ctx: OfficialContext): Promise<unknown> {
  const now = ctx.now ?? new Date();
  if (ctx.entry === "cloudbase_auth") {
    return handleCloudbaseAuth(ctx);
  }
  if (ctx.entry === "mw-jobs") {
    return handleJobs(ctx);
  }
  if (ctx.entry === "mw-pay-hook") {
    // Platform notify query/body may include openid / OpenId / FromUserName.
    // Those are not client-forged identity fields; verify signature on raw bytes first.
    return handlePayHook(ctx, ctx.event);
  }

  const event = unwrapFunctionEvent(ctx.event);
  const forged = forgedDenied(event);
  if (forged) return forged;

  if (ctx.entry === "mw-upload") {
    return handleUpload(ctx, ctx.event);
  }

  const parsed = parseApiRequest(event);
  if (parsed.issues.length || !parsed.request) {
    return fail(requestIdOf(event), "INVALID_ARGUMENT", { issues: parsed.issues });
  }
  const request = parsed.request;
  if (request.apiVersion !== API_VERSION) {
    return fail(request.requestId, "INVALID_ARGUMENT", { issues: ["apiVersion must be 1"] });
  }

  if (ctx.entry === "mw-public") {
    return handlePublic(ctx, request.action, request.requestId, now);
  }
  if (ctx.entry === "mw-member") {
    if (
      (request.action === "member.register" || request.action === "member.updateProfile") &&
      memberWriteTooLarge(byteLength(event))
    ) {
      return fail(request.requestId, "INVALID_ARGUMENT", {
        reason: "PAYLOAD_TOO_LARGE",
        limit: MEMBER_WRITE_MAX_BYTES
      });
    }
    return handleMember(ctx, request, now);
  }
  if (ctx.entry === "mw-admin") {
    return handleAdmin(ctx, request.action, request.requestId, now);
  }
  return fail(request.requestId, "FORBIDDEN", { reason: "UNKNOWN_ENTRY" });
}

async function handlePublic(
  ctx: OfficialContext,
  action: string,
  requestId: string,
  now: Date
): Promise<ApiResponse<unknown>> {
  if (!(PUBLIC_ACTIONS as readonly string[]).includes(action)) {
    return fail(requestId, "FORBIDDEN", { reason: "ACTION_DENIED", entry: "mw-public" });
  }
  if (action === "public.ping") {
    return publicSafe(requestId, now, { entry: "mw-public", skeleton: true });
  }
  if (action === "policies.current") {
    const policies = ctx.policyStore ? await readCurrentPolicies(ctx.policyStore, now) : defaultPolicyRecord(now);
    return publicSafe(requestId, now, {
      agreementVersion: policies.agreementVersion,
      privacyVersion: policies.privacyVersion,
      agreementTitle: policies.agreementTitle,
      privacyTitle: policies.privacyTitle,
      placeholder: policies.placeholder === true,
      note: policies.note
    });
  }
  if (action === "category.tree") {
    const event = unwrapFunctionEvent(ctx.event);
    const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
    const data = rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) ? (rec.data as Record<string, unknown>) : {};
    const extra = rejectUnknownKeys(data, [...CATEGORY_TREE_FIELDS]);
    if (extra.length) {
      return fail(requestId, "INVALID_ARGUMENT", { issues: [`unknown fields: ${extra.join(",")}`] });
    }
    const tree = await readCategoryTree(ctx.categoryStore, { knownVersion: data.knownVersion, publicView: true });
    if (treeHiddenForStructureUpdate(await ctx.categoryStore?.getCatalog())) {
      return publicSafe(requestId, now, {
        ...tree.data,
        nodes: [],
        updating: true,
        message: "类目结构更新中，请稍后重试。"
      });
    }
    return publicSafe(requestId, now, tree.data);
  }
  if (action === "home.get") {
    const event = unwrapFunctionEvent(ctx.event);
    const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
    const data = rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) ? (rec.data as Record<string, unknown>) : {};
    const result = await getHome({
      paperStore: ctx.paperStore,
      categoryStore: ctx.categoryStore,
      importStore: ctx.importStore,
      policyStore: ctx.policyStore,
      now,
      data
    });
    if (!result.ok) {
      return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    }
    if (treeHiddenForStructureUpdate(await ctx.categoryStore?.getCatalog())) {
      return publicSafe(requestId, now, {
        ...result.data,
        roots: [],
        updating: true,
        message: "类目结构更新中，请稍后重试。"
      });
    }
    return publicSafe(requestId, now, result.data);
  }
  if (action === "paper.list" || action === "paper.detail") {
    const event = unwrapFunctionEvent(ctx.event);
    const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
    const data = rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) ? (rec.data as Record<string, unknown>) : {};
    if (action === "paper.list") {
      const result = await listPapers({
        store: ctx.paperStore,
        imports: ctx.importStore,
        categoryStore: ctx.categoryStore,
        data,
        publicView: true
      });
      if (!result.ok) {
        return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
      }
      return publicSafe(requestId, now, result.data);
    }
    const result = await getPublicPaper({
      store: ctx.paperStore,
      imports: ctx.importStore,
      categoryStore: ctx.categoryStore,
      data
    });
    if (!result.ok) {
      return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    }
    return publicSafe(requestId, now, result.data);
  }
  if (action === "ranking.list") {
    // 公开只读：游客可看前百；无需注册。榜单值取自服务端即时维护的 score_metrics。
    const event = unwrapFunctionEvent(ctx.event);
    const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
    const data = rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) ? (rec.data as Record<string, unknown>) : {};
    const result = await listRanking({ store: ctx.rankingStore, data, now });
    if (!result.ok) {
      return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.details || {}) });
    }
    return publicSafe(requestId, now, result.data);
  }
  return fail(requestId, "FORBIDDEN", { reason: "ACTION_DENIED", entry: "mw-public" });
}

async function handleMemberAttempt(
  ctx: OfficialContext,
  request: { action: string; requestId: string; idempotencyKey?: string; data: Record<string, unknown> },
  now: Date,
  fromAppId: string,
  fromOpenId: string
): Promise<ApiResponse<unknown>> {
  const session = await readMemberSession(ctx.memberStore, fromAppId, fromOpenId);
  if (!session.registered || !session.memberId) {
    return fail(request.requestId, "MEMBER_REQUIRED", { reason: "MEMBER_NOT_REGISTERED" });
  }
  if (!ctx.attemptStore) {
    return fail(request.requestId, "INTERNAL_ERROR", { reason: "ATTEMPT_STORE_UNAVAILABLE" });
  }
  const write =
    request.action === "attempt.start" ||
    request.action === "attempt.startReplacing" ||
    request.action === "attempt.save" ||
    request.action === "attempt.abandon" ||
    request.action === "attempt.submit";
  if (write && !request.idempotencyKey) {
    return fail(request.requestId, "INVALID_ARGUMENT", { issues: ["idempotencyKey required"] });
  }
  const maintenance = ctx.maintenanceStore ? await ctx.maintenanceStore.get() : undefined;
  const entitlement = ctx.entitlement || vipEntitlementReader(ctx.vipStore) || isolatedEntitlementReader();
  const common = {
    store: ctx.attemptStore,
    memberId: session.memberId,
    data: request.data,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey || request.requestId,
    now,
    maintenance,
    entitlement,
    readMaintenance: async () => (ctx.maintenanceStore ? ctx.maintenanceStore.get() : undefined),
    readGrowth: ctx.growthStore ? async () => resolveGrowthConfig(ctx.growthStore as GrowthWorkStore, now) : undefined
  };
  const result =
    request.action === "attempt.start"
      ? await startAttempt(common)
      : request.action === "attempt.startReplacing"
        ? await startReplacingAttempt(common)
        : request.action === "attempt.get"
          ? await getAttempt({ store: ctx.attemptStore, memberId: session.memberId, data: request.data })
          : request.action === "attempt.questionPage"
            ? await readQuestionPage({ store: ctx.attemptStore, memberId: session.memberId, data: request.data })
            : request.action === "attempt.save"
              ? await saveAttempt(common)
              : request.action === "attempt.abandon"
                ? await abandonAttempt(common)
                : request.action === "attempt.submit"
                  ? await submitAttempt(common)
                  : request.action === "attempt.result"
                    ? await readAttemptResult({ store: ctx.attemptStore, memberId: session.memberId, data: request.data })
                    : request.action === "attempt.analysis"
                      ? await readAttemptAnalysis({ store: ctx.attemptStore, memberId: session.memberId, data: request.data })
                      : request.action === "attempt.history"
                        ? await listAttemptHistory({ store: ctx.attemptStore, memberId: session.memberId, data: request.data })
                        : { ok: false as const, code: "FORBIDDEN", reason: "ACTION_DENIED" };
  if (!result.ok) {
    return fail(request.requestId, result.code as ErrorCode, {
      reason: result.reason,
      ...("issues" in result && result.issues ? { issues: result.issues } : {}),
      ...("details" in result && result.details ? result.details : {})
    });
  }
  if (request.action === "attempt.submit" && !("replayed" in result && result.replayed === true)) {
    // 一致性设计第 5 节：交卷成功后持久刷新标记，供榜单页显示"更新中/更新延迟"。
    // 标记失败不影响交卷结果，也不伪造刷新时间。
    await markRankingDirty(ctx.rankingStore, now);
  }
  const response =
    request.action === "attempt.analysis"
      ? analysisSafe(request.requestId, now, result.data)
      : publicSafe(request.requestId, now, result.data);
  if (response.ok && "replayed" in result) {
    return { ...response, replayed: result.replayed === true };
  }
  return response;
}

async function handleMember(
  ctx: OfficialContext,
  request: { action: string; requestId: string; idempotencyKey?: string; data: Record<string, unknown> },
  now: Date
): Promise<ApiResponse<unknown>> {
  if (!(MEMBER_ACTIONS as readonly string[]).includes(request.action)) {
    return fail(request.requestId, "FORBIDDEN", { reason: "ACTION_DENIED", entry: "mw-member" });
  }
  const identity = sharedMiniIdentity({
    fromAppId: ctx.fromAppId,
    fromOpenId: ctx.fromOpenId,
    resourceAppId: ctx.resourceAppId,
    resourceOpenId: ctx.resourceOpenId,
    allowedAppIds: ctx.allowedAppIds
  });
  if (!identity.trusted) {
    return fail(request.requestId, "AUTH_REQUIRED", { reason: identity.reason });
  }
  const fromAppId = String(ctx.fromAppId || "").trim();
  const fromOpenId = String(ctx.fromOpenId || "").trim();

  if (request.action === "member.session") {
    const session = await readMemberSession(ctx.memberStore, fromAppId, fromOpenId);
    return publicSafe(request.requestId, now, session);
  }
  if (request.action === "member.me") {
    const result = await readMemberMe(ctx.memberStore, fromAppId, fromOpenId, ctx.attemptStore, ctx.vipStore, now);
    if (!result.ok) {
      return fail(request.requestId, result.code as ErrorCode, { reason: result.reason });
    }
    return publicSafe(request.requestId, now, result.data);
  }
  if (request.action === "vip.status") {
    const session = await readMemberSession(ctx.memberStore, fromAppId, fromOpenId);
    if (!session.registered || !session.memberId) {
      return fail(request.requestId, "MEMBER_REQUIRED", { reason: "MEMBER_NOT_REGISTERED" });
    }
    const result = await readVipStatus(ctx.vipStore, session.memberId, now);
    if (!result.ok) {
      return fail(request.requestId, result.code as ErrorCode, { reason: result.reason });
    }
    return publicSafe(request.requestId, now, result.data);
  }
  if (request.action === "member.growth") {
    if (!ctx.growthStore) {
      return fail(request.requestId, "INTERNAL_ERROR", { reason: "GROWTH_STORE_UNAVAILABLE" });
    }
    const growth = await resolveGrowthConfig(ctx.growthStore, now);
    const result = await readMemberGrowth(ctx.memberStore, ctx.growthStore, fromAppId, fromOpenId, growth);
    if (!result.ok) {
      return fail(request.requestId, result.code as ErrorCode, { reason: result.reason });
    }
    return publicSafe(request.requestId, now, result.data);
  }
  if (request.action === "ranking.me") {
    // 本人名次：与 ranking.list 同一代快照；未参与时只返回可追溯私人值与未参与状态。
    const session = await readMemberSession(ctx.memberStore, fromAppId, fromOpenId);
    if (!session.registered || !session.memberId) {
      return fail(request.requestId, "MEMBER_REQUIRED", { reason: "MEMBER_NOT_REGISTERED" });
    }
    const result = await readRankingMe({
      store: ctx.rankingStore,
      memberId: session.memberId,
      data: request.data,
      now
    });
    if (!result.ok) {
      return fail(request.requestId, result.code as ErrorCode, { reason: result.reason, ...(result.details || {}) });
    }
    return publicSafe(request.requestId, now, result.data);
  }
  if (request.action.startsWith("attempt.")) {
    return handleMemberAttempt(ctx, request, now, fromAppId, fromOpenId);
  }
  if (!request.idempotencyKey) {
    return fail(request.requestId, "INVALID_ARGUMENT", { issues: ["idempotencyKey required"] });
  }
  if (!ctx.memberStore) {
    return fail(request.requestId, "INTERNAL_ERROR", { reason: "MEMBER_STORE_UNAVAILABLE" });
  }
  if (request.action === "member.setRanking") {
    const ids = trustedMemberIds(fromAppId, fromOpenId);
    const result = await setMemberRanking({
      stores: ctx.memberStore,
      ranking: ctx.rankingStore,
      identityId: ids.identityId,
      memberId: ids.memberId,
      data: request.data,
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      now
    });
    if (!result.ok) {
      return fail(request.requestId, result.code as ErrorCode, {
        reason: result.reason,
        ...(result.details || {})
      });
    }
    return publicSafe(request.requestId, now, {
      ...result.data,
      replayed: result.replayed === true,
      tx: budgetsWithinLimit(result.budget)
    });
  }
  if (request.action === "member.register") {
    const growth = ctx.growthStore ? await resolveGrowthConfig(ctx.growthStore, now) : undefined;
    const result = await registerMember({
      stores: ctx.memberStore,
      policies: ctx.policyStore,
      growth,
      fromAppId,
      fromOpenId,
      data: request.data,
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      now
    });
    if (!result.ok) {
      return fail(request.requestId, result.code as ErrorCode, {
        reason: result.reason,
        ...(result.issues ? { issues: result.issues } : {})
      });
    }
    return publicSafe(request.requestId, now, {
      ...result.data,
      created: result.created === true,
      replayed: result.replayed === true,
      nicknameContentSafety: NICKNAME_CONTENT_SAFETY.status,
      tx: budgetsWithinLimit(result.budget)
    });
  }
  const result = await updateMemberProfile({
    stores: ctx.memberStore,
    fromAppId,
    fromOpenId,
    data: request.data,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    now
  });
  if (!result.ok) {
    return fail(request.requestId, result.code as ErrorCode, {
      reason: result.reason,
      ...(result.issues ? { issues: result.issues } : {})
    });
  }
  return publicSafe(request.requestId, now, {
    ...result.data,
    replayed: result.replayed === true,
    nicknameContentSafety: NICKNAME_CONTENT_SAFETY.status,
    tx: budgetsWithinLimit(result.budget)
  });
}

async function handleAdmin(
  ctx: OfficialContext,
  action: string,
  requestId: string,
  now: Date
): Promise<ApiResponse<unknown>> {
  if (action === "admin.register") {
    return fail(requestId, "FORBIDDEN", { reason: "PUBLIC_ADMIN_REGISTER_DENIED" });
  }
  const isMw18 = (ADMIN_MW18_ACTIONS as readonly string[]).includes(action);
  const isMw19 = (ADMIN_MW19_ACTIONS as readonly string[]).includes(action);
  const isMw20 = (ADMIN_MW20_ACTIONS as readonly string[]).includes(action);
  const isRead = (ADMIN_ACTIONS as readonly string[]).includes(action);
  const isWrite = (ADMIN_WRITE_ACTIONS as readonly string[]).includes(action);
  if (!isRead && !isWrite && !isMw18 && !isMw19 && !isMw20) {
    return fail(requestId, "FORBIDDEN", { reason: "ACTION_DENIED", entry: "mw-admin" });
  }
  const admin = await requireAdmin(ctx, requestId);
  if ("failure" in admin) return admin.failure;
  if (isMw18) {
    if (!adminHasRole(admin.record.roles, "super")) {
      return fail(requestId, "FORBIDDEN", { reason: "SUPER_ROLE_REQUIRED" });
    }
    return handleAdminCategoryChange(ctx, admin.record, action, requestId, now);
  }
  if (isMw19) {
    if (!adminHasRole(admin.record.roles, "super")) {
      return fail(requestId, "FORBIDDEN", { reason: "SUPER_ROLE_REQUIRED" });
    }
    return handleAdminCorrection(ctx, admin.record, action, requestId, now);
  }
  if (isMw20) {
    if (!adminHasRole(admin.record.roles, "super")) {
      return fail(requestId, "FORBIDDEN", { reason: "SUPER_ROLE_REQUIRED" });
    }
    return handleAdminVip(ctx, admin.record, action, requestId, now);
  }
  if (action === "category.tree" || action.startsWith("category.")) {
    return handleAdminCategory(ctx, admin.record, action, requestId, now);
  }
  if (action.startsWith("question.") || action.startsWith("upload.")) {
    return handleAdminQuestionBank(ctx, admin.record, action, requestId, now);
  }
  if (action.startsWith("paper.")) {
    return handleAdminPaper(ctx, admin.record, action, requestId, now);
  }
  if (action.startsWith("import.")) {
    return handleAdminImport(ctx, admin.record, action, requestId, now);
  }
  if (action.startsWith("growth.")) {
    return handleAdminGrowth(ctx, admin.record, action, requestId, now);
  }
  if (action.startsWith("ranking.")) {
    return handleAdminRanking(ctx, admin.record, action, requestId, now);
  }
  if (action === "admin.me") {
    return ok(requestId, now, {
      roles: admin.record.roles,
      enabled: admin.record.enabled,
      authVersion: admin.record.authVersion,
      canContent: adminHasRole(admin.record.roles, "content"),
      canOperations: adminHasRole(admin.record.roles, "operations"),
      canSuper: adminHasRole(admin.record.roles, "super")
    });
  }
  if (!ctx.jobStore) {
    return fail(requestId, "INTERNAL_ERROR", { reason: "JOB_STORE_UNAVAILABLE" });
  }
  const event = unwrapFunctionEvent(ctx.event);
  const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const data = rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) ? (rec.data as Record<string, unknown>) : {};
  const extra = rejectUnknownKeys(data, ["jobId", "reason"]);
  if (extra.length) {
    return fail(requestId, "INVALID_ARGUMENT", { issues: [`unknown fields: ${extra.join(",")}`] });
  }
  const jobId = typeof data.jobId === "string" ? data.jobId : "";
  if (!jobId) {
    return fail(requestId, "INVALID_ARGUMENT", { issues: ["jobId required"] });
  }
  if (action === "job.get") {
    const job = await readJob(ctx.jobStore, jobId);
    if (!job) return fail(requestId, "NOT_FOUND", { reason: "JOB_NOT_FOUND" });
    return ok(requestId, now, job);
  }
  if (!adminHasRole(admin.record.roles, "super")) {
    return fail(requestId, "FORBIDDEN", { reason: "SUPER_REQUIRED" });
  }
  if (typeof rec.idempotencyKey !== "string" || rec.idempotencyKey.length === 0) {
    return fail(requestId, "INVALID_ARGUMENT", { issues: ["idempotencyKey required"] });
  }
  if (!ctx.idempotencyStore || !ctx.auditStore) {
    return fail(requestId, "INTERNAL_ERROR", { reason: "JOB_STORE_UNAVAILABLE" });
  }
  const reason = typeof data.reason === "string" ? data.reason : "";
  if (!reason) {
    return fail(requestId, "INVALID_ARGUMENT", { issues: ["reason required"] });
  }
  const resumed = await resumeDefinedJob({
    jobStore: ctx.jobStore,
    idempotencyStore: ctx.idempotencyStore,
    auditStore: ctx.auditStore,
    workStore: ctx.workStore,
    actorId: admin.record.uid,
    jobId,
    reason,
    requestId,
    idempotencyKey: rec.idempotencyKey,
    now
  });
  if (!resumed.ok) {
    const code = (resumed.code as ErrorCode | undefined) || "VERSION_CONFLICT";
    return fail(requestId, code, { reason: resumed.reason });
  }
  const budget = budgetsWithinLimit(resumed.budget);
  return ok(requestId, now, {
    job: resumed.job,
    replayed: resumed.replayed === true,
    pending: false,
    tx: budget
  });
}

function adminRequestBody(ctx: OfficialContext): { rec: Record<string, unknown>; data: Record<string, unknown> } {
  const event = unwrapFunctionEvent(ctx.event);
  const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const data = rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) ? (rec.data as Record<string, unknown>) : {};
  return { rec, data };
}

/**
 * 后台等级配置：
 * - growth.config / growth.preview 为只读（任意已启用后台角色）；
 * - growth.publish 需要 super，且必须带 idempotencyKey 与 reason；
 * - growth.recompute 需要 super；结果由现有总分与当前门槛唯一决定，重复执行不产生额外写入，故不要求幂等键。
 */
async function handleAdminGrowth(
  ctx: OfficialContext,
  admin: AdminUserRecord,
  action: string,
  requestId: string,
  now: Date
): Promise<ApiResponse<unknown>> {
  if (!(GROWTH_ADMIN_READ_ACTIONS as readonly string[]).includes(action) && !(GROWTH_ADMIN_WRITE_ACTIONS as readonly string[]).includes(action)) {
    return fail(requestId, "FORBIDDEN", { reason: "ACTION_DENIED", entry: "mw-admin" });
  }
  if (!ctx.growthStore) {
    return fail(requestId, "INTERNAL_ERROR", { reason: "GROWTH_STORE_UNAVAILABLE" });
  }
  const { rec, data } = adminRequestBody(ctx);
  if (action === "growth.config") {
    const extra = rejectUnknownKeys(data, []);
    if (extra.length) {
      return fail(requestId, "INVALID_ARGUMENT", { issues: [`unknown fields: ${extra.join(",")}`] });
    }
    const read = await readGrowthConfigForAdmin(ctx.growthStore, now);
    return ok(requestId, now, read.data);
  }
  if (action === "growth.preview") {
    const preview = await previewGrowthChange(ctx.growthStore, data);
    if (!preview.ok) {
      return fail(requestId, preview.code as ErrorCode, {
        reason: preview.reason,
        ...(preview.issues ? { issues: preview.issues } : {}),
        ...(preview.details || {})
      });
    }
    return ok(requestId, now, { ...preview.data, wroteDocs: false });
  }
  if (!adminHasRole(admin.roles, "super")) {
    return fail(requestId, "FORBIDDEN", { reason: "SUPER_REQUIRED" });
  }
  if (action === "growth.publish") {
    if (typeof rec.idempotencyKey !== "string" || rec.idempotencyKey.length === 0) {
      return fail(requestId, "INVALID_ARGUMENT", { issues: ["idempotencyKey required"] });
    }
    const published = await publishGrowthConfig({
      store: ctx.growthStore,
      actorId: admin.uid,
      data,
      requestId,
      idempotencyKey: rec.idempotencyKey,
      now
    });
    if (!published.ok) {
      return fail(requestId, published.code as ErrorCode, {
        reason: published.reason,
        ...(published.issues ? { issues: published.issues } : {}),
        ...(published.details || {})
      });
    }
    return ok(requestId, now, {
      ...published.data,
      replayed: published.replayed === true,
      tx: budgetsWithinLimit(published.budget)
    });
  }
  const recomputed = await recomputeGrowth({ store: ctx.growthStore, data, now });
  if (!recomputed.ok) {
    return fail(requestId, recomputed.code as ErrorCode, {
      reason: recomputed.reason,
      ...(recomputed.issues ? { issues: recomputed.issues } : {}),
      ...(recomputed.details || {})
    });
  }
  return ok(requestId, now, recomputed.data);
}

/**
 * 后台榜单治理：
 * - ranking.status 为只读（任意已启用后台角色）；
 * - ranking.rebuild 需要 super，且必须带 idempotencyKey 与 reason；
 *   写齐该代名次行后事务内切换板块头，失败保留上一完整代并标记更新延迟。
 */
async function handleAdminRanking(
  ctx: OfficialContext,
  admin: AdminUserRecord,
  action: string,
  requestId: string,
  now: Date
): Promise<ApiResponse<unknown>> {
  if (action === "ranking.status") {
    const result = await readRankingStatus({ store: ctx.rankingStore, now });
    return ok(requestId, now, result.data);
  }
  if (action !== "ranking.rebuild") {
    return fail(requestId, "FORBIDDEN", { reason: "ACTION_DENIED", entry: "mw-admin" });
  }
  if (!adminHasRole(admin.roles, "super")) {
    return fail(requestId, "FORBIDDEN", { reason: "SUPER_REQUIRED" });
  }
  const { rec, data } = adminRequestBody(ctx);
  if (typeof rec.idempotencyKey !== "string" || rec.idempotencyKey.length === 0) {
    return fail(requestId, "INVALID_ARGUMENT", { issues: ["idempotencyKey required"] });
  }
  const result = await rebuildRanking({
    store: ctx.rankingStore,
    actorId: admin.uid,
    data,
    requestId,
    idempotencyKey: rec.idempotencyKey,
    now
  });
  if (!result.ok) {
    return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.details || {}) });
  }
  return ok(requestId, now, {
    ...result.data,
    replayed: result.replayed === true,
    tx: budgetsWithinLimit(result.budget)
  });
}

async function handleAdminCategoryChange(
  ctx: OfficialContext,
  admin: { uid: string; roles: string[] },
  action: string,
  requestId: string,
  now: Date
): Promise<ApiResponse<unknown>> {
  const event = unwrapFunctionEvent(ctx.event);
  const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const data = rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) ? (rec.data as Record<string, unknown>) : {};
  if (action === "category.change.status") {
    const jobId = typeof data.jobId === "string" ? data.jobId : "";
    const job = jobId && ctx.jobStore ? await ctx.jobStore.get(jobId) : undefined;
    const status = await readCategoryChangeStatus({ store: ctx.categoryStore, change: ctx.catalogChangeStore, job });
    return ok(requestId, now, status.data);
  }
  if (typeof rec.idempotencyKey !== "string" || !rec.idempotencyKey) {
    return fail(requestId, "INVALID_ARGUMENT", { issues: ["idempotencyKey required"] });
  }
  if (!ctx.categoryStore || !ctx.catalogChangeStore) {
    return fail(requestId, "INTERNAL_ERROR", { reason: "CATALOG_CHANGE_STORE_UNAVAILABLE" });
  }
  const common = {
    store: ctx.categoryStore,
    change: ctx.catalogChangeStore,
    actorId: admin.uid,
    data,
    requestId,
    idempotencyKey: rec.idempotencyKey,
    now
  };
  const result = action === "category.change.preview" ? await previewCategoryChange(common) : await commitCategoryChange(common);
  if (!result.ok) {
    return fail(requestId, result.code as ErrorCode, {
      reason: result.reason,
      ...(result.issues ? { issues: result.issues } : {}),
      ...(result.details || {})
    });
  }
  if (action === "category.change.commit") {
    if (ctx.jobStore && "jobs" in ctx.catalogChangeStore) {
      const jobs = (ctx.catalogChangeStore as { jobs?: Map<string, import("@mw/shared").JobRecord> }).jobs;
      const jobId = (result.data as { jobId?: string }).jobId;
      const stored = jobId && jobs ? jobs.get(jobId) : undefined;
      if (stored && "put" in ctx.jobStore) {
        await ctx.jobStore.put(stored);
      }
    }
    const maint = (ctx.catalogChangeStore as { maintenance?: import("@mw/shared").MaintenanceConfig }).maintenance;
    if (ctx.maintenanceStore && maint) {
      await ctx.maintenanceStore.save(maint);
    }
  }
  return ok(requestId, now, { ...result.data, replayed: result.replayed === true });
}

async function handleAdminCorrection(
  ctx: OfficialContext,
  admin: { uid: string; roles: string[] },
  action: string,
  requestId: string,
  now: Date
): Promise<ApiResponse<unknown>> {
  const event = unwrapFunctionEvent(ctx.event);
  const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const data = rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) ? (rec.data as Record<string, unknown>) : {};
  if (!ctx.correctionStore) {
    return fail(requestId, "INTERNAL_ERROR", { reason: "CORRECTION_STORE_UNAVAILABLE" });
  }
  if (action === "correction.status") {
    const jobId = typeof data.jobId === "string" ? data.jobId : "";
    const job = jobId && ctx.jobStore ? await ctx.jobStore.get(jobId) : undefined;
    const maint = ctx.maintenanceStore ? await ctx.maintenanceStore.get() : undefined;
    const status = await readCorrectionStatus({
      store: ctx.correctionStore,
      job,
      data,
      submitClosed: maint?.attemptSubmit.enabled === false
    });
    if (!status.ok) return fail(requestId, status.code as ErrorCode, { reason: status.reason });
    return ok(requestId, now, status.data);
  }
  if (typeof rec.idempotencyKey !== "string" || !rec.idempotencyKey) {
    return fail(requestId, "INVALID_ARGUMENT", { issues: ["idempotencyKey required"] });
  }
  const common = {
    store: ctx.correctionStore,
    actorId: admin.uid,
    data,
    requestId,
    idempotencyKey: rec.idempotencyKey,
    now
  };
  const result = action === "correction.preview" ? await previewCorrection(common) : await commitCorrection(common);
  if (!result.ok) {
    return fail(requestId, result.code as ErrorCode, {
      reason: result.reason,
      ...(result.issues ? { issues: result.issues } : {}),
      ...(result.details || {})
    });
  }
  if (action === "correction.commit") {
    if (ctx.jobStore && "jobs" in ctx.correctionStore) {
      const jobs = (ctx.correctionStore as { jobs?: Map<string, import("@mw/shared").JobRecord> }).jobs;
      const jobId = (result.data as { jobId?: string }).jobId;
      const stored = jobId && jobs ? jobs.get(jobId) : undefined;
      if (stored && "put" in ctx.jobStore) {
        await ctx.jobStore.put(stored);
      }
    }
    const maint = (ctx.correctionStore as { maintenance?: import("@mw/shared").MaintenanceConfig }).maintenance;
    if (ctx.maintenanceStore && maint) {
      await ctx.maintenanceStore.save(maint);
    }
  }
  return ok(requestId, now, { ...result.data, replayed: result.replayed === true });
}

async function handleAdminVip(
  ctx: OfficialContext,
  admin: AdminUserRecord,
  action: string,
  requestId: string,
  now: Date
): Promise<ApiResponse<unknown>> {
  if (!ctx.vipStore) {
    return fail(requestId, "INTERNAL_ERROR", { reason: "VIP_STORE_UNAVAILABLE" });
  }
  const { rec, data } = adminRequestBody(ctx);
  if (typeof rec.idempotencyKey !== "string" || !rec.idempotencyKey) {
    return fail(requestId, "INVALID_ARGUMENT", { issues: ["idempotencyKey required"] });
  }
  const maintenance = ctx.maintenanceStore ? await ctx.maintenanceStore.get() : undefined;
  const result =
    action === "vip.grant"
      ? await grantVipGift({
          store: ctx.vipStore,
          members: ctx.memberStore,
          actorId: admin.uid,
          data,
          requestId,
          idempotencyKey: rec.idempotencyKey,
          now,
          maintenance
        })
      : await revokeVipGiftAction({
          store: ctx.vipStore,
          actorId: admin.uid,
          data,
          requestId,
          idempotencyKey: rec.idempotencyKey,
          now,
          maintenance
        });
  if (!result.ok) {
    return fail(requestId, result.code as ErrorCode, {
      reason: result.reason,
      ...(result.issues ? { issues: result.issues } : {}),
      ...(result.details || {})
    });
  }
  return ok(requestId, now, { ...result.data, replayed: result.replayed === true });
}

async function handleAdminCategory(
  ctx: OfficialContext,
  admin: AdminUserRecord,
  action: string,
  requestId: string,
  now: Date
): Promise<ApiResponse<unknown>> {
  const event = unwrapFunctionEvent(ctx.event);
  const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const data = rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) ? (rec.data as Record<string, unknown>) : {};
  if (action === "category.tree") {
    const extra = rejectUnknownKeys(data, [...CATEGORY_TREE_FIELDS]);
    if (extra.length) {
      return fail(requestId, "INVALID_ARGUMENT", { issues: [`unknown fields: ${extra.join(",")}`] });
    }
    const tree = await readCategoryTree(ctx.categoryStore, { knownVersion: data.knownVersion, publicView: false });
    const catalog = await ctx.categoryStore?.getCatalog();
    if (treeHiddenForStructureUpdate(catalog)) {
      return ok(requestId, now, {
        ...tree.data,
        nodes: [],
        updating: true,
        jobId: catalog?.structureJobId || "",
        message: "类目结构更新中，不展示半棵树。请查看迁移进度。"
      });
    }
    return ok(requestId, now, tree.data);
  }
  if (!adminHasRole(admin.roles, "content")) {
    return fail(requestId, "FORBIDDEN", { reason: "CONTENT_ROLE_REQUIRED" });
  }
  if (typeof rec.idempotencyKey !== "string" || rec.idempotencyKey.length === 0) {
    return fail(requestId, "INVALID_ARGUMENT", { issues: ["idempotencyKey required"] });
  }
  if (!ctx.categoryStore) {
    return fail(requestId, "INTERNAL_ERROR", { reason: "CATEGORY_STORE_UNAVAILABLE" });
  }
  const blocked = contentWritesBlocked(ctx.maintenanceStore ? await ctx.maintenanceStore.get() : undefined);
  if (blocked) {
    return fail(requestId, blocked.code as ErrorCode, { reason: blocked.reason, ...blocked.details });
  }
  if (action === "category.seed") {
    const extra = rejectUnknownKeys(data, ["expectedTreeVersion"]);
    if (extra.length) {
      return fail(requestId, "INVALID_ARGUMENT", { issues: [`unknown fields: ${extra.join(",")}`] });
    }
    const result = await seedInitialCategories({
      store: ctx.categoryStore,
      actorId: admin.uid,
      requestId,
      idempotencyKey: rec.idempotencyKey,
      now
    });
    if (!result.ok) {
      return fail(requestId, result.code as ErrorCode, {
        reason: result.reason,
        ...(result.issues ? { issues: result.issues } : {}),
        ...(result.details || {})
      });
    }
    return ok(requestId, now, { ...result.data, replayed: result.replayed === true, writeConcurrency: "expectedTreeVersion" });
  }
  const common = {
    store: ctx.categoryStore,
    actorId: admin.uid,
    data,
    requestId,
    idempotencyKey: rec.idempotencyKey,
    now
  };
  const result =
    action === "category.create"
      ? await createCategory(common)
      : action === "category.update"
        ? await updateCategory(common)
        : await deleteCategory({ ...common, usage: ctx.categoryUsage || emptyCategoryUsage() });
  if (!result.ok) {
    return fail(requestId, result.code as ErrorCode, {
      reason: result.reason,
      ...(result.issues ? { issues: result.issues } : {}),
      ...(result.details || {})
    });
  }
  if (action === "category.update" && data.enabled !== undefined) {
    await markRankingDirty(ctx.rankingStore, now);
  }
  return ok(requestId, now, { ...result.data, replayed: result.replayed === true, writeConcurrency: "expectedTreeVersion" });
}

async function handleAdminImport(
  ctx: OfficialContext,
  admin: AdminUserRecord,
  action: string,
  requestId: string,
  now: Date
): Promise<ApiResponse<unknown>> {
  if (!adminHasRole(admin.roles, "content")) {
    return fail(requestId, "FORBIDDEN", { reason: "CONTENT_ROLE_REQUIRED" });
  }
  const event = unwrapFunctionEvent(ctx.event);
  const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const data = rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) ? (rec.data as Record<string, unknown>) : {};
  const write = action === "import.validate" || action === "import.commit";
  if (write) {
    if (typeof rec.idempotencyKey !== "string" || rec.idempotencyKey.length === 0) {
      return fail(requestId, "INVALID_ARGUMENT", { issues: ["idempotencyKey required"] });
    }
    const blocked = contentWritesBlocked(ctx.maintenanceStore ? await ctx.maintenanceStore.get() : undefined);
    if (blocked) {
      return fail(requestId, blocked.code as ErrorCode, { reason: blocked.reason, ...blocked.details });
    }
  }
  if (!ctx.importStore) {
    return fail(requestId, "INTERNAL_ERROR", { reason: "IMPORT_STORE_UNAVAILABLE" });
  }
  if (action === "import.validate") {
    const result = await validateImport({
      store: ctx.importStore,
      questions: ctx.questionStore,
      papers: ctx.paperStore,
      categories: ctx.categoryStore,
      upload: ctx.uploadStore,
      actorId: admin.uid,
      data,
      requestId,
      idempotencyKey: String(rec.idempotencyKey),
      now
    });
    if (!result.ok) {
      return fail(requestId, result.code as ErrorCode, {
        reason: result.reason,
        ...(result.issues ? { issues: result.issues } : {}),
        ...(result.details || {})
      });
    }
    return ok(requestId, now, { ...result.data, replayed: result.replayed === true });
  }
  if (action === "import.preview") {
    const result = await previewImport({ store: ctx.importStore, data });
    if (!result.ok) return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    return ok(requestId, now, result.data);
  }
  if (action === "import.commit") {
    const result = await commitImport({
      store: ctx.importStore,
      questions: ctx.questionStore,
      papers: ctx.paperStore,
      categories: ctx.categoryStore,
      actorId: admin.uid,
      data,
      requestId,
      idempotencyKey: String(rec.idempotencyKey),
      now
    });
    if (!result.ok) {
      return fail(requestId, result.code as ErrorCode, {
        reason: result.reason,
        ...(result.issues ? { issues: result.issues } : {}),
        ...(result.details || {})
      });
    }
    return ok(requestId, now, { ...result.data, replayed: result.replayed === true });
  }
  if (action === "import.status") {
    const result = await readImportStatus({ store: ctx.importStore, data });
    if (!result.ok) return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    return ok(requestId, now, result.data);
  }
  return fail(requestId, "FORBIDDEN", { reason: "ACTION_DENIED", entry: "mw-admin" });
}

function questionStoreWithAssets(
  question?: QuestionWorkStore,
  upload?: UploadWorkStore
): QuestionWorkStore | undefined {
  if (!question) return undefined;
  if (!upload) return question;
  return {
    getQuestion: (id) => question.getQuestion(id),
    getVersion: (id) => question.getVersion(id),
    listQuestions: (input) => question.listQuestions(input),
    getAsset: async (id) => (await question.getAsset(id)) || (await upload.getAsset(id)),
    transactWrite: (input) => question.transactWrite(input)
  };
}

async function handleAdminQuestionBank(
  ctx: OfficialContext,
  admin: AdminUserRecord,
  action: string,
  requestId: string,
  now: Date
): Promise<ApiResponse<unknown>> {
  if (!adminHasRole(admin.roles, "content")) {
    return fail(requestId, "FORBIDDEN", { reason: "CONTENT_ROLE_REQUIRED" });
  }
  const event = unwrapFunctionEvent(ctx.event);
  const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const data = rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) ? (rec.data as Record<string, unknown>) : {};
  const write = action === "question.save" || action === "question.disable" || action === "upload.authorize";
  if (write) {
    if (typeof rec.idempotencyKey !== "string" || rec.idempotencyKey.length === 0) {
      return fail(requestId, "INVALID_ARGUMENT", { issues: ["idempotencyKey required"] });
    }
    const blocked = contentWritesBlocked(ctx.maintenanceStore ? await ctx.maintenanceStore.get() : undefined);
    if (blocked) {
      return fail(requestId, blocked.code as ErrorCode, { reason: blocked.reason, ...blocked.details });
    }
  }
  const questionStore = questionStoreWithAssets(ctx.questionStore, ctx.uploadStore);
  if (action === "question.list") {
    const result = await listQuestions({ store: questionStore, imports: ctx.importStore, data });
    if (!result.ok) return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    if (hasQuestionSecrets(result.data).length > 0) {
      return fail(requestId, "INTERNAL_ERROR", { reason: "SECRET_LEAK_BLOCKED" });
    }
    return ok(requestId, now, result.data);
  }
  if (action === "question.get") {
    const result = await getQuestion({
      store: questionStore,
      imports: ctx.importStore,
      storage: ctx.uploadStore?.storage,
      data,
      includeSecrets: true
    });
    if (!result.ok) return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    return ok(requestId, now, result.data);
  }
  if (action === "question.save") {
    if (!questionStore) return fail(requestId, "INTERNAL_ERROR", { reason: "QUESTION_STORE_UNAVAILABLE" });
    const result = await saveQuestion({
      store: questionStore,
      categories: ctx.categoryStore,
      actorId: admin.uid,
      data,
      requestId,
      idempotencyKey: String(rec.idempotencyKey),
      now
    });
    if (!result.ok) {
      return fail(requestId, result.code as ErrorCode, {
        reason: result.reason,
        ...(result.issues ? { issues: result.issues } : {}),
        ...(result.details || {})
      });
    }
    return ok(requestId, now, { ...result.data, replayed: result.replayed === true });
  }
  if (action === "question.disable") {
    if (!questionStore) return fail(requestId, "INTERNAL_ERROR", { reason: "QUESTION_STORE_UNAVAILABLE" });
    const result = await disableQuestion({
      store: questionStore,
      usage: ctx.questionUsage,
      actorId: admin.uid,
      data,
      requestId,
      idempotencyKey: String(rec.idempotencyKey),
      now
    });
    if (!result.ok) {
      return fail(requestId, result.code as ErrorCode, {
        reason: result.reason,
        ...(result.issues ? { issues: result.issues } : {}),
        ...(result.details || {})
      });
    }
    return ok(requestId, now, { ...result.data, replayed: result.replayed === true });
  }
  if (action === "upload.authorize") {
    if (!ctx.uploadStore) return fail(requestId, "INTERNAL_ERROR", { reason: "UPLOAD_STORE_UNAVAILABLE" });
    const result = await authorizeUpload({
      store: ctx.uploadStore,
      actorId: admin.uid,
      data,
      requestId,
      idempotencyKey: String(rec.idempotencyKey),
      now
    });
    if (!result.ok) {
      return fail(requestId, result.code as ErrorCode, {
        reason: result.reason,
        ...(result.issues ? { issues: result.issues } : {}),
        ...(result.details || {})
      });
    }
    return ok(requestId, now, result.data);
  }
  if (action === "upload.status") {
    if (!ctx.uploadStore) return fail(requestId, "INTERNAL_ERROR", { reason: "UPLOAD_STORE_UNAVAILABLE" });
    const result = await readUploadStatus({ store: ctx.uploadStore, data, actorId: admin.uid });
    if (!result.ok) return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    return ok(requestId, now, result.data);
  }
  return fail(requestId, "FORBIDDEN", { reason: "ACTION_DENIED", entry: "mw-admin" });
}

async function handleAdminPaper(
  ctx: OfficialContext,
  admin: AdminUserRecord,
  action: string,
  requestId: string,
  now: Date
): Promise<ApiResponse<unknown>> {
  if (!adminHasRole(admin.roles, "content")) {
    return fail(requestId, "FORBIDDEN", { reason: "CONTENT_ROLE_REQUIRED" });
  }
  const event = unwrapFunctionEvent(ctx.event);
  const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const data = rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) ? (rec.data as Record<string, unknown>) : {};
  const write = action === "paper.save" || action === "paper.publish" || action === "paper.unpublish" || action === "paper.withdraw";
  if (write) {
    if (typeof rec.idempotencyKey !== "string" || rec.idempotencyKey.length === 0) {
      return fail(requestId, "INVALID_ARGUMENT", { issues: ["idempotencyKey required"] });
    }
    const blocked = contentWritesBlocked(ctx.maintenanceStore ? await ctx.maintenanceStore.get() : undefined);
    if (blocked) {
      return fail(requestId, blocked.code as ErrorCode, { reason: blocked.reason, ...blocked.details });
    }
  }
  if (!ctx.paperStore && action !== "paper.list") {
    return fail(requestId, "INTERNAL_ERROR", { reason: "PAPER_STORE_UNAVAILABLE" });
  }
  if (action === "paper.list") {
    const result = await listPapers({ store: ctx.paperStore, imports: ctx.importStore, data, publicView: false });
    if (!result.ok) return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    if (hasPaperSecrets(result.data).length > 0) return fail(requestId, "INTERNAL_ERROR", { reason: "SECRET_LEAK_BLOCKED" });
    return ok(requestId, now, result.data);
  }
  if (action === "paper.get") {
    const result = await getAdminPaper({ store: ctx.paperStore, imports: ctx.importStore, data });
    if (!result.ok) return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    return ok(requestId, now, result.data);
  }
  if (action === "paper.preview") {
    const result = await previewPaper({
      store: ctx.paperStore,
      questions: ctx.questionStore,
      imports: ctx.importStore,
      data,
      includeSecrets: true
    });
    if (!result.ok) return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    return ok(requestId, now, result.data);
  }
  if (action === "paper.save") {
    if (!ctx.paperStore) return fail(requestId, "INTERNAL_ERROR", { reason: "PAPER_STORE_UNAVAILABLE" });
    const result = await savePaper({
      store: ctx.paperStore,
      questions: ctx.questionStore,
      categories: ctx.categoryStore,
      categoryUsage: ctx.categoryUsage,
      imports: ctx.importStore,
      actorId: admin.uid,
      data,
      requestId,
      idempotencyKey: String(rec.idempotencyKey),
      now
    });
    if (!result.ok) {
      return fail(requestId, result.code as ErrorCode, {
        reason: result.reason,
        ...(result.issues ? { issues: result.issues } : {}),
        ...(result.details || {})
      });
    }
    return ok(requestId, now, { ...result.data, replayed: result.replayed === true });
  }
  if (action === "paper.publish") {
    if (!ctx.paperStore) return fail(requestId, "INTERNAL_ERROR", { reason: "PAPER_STORE_UNAVAILABLE" });
    const result = await publishPaper({
      store: ctx.paperStore,
      questions: ctx.questionStore,
      categories: ctx.categoryStore,
      questionUsage: ctx.questionUsage,
      imports: ctx.importStore,
      actorId: admin.uid,
      data,
      requestId,
      idempotencyKey: String(rec.idempotencyKey),
      now
    });
    if (!result.ok) {
      return fail(requestId, result.code as ErrorCode, {
        reason: result.reason,
        ...(result.issues ? { issues: result.issues } : {}),
        ...(result.details || {})
      });
    }
    return ok(requestId, now, { ...result.data, replayed: result.replayed === true });
  }
  if (action === "paper.unpublish") {
    if (!ctx.paperStore) return fail(requestId, "INTERNAL_ERROR", { reason: "PAPER_STORE_UNAVAILABLE" });
    const result = await unpublishPaper({
      store: ctx.paperStore,
      actorId: admin.uid,
      data,
      requestId,
      idempotencyKey: String(rec.idempotencyKey),
      now
    });
    if (!result.ok) {
      return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    }
    return ok(requestId, now, { ...result.data, replayed: result.replayed === true });
  }
  if (action === "paper.withdraw") {
    if (!ctx.paperStore) return fail(requestId, "INTERNAL_ERROR", { reason: "PAPER_STORE_UNAVAILABLE" });
    const result = await withdrawPaper({
      store: ctx.paperStore,
      actorId: admin.uid,
      data,
      requestId,
      idempotencyKey: String(rec.idempotencyKey),
      now
    });
    if (!result.ok) {
      return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    }
    return ok(requestId, now, { ...result.data, replayed: result.replayed === true });
  }
  return fail(requestId, "FORBIDDEN", { reason: "ACTION_DENIED", entry: "mw-admin" });
}

function uploadFieldsOf(event: unknown): Record<string, unknown> {
  const layers: Record<string, unknown>[] = [];
  const walk = (value: unknown, depth = 0): void => {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3) return;
    const rec = value as Record<string, unknown>;
    layers.push(rec);
    if (typeof rec.body === "string") {
      try {
        walk(JSON.parse(rec.body), depth + 1);
      } catch {
        /* ignore */
      }
    }
    if (rec.data && typeof rec.data === "object" && !Array.isArray(rec.data)) {
      walk(rec.data, depth + 1);
    }
  };
  walk(event);
  const out: Record<string, unknown> = {};
  for (const rec of layers) {
    for (const key of ["uploadTicket", "sha256", "size", "fileBase64", "requestId"]) {
      if (rec[key] !== undefined) out[key] = rec[key];
    }
  }
  return out;
}

async function handleUpload(ctx: OfficialContext, event: unknown): Promise<ApiResponse<unknown> | Record<string, unknown>> {
  const rec = uploadFieldsOf(event);
  const requestId = typeof rec.requestId === "string" && rec.requestId ? rec.requestId : requestIdOf(event);
  const ticket = typeof rec.uploadTicket === "string" ? rec.uploadTicket : "";
  const bytes = byteLength(event);
  if (!ticket) {
    return fail(requestId, "FORBIDDEN", { reason: "TICKET_REQUIRED", bytes });
  }
  if (bytes > UPLOAD_LIMIT_BYTES) {
    return fail(requestId, "INVALID_ARGUMENT", {
      reason: "PAYLOAD_TOO_LARGE",
      bytes,
      limit: UPLOAD_LIMIT_BYTES
    });
  }
  if (!ctx.uploadStore) {
    return fail(requestId, "FORBIDDEN", { reason: "UPLOAD_SKELETON_NO_STORE", bytes, limit: UPLOAD_LIMIT_BYTES });
  }
  let fileBytes: Uint8Array | undefined;
  if (typeof rec.fileBase64 === "string" && rec.fileBase64.length > 0) {
    fileBytes = Uint8Array.from(Buffer.from(rec.fileBase64, "base64"));
  }
  const result = await completeUpload({
    store: ctx.uploadStore,
    uploadTicket: ticket,
    sha256: typeof rec.sha256 === "string" ? rec.sha256 : undefined,
    size: typeof rec.size === "number" ? rec.size : undefined,
    bytes: fileBytes,
    adminUid: present(ctx.authUid) ? String(ctx.authUid) : undefined,
    now: ctx.now ?? new Date()
  });
  if (!result.ok) {
    return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.details || {}) });
  }
  return redactUploadSecrets(ok(requestId, ctx.now ?? new Date(), result.data));
}

async function handlePayHook(ctx: OfficialContext, event: unknown): Promise<unknown> {
  if (ctx.maintenanceStore) {
    const config = await ctx.maintenanceStore.get();
    const blocked = paymentNotifyBlockedByMaintenance(config, "mw-pay-hook");
    if (blocked.blocked) {
      return { ok: false, entry: "mw-pay-hook", reason: "MAINTENANCE_SHOULD_NOT_BLOCK_NOTIFY" };
    }
  }
  const verified = verifyVirtualPayNotify(event, ctx.virtualPayNotify);
  if (isVirtualPayUrlVerify(verified)) {
    return verified.echostr;
  }
  if (!verified.ok) {
    return {
      ok: false,
      entry: "mw-pay-hook",
      reason: verified.reason,
      ErrCode: verified.ErrCode,
      ErrMsg: verified.ErrMsg,
      vipGranted: false,
      protocol: verified.protocol
    };
  }
  return {
    ErrCode: 0,
    ErrMsg: "success",
    eventType: verified.eventType,
    vipGranted: false,
    protocol: "virtual-pay-message-push"
  };
}

function jobsEventWithoutPlatform(event: unknown): unknown {
  if (!event || typeof event !== "object") return event;
  const rec = { ...(event as Record<string, unknown>) };
  delete rec.userInfo;
  delete rec.tcbContext;
  return rec;
}

async function handleJobs(ctx: OfficialContext): Promise<Record<string, unknown>> {
  const event = jobsEventWithoutPlatform(ctx.event);
  const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const clientLike = Boolean(rec.fromClient) || forgedClientFields(event).length > 0;
  const now = ctx.now ?? new Date();
  const trust = jobsTrustFromEvent({
    event,
    fromAppId: ctx.fromAppId,
    fromOpenId: ctx.fromOpenId,
    authUid: ctx.authUid,
    secret: ctx.jobsSecret,
    now
  });
  if (
    !trust.trusted &&
    looksLikeTimerEvent(event) &&
    !clientLike &&
    ctx.jobsSecret &&
    process.env.MW_JOBS_PLATFORM_TICK === "1" &&
    ctx.jobStore &&
    ctx.catalogChangeStore &&
    ctx.categoryStore &&
    ctx.maintenanceStore
  ) {
    const processed: unknown[] = [];
    const ticked = await processDueCatalogJobs({
      jobStore: ctx.jobStore,
      change: ctx.catalogChangeStore,
      category: ctx.categoryStore,
      maintenance: ctx.maintenanceStore,
      ranking: ctx.rankingStore,
      now,
      requestId: requestIdOf(event)
    });
    processed.push(...ticked.processed);
    if (ctx.correctionStore) {
      const corr = await processDueCorrectionJobs({
        jobStore: ctx.jobStore,
        correction: ctx.correctionStore,
        maintenance: ctx.maintenanceStore,
        ranking: ctx.rankingStore,
        now,
        requestId: requestIdOf(event)
      });
      processed.push(...corr.processed);
    }
    return { ok: true, entry: "mw-jobs", reason: "PLATFORM_TIMER_TICK", processed };
  }
  if (clientLike || !trust.trusted) {
    return { ok: false, entry: "mw-jobs", reason: trust.reason || "CLIENT_INVOKE_DENIED" };
  }
  if (!ctx.jobStore || !trust.invoke) {
    return { ok: false, entry: "mw-jobs", reason: "NO_TRUSTED_SERVER_TRIGGER" };
  }
  if (trust.invoke.action === "jobs.tick") {
    if (!ctx.maintenanceStore) {
      return { ok: false, entry: "mw-jobs", reason: "MAINTENANCE_STORE_UNAVAILABLE" };
    }
    const processed: unknown[] = [];
    if (ctx.catalogChangeStore && ctx.categoryStore) {
      const ticked = await processDueCatalogJobs({
        jobStore: ctx.jobStore,
        change: ctx.catalogChangeStore,
        category: ctx.categoryStore,
        maintenance: ctx.maintenanceStore,
        ranking: ctx.rankingStore,
        now,
        requestId: requestIdOf(event)
      });
      processed.push(...ticked.processed);
    }
    if (ctx.correctionStore) {
      const ticked = await processDueCorrectionJobs({
        jobStore: ctx.jobStore,
        correction: ctx.correctionStore,
        maintenance: ctx.maintenanceStore,
        ranking: ctx.rankingStore,
        now,
        requestId: requestIdOf(event)
      });
      processed.push(...ticked.processed);
    }
    if (!ctx.catalogChangeStore && !ctx.correctionStore) {
      return { ok: false, entry: "mw-jobs", reason: "CATALOG_CHANGE_STORE_UNAVAILABLE" };
    }
    return { ok: true, entry: "mw-jobs", reason: "JOBS_TICK", processed };
  }
  if (trust.invoke.action === "idempotency.probe") {
    if (!ctx.idempotencyStore) {
      return { ok: false, entry: "mw-jobs", reason: "STORE_UNAVAILABLE" };
    }
    const probed = await probeIdempotency(ctx.idempotencyStore, {
      actorId: trust.invoke.actorId || "",
      action: "mw06.test.write",
      idempotencyKey: trust.invoke.idempotencyKey || "",
      payload: trust.invoke.payload ?? {},
      requestId: requestIdOf(event)
    });
    return { entry: "mw-jobs", ...probed };
  }
  const processed = await processSignedJobsCommand({
    jobStore: ctx.jobStore,
    idempotencyStore: ctx.idempotencyStore,
    workStore: ctx.workStore,
    invoke: trust.invoke,
    requestId: requestIdOf(event),
    now
  });
  return {
    ok: processed.ok,
    entry: "mw-jobs",
    reason: processed.reason,
    code: processed.code,
    job: processed.job ? publicJobView(processed.job) : undefined,
    fencingToken: processed.token,
    replayed: processed.replayed === true,
    tx: budgetsWithinLimit(processed.budget)
  };
}
