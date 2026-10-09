import { callOfficialAction } from "./shared-cloud";

export type BrowseState = "ok" | "loading" | "empty" | "error" | "guest" | "denied" | "unavailable";

export function labelDifficulty(value: string): string {
  if (value === "intermediate") return "进阶";
  if (value === "challenge") return "挑战";
  return "入门";
}

export function labelAccess(value: string): string {
  return value === "vip" ? "VIP" : "免费";
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function errorInfo(res: Record<string, unknown>): { code: string; reason: string; message: string } {
  const error = asRecord(res.error);
  const details = asRecord(error.details);
  return {
    code: String(error.code || "SERVICE_BUSY"),
    reason: String(details.reason || ""),
    message: String(error.message || "网络失败或服务繁忙")
  };
}

export async function publicAction(
  action: string,
  data: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  try {
    return await callOfficialAction("mw-public", action, data, { requestId: `req_mp_${action}_${Date.now()}` });
  } catch {
    return { ok: false, error: { code: "SERVICE_BUSY", message: "网络失败或服务繁忙", retryable: true } };
  }
}

export async function memberMe(): Promise<Record<string, unknown>> {
  try {
    return await callOfficialAction("mw-member", "member.me", {}, { requestId: `req_mp_me_${Date.now()}` });
  } catch {
    return { ok: false, error: { code: "SERVICE_BUSY", message: "网络失败或服务繁忙", retryable: true } };
  }
}

export function paperPath(paper: Record<string, unknown>): string {
  const path = Array.isArray(paper.categoryPath) ? paper.categoryPath.filter((item) => typeof item === "string") : [];
  return path.join(" / ");
}
