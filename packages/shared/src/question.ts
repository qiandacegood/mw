import { hashNamedFields } from "./canonical.js";
import type { Difficulty } from "./types.js";
import { rejectUnknownKeys } from "./validate.js";

export const QUESTION_SCHEMA_VERSION = 1;
export const QUESTION_STEM_MAX = 2000;
export const QUESTION_OPTION_MAX = 400;
export const QUESTION_ANALYSIS_MAX = 4000;
export const QUESTION_OPTION_MIN_SINGLE = 2;
export const QUESTION_OPTION_MAX_COUNT = 8;
export const QUESTION_OPTION_MIN_MULTI = 3;
export const DEFAULT_POINTS_MIN = 1;
export const DEFAULT_POINTS_MAX = 100;

export const QUESTION_TYPES = ["single", "multiple", "trueFalse"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_STATUSES = ["active", "disabled"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const TRUE_FALSE_OPTIONS = [
  { optionId: "TRUE", text: "正确" },
  { optionId: "FALSE", text: "错误" }
] as const;

export const QUESTION_SAVE_FIELDS = [
  "questionId",
  "expectedRevision",
  "categoryId",
  "type",
  "stem",
  "options",
  "answer",
  "analysis",
  "defaultPoints",
  "difficulty"
] as const;

export const QUESTION_LIST_FIELDS = ["categoryId", "status", "cursor", "limit"] as const;
export const QUESTION_GET_FIELDS = ["questionId", "versionId"] as const;
export const QUESTION_DISABLE_FIELDS = ["questionId", "expectedRevision", "reason"] as const;

export const STEM_FIELDS = ["text", "assetIds"] as const;
export const OPTION_FIELDS = ["optionId", "text", "assetIds"] as const;
export const ANSWER_FIELDS = ["optionIds"] as const;
export const ANALYSIS_FIELDS = ["text", "assetIds"] as const;

export const QUESTION_SECRET_KEYS = [
  "answer",
  "analysis",
  "correctOptionIds",
  "analysisAssetIds",
  "analysisFileId",
  "question_versions"
] as const;

export const PUBLIC_QUESTION_FORBIDDEN_KEYS = QUESTION_SECRET_KEYS;

export type QuestionOption = {
  optionId: string;
  text: string;
  assetIds: string[];
};

export type QuestionStem = {
  text: string;
  assetIds: string[];
};

export type QuestionAnswer = {
  optionIds: string[];
};

export type QuestionAnalysis = {
  text: string;
  assetIds: string[];
};

export type QuestionRecord = {
  questionId: string;
  categoryId: string;
  currentVersionId: string;
  status: QuestionStatus;
  revision: number;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type QuestionVersionRecord = {
  versionId: string;
  questionId: string;
  type: QuestionType;
  stem: QuestionStem;
  options: QuestionOption[];
  answer: QuestionAnswer;
  analysis: QuestionAnalysis;
  assetIds: string[];
  defaultPoints: number;
  difficulty: Difficulty;
  categoryId: string;
  schemaVersion: number;
  createdAt: string;
  createdBy: string;
};

export type PublicQuestionView = {
  questionId: string;
  categoryId: string;
  type: QuestionType;
  stem: QuestionStem;
  options: Array<{ optionId: string; text: string; assetIds: string[] }>;
  defaultPoints: number;
  difficulty: Difficulty;
  status: QuestionStatus;
  revision: number;
  currentVersionId: string;
};

export type AdminQuestionView = PublicQuestionView & {
  answer: QuestionAnswer;
  analysis: QuestionAnalysis;
  versionId: string;
  missingAssets: Array<{ assetId: string; kind: "prompt" | "analysis" }>;
};

export function isQuestionType(value: unknown): value is QuestionType {
  return value === "single" || value === "multiple" || value === "trueFalse";
}

export function questionIdFor(actorId: string, requestId: string): string {
  return hashNamedFields({ kind: "question", actorId, requestId }, ["kind", "actorId", "requestId"]);
}

export function questionVersionId(questionId: string, revision: number): string {
  return hashNamedFields(
    { kind: "question_version", questionId, revision },
    ["kind", "questionId", "revision"]
  );
}

export function collectAssetIds(version: Pick<QuestionVersionRecord, "stem" | "options" | "analysis">): string[] {
  const ids = [...version.stem.assetIds];
  for (const option of version.options) ids.push(...option.assetIds);
  ids.push(...version.analysis.assetIds);
  return [...new Set(ids)];
}

export function analysisAssetIdsOf(version: Pick<QuestionVersionRecord, "analysis">): string[] {
  return [...version.analysis.assetIds];
}

export function promptAssetIdsOf(version: Pick<QuestionVersionRecord, "stem" | "options">): string[] {
  const ids = [...version.stem.assetIds];
  for (const option of version.options) ids.push(...option.assetIds);
  return [...new Set(ids)];
}

export function toPublicQuestionView(
  question: QuestionRecord,
  version: QuestionVersionRecord
): PublicQuestionView {
  return {
    questionId: question.questionId,
    categoryId: question.categoryId,
    type: version.type,
    stem: { text: version.stem.text, assetIds: [...version.stem.assetIds] },
    options: version.options.map((item) => ({
      optionId: item.optionId,
      text: item.text,
      assetIds: [...item.assetIds]
    })),
    defaultPoints: version.defaultPoints,
    difficulty: version.difficulty,
    status: question.status,
    revision: question.revision,
    currentVersionId: question.currentVersionId
  };
}

export function toAdminQuestionView(
  question: QuestionRecord,
  version: QuestionVersionRecord,
  missingAssets: Array<{ assetId: string; kind: "prompt" | "analysis" }> = []
): AdminQuestionView {
  return {
    ...toPublicQuestionView(question, version),
    answer: { optionIds: [...version.answer.optionIds] },
    analysis: { text: version.analysis.text, assetIds: [...version.analysis.assetIds] },
    versionId: version.versionId,
    missingAssets
  };
}

export function hasQuestionSecrets(value: unknown): string[] {
  const found = new Set<string>();
  walkKeys(value, (key) => {
    if ((QUESTION_SECRET_KEYS as readonly string[]).includes(key)) found.add(key);
  });
  return [...found];
}

export function stripQuestionSecrets<T>(value: T): T {
  return stripDeep(value) as T;
}

function stripDeep(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripDeep);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((QUESTION_SECRET_KEYS as readonly string[]).includes(key)) continue;
    out[key] = stripDeep(child);
  }
  return out;
}

function walkKeys(value: unknown, onKey: (key: string) => void, depth = 0): void {
  if (!value || typeof value !== "object" || depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, onKey, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    onKey(key);
    walkKeys(child, onKey, depth + 1);
  }
}

export function scoreObjectiveQuestion(
  selectedIds: string[],
  correctIds: string[],
  points: number
): number {
  if (!Number.isInteger(points) || points <= 0) return 0;
  const left = [...selectedIds].map((id) => id.trim()).filter(Boolean).sort();
  const right = [...correctIds].map((id) => id.trim()).filter(Boolean).sort();
  if (left.length !== right.length) return 0;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return 0;
  }
  return points;
}

