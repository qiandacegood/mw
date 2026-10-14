import { hashNamedFields, namedCanonicalJson, sha256Hex } from "./canonical.js";
import { rejectUnknownKeys } from "./validate.js";
import { PAPER_QUESTION_MAX } from "./paper.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "./types.js";

export const ATTEMPT_SCHEMA_VERSION = 1;
export const ATTEMPT_ANSWER_MAX = PAPER_QUESTION_MAX;
export const ATTEMPT_STATES = ["inProgress", "submitted", "abandoned"] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

export const ATTEMPT_START_FIELDS = ["paperId", "expectedPaperVersion"] as const;
export const ATTEMPT_REPLACE_FIELDS = ["paperId", "abandonAttemptId", "expectedRevision", "confirmed"] as const;
export const ATTEMPT_GET_FIELDS = ["attemptId"] as const;
export const ATTEMPT_PAGE_FIELDS = ["attemptId", "chunkNo"] as const;
export const ATTEMPT_SAVE_FIELDS = ["attemptId", "expectedRevision", "answers"] as const;
export const ATTEMPT_ABANDON_FIELDS = ["attemptId", "expectedRevision", "confirmed"] as const;
export const ATTEMPT_SUBMIT_FIELDS = ["attemptId", "expectedRevision", "answers", "confirmUnanswered"] as const;
export const ATTEMPT_ANALYSIS_FIELDS = ["attemptId", "chunkNo", "wrongOnly"] as const;
export const ATTEMPT_HISTORY_FIELDS = ["paperId", "cursor", "limit"] as const;
export const ATTEMPT_ANSWER_ITEM_FIELDS = ["questionId", "optionIds"] as const;
export const ATTEMPT_ID_FIELDS = ["kind", "memberId", "idempotencyKey"] as const;

export type AttemptAnswer = {
  questionId: string;
  optionIds: string[];
};

export type AttemptDraftSummary = {
  attemptId: string | null;
  paperId?: string;
  paperTitle?: string;
  paperVersion?: string;
  revision?: number;
  answeredCount?: number;
  questionCount?: number;
  updatedAt?: string;
};

export type AttemptRecord = {
  attemptId: string;
  memberId: string;
  paperId: string;
  paperVersionId: string;
  paperTitle: string;
  access: "free" | "vip";
  questionCount: number;
  maxScore: number;
  chunkCount: number;
  answers: AttemptAnswer[];
  draftRevision: number;
  state: AttemptState;
  submittedAt: string;
  abandonedAt: string;
  lastSaveRequestId: string;
  score: number | null;
  gradeRevision: number | null;
  submitHash: string | null;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type ActiveAttemptRecord = {
  memberId: string;
  attemptId: string;
  paperId: string;
  paperTitle: string;
  paperVersionId: string;
  revision: number;
  answeredCount: number;
  questionCount: number;
  updatedAt: string;
  schemaVersion: number;
};

export function isAttemptState(value: unknown): value is AttemptState {
  return (ATTEMPT_STATES as readonly string[]).includes(String(value));
}

export function attemptIdFor(memberId: string, idempotencyKey: string): string {
  return hashNamedFields({ kind: "attempt", memberId, idempotencyKey }, ATTEMPT_ID_FIELDS);
}

export function emptyDraftSummary(): AttemptDraftSummary {
  return { attemptId: null };
}

export function draftSummaryOf(active: ActiveAttemptRecord | undefined, attempt?: AttemptRecord): AttemptDraftSummary {
  if (!active?.attemptId) return emptyDraftSummary();
  return {
    attemptId: active.attemptId,
    paperId: attempt?.paperId || active.paperId,
    paperTitle: attempt?.paperTitle || active.paperTitle,
    paperVersion: attempt?.paperVersionId || active.paperVersionId,
    revision: attempt?.draftRevision ?? active.revision,
    answeredCount: attempt ? attempt.answers.length : active.answeredCount,
    questionCount: attempt?.questionCount ?? active.questionCount,
    updatedAt: attempt?.updatedAt || active.updatedAt
  };
}

export function sortOptionIds(optionIds: string[]): string[] {
  return [...new Set(optionIds.filter((id) => typeof id === "string" && id.trim()))].sort((left, right) =>
    left.localeCompare(right)
  );
}

export function normalizeAttemptAnswers(
  input: unknown,
  allowedQuestionIds: readonly string[]
): { ok: true; answers: AttemptAnswer[] } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  if (!Array.isArray(input)) {
    return { ok: false, issues: ["answers must be an array"] };
  }
  if (input.length > ATTEMPT_ANSWER_MAX) {
    return { ok: false, issues: [`answers must have at most ${ATTEMPT_ANSWER_MAX} items`] };
  }
  const allowed = new Set(allowedQuestionIds);
  const seen = new Set<string>();
  const answers: AttemptAnswer[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      issues.push("each answer must be an object");
      continue;
    }
    const rec = item as Record<string, unknown>;
    const extra = rejectUnknownKeys(rec, [...ATTEMPT_ANSWER_ITEM_FIELDS]);
    if (extra.length) issues.push(`unknown answer fields: ${extra.join(",")}`);
    if (typeof rec.questionId !== "string" || !rec.questionId.trim()) {
      issues.push("questionId required");
      continue;
    }
    if (seen.has(rec.questionId)) {
      issues.push("questionId must be unique in answers");
      continue;
    }
    seen.add(rec.questionId);
    if (!allowed.has(rec.questionId)) {
      issues.push(`unknown questionId: ${rec.questionId}`);
      continue;
    }
    if (!Array.isArray(rec.optionIds)) {
      issues.push("optionIds must be an array");
      continue;
    }
    if (rec.optionIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 32)) {
      issues.push("optionIds must be short strings");
      continue;
    }
    const optionIds = sortOptionIds(rec.optionIds as string[]);
    if (optionIds.length === 0) continue;
    answers.push({ questionId: rec.questionId, optionIds });
  }
  if (issues.length) return { ok: false, issues };
  answers.sort((left, right) => left.questionId.localeCompare(right.questionId));
  return { ok: true, answers };
}

