import { hashNamedFields } from "./canonical.js";
import { rejectUnknownKeys } from "./validate.js";

export const SECONDS_PER_DAY = 86400;
export const VIP_SCHEMA_VERSION = 1;
export const VIP_SOURCE_GIFT = "gift" as const;
export const VIP_SOURCE_ORDER = "order" as const;
export const VIP_GRANT_ID_FIELDS = ["sourceType", "sourceId"] as const;
export const VIP_EVENT_ID_FIELDS = ["memberId", "type", "sourceId", "accountRevision"] as const;
export const VIP_GRANT_INPUT_FIELDS = ["targetMemberId", "durationDays", "durationSeconds", "reason", "sourceId"] as const;
export const VIP_REVOKE_INPUT_FIELDS = ["targetMemberId", "sourceId", "reason"] as const;
export const VIP_PAYMENT_KEYS = ["orderId", "planId", "amountFen", "paidAt", "channel", "productId"] as const;
export const VIP_MAX_DURATION_DAYS = 3650;
export const VIP_MAX_DURATION_SECONDS = VIP_MAX_DURATION_DAYS * SECONDS_PER_DAY;

export type VipSourceType = typeof VIP_SOURCE_GIFT | typeof VIP_SOURCE_ORDER;
export type VipReconcileState = "idle" | "pending" | "rebuilding";
export type VipEventType = "grant" | "consume" | "revoke";

export type VipAccountRecord = {
  memberId: string;
  expiresAt: string | null;
  remainingSeconds: number;
  settledAt: string | null;
  grantIds: string[];
  revision: number;
  queueVersion: number;
  reconcileState: VipReconcileState;
  schemaVersion: number;
  updatedAt: string;
};

export type VipGrantRecord = {
  grantId: string;
  memberId: string;
  sourceType: VipSourceType;
  sourceId: string;
  grantedSeconds: number;
  remainingSeconds: number;
  consumedSeconds: number;
  revokedSeconds: number;
  sequence: number;
  grantedAt: string;
  reason: string;
  actorId: string;
  schemaVersion: number;
};

export type VipEventRecord = {
  eventId: string;
  memberId: string;
  sourceId: string;
  type: VipEventType;
  effectiveAt: string;
  seconds: number;
  accountRevision: number;
};

export type VipStatusView = {
  active: boolean;
  expiresAt: string | null;
  remainingSeconds: number;
  reconcileState: VipReconcileState;
  source: "ledger";
};

export function durationSecondsFromDays(days: number): number {
  if (!Number.isInteger(days) || days <= 0) throw new Error("days must be a positive integer");
  return days * SECONDS_PER_DAY;
}

export function nextExpiresAt(input: {
  grantedAtMs: number;
  durationSeconds: number;
  currentExpiresAtMs: number | null;
}): number {
  const base =
    input.currentExpiresAtMs !== null && input.currentExpiresAtMs > input.grantedAtMs
      ? input.currentExpiresAtMs
      : input.grantedAtMs;
  return base + input.durationSeconds * 1000;
}

export function isVipActive(expiresAtMs: number, nowMs: number): boolean {
  return nowMs < expiresAtMs;
}

export function vipGrantId(sourceType: string, sourceId: string): string {
  return hashNamedFields({ sourceType, sourceId }, VIP_GRANT_ID_FIELDS);
}

export function vipEventId(input: {
  memberId: string;
  type: VipEventType;
  sourceId: string;
  accountRevision: number;
}): string {
  return hashNamedFields(
    {
      memberId: input.memberId,
      type: input.type,
      sourceId: input.sourceId,
      accountRevision: input.accountRevision
    },
    VIP_EVENT_ID_FIELDS
  );
}

export function emptyVipAccount(memberId: string, now: Date): VipAccountRecord {
  return {
    memberId,
    expiresAt: null,
    remainingSeconds: 0,
    settledAt: now.toISOString(),
    grantIds: [],
    revision: 0,
    queueVersion: 0,
    reconcileState: "idle",
    schemaVersion: VIP_SCHEMA_VERSION,
    updatedAt: now.toISOString()
  };
}

function cloneGrant(row: VipGrantRecord): VipGrantRecord {
  return { ...row };
}

function grantsBySequence(grants: readonly VipGrantRecord[]): VipGrantRecord[] {
  return grants.map(cloneGrant).sort((a, b) => a.sequence - b.sequence || a.grantId.localeCompare(b.grantId));
}

function remainingOf(grants: readonly VipGrantRecord[]): number {
  return grants.reduce((sum, row) => sum + Math.max(0, row.remainingSeconds), 0);
}

