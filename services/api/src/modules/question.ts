import {
  QUESTION_SCHEMA_VERSION,
  analysisAssetIdsOf,
  auditDocId,
  buildAuditEntry,
  buildIdempotencyRecord,
  categoryUsableForQuestion,
  collectAssetIds,
  parseQuestionDisableInput,
  parseQuestionGetInput,
  parseQuestionListInput,
  parseQuestionSaveInput,
  payloadHash,
  promptAssetIdsOf,
  questionIdFor,
  questionVersionId,
  replayOrConflict,
  toAdminQuestionView,
  toPublicQuestionView,
  type CategoryRecord,
  type MediaAssetRecord,
  type QuestionRecord,
  type QuestionVersionRecord
} from "@mw/shared";
import type { CategoryReadStore } from "./category-stores.js";
import type { TxBudget } from "./job-stores.js";
import type { QuestionUsageStore, QuestionWorkStore } from "./question-stores.js";
import type { ObjectStorage } from "./upload-stores.js";

const RETRYABLE_TX =
  /TX_CONFLICT|TRANSACTION_CONFLICT|DATABASE_TRANSACTION_CONFLICT|DOCUMENT_VERSION_CONFLICT|QUESTION_VERSION_IMMUTABLE|optimistic.?lock|write.?conflict|contention|please retry|try again/i;

export type QuestionActionFailure = {
  ok: false;
  code: string;
  reason: string;
  issues?: string[];
  details?: Record<string, unknown>;
};

export type QuestionActionSuccess<T> = {
  ok: true;
  data: T;
  replayed?: boolean;
  budget: TxBudget;
};

function emptyBudget(): TxBudget {
  return { reads: 0, writes: 0, total: 0, elapsedMs: 0 };
}

function fail(code: string, reason: string, extra?: { issues?: string[]; details?: Record<string, unknown> }): QuestionActionFailure {
  return { ok: false, code, reason, ...(extra?.issues ? { issues: extra.issues } : {}), ...(extra?.details ? { details: extra.details } : {}) };
}

export function isRetryableQuestionTxError(error: unknown): boolean {
  if (error == null) return false;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return RETRYABLE_TX.test(text);
}

async function runWithTxRetry<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      lastError = error;
      if (!isRetryableQuestionTxError(error) || attempt === 3) return { ok: false, error };
    }
  }
  return { ok: false, error: lastError };
}

function missingAssetsOf(
  version: QuestionVersionRecord,
  assets: MediaAssetRecord[]
): Array<{ assetId: string; kind: "prompt" | "analysis" }> {
  const byId = new Map(assets.map((row) => [row.assetId, row]));
  const missing: Array<{ assetId: string; kind: "prompt" | "analysis" }> = [];
  for (const assetId of promptAssetIdsOf(version)) {
    const row = byId.get(assetId);
    if (!row || row.state !== "ready" || row.kind !== "prompt") missing.push({ assetId, kind: "prompt" });
  }
  for (const assetId of analysisAssetIdsOf(version)) {
    const row = byId.get(assetId);
    if (!row || row.state !== "ready" || row.kind !== "analysis") missing.push({ assetId, kind: "analysis" });
  }
  return missing;
}

async function resolveAssets(
  store: QuestionWorkStore,
  version: QuestionVersionRecord
): Promise<MediaAssetRecord[]> {
  const ids = collectAssetIds(version);
  const rows: MediaAssetRecord[] = [];
  for (const id of ids) {
    const row = await store.getAsset(id);
    if (row) rows.push(row);
  }
  return rows;
}

export async function listQuestions(input: {
  store?: QuestionWorkStore;
  data: Record<string, unknown>;
}): Promise<QuestionActionSuccess<{ items: ReturnType<typeof toPublicQuestionView>[]; complete: boolean }> | QuestionActionFailure> {
  const parsed = parseQuestionListInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_LIST", { issues: parsed.issues });
  if (!input.store) return fail("INTERNAL_ERROR", "QUESTION_STORE_UNAVAILABLE");
  const questions = await input.store.listQuestions({
    categoryId: parsed.categoryId,
    status: parsed.status,
    limit: parsed.limit
  });
  const items = [];
  for (const question of questions) {
    const version = await input.store.getVersion(question.currentVersionId);
    if (!version) continue;
    items.push(toPublicQuestionView(question, version));
  }
  return { ok: true, data: { items, complete: items.every((item) => item.questionId) }, budget: emptyBudget() };
}

export async function getQuestion(input: {
  store?: QuestionWorkStore;
  storage?: ObjectStorage;
  data: Record<string, unknown>;
  includeSecrets: boolean;
}): Promise<
  | QuestionActionSuccess<{
      question: ReturnType<typeof toAdminQuestionView> | ReturnType<typeof toPublicQuestionView>;
      assets: Array<{ assetId: string; kind: string; caption: string; mime: string; size: number; readUrl?: string }>;
      complete: boolean;
    }>
  | QuestionActionFailure
