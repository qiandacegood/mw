import {
  API_VERSION,
  adminAuthorized,
  adminHasRole,
  cloudbaseAuthDecision,
  errorMessage,
  forgedClientFields,
  parseApiRequest,
  sharedMiniIdentity,
  toUtcIso,
  type AdminRole,
  type ApiFailure,
  type ApiResponse,
  type ErrorCode
} from "@mw/shared";

export const UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;

export const PUBLIC_ACTIONS = ["public.ping", "home.get"] as const;
export const MEMBER_ACTIONS = ["member.session"] as const;
export const ADMIN_ACTIONS = ["admin.me"] as const;

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

function requestIdOf(event: unknown): string {
  if (event && typeof event === "object" && "requestId" in event) {
    const value = (event as { requestId?: unknown }).requestId;
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

  const forged = forgedDenied(ctx.event);
  if (forged) return forged;

  if (ctx.entry === "mw-upload") {
    return handleUpload(ctx.event, requestIdOf(ctx.event));
  }
  if (ctx.entry === "mw-pay-hook") {
    return handlePayHook(ctx.event);
  }
  if (ctx.entry === "mw-jobs") {
    return handleJobs(ctx);
  }

  const parsed = parseApiRequest(ctx.event);
  if (parsed.issues.length || !parsed.request) {
    return fail(requestIdOf(ctx.event), "INVALID_ARGUMENT", { issues: parsed.issues });
  }
  const request = parsed.request;
  if (request.apiVersion !== API_VERSION) {
    return fail(request.requestId, "INVALID_ARGUMENT", { issues: ["apiVersion must be 1"] });
  }

  if (ctx.entry === "mw-public") {
    return handlePublic(request.action, request.requestId, now);
  }
  if (ctx.entry === "mw-member") {
    return handleMember(ctx, request.action, request.requestId, now);
  }
  if (ctx.entry === "mw-admin") {
    return handleAdmin(ctx, request.action, request.requestId, now);
  }
  return fail(request.requestId, "FORBIDDEN", { reason: "UNKNOWN_ENTRY" });
}

function handlePublic(action: string, requestId: string, now: Date): ApiResponse<unknown> {
  if (!(PUBLIC_ACTIONS as readonly string[]).includes(action)) {
    return fail(requestId, "FORBIDDEN", { reason: "ACTION_DENIED", entry: "mw-public" });
  }
  if (action === "public.ping") {
    return ok(requestId, now, { entry: "mw-public", skeleton: true });
  }
  return ok(requestId, now, {
    roots: [],
    recommended: [],
    catalogVersion: 0,
    note: "MW05 public skeleton; catalog is MW09+"
  });
}

function handleMember(
  ctx: OfficialContext,
  action: string,
  requestId: string,
  now: Date
): ApiResponse<unknown> {
  if (!(MEMBER_ACTIONS as readonly string[]).includes(action)) {
    return fail(requestId, "FORBIDDEN", { reason: "ACTION_DENIED", entry: "mw-member" });
  }
  const identity = sharedMiniIdentity({
    fromAppId: ctx.fromAppId,
    fromOpenId: ctx.fromOpenId,
    resourceAppId: ctx.resourceAppId,
    resourceOpenId: ctx.resourceOpenId,
    allowedAppIds: ctx.allowedAppIds
  });
  if (!identity.trusted) {
    return fail(requestId, "AUTH_REQUIRED", { reason: identity.reason });
  }
  return ok(requestId, now, {
    trusted: true,
    registered: false,
    note: "MW05 trusted shared identity only; member.register is MW08"
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
  if (!(ADMIN_ACTIONS as readonly string[]).includes(action)) {
    return fail(requestId, "FORBIDDEN", { reason: "ACTION_DENIED", entry: "mw-admin" });
  }
  const admin = await requireAdmin(ctx, requestId);
  if ("failure" in admin) return admin.failure;
  return ok(requestId, now, {
    roles: admin.record.roles,
    enabled: admin.record.enabled,
    authVersion: admin.record.authVersion,
    canContent: adminHasRole(admin.record.roles, "content"),
    canOperations: adminHasRole(admin.record.roles, "operations"),
    canSuper: adminHasRole(admin.record.roles, "super")
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

function handlePayHook(event: unknown): Record<string, unknown> {
  const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const hasSignature = Boolean(rec.signature || rec.sign);
  if (!hasSignature) {
    return { ok: false, entry: "mw-pay-hook", reason: "SIGNATURE_REQUIRED" };
  }
  return { ok: false, entry: "mw-pay-hook", reason: "NOT_A_REAL_PAYMENT_CHANNEL" };
}

function handleJobs(ctx: OfficialContext): Record<string, unknown> {
  const rec = ctx.event && typeof ctx.event === "object" ? (ctx.event as Record<string, unknown>) : {};
  const clientLike = Boolean(rec.fromClient) || forgedClientFields(ctx.event).length > 0;
  if (clientLike || !ctx.trustedScheduler) {
    return { ok: false, entry: "mw-jobs", reason: "CLIENT_INVOKE_DENIED" };
  }
  return { ok: false, entry: "mw-jobs", reason: "NO_TRUSTED_SERVER_TRIGGER" };
}
