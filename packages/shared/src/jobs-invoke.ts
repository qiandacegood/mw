import { canonicalJson, sha256Bytes, toHex, utf8Bytes } from "./canonical.js";

export const JOBS_INVOKE_MAX_AGE_MS = 10 * 60 * 1000;

export type JobsWorkerCommand =
  | "acquire"
  | "saveCursor"
  | "renew"
  | "succeed"
  | "fail"
  | "interruptAfterCursor"
  | "continue"
  | "inspect"
  | "idempotencyProbe";

export interface JobsServerInvoke {
  action: "jobs.process" | "jobs.tick" | "jobs.inspect" | "idempotency.probe";
  issuedAt: string;
  nonce: string;
  jobId?: string;
  command?: JobsWorkerCommand;
  leaseMs?: number;
  fencingToken?: number;
  cursor?: { done: number; total: number };
  failCode?: string;
  actorId?: string;
  idempotencyKey?: string;
  payload?: unknown;
  mac: string;
}

const SIGNED_KEYS = [
  "action",
  "issuedAt",
  "nonce",
  "jobId",
  "command",
  "leaseMs",
  "fencingToken",
  "cursor",
  "failCode",
  "actorId",
  "idempotencyKey",
  "payload"
] as const;

export function jobsInvokePayload(input: Omit<JobsServerInvoke, "mac">): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SIGNED_KEYS) {
    if (input[key] !== undefined) {
      out[key] = input[key];
    }
  }
  return out;
}

export function hmacSha256Hex(secret: string, message: string): string {
  let key = utf8Bytes(secret);
  if (key.length > 64) {
    key = sha256Bytes(key);
  }
  const block = new Uint8Array(64);
  block.set(key);
  const messageBytes = utf8Bytes(message);
  const inner = new Uint8Array(64 + messageBytes.length);
  const outer = new Uint8Array(96);
  for (let i = 0; i < 64; i += 1) {
    inner[i] = (block[i] as number) ^ 0x36;
    outer[i] = (block[i] as number) ^ 0x5c;
  }
  inner.set(messageBytes, 64);
  outer.set(sha256Bytes(inner), 64);
  return toHex(sha256Bytes(outer));
}

export function signJobsInvoke(secret: string, input: Omit<JobsServerInvoke, "mac">): JobsServerInvoke {
  const mac = hmacSha256Hex(secret, canonicalJson(jobsInvokePayload(input)));
  return { ...input, mac };
}

export function verifyJobsInvokeMac(secret: string, invoke: JobsServerInvoke): boolean {
  if (!secret || !invoke.mac) return false;
  const expected = hmacSha256Hex(secret, canonicalJson(jobsInvokePayload(invoke)));
  if (expected.length !== invoke.mac.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ invoke.mac.charCodeAt(i);
  }
  return diff === 0;
}

export function looksLikeTimerEvent(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const rec = event as Record<string, unknown>;
  const type = rec.Type ?? rec.type;
  return type === "Timer" || type === "timer" || typeof rec.TriggerName === "string";
}

export function evaluateJobsTrust(input: {
  event: unknown;
  fromAppId?: string;
  fromOpenId?: string;
  authUid?: string;
  secret?: string;
  now: Date;
}): { trusted: boolean; reason: string; invoke?: JobsServerInvoke } {
  const rec = input.event && typeof input.event === "object" ? (input.event as Record<string, unknown>) : {};
  if (rec.fromClient === true) {
    return { trusted: false, reason: "CLIENT_INVOKE_DENIED" };
  }
  if (input.fromAppId || input.fromOpenId || input.authUid) {
    return { trusted: false, reason: "CLIENT_INVOKE_DENIED" };
  }
  const raw = rec.serverInvoke;
  const invoke = raw && typeof raw === "object" ? (raw as JobsServerInvoke) : undefined;
  const tokenValid = Boolean(
    invoke &&
      input.secret &&
      verifyJobsInvokeMac(input.secret, invoke) &&
      Number.isFinite(Date.parse(invoke.issuedAt)) &&
      input.now.getTime() - Date.parse(invoke.issuedAt) <= JOBS_INVOKE_MAX_AGE_MS &&
      Date.parse(invoke.issuedAt) - input.now.getTime() <= 60_000
  );
  if (looksLikeTimerEvent(input.event) && !tokenValid) {
    return { trusted: false, reason: "FORGED_TIMER_DENIED" };
  }
  if (!tokenValid) {
    return { trusted: false, reason: "NO_TRUSTED_SERVER_TRIGGER" };
  }
  return { trusted: true, reason: "SIGNED_SERVER_INVOKE", invoke };
}