> {
  const parsed = parseQuestionGetInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_GET", { issues: parsed.issues });
  if (!input.store) return fail("INTERNAL_ERROR", "QUESTION_STORE_UNAVAILABLE");
  const question = await input.store.getQuestion(parsed.questionId);
  if (!question) return fail("NOT_FOUND", "QUESTION_NOT_FOUND");
  const version = await input.store.getVersion(parsed.versionId || question.currentVersionId);
  if (!version) return fail("NOT_FOUND", "QUESTION_VERSION_NOT_FOUND");
  const assets = await resolveAssets(input.store, version);
  const missing = missingAssetsOf(version, assets);
  const assetViews = [];
  for (const row of assets) {
    const isAnalysis = row.kind === "analysis";
    if (isAnalysis && !input.includeSecrets) continue;
    const readUrl = input.storage ? await input.storage.getTempReadUrl(row.objectKey, 60) : undefined;
    assetViews.push({
      assetId: row.assetId,
      kind: row.kind,
      caption: row.caption,
      mime: row.mime,
      size: row.size,
      ...(readUrl && input.includeSecrets ? { readUrl } : row.kind === "prompt" && readUrl ? { readUrl } : {})
    });
  }
  if (input.includeSecrets) {
    return {
      ok: true,
      data: {
        question: toAdminQuestionView(question, version, missing),
        assets: assetViews,
        complete: missing.length === 0
      },
      budget: emptyBudget()
    };
  }
  return {
    ok: true,
    data: {
      question: toPublicQuestionView(question, version),
      assets: assetViews.filter((item) => item.kind === "prompt"),
      complete: missing.filter((item) => item.kind === "prompt").length === 0
    },
    budget: emptyBudget()
  };
}

export async function saveQuestion(input: {
  store: QuestionWorkStore;
  categories?: CategoryReadStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<QuestionActionSuccess<ReturnType<typeof toAdminQuestionView> & { versionId: string; revision: number; idempotencyId: string }> | QuestionActionFailure> {
  const parsed = parseQuestionSaveInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_SAVE", { issues: parsed.issues });
  const category = input.categories ? await input.categories.getCategory(parsed.categoryId) : ({ categoryId: parsed.categoryId, enabled: true, deletedAt: null } as CategoryRecord);
  const usable = categoryUsableForQuestion(category);
  if (!usable.ok) return fail(usable.code, usable.reason);
  const questionId = parsed.questionId || questionIdFor(input.actorId, input.requestId);
  const isCreate = !parsed.questionId;
  if (isCreate && parsed.expectedRevision !== 0) {
    return fail("INVALID_ARGUMENT", "CREATE_EXPECTED_REVISION_ZERO");
  }
  const versionDraft: Omit<QuestionVersionRecord, "versionId" | "createdAt" | "createdBy" | "assetIds" | "questionId"> = {
    type: parsed.type,
    stem: parsed.stem,
    options: parsed.options,
    answer: parsed.answer,
    analysis: parsed.analysis,
    defaultPoints: parsed.defaultPoints,
    difficulty: parsed.difficulty,
    categoryId: parsed.categoryId,
    schemaVersion: QUESTION_SCHEMA_VERSION
  };
  const allAssetIds = collectAssetIds({
    stem: parsed.stem,
    options: parsed.options,
    analysis: parsed.analysis
  });
  for (const assetId of allAssetIds) {
    const asset = await input.store.getAsset(assetId);
    if (!asset || asset.state !== "ready") {
      return fail("INVALID_ARGUMENT", "ASSET_NOT_READY", { details: { assetId } });
    }
    const wantsAnalysis = parsed.analysis.assetIds.includes(assetId);
    if (wantsAnalysis && asset.kind !== "analysis") {
      return fail("INVALID_ARGUMENT", "ASSET_PURPOSE_MISMATCH", { details: { assetId, expected: "analysis" } });
    }
    if (!wantsAnalysis && asset.kind !== "prompt") {
      return fail("INVALID_ARGUMENT", "ASSET_PURPOSE_MISMATCH", { details: { assetId, expected: "prompt" } });
    }
  }
  const payload = {
    questionId,
    expectedRevision: parsed.expectedRevision,
    categoryId: parsed.categoryId,
    type: parsed.type,
    stem: parsed.stem,
    options: parsed.options,
    answer: parsed.answer,
    analysis: parsed.analysis,
    defaultPoints: parsed.defaultPoints,
    difficulty: parsed.difficulty
  };
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "question.save",
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  });
  const retried = await runWithTxRetry(() =>
    input.store.transactWrite({
      questionId,
      idempotencyId: idemRecord.id,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, payloadHash(payload), () => null);
        if (!replay.ok) {
          return { result: null as never, error: { code: replay.code, reason: "IDEMPOTENCY_CONFLICT" } };
        }
        if (replay.replayed) {
          const view = replay.result as ReturnType<typeof toAdminQuestionView> & { versionId: string; revision: number; idempotencyId: string };
          if (view) return { result: view };
        }
        if (parsed.questionId && !snap.question) {
          return { result: null as never, error: { code: "NOT_FOUND", reason: "QUESTION_NOT_FOUND" } };
        }
        if (!parsed.questionId && snap.question) {
          return { result: null as never, error: { code: "VERSION_CONFLICT", reason: "QUESTION_ID_TAKEN" } };
        }
        const currentRevision = snap.question?.revision ?? 0;
        if (currentRevision !== parsed.expectedRevision) {
          return { result: null as never, error: { code: "VERSION_CONFLICT", reason: "EXPECTED_REVISION_MISMATCH" } };
        }
        if (snap.question?.status === "disabled") {
          return { result: null as never, error: { code: "INVALID_ARGUMENT", reason: "QUESTION_DISABLED" } };
        }
        const nextRevision = currentRevision + 1;
        const versionId = questionVersionId(questionId, nextRevision);
        if (snap.versions.some((row) => row.versionId === versionId)) {
          return { result: null as never, error: { code: "INTERNAL_ERROR", reason: "VERSION_ID_COLLISION" } };
        }
        const version: QuestionVersionRecord = {
          ...versionDraft,
          versionId,
          questionId,
          assetIds: allAssetIds,
          createdAt: input.now.toISOString(),
          createdBy: input.actorId
        };
        const question: QuestionRecord = {
          questionId,
          categoryId: parsed.categoryId,
          currentVersionId: versionId,
          status: snap.question?.status || "active",
          revision: nextRevision,
          schemaVersion: QUESTION_SCHEMA_VERSION,
          createdAt: snap.question?.createdAt || input.now.toISOString(),
          updatedAt: input.now.toISOString()
        };
        const view = {
          ...toAdminQuestionView(question, version, []),
          versionId,
          revision: nextRevision,
          idempotencyId: idemRecord.id
        };
        const audit = buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: "question.save",
          target: questionId,
          reason: parsed.questionId ? "update question version" : "create question",
          requestId: input.requestId,
          before: snap.currentVersion
            ? { versionId: snap.currentVersion.versionId, revision: currentRevision }
            : null,
          after: { versionId, revision: nextRevision, type: version.type },
          now: input.now
        });
        view.versionId = versionId;
        return {
          question,
          version,
          idem: { ...idemRecord, status: "succeeded", resultRef: view },
          audit: { ...audit, requestId: input.requestId },
          result: { ...view, auditId: auditDocId(audit) }
        };
      }
    })
  );
  if (!retried.ok) return fail("SERVICE_BUSY", "QUESTION_TX_RETRY_EXHAUSTED");
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  return { ok: true, data: retried.value.mutation.result, replayed: Boolean(retried.value.mutation.idem && retried.value.mutation.result), budget: retried.value.budget };
}

