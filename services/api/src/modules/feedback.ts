import {
  FEEDBACK_SCHEMA_VERSION,
  disableBlocksWrites,
  feedbackDocId,
  feedbackTriesToMutateAnswers,
  paperBindsQuestionVersion,
  parseFeedbackCreateInput,
  parseFeedbackListInput,
  parseFeedbackResolveInput,
  type FeedbackRecord
} from "@mw/shared";
import type { MemberReadStore } from "./member-stores.js";
import type { PaperReadStore } from "./paper-stores.js";
import type { FeedbackStore } from "./feedback-stores.js";

export const MEMBER_FEEDBACK_ACTIONS = ["feedback.create"] as const;
export const ADMIN_FEEDBACK_READ_ACTIONS = ["feedback.list"] as const;
export const ADMIN_FEEDBACK_WRITE_ACTIONS = ["feedback.resolve"] as const;

type ActionFailure = { ok: false; code: string; reason: string; issues?: string[]; details?: Record<string, unknown> };
type ActionSuccess<T> = { ok: true; data: T; replayed?: boolean };

function fail(code: string, reason: string, extra?: { issues?: string[]; details?: Record<string, unknown> }): ActionFailure {
  return { ok: false, code, reason, ...(extra || {}) };
}

function publicFeedback(row: FeedbackRecord) {
  return {
    feedbackId: row.feedbackId,
    memberId: row.memberId,
    type: row.type,
    paperId: row.paperId,
    questionId: row.questionId,
    versionId: row.versionId,
    text: row.text,
    status: row.status,
    resolveNote: row.resolveNote,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt,
    submitterDeleted: row.submitterDeleted === true,
    submitterDeletedAt: row.submitterDeletedAt || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export async function createFeedback(input: {
  store: FeedbackStore;
  members: MemberReadStore;
  papers: PaperReadStore;
  memberId: string;
  data: Record<string, unknown>;
  idempotencyKey: string;
  now: Date;
}): Promise<ActionSuccess<ReturnType<typeof publicFeedback>> | ActionFailure> {
  const mutated = feedbackTriesToMutateAnswers(input.data);
  if (mutated.length) {
    return fail("INVALID_ARGUMENT", "FEEDBACK_CANNOT_MUTATE_ANSWERS", { issues: mutated });
  }
  const parsed = parseFeedbackCreateInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "FEEDBACK_CREATE_INPUT_INVALID", { issues: parsed.issues });
  const member = await input.members.getMember(input.memberId);
  if (!member) return fail("MEMBER_REQUIRED", "MEMBER_NOT_REGISTERED");
  if (disableBlocksWrites(member.status)) return fail("ACCOUNT_DISABLED", "MEMBER_DISABLED");
  const paper = await input.papers.getPaper(parsed.paperId);
  if (!paper) return fail("NOT_FOUND", "PAPER_NOT_FOUND");
  const versions = await input.papers.listVersionsForPaper(parsed.paperId);
  const bound = versions.some((version) =>
    paperBindsQuestionVersion({
      questionIds: version.questionIds,
      questionVersionIds: version.questionVersionIds,
      questionId: parsed.questionId,
      versionId: parsed.versionId
    })
  );
  if (!bound) return fail("INVALID_ARGUMENT", "PAPER_QUESTION_VERSION_MISMATCH");
  const feedbackId = feedbackDocId({
    memberId: input.memberId,
    paperId: parsed.paperId,
    questionId: parsed.questionId,
    versionId: parsed.versionId,
    idempotencyKey: input.idempotencyKey
  });
  const existing = await input.store.get(feedbackId);
  const nowIso = input.now.toISOString();
  if (existing) {
    const same =
      existing.memberId === input.memberId &&
      existing.type === parsed.type &&
      existing.paperId === parsed.paperId &&
      existing.questionId === parsed.questionId &&
      existing.versionId === parsed.versionId &&
      existing.text === parsed.text;
    if (!same) return fail("IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT");
    return { ok: true, data: publicFeedback(existing), replayed: true };
  }
  const record: FeedbackRecord = {
    feedbackId,
    memberId: input.memberId,
    type: parsed.type,
    paperId: parsed.paperId,
    questionId: parsed.questionId,
    versionId: parsed.versionId,
    text: parsed.text,
    status: "open",
    resolveNote: "",
    resolvedBy: "",
    resolvedAt: "",
    submitterDeleted: false,
    submitterDeletedAt: "",
    schemaVersion: FEEDBACK_SCHEMA_VERSION,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  await input.store.save(record);
  return { ok: true, data: publicFeedback(record) };
}

export async function listFeedback(input: {
  store: FeedbackStore;
  data: Record<string, unknown>;
}): Promise<ActionSuccess<{ items: ReturnType<typeof publicFeedback>[] }> | ActionFailure> {
  const parsed = parseFeedbackListInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "FEEDBACK_LIST_INPUT_INVALID", { issues: parsed.issues });
  const items = await input.store.list({ status: parsed.status || undefined, limit: parsed.limit });
  return { ok: true, data: { items: items.map(publicFeedback) } };
}

export async function resolveFeedback(input: {
  store: FeedbackStore;
  actorId: string;
  data: Record<string, unknown>;
  now: Date;
}): Promise<ActionSuccess<ReturnType<typeof publicFeedback>> | ActionFailure> {
  const mutated = feedbackTriesToMutateAnswers(input.data);
  if (mutated.length) {
    return fail("INVALID_ARGUMENT", "FEEDBACK_CANNOT_MUTATE_ANSWERS", { issues: mutated });
  }
  const parsed = parseFeedbackResolveInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "FEEDBACK_RESOLVE_INPUT_INVALID", { issues: parsed.issues });
  const current = await input.store.get(parsed.feedbackId);
  if (!current) return fail("NOT_FOUND", "FEEDBACK_NOT_FOUND");
  if (current.status === "resolved") {
    return { ok: true, data: publicFeedback(current), replayed: true };
  }
  const next: FeedbackRecord = {
    ...current,
    status: "resolved",
    resolveNote: parsed.note,
    resolvedBy: input.actorId,
    resolvedAt: input.now.toISOString(),
    updatedAt: input.now.toISOString()
  };
  await input.store.save(next);
  return { ok: true, data: publicFeedback(next) };
}

export async function markMemberFeedbacksDeleted(input: {
  store: FeedbackStore;
  memberId: string;
  now: Date;
}): Promise<{ marked: number }> {
  if (!input.store.listByMember) return { marked: 0 };
  const rows = await input.store.listByMember(input.memberId);
  const nowIso = input.now.toISOString();
  let marked = 0;
  for (const row of rows) {
    if (row.submitterDeleted === true) continue;
    await input.store.save({
      ...row,
      submitterDeleted: true,
      submitterDeletedAt: nowIso,
      updatedAt: nowIso
    });
    marked += 1;
  }
  return { marked };
}
