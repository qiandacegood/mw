import { hashNamedFields } from "./canonical.js";
import { rejectUnknownKeys } from "./validate.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "./types.js";

/**
 * MW23 题目反馈纯逻辑。
 *
 * 绑定试卷与题目版本；类型至少覆盖题目错误或解析错误。
 * 不接受任意外链抓取；会员不能借反馈改答案库。
 * 客服入口与题目反馈是两类问题，不要混成订单售后。
 */

export const FEEDBACK_SCHEMA_VERSION = 1;
export const FEEDBACK_TYPES = ["question_error", "analysis_error"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_STATUSES = ["open", "resolved"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_CREATE_FIELDS = ["type", "paperId", "questionId", "versionId", "text"] as const;
export const FEEDBACK_LIST_FIELDS = ["status", "cursor", "limit"] as const;
export const FEEDBACK_RESOLVE_FIELDS = ["feedbackId", "note"] as const;
export const FEEDBACK_ID_FIELDS = ["kind", "memberId", "paperId", "questionId", "versionId", "idempotencyKey"] as const;

export const FEEDBACK_TEXT_MIN = 4;
export const FEEDBACK_TEXT_MAX = 500;
export const FEEDBACK_NOTE_MAX = 400;

const EXTERNAL_LINK = /https?:\/\/|www\.|\.com|\.cn|\.net|\.org|ftp:\/\/|weixin:\/\//i;

export type FeedbackRecord = {
  feedbackId: string;
  memberId: string;
  type: FeedbackType;
  paperId: string;
  questionId: string;
  versionId: string;
  text: string;
  status: FeedbackStatus;
  resolveNote: string;
  resolvedBy: string;
  resolvedAt: string;
  /** 提交人已注销时标记；不得据此改答案库。 */
  submitterDeleted: boolean;
  submitterDeletedAt: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
};

export function parseFeedbackType(value: unknown): FeedbackType | undefined {
  return typeof value === "string" && (FEEDBACK_TYPES as readonly string[]).includes(value)
    ? (value as FeedbackType)
    : undefined;
}

export function feedbackContainsExternalLink(text: string): boolean {
  return EXTERNAL_LINK.test(text);
}

export function feedbackDocId(input: {
  memberId: string;
  paperId: string;
  questionId: string;
  versionId: string;
  idempotencyKey: string;
}): string {
  return hashNamedFields(
    {
      kind: "feedback",
      memberId: input.memberId,
      paperId: input.paperId,
      questionId: input.questionId,
      versionId: input.versionId,
      idempotencyKey: input.idempotencyKey
    },
    FEEDBACK_ID_FIELDS
  );
}

export function parseFeedbackCreateInput(
  data: Record<string, unknown>
):
  | { ok: true; type: FeedbackType; paperId: string; questionId: string; versionId: string; text: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...FEEDBACK_CREATE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const type = parseFeedbackType(data.type);
  if (!type) issues.push(`type must be one of ${FEEDBACK_TYPES.join(",")}`);
  const paperId = typeof data.paperId === "string" ? data.paperId.trim() : "";
  const questionId = typeof data.questionId === "string" ? data.questionId.trim() : "";
  const versionId = typeof data.versionId === "string" ? data.versionId.trim() : "";
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!paperId) issues.push("paperId required");
  if (!questionId) issues.push("questionId required");
  if (!versionId) issues.push("versionId required");
  if (text.length < FEEDBACK_TEXT_MIN || text.length > FEEDBACK_TEXT_MAX) {
    issues.push(`text length must be ${FEEDBACK_TEXT_MIN}-${FEEDBACK_TEXT_MAX}`);
  }
  if (text && feedbackContainsExternalLink(text)) {
    issues.push("feedback must not contain external links");
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, type: type as FeedbackType, paperId, questionId, versionId, text };
}

export function parseFeedbackListInput(
  data: Record<string, unknown>
): { ok: true; status: FeedbackStatus | ""; cursor: string; limit: number } | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...FEEDBACK_LIST_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  let status: FeedbackStatus | "" = "";
  if (data.status !== undefined && data.status !== "") {
    if (typeof data.status !== "string" || !(FEEDBACK_STATUSES as readonly string[]).includes(data.status)) {
      issues.push(`status must be one of ${FEEDBACK_STATUSES.join(",")}`);
    } else {
      status = data.status as FeedbackStatus;
    }
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
  return { ok: true, status, cursor, limit };
}

export function parseFeedbackResolveInput(
  data: Record<string, unknown>
): { ok: true; feedbackId: string; note: string } | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...FEEDBACK_RESOLVE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const feedbackId = typeof data.feedbackId === "string" ? data.feedbackId.trim() : "";
  const note = typeof data.note === "string" ? data.note.trim() : "";
  if (!feedbackId) issues.push("feedbackId required");
  if (!note) issues.push("note required");
  if (note.length > FEEDBACK_NOTE_MAX) issues.push(`note length must be <= ${FEEDBACK_NOTE_MAX}`);
  if (note && feedbackContainsExternalLink(note)) issues.push("note must not contain external links");
  if (issues.length) return { ok: false, issues };
  return { ok: true, feedbackId, note };
}

/** 反馈不得改答案库：resolve 只改反馈状态，不得携带答案字段。 */
export const FEEDBACK_FORBIDDEN_MUTATION_KEYS = [
  "answer",
  "correctOptionIds",
  "analysis",
  "question_versions",
  "paper_answers"
] as const;

export function feedbackTriesToMutateAnswers(data: Record<string, unknown>): string[] {
  return FEEDBACK_FORBIDDEN_MUTATION_KEYS.filter((key) => data[key] !== undefined);
}

export function paperBindsQuestionVersion(input: {
  questionIds: readonly string[];
  questionVersionIds: readonly string[];
  questionId: string;
  versionId: string;
}): boolean {
  const index = input.questionIds.indexOf(input.questionId);
  if (index < 0) return false;
  return input.questionVersionIds[index] === input.versionId;
}

export function publicSupportEntry(nowIso: string) {
  return {
    title: "客服入口（测试稿）",
    channel: "in-app",
    hours: "工作日 09:00-18:00（测试）",
    note: "题目或解析错误请走解析页反馈，不要把订单售后发到这里。本轮客服入口为测试稿，正式方式仍待负责人确认。",
    placeholder: true,
    updatedAt: nowIso
  };
}
