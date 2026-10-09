import { hashNamedFields, namedCanonicalJson, sha256Hex, utf8Bytes } from "./canonical.js";
import { hasQuestionSecrets, type QuestionType, type QuestionVersionRecord } from "./question.js";
import type { Difficulty, PaperAccess } from "./types.js";
import { rejectUnknownKeys } from "./validate.js";

export const PAPER_SCHEMA_VERSION = 1;
export const PAPER_TITLE_MAX = 80;
export const PAPER_SUMMARY_MAX = 400;
export const PAPER_GOAL_MAX = 400;
export const PAPER_QUESTION_MIN = 1;
export const PAPER_QUESTION_MAX = 100;
export const PAPER_POINTS_MIN = 1;
export const PAPER_POINTS_MAX = 100;
export const PAPER_CHUNK_QUESTION_MAX = 20;
export const PAPER_CHUNK_BYTES_MAX = 256 * 1024;
export const PAPER_OVERLAP_RATIO = 0.7;
export const PAPER_SORT_MIN = 0;
export const PAPER_SORT_MAX = 100000;
export const PAPER_MINUTES_MIN = 1;
export const PAPER_MINUTES_MAX = 300;

export const PAPER_STATUSES = ["draft", "published", "unpublished", "withdrawn"] as const;
export type PaperStatus = (typeof PAPER_STATUSES)[number];

export const PAPER_ACCESSES = ["free", "vip"] as const;
export const PAPER_DIFFICULTIES = ["beginner", "intermediate", "challenge"] as const;

export const PAPER_SAVE_FIELDS = [
  "paperId",
  "expectedRevision",
  "title",
  "summary",
  "goal",
  "categoryId",
  "access",
  "difficulty",
  "sort",
  "suggestedMinutes",
  "items"
] as const;

export const PAPER_ITEM_FIELDS = ["questionId", "versionId", "points", "ord"] as const;
export const PAPER_LIST_FIELDS = ["categoryId", "status", "difficulty", "access", "sort", "cursor", "limit"] as const;
export const PAPER_GET_FIELDS = ["paperId", "versionId"] as const;
export const PAPER_PREVIEW_FIELDS = ["paperId"] as const;
export const PAPER_PUBLISH_FIELDS = ["paperId", "expectedRevision", "confirmOverlap", "injectPublishFault"] as const;
export const PAPER_UNPUBLISH_FIELDS = ["paperId", "expectedRevision"] as const;
export const PAPER_WITHDRAW_FIELDS = ["paperId", "expectedRevision", "reason"] as const;
export const PAPER_PUBLIC_LIST_FIELDS = [
  "categoryId",
  "includeDescendants",
  "difficulty",
  "access",
  "progress",
  "sort",
  "cursor",
  "limit"
] as const;
export const PAPER_PUBLIC_DETAIL_FIELDS = ["paperId"] as const;
export const HOME_GET_FIELDS = [] as const;
export const PAPER_PROGRESS_VALUES = ["done", "undone"] as const;
export type PaperProgressFilter = (typeof PAPER_PROGRESS_VALUES)[number];
export const PAPER_LIST_CURSOR_KEYS = [
  "sort",
  "categoryId",
  "includeDescendants",
  "difficulty",
  "access",
  "progress",
  "afterKey",
  "afterId",
  "gen"
] as const;
export type PaperListCursorPayload = {
  sort: "latest" | "recommended";
  categoryId: string;
  includeDescendants: boolean;
  difficulty: string;
  access: string;
  progress: string;
  afterKey: string;
  afterId: string;
  gen: number;
};
export const HOME_SHELF_LIMIT = 8;
export const PUBLIC_PAPER_SCAN_LIMIT = 200;
export const PAPER_FAULTS = ["missingChunk", "badManifest"] as const;
export type PaperPublishFault = (typeof PAPER_FAULTS)[number];

export type PaperDraftItem = {
  questionId: string;
  versionId: string;
  points: number;
  ord: number;
};

export type PaperRecord = {
  paperId: string;
  title: string;
  summary: string;
  goal: string;
  categoryId: string;
  access: PaperAccess;
  difficulty: Difficulty;
  sort: number;
  suggestedMinutes: number;
  publishedAt: string | null;
  status: PaperStatus;
  activeVersionId: string | null;
  revision: number;
  draftItems: PaperDraftItem[];
  draftQuestionCount: number;
  draftMaxScore: number;
  accessLocked: boolean;
  withdrawReason: string | null;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  importBatchId?: string;
  sourceKey?: string;
};