export async function disableQuestion(input: {
  store: QuestionWorkStore;
  usage?: QuestionUsageStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<QuestionActionSuccess<{ questionId: string; status: "disabled"; revision: number; idempotencyId: string }> | QuestionActionFailure> {
  const parsed = parseQuestionDisableInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_DISABLE", { issues: parsed.issues });
  const paperRefs = input.usage ? input.usage.paperRefsFor(parsed.questionId) : [];
  if (paperRefs.length > 0) {
    return fail("INVALID_ARGUMENT", "QUESTION_IN_USE", {
      details: { paperRefs: paperRefs.length, note: "referenced versions are immutable" }
    });
  }
  const payload = { questionId: parsed.questionId, expectedRevision: parsed.expectedRevision };
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "question.disable",
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  });
  const retried = await runWithTxRetry(() =>
    input.store.transactWrite({
      questionId: parsed.questionId,
      idempotencyId: idemRecord.id,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, payloadHash(payload), () => null);
        if (!replay.ok) return { result: null as never, error: { code: replay.code, reason: "IDEMPOTENCY_CONFLICT" } };
        if (replay.replayed) {
          const view = replay.result as { questionId: string; status: "disabled"; revision: number; idempotencyId: string };
          if (view) return { result: view };
        }
        if (!snap.question) return { result: null as never, error: { code: "NOT_FOUND", reason: "QUESTION_NOT_FOUND" } };
        if (snap.question.revision !== parsed.expectedRevision) {
          return { result: null as never, error: { code: "VERSION_CONFLICT", reason: "EXPECTED_REVISION_MISMATCH" } };
        }
        const next: QuestionRecord = {
          ...snap.question,
          status: "disabled",
          updatedAt: input.now.toISOString()
        };
        const view = {
          questionId: next.questionId,
          status: "disabled" as const,
          revision: next.revision,
          idempotencyId: idemRecord.id
        };
        const audit = buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: "question.disable",
          target: next.questionId,
          reason: parsed.reason,
          requestId: input.requestId,
          before: { status: snap.question.status },
          after: { status: "disabled" },
          now: input.now
        });
        return {
          question: next,
          idem: { ...idemRecord, status: "succeeded", resultRef: view },
          audit,
          result: view
        };
      }
    })
  );
  if (!retried.ok) return fail("SERVICE_BUSY", "QUESTION_TX_RETRY_EXHAUSTED");
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  return { ok: true, data: retried.value.mutation.result, budget: retried.value.budget };
}