function consumeBySequence(grants: readonly VipGrantRecord[], seconds: number): { grants: VipGrantRecord[]; consumed: number } {
  let left = Math.max(0, Math.floor(seconds));
  let consumed = 0;
  const next = grantsBySequence(grants);
  for (const row of next) {
    if (left <= 0) break;
    const take = Math.min(row.remainingSeconds, left);
    if (take <= 0) continue;
    row.remainingSeconds -= take;
    row.consumedSeconds += take;
    left -= take;
    consumed += take;
  }
  return { grants: next, consumed };
}

export function projectVipLedger(input: {
  account?: VipAccountRecord;
  grants: readonly VipGrantRecord[];
  now: Date;
}): {
  account: VipAccountRecord;
  grants: VipGrantRecord[];
  consumedSeconds: number;
  active: boolean;
} {
  const now = input.now;
  const nowMs = now.getTime();
  const account = input.account
    ? { ...input.account, grantIds: [...input.account.grantIds] }
    : emptyVipAccount("", now);
  const settledAtMs = account.settledAt ? Date.parse(account.settledAt) : nowMs;
  const expiresAtMs = account.expiresAt ? Date.parse(account.expiresAt) : null;
  const elapsed = Number.isFinite(settledAtMs) ? Math.max(0, Math.floor((nowMs - settledAtMs) / 1000)) : 0;
  const remainingBefore = remainingOf(input.grants);
  let toConsume = 0;
  if (remainingBefore > 0 && elapsed > 0) {
    if (expiresAtMs !== null && nowMs >= expiresAtMs) {
      toConsume = remainingBefore;
    } else {
      toConsume = Math.min(elapsed, remainingBefore);
    }
  }
  const settled = consumeBySequence(input.grants, toConsume);
  const remaining = remainingOf(settled.grants);
  const projected: VipAccountRecord = {
    ...account,
    remainingSeconds: remaining,
    settledAt: now.toISOString(),
    expiresAt: account.expiresAt,
    grantIds: settled.grants.map((row) => row.grantId),
    updatedAt: now.toISOString()
  };
  const active = projected.expiresAt ? isVipActive(Date.parse(projected.expiresAt), nowMs) : false;
  return { account: projected, grants: settled.grants, consumedSeconds: settled.consumed, active };
}

export function evaluateVipStatus(input: {
  account?: VipAccountRecord;
  grants?: readonly VipGrantRecord[];
  now: Date;
}): VipStatusView {
  const projected = projectVipLedger({
    account: input.account,
    grants: input.grants || [],
    now: input.now
  });
  const expiresAt = input.account?.expiresAt ?? null;
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : null;
  const active = expiresAtMs !== null && isVipActive(expiresAtMs, input.now.getTime());
  return {
    active,
    expiresAt,
    remainingSeconds: projected.account.remainingSeconds,
    reconcileState: input.account?.reconcileState || "idle",
    source: "ledger"
  };
}