export type PaperChunkItem = {
  ord: number;
  questionId: string;
  questionVersionId: string;
  type: QuestionType;
  stem: { text: string; assetIds: string[] };
  options: Array<{ optionId: string; text: string; assetIds: string[] }>;
  points: number;
};

export type PaperAnswerItem = {
  ord: number;
  questionId: string;
  questionVersionId: string;
  answer: { optionIds: string[] };
  analysis: { text: string; assetIds: string[] };
};

export type PaperChunkRecord = {
  chunkId: string;
  versionId: string;
  chunkNo: number;
  items: PaperChunkItem[];
  digest: string;
  schemaVersion: number;
};

export type PaperAnswerRecord = {
  chunkId: string;
  versionId: string;
  chunkNo: number;
  items: PaperAnswerItem[];
  digest: string;
  schemaVersion: number;
};

export type PaperVersionRecord = {
  versionId: string;
  paperId: string;
  questionCount: number;
  maxScore: number;
  chunkIds: string[];
  answerChunkIds: string[];
  chunkDigests: string[];
  answerDigests: string[];
  categoryPathSnapshot: string[];
  manifestHash: string;
  questionIds: string[];
  questionVersionIds: string[];
  schemaVersion: number;
  createdAt: string;
  createdBy: string;
};

export type PublicPaperSummary = {
  paperId: string;
  title: string;
  summary: string;
  access: PaperAccess;
  difficulty: Difficulty;
  sort: number;
  publishedAt: string | null;
  questionCount: number;
  maxScore: number;
  categoryId: string;
  categoryPath: string[];
};

export type PublicPaperDetail = PublicPaperSummary & {
  goal: string;
  suggestedMinutes: number;
  status: "published";
};

export type AdminPaperView = PublicPaperSummary & {
  goal: string;
  suggestedMinutes: number;
  status: PaperStatus;
  revision: number;
  activeVersionId: string | null;
  accessLocked: boolean;
  withdrawReason: string | null;
  draftItems: PaperDraftItem[];
  draftQuestionCount: number;
  draftMaxScore: number;
};

export function isPaperStatus(value: unknown): value is PaperStatus {
  return (PAPER_STATUSES as readonly string[]).includes(String(value));
}

export function isPaperAccess(value: unknown): value is PaperAccess {
  return value === "free" || value === "vip";
}

export function paperIdFor(actorId: string, requestId: string): string {
  return hashNamedFields({ kind: "paper", actorId, requestId }, ["kind", "actorId", "requestId"]);
}

export function paperVersionId(paperId: string, revision: number): string {
  return hashNamedFields({ kind: "paper_version", paperId, revision }, ["kind", "paperId", "revision"]);
}

export function paperChunkId(versionId: string, chunkNo: number): string {
  return hashNamedFields({ kind: "paper_chunk", versionId, chunkNo }, ["kind", "versionId", "chunkNo"]);
}

export function paperAnswerId(versionId: string, chunkNo: number): string {
  return hashNamedFields({ kind: "paper_answer", versionId, chunkNo }, ["kind", "versionId", "chunkNo"]);
}

export function chunkDigestOf(versionId: string, chunkNo: number, items: PaperChunkItem[]): string {
  return sha256Hex(namedCanonicalJson({ versionId, chunkNo, items }, ["versionId", "chunkNo", "items"]));
}

export function answerDigestOf(versionId: string, chunkNo: number, items: PaperAnswerItem[]): string {
  return sha256Hex(namedCanonicalJson({ versionId, chunkNo, items }, ["versionId", "chunkNo", "items"]));
}

export function paperManifestHash(input: {
  versionId: string;
  questionCount: number;
  maxScore: number;
  chunkIds: string[];
  answerChunkIds: string[];
  chunkDigests: string[];
  answerDigests: string[];
  categoryPathSnapshot: string[];
}): string {
  return hashNamedFields(input, [
    "versionId",
    "questionCount",
    "maxScore",
    "chunkIds",
    "answerChunkIds",
    "chunkDigests",
    "answerDigests",
    "categoryPathSnapshot"
  ]);
}