function parseAssetIds(value: unknown, label: string, issues: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(`${label} assetIds must be an array`);
    return [];
  }
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      issues.push(`${label} assetIds must be non-empty strings`);
      continue;
    }
    if (/https?:\/\//i.test(item) || item.includes("://")) {
      issues.push(`${label} must not use remote urls`);
      continue;
    }
    ids.push(item.trim());
  }
  return [...new Set(ids)];
}

function rejectRemote(text: string, label: string, issues: string[]): void {
  if (/https?:\/\//i.test(text)) {
    issues.push(`${label} must not contain remote urls`);
  }
}

function parseStem(value: unknown, issues: string[]): QuestionStem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push("stem must be an object");
    return { text: "", assetIds: [] };
  }
  const rec = value as Record<string, unknown>;
  const extra = rejectUnknownKeys(rec, [...STEM_FIELDS]);
  if (extra.length) issues.push(`unknown stem fields: ${extra.join(",")}`);
  if (typeof rec.text !== "string" || rec.text.trim().length === 0) {
    issues.push("stem.text required");
  } else if (rec.text.trim().length > QUESTION_STEM_MAX) {
    issues.push("stem.text too long");
  } else {
    rejectRemote(rec.text, "stem.text", issues);
  }
  return {
    text: typeof rec.text === "string" ? rec.text.trim() : "",
    assetIds: parseAssetIds(rec.assetIds, "stem", issues)
  };
}

