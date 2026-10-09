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
  memberWriteTooLarge,
  parseApiRequest,
  paymentNotifyBlockedByMaintenance,
  publicJobView,
  rejectUnknownKeys,
  sharedMiniIdentity,
  toUtcIso,
  PARENT_CHANGE_NOTE,
  CATEGORY_TREE_FIELDS,
  hasQuestionSecrets,
  hasPaperSecrets,
  redactUploadSecrets,
  type AdminRole,
  type ApiFailure,
  type ApiResponse,
  type ErrorCode
} from "@mw/shared";
import type { AuditStore, IdempotencyStore, JobStore, MaintenanceStore, WorkStore } from "./modules/job-stores.js";
import type { MemberReadStore, MemberWorkStore, PolicyStore } from "./modules/member-stores.js";
import {
  readCurrentPolicies,
  readMemberMe,
  readMemberSession,
  registerMember,
  updateMemberProfile
} from "./modules/member.js";
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
import type { CategoryUsageStore, CategoryWorkStore } from "./modules/category-stores.js";
import { emptyCategoryUsage } from "./modules/category-stores.js";
import { disableQuestion, getQuestion, listQuestions, saveQuestion } from "./modules/question.js";
import type { QuestionUsageStore, QuestionWorkStore } from "./modules/question-stores.js";
import { authorizeUpload, completeUpload, readUploadStatus } from "./modules/upload.js";
import type { UploadWorkStore } from "./modules/upload-stores.js";
import {
  getAdminPaper,
  getPublicPaper,
  listPapers,
  previewPaper,
  publishPaper,
  savePaper,
  unpublishPaper,
  withdrawPaper
} from "./modules/paper.js";
import type { PaperWorkStore } from "./modules/paper-stores.js";

export const UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;

export const PUBLIC_ACTIONS = ["public.ping", "home.get", "policies.current", "category.tree", "paper.list", "paper.detail"] as const;
export const MEMBER_ACTIONS = ["member.session", "member.register", "member.me", "member.updateProfile"] as const;
export const ADMIN_ACTIONS = [
  "admin.me",
  "job.get",
  "category.tree",
  "question.list",
  "question.get",
  "upload.status",
  "paper.list",
  "paper.get",
  "paper.preview"
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
  "paper.withdraw"
] as const;
export const ADMIN_MW18_ACTIONS = ["category.change.preview", "category.change.commit"] as const;

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

  const event = unwrapFunctionEvent(ctx.event);
  const forged = forgedDenied(event);
  if (forged) return forged;

  if (ctx.entry === "mw-upload") {
    return handleUpload(ctx, ctx.event);
  }
  if (ctx.entry === "mw-pay-hook") {
    return handlePayHook(ctx, event);
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
    return publicSafe(requestId, now, tree.data);
  }
  if (action === "paper.list" || action === "paper.detail") {
    const event = unwrapFunctionEvent(ctx.event);
    const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
    const data = rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) ? (rec.data as Record<string, unknown>) : {};
    if (action === "paper.list") {
      const result = await listPapers({ store: ctx.paperStore, data, publicView: true });
      if (!result.ok) {
        return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
      }
      return publicSafe(requestId, now, result.data);
    }
    const result = await getPublicPaper({ store: ctx.paperStore, data });
    if (!result.ok) {
      return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    }
    return publicSafe(requestId, now, result.data);
  }
  return publicSafe(requestId, now, {
    roots: [],
    recommended: [],
    catalogVersion: 0,
    note: "MW05 public skeleton; category.tree is available, paper browse is MW13"
  });
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
    const result = await readMemberMe(ctx.memberStore, fromAppId, fromOpenId);
    if (!result.ok) {
      return fail(request.requestId, result.code as ErrorCode, { reason: result.reason });
    }
    return publicSafe(request.requestId, now, result.data);
  }
  if (!request.idempotencyKey) {
    return fail(request.requestId, "INVALID_ARGUMENT", { issues: ["idempotencyKey required"] });
  }
  if (!ctx.memberStore) {
    return fail(request.requestId, "INTERNAL_ERROR", { reason: "MEMBER_STORE_UNAVAILABLE" });
  }
  if (request.action === "member.register") {
    const result = await registerMember({
      stores: ctx.memberStore,
      policies: ctx.policyStore,
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
  const isRead = (ADMIN_ACTIONS as readonly string[]).includes(action);
  const isWrite = (ADMIN_WRITE_ACTIONS as readonly string[]).includes(action);
  if (!isRead && !isWrite && !isMw18) {
    return fail(requestId, "FORBIDDEN", { reason: "ACTION_DENIED", entry: "mw-admin" });
  }
  const admin = await requireAdmin(ctx, requestId);
  if ("failure" in admin) return admin.failure;
  if (isMw18) {
    return fail(requestId, "INVALID_ARGUMENT", {
      reason: "PARENT_CHANGE_REQUIRES_MW18",
      note: PARENT_CHANGE_NOTE
    });
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
  return ok(requestId, now, { ...result.data, replayed: result.replayed === true, writeConcurrency: "expectedTreeVersion" });
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
    const result = await listQuestions({ store: questionStore, data });
    if (!result.ok) return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    if (hasQuestionSecrets(result.data).length > 0) {
      return fail(requestId, "INTERNAL_ERROR", { reason: "SECRET_LEAK_BLOCKED" });
    }
    return ok(requestId, now, result.data);
  }
  if (action === "question.get") {
    const result = await getQuestion({
      store: questionStore,
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
    const result = await listPapers({ store: ctx.paperStore, data, publicView: false });
    if (!result.ok) return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    if (hasPaperSecrets(result.data).length > 0) return fail(requestId, "INTERNAL_ERROR", { reason: "SECRET_LEAK_BLOCKED" });
    return ok(requestId, now, result.data);
  }
  if (action === "paper.get") {
    const result = await getAdminPaper({ store: ctx.paperStore, data });
    if (!result.ok) return fail(requestId, result.code as ErrorCode, { reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) });
    return ok(requestId, now, result.data);
  }
  if (action === "paper.preview") {
    const result = await previewPaper({
      store: ctx.paperStore,
      questions: ctx.questionStore,
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

async function handlePayHook(ctx: OfficialContext, event: unknown): Promise<Record<string, unknown>> {
  if (ctx.maintenanceStore) {
    const config = await ctx.maintenanceStore.get();
    const blocked = paymentNotifyBlockedByMaintenance(config, "mw-pay-hook");
    if (blocked.blocked) {
      return { ok: false, entry: "mw-pay-hook", reason: "MAINTENANCE_SHOULD_NOT_BLOCK_NOTIFY" };
    }
  }
  const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const hasSignature = Boolean(rec.signature || rec.sign);
  if (!hasSignature) {
    return { ok: false, entry: "mw-pay-hook", reason: "SIGNATURE_REQUIRED" };
  }
  return { ok: false, entry: "mw-pay-hook", reason: "NOT_A_REAL_PAYMENT_CHANNEL" };
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
  if (clientLike || !trust.trusted) {
    return { ok: false, entry: "mw-jobs", reason: trust.reason || "CLIENT_INVOKE_DENIED" };
  }
  if (!ctx.jobStore || !trust.invoke) {
    return { ok: false, entry: "mw-jobs", reason: "NO_TRUSTED_SERVER_TRIGGER" };
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