export function draftMaxScoreOf(items: PaperDraftItem[]): number {
  return items.reduce((sum, item) => sum + item.points, 0);
}

export function overlapRatio(left: string[], right: string[]): number {
  if (!left.length) return 0;
  const rightSet = new Set(right);
  const hit = left.filter((id) => rightSet.has(id)).length;
  return hit / left.length;
}

export function overlappingPaperIds(thisQuestionIds: string[], others: Array<{ paperId: string; questionIds: string[] }>): string[] {
  return others
    .filter((row) => overlapRatio(thisQuestionIds, row.questionIds) >= PAPER_OVERLAP_RATIO)
    .map((row) => row.paperId);
}

export function paperNewStartGate(
  status: PaperStatus
): { blocked: false } | { blocked: true; code: "NOT_FOUND" | "PAPER_WITHDRAWN"; reason: string } {
  if (status === "published") return { blocked: false };
  if (status === "withdrawn") return { blocked: true, code: "PAPER_WITHDRAWN", reason: "PAPER_WITHDRAWN" };
  if (status === "unpublished") return { blocked: true, code: "NOT_FOUND", reason: "PAPER_UNPUBLISHED" };
  return { blocked: true, code: "NOT_FOUND", reason: "PAPER_NOT_PUBLISHED" };
}

export function hasPaperSecrets(value: unknown): string[] {
  return hasQuestionSecrets(value);
}

export function toPublicPaperSummary(paper: PaperRecord, version?: PaperVersionRecord | null): PublicPaperSummary {
  return {
    paperId: paper.paperId,
    title: paper.title,
    summary: paper.summary,
    access: paper.access,
    difficulty: paper.difficulty,
    sort: paper.sort,
    publishedAt: paper.publishedAt,
    questionCount: version?.questionCount ?? paper.draftQuestionCount,
    maxScore: version?.maxScore ?? paper.draftMaxScore,
    categoryId: paper.categoryId,
    categoryPath: version?.categoryPathSnapshot ?? []
  };
}

export function toPublicPaperDetail(paper: PaperRecord, version: PaperVersionRecord): PublicPaperDetail {
  return {
    ...toPublicPaperSummary(paper, version),
    goal: paper.goal,
    suggestedMinutes: paper.suggestedMinutes,
    status: "published"
  };
}

export function toAdminPaperView(paper: PaperRecord, version?: PaperVersionRecord | null): AdminPaperView {
  return {
    ...toPublicPaperSummary(paper, version),
    goal: paper.goal,
    suggestedMinutes: paper.suggestedMinutes,
    status: paper.status,
    revision: paper.revision,
    activeVersionId: paper.activeVersionId,
    accessLocked: paper.accessLocked,
    withdrawReason: paper.withdrawReason,
    draftItems: paper.draftItems.map((item) => ({ ...item })),
    draftQuestionCount: paper.draftQuestionCount,
    draftMaxScore: paper.draftMaxScore
  };
}

