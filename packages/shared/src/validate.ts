import { API_VERSION, type ApiRequest } from "./types.js";

const MAX_STRING = 2000;

export function rejectUnknownKeys(input: Record<string, unknown>, allowed: string[]): string[] {
  return Object.keys(input).filter((key) => !allowed.includes(key));
}

export function parseApiRequest(input: unknown): { request?: ApiRequest; issues: string[] } {
  const issues: string[] = [];
  if (!input || typeof input !== "object") {
    return { issues: ["request must be an object"] };
  }
  const rec = input as Record<string, unknown>;
  const extra = rejectUnknownKeys(rec, ["apiVersion", "action", "requestId", "idempotencyKey", "data"]);
  if (extra.length) issues.push(`unknown fields: ${extra.join(",")}`);
  if (rec.apiVersion !== API_VERSION) issues.push("apiVersion must be 1");
  if (typeof rec.action !== "string" || rec.action.length === 0) issues.push("action required");
  if (typeof rec.requestId !== "string" || rec.requestId.length === 0) issues.push("requestId required");
  if (rec.idempotencyKey !== undefined && typeof rec.idempotencyKey !== "string") {
    issues.push("idempotencyKey must be string");
  }
  if (!rec.data || typeof rec.data !== "object" || Array.isArray(rec.data)) {
    issues.push("data must be object");
  }
  if (typeof rec.requestId === "string" && rec.requestId.length > MAX_STRING) {
    issues.push("requestId too long");
  }
  if (issues.length) return { issues };
  return { request: rec as unknown as ApiRequest, issues: [] };
}

export function hasForbiddenAnswerKeys(value: unknown): string[] {
  const found: string[] = [];
  walk(value, (key) => {
    if (key === "answer" || key === "analysis" || key === "correctOptionIds") found.push(key);
  });
  return [...new Set(found)];
}

function walk(value: unknown, onKey: (key: string) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, onKey);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    onKey(key);
    walk(child, onKey);
  }
}
