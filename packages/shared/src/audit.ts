import { payloadHash } from "./canonical.js";

export const AUDIT_FORBIDDEN_KEYS = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "session_key",
  "sessionKey",
  "openid",
  "openId",
  "OPENID",
  "FROM_OPENID",
  "unionid",
  "unionId",
  "appKey",
  "AppKey",
  "answer",
  "analysis",
  "correctOptionIds",
  "CLOUDBASE_ENV_ID",
  "process.env",
  "envId"
] as const;

const FORBIDDEN = new Set<string>(AUDIT_FORBIDDEN_KEYS.map((key) => key.toLowerCase()));

export interface AuditEntry {
  actorType: "admin" | "system" | "member";
  actorId: string;
  action: string;
  target: string;
  reason: string;
  requestId: string;
  beforeHash: string;
  afterHash: string;
  createdAt: string;
  schemaVersion: number;
}

export function isForbiddenAuditKey(key: string): boolean {
  const lower = key.toLowerCase();
  return FORBIDDEN.has(lower) || lower.includes("password") || lower.includes("secret");
}

export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value !== "object" || depth > 6) {
    return value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? value
      : "[omitted]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeAuditValue(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenAuditKey(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = sanitizeAuditValue(child, depth + 1);
  }
  return out;
}

export function auditSummaryHash(value: unknown): string {
  return payloadHash(sanitizeAuditValue(value));
}

export const AUDIT_REASON_MAX_LENGTH = 160;

const REASON_SECRET_ASSIGN = /(?:password|passwd|pwd|token|secret|authorization|api[_-]?key|access[_-]?key|session[_-]?key)\s*[:=]\s*\S+/gi;
const REASON_JWT = /eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
const REASON_LONG_SECRET = /\b[a-f0-9]{32,}\b/gi;

export function sanitizeAuditReason(reason: string): string {
  let text = String(reason ?? "");
  text = text.replace(REASON_SECRET_ASSIGN, "[redacted]");
  text = text.replace(REASON_JWT, "[redacted]");
  text = text.replace(REASON_LONG_SECRET, "[redacted]");
  if (text.length > AUDIT_REASON_MAX_LENGTH) {
    text = text.slice(0, AUDIT_REASON_MAX_LENGTH);
  }
  return text;
}

export function buildAuditEntry(input: {
  actorType: AuditEntry["actorType"];
  actorId: string;
  action: string;
  target: string;
  reason: string;
  requestId: string;
  before?: unknown;
  after?: unknown;
  now: Date;
}): AuditEntry {
  return {
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    target: input.target,
    reason: sanitizeAuditReason(input.reason),
    requestId: input.requestId,
    beforeHash: auditSummaryHash(input.before ?? null),
    afterHash: auditSummaryHash(input.after ?? null),
    createdAt: input.now.toISOString(),
    schemaVersion: 1
  };
}