export function assemblePaperSnapshot(input: {
  paperId: string;
  revision: number;
  items: PaperDraftItem[];
  versions: QuestionVersionRecord[];
  categoryPathSnapshot: string[];
  createdAt: string;
  createdBy: string;
}):
  | {
      ok: true;
      version: PaperVersionRecord;
      chunks: PaperChunkRecord[];
      answers: PaperAnswerRecord[];
    }
  | { ok: false; issues: string[] } {
  const issues: string[] = [];
  if (input.items.length < PAPER_QUESTION_MIN || input.items.length > PAPER_QUESTION_MAX) {
    issues.push("question count must be 1-100");
  }
  const byVersion = new Map(input.versions.map((row) => [row.versionId, row]));
  const seenQuestions = new Set<string>();
  const ordered = [...input.items].sort((left, right) => left.ord - right.ord);
  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index];
    if (!item) continue;
    if (item.ord !== index + 1) issues.push(`item ord must be sequential, expected ${index + 1}`);
    if (seenQuestions.has(item.questionId)) issues.push("questionId must be unique in a paper");
    seenQuestions.add(item.questionId);
    if (!Number.isInteger(item.points) || item.points < PAPER_POINTS_MIN || item.points > PAPER_POINTS_MAX) {
      issues.push("each item points must be an integer 1-100");
    }
    if (!byVersion.has(item.versionId)) issues.push(`question version missing: ${item.versionId}`);
  }
  if (issues.length) return { ok: false, issues };

  const versionId = paperVersionId(input.paperId, input.revision);
  const chunks: PaperChunkRecord[] = [];
  const answers: PaperAnswerRecord[] = [];
  for (let start = 0; start < ordered.length; start += PAPER_CHUNK_QUESTION_MAX) {
    const slice = ordered.slice(start, start + PAPER_CHUNK_QUESTION_MAX);
    const chunkNo = chunks.length + 1;
    const chunkItems: PaperChunkItem[] = [];
    const answerItems: PaperAnswerItem[] = [];
    for (const item of slice) {
      const version = byVersion.get(item.versionId);
      if (!version) continue;
      chunkItems.push({
        ord: item.ord,
        questionId: item.questionId,
        questionVersionId: version.versionId,
        type: version.type,
        stem: { text: version.stem.text, assetIds: [...version.stem.assetIds] },
        options: version.options.map((option) => ({
          optionId: option.optionId,
          text: option.text,
          assetIds: [...option.assetIds]
        })),
        points: item.points
      });
      answerItems.push({
        ord: item.ord,
        questionId: item.questionId,
        questionVersionId: version.versionId,
        answer: { optionIds: [...version.answer.optionIds] },
        analysis: { text: version.analysis.text, assetIds: [...version.analysis.assetIds] }
      });
    }
    const chunkId = paperChunkId(versionId, chunkNo);
    const answerId = paperAnswerId(versionId, chunkNo);
    chunks.push({
      chunkId,
      versionId,
      chunkNo,
      items: chunkItems,
      digest: chunkDigestOf(versionId, chunkNo, chunkItems),
      schemaVersion: PAPER_SCHEMA_VERSION
    });
    answers.push({
      chunkId: answerId,
      versionId,
      chunkNo,
      items: answerItems,
      digest: answerDigestOf(versionId, chunkNo, answerItems),
      schemaVersion: PAPER_SCHEMA_VERSION
    });
  }
  const maxScore = draftMaxScoreOf(ordered);
  const version: PaperVersionRecord = {
    versionId,
    paperId: input.paperId,
    questionCount: ordered.length,
    maxScore,
    chunkIds: chunks.map((row) => row.chunkId),
    answerChunkIds: answers.map((row) => row.chunkId),
    chunkDigests: chunks.map((row) => row.digest),
    answerDigests: answers.map((row) => row.digest),
    categoryPathSnapshot: [...input.categoryPathSnapshot],
    manifestHash: "",
    questionIds: ordered.map((item) => item.questionId),
    questionVersionIds: ordered.map((item) => item.versionId),
    schemaVersion: PAPER_SCHEMA_VERSION,
    createdAt: input.createdAt,
    createdBy: input.createdBy
  };
  version.manifestHash = paperManifestHash(version);
  const closed = assertSnapshotClosed(version, chunks, answers);
  if (!closed.ok) return closed;
  return { ok: true, version, chunks, answers };
}

export function applyPublishFault(
  snapshot: { version: PaperVersionRecord; chunks: PaperChunkRecord[]; answers: PaperAnswerRecord[] },
  fault?: PaperPublishFault
): { version: PaperVersionRecord; chunks: PaperChunkRecord[]; answers: PaperAnswerRecord[] } {
  if (fault === "missingChunk") {
    return {
      version: snapshot.version,
      chunks: snapshot.chunks.slice(0, Math.max(0, snapshot.chunks.length - 1)),
      answers: snapshot.answers
    };
  }
  if (fault === "badManifest") {
    return {
      version: { ...snapshot.version, manifestHash: "0".repeat(64) },
      chunks: snapshot.chunks,
      answers: snapshot.answers
    };
  }
  return snapshot;
}