export function applyVipGrant(input: {
  account?: VipAccountRecord;
  grants: readonly VipGrantRecord[];
  memberId: string;
  sourceType: VipSourceType;
  sourceId: string;
  durationSeconds: number;
  grantedAt: Date;
  reason: string;
  actorId: string;
}):
  | {
      ok: true;
      account: VipAccountRecord;
      grant: VipGrantRecord;
      grants: VipGrantRecord[];
      events: VipEventRecord[];
      replayed: boolean;
    }
  | { ok: false; reason: string } {
  if (input.sourceType !== VIP_SOURCE_GIFT && input.sourceType !== VIP_SOURCE_ORDER) {
    return { ok: false, reason: "SOURCE_TYPE_INVALID" };
  }
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > VIP_MAX_DURATION_SECONDS) {
    return { ok: false, reason: "DURATION_INVALID" };
  }
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: "REASON_REQUIRED" };
  const grantId = vipGrantId(input.sourceType, input.sourceId);
  const existing = input.grants.find((row) => row.grantId === grantId);
  if (existing) {
    const account = input.account || emptyVipAccount(input.memberId, input.grantedAt);
    return {
      ok: true,
      account,
      grant: cloneGrant(existing),
      grants: grantsBySequence(input.grants),
      events: [],
      replayed: true
    };
  }
  const settled = projectVipLedger({
    account: input.account || emptyVipAccount(input.memberId, input.grantedAt),
    grants: input.grants,
    now: input.grantedAt
  });
  const grantedAtMs = input.grantedAt.getTime();
  const currentExpiresAtMs = settled.account.expiresAt ? Date.parse(settled.account.expiresAt) : null;
  const expiresAtMs = nextExpiresAt({
    grantedAtMs,
    durationSeconds: input.durationSeconds,
    currentExpiresAtMs
  });
  const sequence = settled.grants.reduce((max, row) => Math.max(max, row.sequence), 0) + 1;
  const grant: VipGrantRecord = {
    grantId,
    memberId: input.memberId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    grantedSeconds: input.durationSeconds,
    remainingSeconds: input.durationSeconds,
    consumedSeconds: 0,
    revokedSeconds: 0,
    sequence,
    grantedAt: input.grantedAt.toISOString(),
    reason,
    actorId: input.actorId,
    schemaVersion: VIP_SCHEMA_VERSION
  };
  const grants = [...settled.grants, grant];
  const revision = settled.account.revision + 1;
  const account: VipAccountRecord = {
    ...settled.account,
    memberId: input.memberId,
    expiresAt: new Date(expiresAtMs).toISOString(),
    remainingSeconds: remainingOf(grants),
    settledAt: input.grantedAt.toISOString(),
    grantIds: grants.map((row) => row.grantId),
    revision,
    queueVersion: settled.account.queueVersion + 1,
    reconcileState: "idle",
    schemaVersion: VIP_SCHEMA_VERSION,
    updatedAt: input.grantedAt.toISOString()
  };
  const events: VipEventRecord[] = [];
  if (settled.consumedSeconds > 0) {
    events.push({
      eventId: vipEventId({
        memberId: input.memberId,
        type: "consume",
        sourceId: input.sourceId,
        accountRevision: revision
      }),
      memberId: input.memberId,
      sourceId: input.sourceId,
      type: "consume",
      effectiveAt: input.grantedAt.toISOString(),
      seconds: settled.consumedSeconds,
      accountRevision: revision
    });
  }
  events.push({
    eventId: vipEventId({
      memberId: input.memberId,
      type: "grant",
      sourceId: input.sourceId,
      accountRevision: revision
    }),
    memberId: input.memberId,
    sourceId: input.sourceId,
    type: "grant",
    effectiveAt: input.grantedAt.toISOString(),
    seconds: input.durationSeconds,
    accountRevision: revision
  });
  return { ok: true, account, grant, grants, events, replayed: false };
}

export type RevokeVipSourceResult =
  | {
      ok: true;
      account: VipAccountRecord;
      grant: VipGrantRecord;
      grants: VipGrantRecord[];
      events: VipEventRecord[];
      revokedSeconds: number;
      replayed: boolean;
    }
  | { ok: false; reason: string };

export function revokeVipSource(input: {
  account?: VipAccountRecord;
  grants: readonly VipGrantRecord[];
  sourceType: VipSourceType;
  sourceId: string;
  now: Date;
  reason: string;
}): RevokeVipSourceResult {
  if (!input.reason.trim()) return { ok: false, reason: "REASON_REQUIRED" };
  if (input.sourceType !== VIP_SOURCE_GIFT && input.sourceType !== VIP_SOURCE_ORDER) {
    return { ok: false, reason: "SOURCE_TYPE_INVALID" };
  }
  const grantId = vipGrantId(input.sourceType, input.sourceId);
  const found = input.grants.find(
    (row) => row.grantId === grantId || (row.sourceType === input.sourceType && row.sourceId === input.sourceId)
  );
  if (!found) {
    return { ok: false, reason: input.sourceType === VIP_SOURCE_GIFT ? "GIFT_GRANT_NOT_FOUND" : "ORDER_GRANT_NOT_FOUND" };
  }
  if (found.sourceType !== input.sourceType) {
    return { ok: false, reason: input.sourceType === VIP_SOURCE_GIFT ? "PAID_SOURCE_NOT_REVOCABLE" : "SOURCE_TYPE_MISMATCH" };
  }
  const settled = projectVipLedger({
    account: input.account || emptyVipAccount(found.memberId, input.now),
    grants: input.grants,
    now: input.now
  });
  const current = settled.grants.find((row) => row.grantId === found.grantId);
  if (!current) {
    return { ok: false, reason: input.sourceType === VIP_SOURCE_GIFT ? "GIFT_GRANT_NOT_FOUND" : "ORDER_GRANT_NOT_FOUND" };
  }
  if (current.remainingSeconds <= 0) {
    return {
      ok: true,
      account: settled.account,
      grant: current,
      grants: settled.grants,
      events: [],
      revokedSeconds: 0,
      replayed: true
    };
  }
  const revokedSeconds = current.remainingSeconds;
  current.revokedSeconds += revokedSeconds;
  current.remainingSeconds = 0;
  const remaining = remainingOf(settled.grants);
  const revision = settled.account.revision + 1;
  const expiresAt = remaining > 0 ? new Date(input.now.getTime() + remaining * 1000).toISOString() : input.now.toISOString();
  const account: VipAccountRecord = {
    ...settled.account,
    remainingSeconds: remaining,
    settledAt: input.now.toISOString(),
    expiresAt,
    grantIds: settled.grants.map((row) => row.grantId),
    revision,
    queueVersion: settled.account.queueVersion + 1,
    updatedAt: input.now.toISOString()
  };
  const events: VipEventRecord[] = [];
  if (settled.consumedSeconds > 0) {
    events.push({
      eventId: vipEventId({
        memberId: found.memberId,
        type: "consume",
        sourceId: input.sourceId,
        accountRevision: revision
      }),
      memberId: found.memberId,
      sourceId: input.sourceId,
      type: "consume",
      effectiveAt: input.now.toISOString(),
      seconds: settled.consumedSeconds,
      accountRevision: revision
    });
  }
  events.push({
    eventId: vipEventId({
      memberId: found.memberId,
      type: "revoke",
      sourceId: input.sourceId,
      accountRevision: revision
    }),
    memberId: found.memberId,
    sourceId: input.sourceId,
    type: "revoke",
    effectiveAt: input.now.toISOString(),
    seconds: revokedSeconds,
    accountRevision: revision
  });
  return { ok: true, account, grant: current, grants: settled.grants, events, revokedSeconds, replayed: false };
}