export function parseAttemptStartInput(
  data: Record<string, unknown>
): { ok: true; paperId: string; expectedPaperVersion?: string } | { ok: false; issues: string[] } {
  const issues = rejectUnknownKeys(data, [...ATTEMPT_START_FIELDS]);
  if (typeof data.paperId !== "string" || !data.paperId.trim()) issues.push("paperId required");
  if (data.expectedPaperVersion !== undefined && (typeof data.expectedPaperVersion !== "string" || !data.expectedPaperVersion)) {
    issues.push("expectedPaperVersion must be string");
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    paperId: String(data.paperId).trim(),
    ...(typeof data.expectedPaperVersion === "string" ? { expectedPaperVersion: data.expectedPaperVersion } : {})
  };
}

export function parseAttemptReplaceInput(data: Record<string, unknown>):
  | { ok: true; paperId: string; abandonAttemptId: string; expectedRevision: number; confirmed: true }
  | { ok: false; issues: string[] } {
  const issues = rejectUnknownKeys(data, [...ATTEMPT_REPLACE_FIELDS]);
  if (typeof data.paperId !== "string" || !data.paperId.trim()) issues.push("paperId required");
  if (typeof data.abandonAttemptId !== "string" || !data.abandonAttemptId.trim()) issues.push("abandonAttemptId required");
  if (!Number.isInteger(data.expectedRevision) || Number(data.expectedRevision) < 0) {
    issues.push("expectedRevision must be a non-negative integer");
  }
  if (data.confirmed !== true) issues.push("confirmed must be true");
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    paperId: String(data.paperId).trim(),
    abandonAttemptId: String(data.abandonAttemptId).trim(),
    expectedRevision: Number(data.expectedRevision),
    confirmed: true
  };
}

export function parseAttemptIdInput(
  data: Record<string, unknown>,
  extra: readonly string[] = []
): { ok: true; attemptId: string } | { ok: false; issues: string[] } {
  const issues = rejectUnknownKeys(data, ["attemptId", ...extra]);
  if (typeof data.attemptId !== "string" || !data.attemptId.trim()) issues.push("attemptId required");
  if (issues.length) return { ok: false, issues };
  return { ok: true, attemptId: String(data.attemptId).trim() };
}

export function parseQuestionPageInput(
  data: Record<string, unknown>
): { ok: true; attemptId: string; chunkNo: number } | { ok: false; issues: string[] } {
  const issues = rejectUnknownKeys(data, [...ATTEMPT_PAGE_FIELDS]);
  if (typeof data.attemptId !== "string" || !data.attemptId.trim()) issues.push("attemptId required");
  if (!Number.isInteger(data.chunkNo) || Number(data.chunkNo) < 1) issues.push("chunkNo must be an integer >= 1");
  if (issues.length) return { ok: false, issues };
  return { ok: true, attemptId: String(data.attemptId).trim(), chunkNo: Number(data.chunkNo) };
}