function parseOptions(value: unknown, type: QuestionType, issues: string[]): QuestionOption[] {
  if (type === "trueFalse") {
    if (value !== undefined) {
      if (!Array.isArray(value)) {
        issues.push("trueFalse options are fixed");
      } else if (value.length !== 2) {
        issues.push("trueFalse must use 正确 and 错误");
      } else {
        const texts = value.map((item) =>
          item && typeof item === "object" ? String((item as { text?: unknown }).text || "") : ""
        );
        if (texts[0] !== "正确" || texts[1] !== "错误") {
          issues.push("trueFalse options must be 正确 and 错误");
        }
      }
    }
    const extraAssets: string[][] = [];
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        if (item && typeof item === "object") {
          extraAssets[index] = parseAssetIds((item as { assetIds?: unknown }).assetIds, `options[${index}]`, issues);
        }
      }
    }
    return TRUE_FALSE_OPTIONS.map((item, index) => ({
      optionId: item.optionId,
      text: item.text,
      assetIds: extraAssets[index] || []
    }));
  }
  if (!Array.isArray(value)) {
    issues.push("options must be an array");
    return [];
  }
  const min = type === "single" ? QUESTION_OPTION_MIN_SINGLE : QUESTION_OPTION_MIN_MULTI;
  if (value.length < min || value.length > QUESTION_OPTION_MAX_COUNT) {
    issues.push(type === "single" ? "single choice needs 2-8 unique options" : "multiple choice needs 3-8 unique options");
  }
  const options: QuestionOption[] = [];
  const seenIds = new Set<string>();
  const seenTexts = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      issues.push(`options[${index}] must be an object`);
      continue;
    }
    const rec = item as Record<string, unknown>;
    const extra = rejectUnknownKeys(rec, [...OPTION_FIELDS]);
    if (extra.length) issues.push(`unknown option fields: ${extra.join(",")}`);
    const optionId = typeof rec.optionId === "string" ? rec.optionId.trim() : "";
    const text = typeof rec.text === "string" ? rec.text.trim() : "";
    if (!optionId) issues.push(`options[${index}].optionId required`);
    if (!text) issues.push(`options[${index}].text required`);
    if (text.length > QUESTION_OPTION_MAX) issues.push(`options[${index}].text too long`);
    rejectRemote(text, `options[${index}].text`, issues);
    if (optionId && seenIds.has(optionId)) issues.push("optionId must be unique");
    if (text && seenTexts.has(text)) issues.push("option text must be unique");
    if (optionId) seenIds.add(optionId);
    if (text) seenTexts.add(text);
    options.push({
      optionId,
      text,
      assetIds: parseAssetIds(rec.assetIds, `options[${index}]`, issues)
    });
  }
  return options;
}

function parseAnswer(value: unknown, options: QuestionOption[], type: QuestionType, issues: string[]): QuestionAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push("answer must be an object");
    return { optionIds: [] };
  }
  const rec = value as Record<string, unknown>;
  const extra = rejectUnknownKeys(rec, [...ANSWER_FIELDS]);
  if (extra.length) issues.push(`unknown answer fields: ${extra.join(",")}`);
  if (!Array.isArray(rec.optionIds)) {
    issues.push("answer.optionIds must be an array");
    return { optionIds: [] };
  }
  const ids = rec.optionIds.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  const unique = [...new Set(ids)].sort();
  if (unique.length !== ids.length) issues.push("answer optionIds must be unique");
  const allowed = new Set(options.map((item) => item.optionId));
  for (const id of unique) {
    if (!allowed.has(id)) issues.push(`answer references unknown option ${id}`);
  }
  if (type === "single" || type === "trueFalse") {
    if (unique.length !== 1) issues.push("exactly one correct option required");
  } else if (type === "multiple") {
    if (unique.length < 2) issues.push("multiple choice needs at least 2 correct options");
    if (options.length > 0 && unique.length >= options.length) {
      issues.push("multiple choice correct set must be smaller than option count");
    }
  }
  return { optionIds: unique };
}

function parseAnalysis(value: unknown, type: QuestionType, issues: string[]): QuestionAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push("analysis must be an object");
    return { text: "", assetIds: [] };
  }
  const rec = value as Record<string, unknown>;
  const extra = rejectUnknownKeys(rec, [...ANALYSIS_FIELDS]);
  if (extra.length) issues.push(`unknown analysis fields: ${extra.join(",")}`);
  if (typeof rec.text !== "string" || rec.text.trim().length === 0) {
    issues.push("analysis.text required");
  } else if (rec.text.trim().length > QUESTION_ANALYSIS_MAX) {
    issues.push("analysis.text too long");
  } else {
    rejectRemote(rec.text, "analysis.text", issues);
  }
  if (type === "multiple" && typeof rec.text === "string" && rec.text.trim().length > 0) {
    /* 字段存在即可写漏选/误选说明，本轮不审内容对错 */
  }
  return {
    text: typeof rec.text === "string" ? rec.text.trim() : "",
    assetIds: parseAssetIds(rec.assetIds, "analysis", issues)
  };
}