export function assertSnapshotClosed(
  version: PaperVersionRecord,
  chunks: PaperChunkRecord[],
  answers: PaperAnswerRecord[]
): { ok: true } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  if (version.questionCount < PAPER_QUESTION_MIN || version.questionCount > PAPER_QUESTION_MAX) {
    issues.push("question count must be 1-100");
  }
  if (chunks.length !== version.chunkIds.length || answers.length !== version.answerChunkIds.length) {
    issues.push("CHUNK_MISSING");
  }
  const chunkById = new Map(chunks.map((row) => [row.chunkId, row]));
  const answerById = new Map(answers.map((row) => [row.chunkId, row]));
  let seenOrds = 0;
  let score = 0;
  for (let index = 0; index < version.chunkIds.length; index += 1) {
    const chunkId = version.chunkIds[index];
    const answerId = version.answerChunkIds[index];
    const expectedChunkId = paperChunkId(version.versionId, index + 1);
    const expectedAnswerId = paperAnswerId(version.versionId, index + 1);
    if (chunkId !== expectedChunkId) issues.push("CHUNK_ID_MISMATCH");
    if (answerId !== expectedAnswerId) issues.push("ANSWER_ID_MISMATCH");
    const chunk = chunkId ? chunkById.get(chunkId) : undefined;
    const answer = answerId ? answerById.get(answerId) : undefined;
    if (!chunk) {
      issues.push("CHUNK_MISSING");
      continue;
    }
    if (!answer) issues.push("ANSWER_CHUNK_MISSING");
    if (chunk.items.length === 0 || chunk.items.length > PAPER_CHUNK_QUESTION_MAX) {
      issues.push("CHUNK_QUESTION_LIMIT");
    }
    const serialized = utf8Bytes(namedCanonicalJson({ items: chunk.items }, ["items"]));
    if (serialized.length > PAPER_CHUNK_BYTES_MAX) issues.push("CHUNK_TOO_LARGE");
    if (chunk.digest !== chunkDigestOf(chunk.versionId, chunk.chunkNo, chunk.items)) {
      issues.push("CHUNK_DIGEST_MISMATCH");
    }
    if (answer && answer.digest !== answerDigestOf(answer.versionId, answer.chunkNo, answer.items)) {
      issues.push("ANSWER_DIGEST_MISMATCH");
    }
    if (version.chunkDigests[index] !== chunk.digest) issues.push("MANIFEST_CHUNK_DIGEST_MISMATCH");
    if (answer && version.answerDigests[index] !== answer.digest) issues.push("MANIFEST_ANSWER_DIGEST_MISMATCH");
    for (const item of chunk.items) {
      seenOrds += 1;
      if (item.ord !== seenOrds) issues.push("QUESTION_ORDER_GAP");
      if (!Number.isInteger(item.points) || item.points < PAPER_POINTS_MIN || item.points > PAPER_POINTS_MAX) {
        issues.push("INVALID_POINTS");
      }
      score += item.points;
      if ("answer" in item || "analysis" in item) issues.push("SECRET_IN_PUBLIC_CHUNK");
    }
  }
  if (seenOrds !== version.questionCount) issues.push("QUESTION_COUNT_MISMATCH");
  if (score !== version.maxScore) issues.push("MAX_SCORE_MISMATCH");
  const expectedManifest = paperManifestHash(version);
  if (version.manifestHash !== expectedManifest) issues.push("MANIFEST_HASH_MISMATCH");
  return issues.length ? { ok: false, issues: [...new Set(issues)] } : { ok: true };
}