export function parseAttemptSaveEnvelope(
  data: Record<string, unknown>
): { ok: true; attemptId: string; expectedRevision: number; rawAnswers: unknown } | { ok: false; issues: string[] } {
  const issues = rejectUnknownKeys(data, [...ATTEMPT_SAVE_FIELDS]);
  if (typeof data.attemptId !== "string" || !data.attemptId.trim()) issues.push("attemptId required");
  if (!Number.isInteger(data.expectedRevision) || Number(data.expectedRevision) < 0) {
    issues.push("expectedRevision must be a non-negative integer");
  }
  if (!Array.isArray(data.answers)) issues.push("answers must be an array");
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    attemptId: String(data.attemptId).trim(),
    expectedRevision: Number(data.expectedRevision),
    rawAnswers: data.answers
  };
}

export function parseAttemptSaveInput(
  data: Record<string, unknown>,
  allowedQuestionIds: readonly string[]
):
  | { ok: true; attemptId: string; expectedRevision: number; answers: AttemptAnswer[] }
  | { ok: false; issues: string[] } {
  const envelope = parseAttemptSaveEnvelope(data);
  if (!envelope.ok) return envelope;
  const answers = normalizeAttemptAnswers(envelope.rawAnswers, allowedQuestionIds);
  if (!answers.ok) return { ok: false, issues: answers.issues };
  return {
    ok: true,
    attemptId: envelope.attemptId,
    expectedRevision: envelope.expectedRevision,
    answers: answers.answers
  };
}

export function attemptSubmitHash(answers: AttemptAnswer[]): string {
  return sha256Hex(namedCanonicalJson({ answers }, ["answers"]));
}

export function parseAttemptSubmitEnvelope(
  data: Record<string, unknown>
):
  | { ok: true; attemptId: string; expectedRevision: number; rawAnswers: unknown; confirmUnanswered: boolean }
  | { ok: false; issues: string[] } {
  const issues = rejectUnknownKeys(data, [...ATTEMPT_SUBMIT_FIELDS]);
  if (typeof data.attemptId !== "string" || !data.attemptId.trim()) issues.push("attemptId required");
  if (!Number.isInteger(data.expectedRevision) || Number(data.expectedRevision) < 0) {
    issues.push("expectedRevision must be a non-negative integer");
  }
  if (!Array.isArray(data.answers)) issues.push("answers must be an array");
  if (typeof data.confirmUnanswered !== "boolean") issues.push("confirmUnanswered must be boolean");
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    attemptId: String(data.attemptId).trim(),
    expectedRevision: Number(data.expectedRevision),
    rawAnswers: data.answers,
    confirmUnanswered: data.confirmUnanswered === true
  };
}

export function validateSubmitAnswers(
  input: unknown,
  questions: ReadonlyArray<{ questionId: string; optionIds: readonly string[] }>
): { ok: true; answers: AttemptAnswer[]; unansweredIds: string[] } | { ok: false; issues: string[] } {
  const allowedIds = questions.map((row) => row.questionId);
  const optionMap = new Map(questions.map((row) => [row.questionId, new Set(row.optionIds)]));
  if (!Array.isArray(input)) {
    return { ok: false, issues: ["answers must be an array"] };
  }
  const rawIssues: string[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (!Array.isArray(rec.optionIds)) continue;
    const raw = rec.optionIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim()));
    if (raw.length !== new Set(raw).size) {
      rawIssues.push("optionIds must be unique");
    }
    const questionId = typeof rec.questionId === "string" ? rec.questionId : "";
    const allowed = optionMap.get(questionId);
    if (questionId && allowed) {
      for (const id of raw) {
        if (!allowed.has(id)) rawIssues.push(`option not on paper: ${id}`);
      }
    }
  }
  if (rawIssues.length) return { ok: false, issues: [...new Set(rawIssues)] };
  const normalized = normalizeAttemptAnswers(input, allowedIds);
  if (!normalized.ok) return normalized;
  const answered = new Set(normalized.answers.map((row) => row.questionId));
  const unansweredIds = allowedIds.filter((id) => !answered.has(id));
  return { ok: true, answers: normalized.answers, unansweredIds };
}

