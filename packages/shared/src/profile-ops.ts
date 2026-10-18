import { rejectUnknownKeys } from "./validate.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "./types.js";
import { MEMBER_STATUSES, type MemberStatus } from "./member.js";

/**
 * MW23 停用 / 禁榜 / 会员查询契约。
 * disable 与 ban 分开记录，原因必填，仅 super。恢复同样要原因。
 */

export const MEMBER_DISABLE_FIELDS = ["targetMemberId", "disabled", "reason", "expectedRevision"] as const;
export const RANKING_BAN_FIELDS = ["targetMemberId", "banned", "reason", "expectedRevision"] as const;
export const MEMBER_LIST_FIELDS = ["status", "nickname", "cursor", "limit"] as const;
export const MEMBER_GET_FIELDS = ["targetMemberId"] as const;
export const MEMBER_CATEGORY_SCORES_FIELDS = ["categoryId"] as const;

export const MODERATION_REASON_MIN = 2;
export const MODERATION_REASON_MAX = 200;

function parseReason(value: unknown, issues: string[]): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason) issues.push("reason required");
  else if (reason.length < MODERATION_REASON_MIN || reason.length > MODERATION_REASON_MAX) {
    issues.push(`reason length must be ${MODERATION_REASON_MIN}-${MODERATION_REASON_MAX}`);
  }
  return reason;
}

function parseTargetMemberId(value: unknown, issues: string[]): string {
  const memberId = typeof value === "string" ? value.trim() : "";
  if (!memberId) issues.push("targetMemberId required");
  return memberId;
}

function parseExpectedRevision(value: unknown, issues: string[]): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    issues.push("expectedRevision must be a positive integer");
    return undefined;
  }
  return value;
}

export function parseMemberDisableInput(
  data: Record<string, unknown>
): { ok: true; memberId: string; disabled: boolean; reason: string; expectedRevision?: number } | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...MEMBER_DISABLE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const memberId = parseTargetMemberId(data.targetMemberId, issues);
  if (typeof data.disabled !== "boolean") issues.push("disabled must be boolean");
  const reason = parseReason(data.reason, issues);
  const expectedRevision = parseExpectedRevision(data.expectedRevision, issues);
  if (issues.length) return { ok: false, issues };
  return { ok: true, memberId, disabled: data.disabled as boolean, reason, expectedRevision };
}

export function parseRankingBanInput(
  data: Record<string, unknown>
): { ok: true; memberId: string; banned: boolean; reason: string; expectedRevision?: number } | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...RANKING_BAN_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const memberId = parseTargetMemberId(data.targetMemberId, issues);
  if (typeof data.banned !== "boolean") issues.push("banned must be boolean");
  const reason = parseReason(data.reason, issues);
  const expectedRevision = parseExpectedRevision(data.expectedRevision, issues);
  if (issues.length) return { ok: false, issues };
  return { ok: true, memberId, banned: data.banned as boolean, reason, expectedRevision };
}

export function parseMemberListInput(
  data: Record<string, unknown>
): { ok: true; status: MemberStatus | ""; nickname: string; cursor: string; limit: number } | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...MEMBER_LIST_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  let status: MemberStatus | "" = "";
  if (data.status !== undefined && data.status !== "") {
    if (typeof data.status !== "string" || !(MEMBER_STATUSES as readonly string[]).includes(data.status)) {
      issues.push(`status must be one of ${MEMBER_STATUSES.join(",")}`);
    } else {
      status = data.status as MemberStatus;
    }
  }
  let nickname = "";
  if (data.nickname !== undefined) {
    if (typeof data.nickname !== "string") issues.push("nickname must be a string");
    else nickname = data.nickname.trim();
  }
  let limit = DEFAULT_PAGE_LIMIT;
  if (data.limit !== undefined) {
    if (typeof data.limit !== "number" || !Number.isInteger(data.limit) || data.limit < 1 || data.limit > MAX_PAGE_LIMIT) {
      issues.push(`limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`);
    } else {
      limit = data.limit;
    }
  }
  let cursor = "";
  if (data.cursor !== undefined) {
    if (typeof data.cursor !== "string") issues.push("cursor must be a string");
    else cursor = data.cursor;
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, status, nickname, cursor, limit };
}

export function parseMemberGetInput(
  data: Record<string, unknown>
): { ok: true; memberId: string } | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...MEMBER_GET_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const memberId = parseTargetMemberId(data.targetMemberId, issues);
  if (issues.length) return { ok: false, issues };
  return { ok: true, memberId };
}

/** 禁榜只影响公开展示，不等于停用、不等于退款或改 VIP。 */
export function rankingBanChangesAccountStatus(): boolean {
  return false;
}

export function disableBlocksWrites(status: string): boolean {
  return status === "disabled" || status === "deleting" || status === "deleted";
}

/** 停用 ≠ 注销。已注销账号禁止新业务写，查询按本人/客服必要订单口径。 */
export function deletionBlocksWrites(status: string): boolean {
  return status === "deleting" || status === "deleted";
}

export function parseMemberCategoryScoresInput(
  data: Record<string, unknown>
): { ok: true; categoryId: string } | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...MEMBER_CATEGORY_SCORES_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  let categoryId = "";
  if (data.categoryId !== undefined) {
    if (typeof data.categoryId !== "string") issues.push("categoryId must be a string");
    else categoryId = data.categoryId.trim();
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, categoryId };
}