function parseText(value: unknown, label: string, max: number, issues: string[]): string {
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${label} required`);
    return "";
  }
  const text = value.trim();
  if (text.length > max) issues.push(`${label} too long`);
  return text;
}

function parseItems(value: unknown, issues: string[]): PaperDraftItem[] {
  if (!Array.isArray(value)) {
    issues.push("items must be an array");
    return [];
  }
  if (value.length < PAPER_QUESTION_MIN || value.length > PAPER_QUESTION_MAX) {
    issues.push("question count must be 1-100");
  }
  const items: PaperDraftItem[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push(`items[${index}] must be an object`);
      continue;
    }
    const rec = raw as Record<string, unknown>;
    const extra = rejectUnknownKeys(rec, [...PAPER_ITEM_FIELDS]);
    if (extra.length) issues.push(`unknown item fields: ${extra.join(",")}`);
    const questionId = typeof rec.questionId === "string" ? rec.questionId.trim() : "";
    const versionId = typeof rec.versionId === "string" ? rec.versionId.trim() : "";
    const points = rec.points;
    const ord = rec.ord === undefined ? index + 1 : rec.ord;
    if (!questionId) issues.push(`items[${index}].questionId required`);
    if (questionId && seen.has(questionId)) issues.push("questionId must be unique in a paper");
    if (questionId) seen.add(questionId);
    if (typeof points !== "number" || !Number.isInteger(points) || points < PAPER_POINTS_MIN || points > PAPER_POINTS_MAX) {
      issues.push(`items[${index}].points must be an integer 1-100`);
    }
    if (typeof ord !== "number" || !Number.isInteger(ord) || ord !== index + 1) {
      issues.push(`items[${index}].ord must be ${index + 1}`);
    }
    items.push({
      questionId,
      versionId,
      points: typeof points === "number" ? points : 0,
      ord: typeof ord === "number" ? ord : index + 1
    });
  }
  return items;
}

export function parsePaperSaveInput(
  data: Record<string, unknown>
):
  | {
      ok: true;
      paperId?: string;
      expectedRevision: number;
      title: string;
      summary: string;
      goal: string;
      categoryId: string;
      access: PaperAccess;
      difficulty: Difficulty;
      sort: number;
      suggestedMinutes: number;
      items?: PaperDraftItem[];
    }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...PAPER_SAVE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const paperId = typeof data.paperId === "string" && data.paperId.trim() ? data.paperId.trim() : undefined;
  if (typeof data.expectedRevision !== "number" || !Number.isInteger(data.expectedRevision) || data.expectedRevision < 0) {
    issues.push("expectedRevision required");
  }
  const title = parseText(data.title, "title", PAPER_TITLE_MAX, issues);
  const summary = parseText(data.summary, "summary", PAPER_SUMMARY_MAX, issues);
  const goal = parseText(data.goal, "goal", PAPER_GOAL_MAX, issues);
  const categoryId = typeof data.categoryId === "string" ? data.categoryId.trim() : "";
  if (!categoryId) issues.push("categoryId required");
  if (!isPaperAccess(data.access)) issues.push("access must be free or vip");
  if (data.difficulty !== "beginner" && data.difficulty !== "intermediate" && data.difficulty !== "challenge") {
    issues.push("difficulty must be beginner, intermediate or challenge");
  }
  if (typeof data.sort !== "number" || !Number.isInteger(data.sort) || data.sort < PAPER_SORT_MIN || data.sort > PAPER_SORT_MAX) {
    issues.push("sort must be an integer 0-100000");
  }
  const suggestedMinutes = data.suggestedMinutes === undefined ? 20 : data.suggestedMinutes;
  if (
    typeof suggestedMinutes !== "number" ||
    !Number.isInteger(suggestedMinutes) ||
    suggestedMinutes < PAPER_MINUTES_MIN ||
    suggestedMinutes > PAPER_MINUTES_MAX
  ) {
    issues.push("suggestedMinutes must be an integer 1-300");
  }
  const items = data.items === undefined ? undefined : parseItems(data.items, issues);
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    paperId,
    expectedRevision: data.expectedRevision as number,
    title,
    summary,
    goal,
    categoryId,
    access: data.access as PaperAccess,
    difficulty: data.difficulty as Difficulty,
    sort: data.sort as number,
    suggestedMinutes: suggestedMinutes as number,
    items
  };
}

export function parsePaperListInput(data: Record<string, unknown>, publicView = false):
  | {
      ok: true;
      categoryId?: string;
      status?: PaperStatus;
      difficulty?: Difficulty;
      access?: PaperAccess;
      progress?: PaperProgressFilter;
      includeDescendants: boolean;
      sort: "latest" | "recommended";
      limit: number;
      cursor?: string;
    }
  | { ok: false; issues: string[] } {
  const allowed = publicView ? PAPER_PUBLIC_LIST_FIELDS : PAPER_LIST_FIELDS;
  const extra = rejectUnknownKeys(data, [...allowed]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const categoryId = typeof data.categoryId === "string" && data.categoryId.trim() ? data.categoryId.trim() : undefined;
  const status = data.status === undefined ? undefined : data.status;
  if (status !== undefined && !isPaperStatus(status)) issues.push("status invalid");
  if (publicView && status !== undefined) issues.push("public list cannot filter arbitrary status");
  const difficulty = data.difficulty;
  if (difficulty !== undefined && difficulty !== "beginner" && difficulty !== "intermediate" && difficulty !== "challenge") {
    issues.push("difficulty invalid");
  }
  const access = data.access;
  if (access !== undefined && !isPaperAccess(access)) issues.push("access invalid");
  const sort = data.sort === undefined || data.sort === "latest" || data.sort === "recommended" ? data.sort || "latest" : "";
  if (!sort) issues.push("sort must be latest or recommended");
  const limit = data.limit === undefined ? 20 : data.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    issues.push("limit must be 1-100");
  }
  if (data.includeDescendants !== undefined && data.includeDescendants !== true && data.includeDescendants !== false) {
    issues.push("includeDescendants must be boolean");
  }
  const progress = data.progress;
  if (progress !== undefined && progress !== "done" && progress !== "undone") {
    issues.push("progress must be done or undone");
  }
  if (!publicView && progress !== undefined) {
    issues.push("admin list cannot filter progress");
  }
  if (data.cursor !== undefined && (typeof data.cursor !== "string" || !data.cursor.trim())) {
    issues.push("cursor invalid");
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    categoryId,
    status: publicView ? "published" : (status as PaperStatus | undefined),
    difficulty: difficulty as Difficulty | undefined,
    access: access as PaperAccess | undefined,
    progress: publicView ? (progress as PaperProgressFilter | undefined) : undefined,
    includeDescendants: publicView ? data.includeDescendants !== false : false,
    sort: sort as "latest" | "recommended",
    limit: limit as number,
    cursor: typeof data.cursor === "string" && data.cursor.trim() ? data.cursor.trim() : undefined
  };
}

export function paperListCursorFilterOf(input: {
  sort: "latest" | "recommended";
  categoryId?: string;
  includeDescendants: boolean;
  difficulty?: string;
  access?: string;
  progress?: string;
  gen: number;
}): Omit<PaperListCursorPayload, "afterKey" | "afterId"> {
  return {
    sort: input.sort,
    categoryId: input.categoryId || "",
    includeDescendants: input.includeDescendants,
    difficulty: input.difficulty || "",
    access: input.access || "",
    progress: input.progress || "",
    gen: input.gen
  };
}

function hexOfBytes(bytes: Uint8Array): string {
  return [...bytes].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function bytesOfHex(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

export function encodePaperListCursor(payload: PaperListCursorPayload): string {
  const body = namedCanonicalJson(payload, [...PAPER_LIST_CURSOR_KEYS]);
  return `${sha256Hex(body)}.${hexOfBytes(utf8Bytes(body))}`;
}

export function decodePaperListCursor(
  raw: unknown
): { ok: true; payload: PaperListCursorPayload } | { ok: false; reason: string } {
  if (typeof raw !== "string" || !raw.includes(".")) return { ok: false, reason: "CURSOR_INVALID" };
  const dot = raw.indexOf(".");
  const sig = raw.slice(0, dot);
  const hex = raw.slice(dot + 1);
  const bytes = bytesOfHex(hex);
  if (!bytes) return { ok: false, reason: "CURSOR_INVALID" };
  let body = "";
  for (const item of bytes) body += String.fromCharCode(item);
  if (sha256Hex(body) !== sig) return { ok: false, reason: "CURSOR_INVALID" };
  try {
    const parsed = JSON.parse(body) as PaperListCursorPayload;
    if (
      (parsed.sort !== "latest" && parsed.sort !== "recommended") ||
      typeof parsed.categoryId !== "string" ||
      typeof parsed.includeDescendants !== "boolean" ||
      typeof parsed.difficulty !== "string" ||
      typeof parsed.access !== "string" ||
      typeof parsed.progress !== "string" ||
      typeof parsed.afterKey !== "string" ||
      typeof parsed.afterId !== "string" ||
      typeof parsed.gen !== "number"
    ) {
      return { ok: false, reason: "CURSOR_INVALID" };
    }
    return { ok: true, payload: parsed };
  } catch {
    return { ok: false, reason: "CURSOR_INVALID" };
  }
}

export function paperListCursorMatches(
  payload: PaperListCursorPayload,
  filter: Omit<PaperListCursorPayload, "afterKey" | "afterId">
): boolean {
  return (
    payload.sort === filter.sort &&
    payload.categoryId === filter.categoryId &&
    payload.includeDescendants === filter.includeDescendants &&
    payload.difficulty === filter.difficulty &&
    payload.access === filter.access &&
    payload.progress === filter.progress &&
    payload.gen === filter.gen
  );
}

export function parseHomeGetInput(data: Record<string, unknown>): { ok: true } | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...HOME_GET_FIELDS]);
  return extra.length ? { ok: false, issues: [`unknown fields: ${extra.join(",")}`] } : { ok: true };
}

export function parsePaperGetInput(data: Record<string, unknown>):
  | { ok: true; paperId: string; versionId?: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...PAPER_GET_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (typeof data.paperId !== "string" || !data.paperId.trim()) issues.push("paperId required");
  if (data.versionId !== undefined && (typeof data.versionId !== "string" || !data.versionId.trim())) {
    issues.push("versionId must be a string");
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    paperId: String(data.paperId).trim(),
    versionId: typeof data.versionId === "string" && data.versionId.trim() ? data.versionId.trim() : undefined
  };
}

export function parsePaperPreviewInput(data: Record<string, unknown>): { ok: true; paperId: string } | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...PAPER_PREVIEW_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (typeof data.paperId !== "string" || !data.paperId.trim()) issues.push("paperId required");
  if (issues.length) return { ok: false, issues };
  return { ok: true, paperId: String(data.paperId).trim() };
}

export function parsePaperPublishInput(data: Record<string, unknown>):
  | { ok: true; paperId: string; expectedRevision: number; confirmOverlap: boolean; injectPublishFault?: PaperPublishFault }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...PAPER_PUBLISH_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (typeof data.paperId !== "string" || !data.paperId.trim()) issues.push("paperId required");
  if (typeof data.expectedRevision !== "number" || !Number.isInteger(data.expectedRevision) || data.expectedRevision < 1) {
    issues.push("expectedRevision required");
  }
  if (data.confirmOverlap !== undefined && typeof data.confirmOverlap !== "boolean") {
    issues.push("confirmOverlap must be boolean");
  }
  if (data.injectPublishFault !== undefined && !PAPER_FAULTS.includes(data.injectPublishFault as PaperPublishFault)) {
    issues.push("injectPublishFault invalid");
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    paperId: String(data.paperId).trim(),
    expectedRevision: data.expectedRevision as number,
    confirmOverlap: data.confirmOverlap === true,
    injectPublishFault: data.injectPublishFault as PaperPublishFault | undefined
  };
}

export function parsePaperUnpublishInput(data: Record<string, unknown>):
  | { ok: true; paperId: string; expectedRevision: number }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...PAPER_UNPUBLISH_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (typeof data.paperId !== "string" || !data.paperId.trim()) issues.push("paperId required");
  if (typeof data.expectedRevision !== "number" || !Number.isInteger(data.expectedRevision) || data.expectedRevision < 1) {
    issues.push("expectedRevision required");
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, paperId: String(data.paperId).trim(), expectedRevision: data.expectedRevision as number };
}

export function parsePaperWithdrawInput(data: Record<string, unknown>):
  | { ok: true; paperId: string; expectedRevision: number; reason: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...PAPER_WITHDRAW_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (typeof data.paperId !== "string" || !data.paperId.trim()) issues.push("paperId required");
  if (typeof data.expectedRevision !== "number" || !Number.isInteger(data.expectedRevision) || data.expectedRevision < 1) {
    issues.push("expectedRevision required");
  }
  if (typeof data.reason !== "string" || !data.reason.trim()) issues.push("reason required");
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    paperId: String(data.paperId).trim(),
    expectedRevision: data.expectedRevision as number,
    reason: String(data.reason).trim()
  };
}

export function parsePublicPaperDetailInput(data: Record<string, unknown>): { ok: true; paperId: string } | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...PAPER_PUBLIC_DETAIL_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (typeof data.paperId !== "string" || !data.paperId.trim()) issues.push("paperId required");
  if (issues.length) return { ok: false, issues };
  return { ok: true, paperId: String(data.paperId).trim() };
}