export function parseQuestionSaveInput(data: Record<string, unknown>):
  | {
      ok: true;
      questionId?: string;
      expectedRevision: number;
      categoryId: string;
      type: QuestionType;
      stem: QuestionStem;
      options: QuestionOption[];
      answer: QuestionAnswer;
      analysis: QuestionAnalysis;
      defaultPoints: number;
      difficulty: Difficulty;
    }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...QUESTION_SAVE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (data.questionId !== undefined && (typeof data.questionId !== "string" || !data.questionId.trim())) {
    issues.push("questionId must be a non-empty string");
  }
  if (typeof data.expectedRevision !== "number" || !Number.isInteger(data.expectedRevision) || data.expectedRevision < 0) {
    issues.push("expectedRevision required");
  }
  if (typeof data.categoryId !== "string" || !data.categoryId.trim()) {
    issues.push("categoryId required");
  }
  if (!isQuestionType(data.type)) {
    issues.push("type must be single, multiple or trueFalse");
  }
  if (data.difficulty !== "beginner" && data.difficulty !== "intermediate" && data.difficulty !== "challenge") {
    issues.push("difficulty must be beginner, intermediate or challenge");
  }
  if (typeof data.defaultPoints !== "number" || !Number.isInteger(data.defaultPoints) || data.defaultPoints < DEFAULT_POINTS_MIN) {
    issues.push("defaultPoints must be a positive integer");
  } else if (data.defaultPoints > DEFAULT_POINTS_MAX) {
    issues.push("defaultPoints too large");
  }
  const type = isQuestionType(data.type) ? data.type : "single";
  const stem = parseStem(data.stem, issues);
  const options = parseOptions(data.options, type, issues);
  const answer = parseAnswer(data.answer, options, type, issues);
  const analysis = parseAnalysis(data.analysis, type, issues);
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    questionId: typeof data.questionId === "string" ? data.questionId.trim() : undefined,
    expectedRevision: data.expectedRevision as number,
    categoryId: String(data.categoryId).trim(),
    type,
    stem,
    options,
    answer,
    analysis,
    defaultPoints: data.defaultPoints as number,
    difficulty: data.difficulty as Difficulty
  };
}

export function parseQuestionListInput(data: Record<string, unknown>):
  | { ok: true; categoryId?: string; status?: QuestionStatus; cursor?: string; limit: number }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...QUESTION_LIST_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (data.categoryId !== undefined && typeof data.categoryId !== "string") issues.push("categoryId must be string");
  if (data.status !== undefined && data.status !== "active" && data.status !== "disabled") {
    issues.push("status must be active or disabled");
  }
  if (data.cursor !== undefined && typeof data.cursor !== "string") issues.push("cursor must be string");
  let limit = 20;
  if (data.limit !== undefined) {
    if (typeof data.limit !== "number" || !Number.isInteger(data.limit) || data.limit < 1 || data.limit > 100) {
      issues.push("limit must be 1-100");
    } else {
      limit = data.limit;
    }
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    categoryId: typeof data.categoryId === "string" && data.categoryId ? data.categoryId : undefined,
    status: data.status === "active" || data.status === "disabled" ? data.status : undefined,
    cursor: typeof data.cursor === "string" && data.cursor ? data.cursor : undefined,
    limit
  };
}

export function parseQuestionGetInput(data: Record<string, unknown>):
  | { ok: true; questionId: string; versionId?: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...QUESTION_GET_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (typeof data.questionId !== "string" || !data.questionId.trim()) issues.push("questionId required");
  if (data.versionId !== undefined && typeof data.versionId !== "string") issues.push("versionId must be string");
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    questionId: String(data.questionId).trim(),
    versionId: typeof data.versionId === "string" && data.versionId ? data.versionId : undefined
  };
}

export function parseQuestionDisableInput(data: Record<string, unknown>):
  | { ok: true; questionId: string; expectedRevision: number; reason: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...QUESTION_DISABLE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (typeof data.questionId !== "string" || !data.questionId.trim()) issues.push("questionId required");
  if (typeof data.expectedRevision !== "number" || !Number.isInteger(data.expectedRevision) || data.expectedRevision < 1) {
    issues.push("expectedRevision required");
  }
  if (typeof data.reason !== "string" || !data.reason.trim()) issues.push("reason required");
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    questionId: String(data.questionId).trim(),
    expectedRevision: data.expectedRevision as number,
    reason: String(data.reason).trim()
  };
}

export function categoryUsableForQuestion(
  category:
    | {
        deletedAt?: string | null;
        enabled?: boolean;
        categoryId?: string;
      }
    | undefined
): { ok: true } | { ok: false; code: "CATEGORY_UNAVAILABLE" | "NOT_FOUND"; reason: string } {
  if (!category) return { ok: false, code: "NOT_FOUND", reason: "CATEGORY_NOT_FOUND" };
  if (category.deletedAt) return { ok: false, code: "CATEGORY_UNAVAILABLE", reason: "CATEGORY_DELETED" };
  if (category.enabled === false) return { ok: false, code: "CATEGORY_UNAVAILABLE", reason: "CATEGORY_DISABLED" };
  return { ok: true };
}