export function parseAttemptAnalysisInput(data: Record<string, unknown>):
  | { ok: true; attemptId: string; chunkNo: number; wrongOnly: boolean }
  | { ok: false; issues: string[] } {
  const issues = rejectUnknownKeys(data, [...ATTEMPT_ANALYSIS_FIELDS]);
  if (typeof data.attemptId !== "string" || !data.attemptId.trim()) issues.push("attemptId required");
  if (!Number.isInteger(data.chunkNo) || Number(data.chunkNo) < 1) issues.push("chunkNo must be an integer >= 1");
  if (data.wrongOnly !== undefined && typeof data.wrongOnly !== "boolean") issues.push("wrongOnly must be boolean");
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    attemptId: String(data.attemptId).trim(),
    chunkNo: Number(data.chunkNo),
    wrongOnly: data.wrongOnly === true
  };
}

export function parseAttemptHistoryInput(data: Record<string, unknown>):
  | { ok: true; paperId?: string; cursor?: string; limit: number }
  | { ok: false; issues: string[] } {
  const issues = rejectUnknownKeys(data, [...ATTEMPT_HISTORY_FIELDS]);
  if (data.paperId !== undefined && (typeof data.paperId !== "string" || !data.paperId.trim())) {
    issues.push("paperId must be a non-empty string");
  }
  if (data.cursor !== undefined && (typeof data.cursor !== "string" || !data.cursor.trim())) {
    issues.push("cursor must be a string");
  }
  let limit = DEFAULT_PAGE_LIMIT;
  if (data.limit !== undefined) {
    if (!Number.isInteger(data.limit) || Number(data.limit) < 1 || Number(data.limit) > MAX_PAGE_LIMIT) {
      issues.push(`limit must be 1-${MAX_PAGE_LIMIT}`);
    } else {
      limit = Number(data.limit);
    }
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    ...(typeof data.paperId === "string" && data.paperId.trim() ? { paperId: data.paperId.trim() } : {}),
    ...(typeof data.cursor === "string" && data.cursor.trim() ? { cursor: data.cursor.trim() } : {}),
    limit
  };
}

export function encodeHistoryCursor(submittedAt: string, attemptId: string): string {
  return `${submittedAt}~${attemptId}`;
}

export function parseHistoryCursor(cursor: string): { submittedAt: string; attemptId: string } | undefined {
  const at = cursor.lastIndexOf("~");
  if (at <= 0 || at === cursor.length - 1) return undefined;
  const submittedAt = cursor.slice(0, at);
  const attemptId = cursor.slice(at + 1);
  if (!submittedAt || !attemptId) return undefined;
  return { submittedAt, attemptId };
}

export function parseAttemptAbandonInput(data: Record<string, unknown>):
  | { ok: true; attemptId: string; expectedRevision: number; confirmed: true }
  | { ok: false; issues: string[] } {
  const issues = rejectUnknownKeys(data, [...ATTEMPT_ABANDON_FIELDS]);
  if (typeof data.attemptId !== "string" || !data.attemptId.trim()) issues.push("attemptId required");
  if (!Number.isInteger(data.expectedRevision) || Number(data.expectedRevision) < 0) {
    issues.push("expectedRevision must be a non-negative integer");
  }
  if (data.confirmed !== true) issues.push("confirmed must be true");
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    attemptId: String(data.attemptId).trim(),
    expectedRevision: Number(data.expectedRevision),
    confirmed: true
  };
}

export function toPublicAttemptView(attempt: AttemptRecord): {
  attemptId: string;
  paperId: string;
  paperVersion: string;
  paperTitle: string;
  access: "free" | "vip";
  revision: number;
  state: AttemptState;
  answers: AttemptAnswer[];
  answeredCount: number;
  questionCount: number;
  maxScore: number;
  chunkCount: number;
  updatedAt: string;
} {
  return {
    attemptId: attempt.attemptId,
    paperId: attempt.paperId,
    paperVersion: attempt.paperVersionId,
    paperTitle: attempt.paperTitle,
    access: attempt.access,
    revision: attempt.draftRevision,
    state: attempt.state,
    answers: attempt.answers.map((row) => ({ questionId: row.questionId, optionIds: [...row.optionIds] })),
    answeredCount: attempt.answers.length,
    questionCount: attempt.questionCount,
    maxScore: attempt.maxScore,
    chunkCount: attempt.chunkCount,
    updatedAt: attempt.updatedAt
  };
}
