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

export const UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;

export const PUBLIC_ACTIONS = ["public.ping", "home.get", "policies.current"] as const;
export const MEMBER_ACTIONS = ["member.session", "member.register", "member.me", "member.updateProfile"] as const;
export const ADMIN_ACTIONS = ["admin.me", "job.get"] as const;
export const ADMIN_WRITE_ACTIONS = ["job.resume"] as const;

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
    return handleUpload(event, requestIdOf(event));
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
    return ok(requestId, now, { entry: "mw-public", skeleton: true });
  }
  if (action === "policies.current") {
    const policies = ctx.policyStore ? await readCurrentPolicies(ctx.policyStore, now) : defaultPolicyRecord(now);
    return ok(requestId, now, {
      agreementVersion: policies.agreementVersion,
      privacyVersion: policies.privacyVersion,
      agreementTitle: policies.agreementTitle,
      privacyTitle: policies.privacyTitle,
      placeholder: policies.placeholder === true,
      note: policies.note
    });
  }
  return ok(requestId, now, {
    roots: [],
    recommended: [],
    catalogVersion: 0,
    note: "MW05 public skeleton; catalog is MW09+"
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
    return ok(request.requestId, now, session);
  }
  if (request.action === "member.me") {
    const result = await readMemberMe(ctx.memberStore, fromAppId, fromOpenId);
    if (!result.ok) {
      return fail(request.requestId, result.code as ErrorCode, { reason: result.reason });
    }
    return ok(request.requestId, now, result.data);
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
    return ok(request.requestId, now, {
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
  return ok(request.requestId, now, {
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
  const isRead = (ADMIN_ACTIONS as readonly string[]).includes(action);
  const isWrite = (ADMIN_WRITE_ACTIONS as readonly string[]).includes(action);
  if (!isRead && !isWrite) {
    return fail(requestId, "FORBIDDEN", { reason: "ACTION_DENIED", entry: "mw-admin" });
  }
  const admin = await requireAdmin(ctx, requestId);
  if ("failure" in admin) return admin.failure;
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

function handleUpload(event: unknown, requestId: string): ApiResponse<unknown> | Record<string, unknown> {
  const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const ticket = rec.uploadTicket;
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
  return {
    ok: false,
    requestId,
    error: {
      code: "FORBIDDEN" as ErrorCode,
      message: errorMessage("FORBIDDEN"),
      retryable: false,
      details: { reason: "UPLOAD_SKELETON_NO_STORE", bytes, limit: UPLOAD_LIMIT_BYTES }
    }
  };
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