export function revokeVipGift(input: {
  account?: VipAccountRecord;
  grants: readonly VipGrantRecord[];
  sourceId: string;
  now: Date;
  reason: string;
}): RevokeVipSourceResult {
  return revokeVipSource({ ...input, sourceType: VIP_SOURCE_GIFT });
}

export function revokeVipOrderSource(input: {
  account?: VipAccountRecord;
  grants: readonly VipGrantRecord[];
  sourceId: string;
  now: Date;
  reason: string;
}): RevokeVipSourceResult {
  return revokeVipSource({ ...input, sourceType: VIP_SOURCE_ORDER });
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function parseVipGrantInput(data: Record<string, unknown>):
  | {
      ok: true;
      memberId: string;
      durationSeconds: number;
      reason: string;
      sourceId?: string;
    }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...VIP_GRANT_INPUT_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  for (const key of VIP_PAYMENT_KEYS) {
    if (key in data) issues.push(`payment field forbidden: ${key}`);
  }
  const memberId = typeof data.targetMemberId === "string" ? data.targetMemberId.trim() : "";
  if (!memberId) issues.push("targetMemberId required");
  const reason = typeof data.reason === "string" ? data.reason.trim() : "";
  if (!reason) issues.push("reason required");
  const days = data.durationDays === undefined ? undefined : asPositiveInt(data.durationDays);
  const seconds = data.durationSeconds === undefined ? undefined : asPositiveInt(data.durationSeconds);
  if (data.durationDays !== undefined && days === undefined) issues.push("durationDays must be a positive integer");
  if (data.durationSeconds !== undefined && seconds === undefined) issues.push("durationSeconds must be a positive integer");
  if (days === undefined && seconds === undefined) issues.push("durationDays or durationSeconds required");
  if (days !== undefined && days > VIP_MAX_DURATION_DAYS) issues.push("durationDays too large");
  if (seconds !== undefined && seconds > VIP_MAX_DURATION_SECONDS) issues.push("durationSeconds too large");
  if (days !== undefined && seconds !== undefined && seconds !== durationSecondsFromDays(days)) {
    issues.push("durationDays and durationSeconds mismatch");
  }
  const sourceId = data.sourceId === undefined ? undefined : typeof data.sourceId === "string" ? data.sourceId.trim() : "";
  if (data.sourceId !== undefined && (!sourceId || sourceId.length > 80 || !/^[A-Za-z0-9._:-]+$/.test(sourceId))) {
    issues.push("sourceId must be 1-80 token chars");
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    memberId,
    durationSeconds: days !== undefined ? durationSecondsFromDays(days) : (seconds as number),
    reason,
    ...(sourceId ? { sourceId } : {})
  };
}

export function parseVipRevokeInput(data: Record<string, unknown>):
  | { ok: true; memberId: string; sourceId: string; reason: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...VIP_REVOKE_INPUT_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  for (const key of VIP_PAYMENT_KEYS) {
    if (key in data) issues.push(`payment field forbidden: ${key}`);
  }
  const memberId = typeof data.targetMemberId === "string" ? data.targetMemberId.trim() : "";
  const sourceId = typeof data.sourceId === "string" ? data.sourceId.trim() : "";
  const reason = typeof data.reason === "string" ? data.reason.trim() : "";
  if (!memberId) issues.push("targetMemberId required");
  if (!sourceId) issues.push("sourceId required");
  if (!reason) issues.push("reason required");
  if (issues.length) return { ok: false, issues };
  return { ok: true, memberId, sourceId, reason };
}
