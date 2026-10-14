import {
  ATTEMPT_SCHEMA_VERSION,
  applyScoreMetric,
  attemptIdFor,
  attemptSubmitHash,
  buildIdempotencyRecord,
  categoryMetricIdsOf,
  checkMaintenanceGate,
  DEFAULT_GROWTH_LEVELS,
  DEFAULT_LEVEL_ID,
  defaultMaintenanceConfig,
  draftSummaryOf,
  emptyDraftSummary,
  encodeHistoryCursor,
  gradeSelectedAnswers,
  levelIdForScore,
  MEDAL_GRANT_SOURCE_SUBMIT,
  METRIC_GENERATION_BASE,
  monthKeyShanghai,
  normalizeAttemptAnswers,
  paperBestId,
  paperChunkId,
  paperDelta,
  paperNewStartGate,
  paperStartDeniedByAccess,
  parseAttemptAbandonInput,
  parseAttemptAnalysisInput,
  parseAttemptHistoryInput,
  parseAttemptIdInput,
  parseAttemptReplaceInput,
  parseAttemptSaveEnvelope,
  parseAttemptStartInput,
  parseAttemptSubmitEnvelope,
  parseHistoryCursor,
  parseQuestionPageInput,
  planMedalGrants,
  replayOrConflict,
  SCORE_EVENT_KIND_SUBMIT,
  scoreEventId,
  scoreMetricId,
  toPublicAttemptView,
  validateSubmitAnswers,
  weekKeyShanghai,
  type ActiveAttemptRecord,
  type AttemptDraftSummary,
  type AttemptRecord,
  type GradeableQuestion,
  type GrowthConfigRecord,
  type IdempotencyRecord,
  type MaintenanceConfig,
  type PaperAnswerRecord,
  type PaperBestRecord,
  type PaperChunkRecord,
  type ScoreEventRecord,
  type ScoreMetricRecord,
  type SubmitResultData,
  isolatedEntitlementReader,
  type PracticeEntitlementReader
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { AttemptWorkStore, AttemptWriteMutation, SubmitWriteMutation } from "./attempt-stores.js";
import type { MemberStatsRecord } from "./member-stores.js";
import { growthGrantIdsFor } from "./growth-stores.js";

export const ATTEMPT_TX_MAX_ATTEMPTS = 3;
export const ATTEMPT_WRITE_ACTIONS = [
  "attempt.start",
  "attempt.startReplacing",
  "attempt.save",
  "attempt.abandon",
  "attempt.submit"
] as const;
export const ATTEMPT_READ_ACTIONS = ["attempt.get", "attempt.questionPage", "attempt.result", "attempt.analysis", "attempt.history"] as const;

const RETRYABLE_TX =
  /TX_CONFLICT|TRANSACTION_CONFLICT|DATABASE_TRANSACTION_CONFLICT|DOCUMENT_VERSION_CONFLICT|TRANSACTION_CONFLICTED|optimistic.?lock|write.?conflict|contention|please retry|try again/i;

export type AttemptActionFailure = {
  ok: false;
  code: string;
  reason: string;
  issues?: string[];
  details?: Record<string, unknown>;
};

export type AttemptActionSuccess<T> = {
  ok: true;
  data: T;
  replayed?: boolean;
  budget: TxBudget;
};

function emptyBudget(): TxBudget {
  return { reads: 0, writes: 0, total: 0, elapsedMs: 0 };
}

function fail(code: string, reason: string, extra?: { issues?: string[]; details?: Record<string, unknown> }): AttemptActionFailure {
  return {
    ok: false,
    code,
    reason,
    ...(extra?.issues ? { issues: extra.issues } : {}),
    ...(extra?.details ? { details: extra.details } : {})
  };
}

export function isRetryableAttemptTxError(error: unknown): boolean {
  if (error == null) return false;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/CRASH_AFTER_/i.test(text)) return false;
  return RETRYABLE_TX.test(text);
}

async function runWithTxRetry<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPT_TX_MAX_ATTEMPTS; attempt += 1) {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      lastError = error;
      if (!isRetryableAttemptTxError(error) || attempt === ATTEMPT_TX_MAX_ATTEMPTS) {
        return { ok: false, error };
      }
    }
  }
  return { ok: false, error: lastError };
}

function startBlocked(config: MaintenanceConfig | undefined): AttemptActionFailure | undefined {
  const checked = checkMaintenanceGate(config || defaultMaintenanceConfig(new Date()), "attemptStart");
  if (checked.allowed) return undefined;
  return fail("CONTENT_UPDATING", checked.reason || "ATTEMPT_START_CLOSED", {
    details: { gate: "attemptStart", jobId: checked.jobId }
  });
}

function submitBlocked(config: MaintenanceConfig | undefined): AttemptActionFailure | undefined {
  const checked = checkMaintenanceGate(config || defaultMaintenanceConfig(new Date()), "attemptSubmit");
  if (checked.allowed) return undefined;
  return fail("CONTENT_UPDATING", checked.reason || "ATTEMPT_SUBMIT_CLOSED", {
    details: { gate: "attemptSubmit", jobId: checked.jobId }
  });
}

function memberWriteBlocked(member: { status: string } | undefined): AttemptActionFailure | undefined {
  if (!member) return fail("MEMBER_REQUIRED", "MEMBER_NOT_REGISTERED");
  if (member.status === "disabled" || member.status === "deleting" || member.status === "deleted") {
    return fail("ACCOUNT_DISABLED", "ACCOUNT_DISABLED");
  }
  return undefined;
}

function closedAttemptCode(state: string): { code: string; reason: string } {
  if (state === "submitted") return { code: "ALREADY_SUBMITTED", reason: "ATTEMPT_ALREADY_SUBMITTED" };
  return { code: "INVALID_ARGUMENT", reason: "ATTEMPT_NOT_IN_PROGRESS" };
}

function newAttempt(input: {
  attemptId: string;
  memberId: string;
  paperId: string;
  paperVersionId: string;
  paperTitle: string;
  access: "free" | "vip";
  questionCount: number;
  maxScore: number;
  chunkCount: number;
  now: Date;
}): AttemptRecord {
  const at = input.now.toISOString();
  return {
    attemptId: input.attemptId,
    memberId: input.memberId,
    paperId: input.paperId,
    paperVersionId: input.paperVersionId,
    paperTitle: input.paperTitle,
    access: input.access,
    questionCount: input.questionCount,
    maxScore: input.maxScore,
    chunkCount: input.chunkCount,
    answers: [],
    draftRevision: 0,
    state: "inProgress",
    submittedAt: "",
    abandonedAt: "",
    lastSaveRequestId: "",
    score: null,
    gradeRevision: null,
    submitHash: null,
    schemaVersion: ATTEMPT_SCHEMA_VERSION,
    createdAt: at,
    updatedAt: at
  };
}

function toActive(attempt: AttemptRecord): ActiveAttemptRecord {
  return {
    memberId: attempt.memberId,
    attemptId: attempt.attemptId,
    paperId: attempt.paperId,
    paperTitle: attempt.paperTitle,
    paperVersionId: attempt.paperVersionId,
    revision: attempt.draftRevision,
    answeredCount: attempt.answers.length,
    questionCount: attempt.questionCount,
    updatedAt: attempt.updatedAt,
    schemaVersion: ATTEMPT_SCHEMA_VERSION
  };
}

function startView(attempt: AttemptRecord) {
  return {
    attemptId: attempt.attemptId,
    paperId: attempt.paperId,
    paperVersion: attempt.paperVersionId,
    paperTitle: attempt.paperTitle,
    access: attempt.access,
    revision: attempt.draftRevision,
    questionCount: attempt.questionCount,
    maxScore: attempt.maxScore,
    chunkCount: attempt.chunkCount,
    chunks: Array.from({ length: attempt.chunkCount }, (_, index) => ({ chunkNo: index + 1 }))
  };
}

function activeExistsDetails(active: ActiveAttemptRecord) {
  return {
    existingAttemptId: active.attemptId,
    existingPaperId: active.paperId,
    existingTitle: active.paperTitle,
    existingRevision: active.revision
  };
}

function abandonInPlace(attempt: AttemptRecord, now: Date): AttemptRecord {
  return {
    ...attempt,
    state: "abandoned",
    abandonedAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function replayRef<T>(idem: IdempotencyRecord | undefined): T | undefined {
  if (!idem || idem.status !== "succeeded" || idem.resultRef == null) return undefined;
  return idem.resultRef as T;
}

export async function readDraftSummary(
  store: AttemptWorkStore | undefined,
  memberId: string
): Promise<AttemptDraftSummary> {
  if (!store) return emptyDraftSummary();
  const active = await store.getActive(memberId);
  if (!active?.attemptId) return emptyDraftSummary();
  const attempt = await store.getAttempt(active.attemptId);
  if (!attempt || attempt.state !== "inProgress") return emptyDraftSummary();
  return draftSummaryOf(active, attempt);
}

export async function startAttempt(input: {
  store: AttemptWorkStore;
  memberId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
  maintenance?: MaintenanceConfig;
  entitlement?: PracticeEntitlementReader;
}): Promise<AttemptActionSuccess<ReturnType<typeof startView>> | AttemptActionFailure> {
  const blocked = startBlocked(input.maintenance);
  if (blocked) return blocked;
  const parsed = parseAttemptStartInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "START_INPUT_INVALID", { issues: parsed.issues });
  const entitlement = await (input.entitlement || isolatedEntitlementReader()).evaluate(input.memberId, input.now);
  const attemptId = attemptIdFor(input.memberId, input.idempotencyKey);
  const idemRecord = buildIdempotencyRecord({
    actorId: input.memberId,
    action: "attempt.start",
    idempotencyKey: input.idempotencyKey,
    payload: { paperId: parsed.paperId, expectedPaperVersion: parsed.expectedPaperVersion || "" },
    requestId: input.requestId
  });
  const retried = await runWithTxRetry(() =>
    input.store.transactWrite({
      memberId: input.memberId,
      attemptId,
      paperId: parsed.paperId,
      idempotencyId: idemRecord.id,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, idemRecord.payloadHash, () => null);
        if (!replay.ok) {
          return { error: { code: "IDEMPOTENCY_CONFLICT", reason: "IDEMPOTENCY_CONFLICT" }, result: startView(newAttempt({
            attemptId,
            memberId: input.memberId,
            paperId: parsed.paperId,
            paperVersionId: "",
            paperTitle: "",
            access: "free",
            questionCount: 0,
            maxScore: 0,
            chunkCount: 0,
            now: input.now
          })) };
        }
        const replayed = replayRef<ReturnType<typeof startView>>(snap.idem);
        if (replay.replayed && replayed) {
          return { result: replayed, replayed: true, idem: snap.idem };
        }
        const memberBlocked = memberWriteBlocked(snap.member);
        if (memberBlocked) return { error: { code: memberBlocked.code, reason: memberBlocked.reason }, result: startView(newAttempt({
          attemptId, memberId: input.memberId, paperId: parsed.paperId, paperVersionId: "", paperTitle: "", access: "free", questionCount: 0, maxScore: 0, chunkCount: 0, now: input.now
        })) };
        if (!snap.paper || !snap.version) {
          return { error: { code: "NOT_FOUND", reason: "PAPER_NOT_FOUND" }, result: startView(newAttempt({
            attemptId, memberId: input.memberId, paperId: parsed.paperId, paperVersionId: "", paperTitle: "", access: "free", questionCount: 0, maxScore: 0, chunkCount: 0, now: input.now
          })) };
        }
        const gate = paperNewStartGate(snap.paper.status);
        if (gate.blocked) {
          return { error: { code: gate.code, reason: gate.reason }, result: startView(newAttempt({
            attemptId, memberId: input.memberId, paperId: parsed.paperId, paperVersionId: "", paperTitle: "", access: "free", questionCount: 0, maxScore: 0, chunkCount: 0, now: input.now
          })) };
        }
        if (snap.category && (snap.category.enabled !== true || snap.category.deletedAt)) {
          return { error: { code: "CATEGORY_UNAVAILABLE", reason: "CATEGORY_UNAVAILABLE" }, result: startView(newAttempt({
            attemptId, memberId: input.memberId, paperId: parsed.paperId, paperVersionId: "", paperTitle: "", access: "free", questionCount: 0, maxScore: 0, chunkCount: 0, now: input.now
          })) };
        }
        if (parsed.expectedPaperVersion && parsed.expectedPaperVersion !== snap.version.versionId) {
          return { error: { code: "VERSION_CONFLICT", reason: "PAPER_VERSION_MISMATCH" }, result: startView(newAttempt({
            attemptId, memberId: input.memberId, paperId: parsed.paperId, paperVersionId: "", paperTitle: "", access: "free", questionCount: 0, maxScore: 0, chunkCount: 0, now: input.now
          })) };
        }
        const vip = paperStartDeniedByAccess(snap.paper.access, entitlement);
        if (vip.blocked) {
          return { error: { code: vip.code, reason: vip.reason }, result: startView(newAttempt({
            attemptId, memberId: input.memberId, paperId: parsed.paperId, paperVersionId: "", paperTitle: "", access: "free", questionCount: 0, maxScore: 0, chunkCount: 0, now: input.now
          })) };
        }
        if (snap.active?.attemptId) {
          return {
            error: {
              code: "ACTIVE_ATTEMPT_EXISTS",
              reason: "ACTIVE_ATTEMPT_EXISTS",
              details: activeExistsDetails(snap.active)
            },
            result: startView(newAttempt({
              attemptId, memberId: input.memberId, paperId: parsed.paperId, paperVersionId: "", paperTitle: "", access: "free", questionCount: 0, maxScore: 0, chunkCount: 0, now: input.now
            }))
          };
        }
        const attempt = newAttempt({
          attemptId,
          memberId: input.memberId,
          paperId: snap.paper.paperId,
          paperVersionId: snap.version.versionId,
          paperTitle: snap.paper.title,
          access: snap.paper.access,
          questionCount: snap.version.questionCount,
          maxScore: snap.version.maxScore,
          chunkCount: snap.version.chunkIds.length,
          now: input.now
        });
        const view = startView(attempt);
        return {
          attempt,
          active: toActive(attempt),
          idem: { ...idemRecord, status: "succeeded", resultRef: view },
          result: view
        };
      }
    })
  );
  if (!retried.ok) return fail("SERVICE_BUSY", "ATTEMPT_TX_RETRY_EXHAUSTED");
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  return {
    ok: true,
    data: retried.value.mutation.result,
    replayed: retried.value.mutation.replayed === true,
    budget: retried.value.budget
  };
}

export async function startReplacingAttempt(input: {
  store: AttemptWorkStore;
  memberId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
  maintenance?: MaintenanceConfig;
  entitlement?: PracticeEntitlementReader;
}): Promise<AttemptActionSuccess<ReturnType<typeof startView> & { abandonedAttemptId: string }> | AttemptActionFailure> {
  const blocked = startBlocked(input.maintenance);
  if (blocked) return blocked;
  const parsed = parseAttemptReplaceInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "REPLACE_INPUT_INVALID", { issues: parsed.issues });
  const entitlement = await (input.entitlement || isolatedEntitlementReader()).evaluate(input.memberId, input.now);
  const attemptId = attemptIdFor(input.memberId, input.idempotencyKey);
  const idemRecord = buildIdempotencyRecord({
    actorId: input.memberId,
    action: "attempt.startReplacing",
    idempotencyKey: input.idempotencyKey,
    payload: {
      paperId: parsed.paperId,
      abandonAttemptId: parsed.abandonAttemptId,
      expectedRevision: parsed.expectedRevision,
      confirmed: true
    },
    requestId: input.requestId
  });
  type ReplaceView = ReturnType<typeof startView> & { abandonedAttemptId: string };
  const dummy = (): ReplaceView => ({ ...startView(newAttempt({
    attemptId, memberId: input.memberId, paperId: parsed.paperId, paperVersionId: "", paperTitle: "", access: "free", questionCount: 0, maxScore: 0, chunkCount: 0, now: input.now
  })), abandonedAttemptId: parsed.abandonAttemptId });
  const retried = await runWithTxRetry(() =>
    input.store.transactWrite({
      memberId: input.memberId,
      attemptId,
      oldAttemptId: parsed.abandonAttemptId,
      paperId: parsed.paperId,
      idempotencyId: idemRecord.id,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, idemRecord.payloadHash, () => null);
        if (!replay.ok) return { error: { code: "IDEMPOTENCY_CONFLICT", reason: "IDEMPOTENCY_CONFLICT" }, result: dummy() };
        const replayed = replayRef<ReplaceView>(snap.idem);
        if (replay.replayed && replayed) return { result: replayed, replayed: true, idem: snap.idem };
        const memberBlocked = memberWriteBlocked(snap.member);
        if (memberBlocked) return { error: { code: memberBlocked.code, reason: memberBlocked.reason }, result: dummy() };
        if (!snap.oldAttempt || snap.oldAttempt.memberId !== input.memberId) {
          return { error: { code: "NOT_FOUND", reason: "ABANDON_ATTEMPT_NOT_FOUND" }, result: dummy() };
        }
        if (snap.oldAttempt.state !== "inProgress") {
          const closed = closedAttemptCode(snap.oldAttempt.state);
          return { error: { code: closed.code, reason: closed.reason }, result: dummy() };
        }
        if (snap.oldAttempt.draftRevision !== parsed.expectedRevision) {
          return { error: { code: "DRAFT_CONFLICT", reason: "DRAFT_CONFLICT" }, result: dummy() };
        }
        if (!snap.active || snap.active.attemptId !== parsed.abandonAttemptId) {
          return { error: { code: "ACTIVE_ATTEMPT_EXISTS", reason: "ACTIVE_MISMATCH" }, result: dummy() };
        }
        if (!snap.paper || !snap.version) return { error: { code: "NOT_FOUND", reason: "PAPER_NOT_FOUND" }, result: dummy() };
        const gate = paperNewStartGate(snap.paper.status);
        if (gate.blocked) return { error: { code: gate.code, reason: gate.reason }, result: dummy() };
        if (snap.category && (snap.category.enabled !== true || snap.category.deletedAt)) {
          return { error: { code: "CATEGORY_UNAVAILABLE", reason: "CATEGORY_UNAVAILABLE" }, result: dummy() };
        }
        const vip = paperStartDeniedByAccess(snap.paper.access, entitlement);
        if (vip.blocked) return { error: { code: vip.code, reason: vip.reason }, result: dummy() };
        const abandoned = abandonInPlace(snap.oldAttempt, input.now);
        const attempt = newAttempt({
          attemptId,
          memberId: input.memberId,
          paperId: snap.paper.paperId,
          paperVersionId: snap.version.versionId,
          paperTitle: snap.paper.title,
          access: snap.paper.access,
          questionCount: snap.version.questionCount,
          maxScore: snap.version.maxScore,
          chunkCount: snap.version.chunkIds.length,
          now: input.now
        });
        const view: ReplaceView = { ...startView(attempt), abandonedAttemptId: abandoned.attemptId };
        return {
          oldAttempt: abandoned,
          attempt,
          active: toActive(attempt),
          idem: { ...idemRecord, status: "succeeded", resultRef: view },
          result: view
        };
      }
    })
  );
  if (!retried.ok) return fail("SERVICE_BUSY", "ATTEMPT_TX_RETRY_EXHAUSTED");
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  return {
    ok: true,
    data: retried.value.mutation.result,
    replayed: retried.value.mutation.replayed === true,
    budget: retried.value.budget
  };
}

export async function getAttempt(input: {
  store: AttemptWorkStore;
  memberId: string;
  data: Record<string, unknown>;
}): Promise<AttemptActionSuccess<ReturnType<typeof toPublicAttemptView>> | AttemptActionFailure> {
  const parsed = parseAttemptIdInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "GET_INPUT_INVALID", { issues: parsed.issues });
  const attempt = await input.store.getAttempt(parsed.attemptId);
  if (!attempt || attempt.memberId !== input.memberId) return fail("NOT_FOUND", "ATTEMPT_NOT_FOUND");
  return { ok: true, data: toPublicAttemptView(attempt), budget: emptyBudget() };
}

export async function readQuestionPage(input: {
  store: AttemptWorkStore;
  memberId: string;
  data: Record<string, unknown>;
}): Promise<
  | AttemptActionSuccess<{
      attemptId: string;
      chunkNo: number;
      chunkCount: number;
      revision: number;
      items: PaperChunkRecord["items"];
      selected: Record<string, string[]>;
    }>
  | AttemptActionFailure
> {
  const parsed = parseQuestionPageInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "PAGE_INPUT_INVALID", { issues: parsed.issues });
  const attempt = await input.store.getAttempt(parsed.attemptId);
  if (!attempt || attempt.memberId !== input.memberId) return fail("NOT_FOUND", "ATTEMPT_NOT_FOUND");
  if (attempt.state !== "inProgress") {
    const closed = closedAttemptCode(attempt.state);
    return fail(closed.code, closed.reason);
  }
  if (parsed.chunkNo > attempt.chunkCount) return fail("INVALID_ARGUMENT", "CHUNK_OUT_OF_RANGE", { issues: ["chunkNo out of range"] });
  const version = await input.store.getVersion(attempt.paperVersionId);
  const chunkId = version?.chunkIds[parsed.chunkNo - 1] || paperChunkId(attempt.paperVersionId, parsed.chunkNo);
  const chunk = await input.store.getChunk(chunkId);
  if (!chunk) return fail("INTERNAL_ERROR", "CHUNK_MISSING");
  const selected: Record<string, string[]> = {};
  for (const answer of attempt.answers) {
    if (chunk.items.some((item) => item.questionId === answer.questionId)) {
      selected[answer.questionId] = [...answer.optionIds];
    }
  }
  return {
    ok: true,
    data: {
      attemptId: attempt.attemptId,
      chunkNo: parsed.chunkNo,
      chunkCount: attempt.chunkCount,
      revision: attempt.draftRevision,
      items: chunk.items.map((item) => ({
        ord: item.ord,
        questionId: item.questionId,
        questionVersionId: item.questionVersionId,
        type: item.type,
        stem: { text: item.stem.text, assetIds: [...item.stem.assetIds] },
        options: item.options.map((option) => ({ optionId: option.optionId, text: option.text, assetIds: [...option.assetIds] })),
        points: item.points
      })),
      selected
    },
    budget: emptyBudget()
  };
}

export async function saveAttempt(input: {
  store: AttemptWorkStore;
  memberId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<AttemptActionSuccess<{ attemptId: string; revision: number; savedAt: string; answeredCount: number }> | AttemptActionFailure> {
  const envelope = parseAttemptSaveEnvelope(input.data);
  if (!envelope.ok) return fail("INVALID_ARGUMENT", "SAVE_INPUT_INVALID", { issues: envelope.issues });
  const idemRecord = buildIdempotencyRecord({
    actorId: input.memberId,
    action: "attempt.save",
    idempotencyKey: input.requestId,
    payload: { attemptId: envelope.attemptId, requestId: input.requestId, answers: envelope.rawAnswers },
    requestId: input.requestId
  });
  type SaveView = { attemptId: string; revision: number; savedAt: string; answeredCount: number };
  const dummy: SaveView = { attemptId: envelope.attemptId, revision: 0, savedAt: "", answeredCount: 0 };
  const retried = await runWithTxRetry(() =>
    input.store.transactWrite({
      memberId: input.memberId,
      attemptId: envelope.attemptId,
      idempotencyId: idemRecord.id,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, idemRecord.payloadHash, () => null);
        if (!replay.ok) return { error: { code: "IDEMPOTENCY_CONFLICT", reason: "IDEMPOTENCY_CONFLICT" }, result: dummy };
        const replayed = replayRef<SaveView>(snap.idem);
        if (replay.replayed && replayed) return { result: replayed, replayed: true, idem: snap.idem };
        const memberBlocked = memberWriteBlocked(snap.member);
        if (memberBlocked) return { error: { code: memberBlocked.code, reason: memberBlocked.reason }, result: dummy };
        if (!snap.attempt || snap.attempt.memberId !== input.memberId) {
          return { error: { code: "NOT_FOUND", reason: "ATTEMPT_NOT_FOUND" }, result: dummy };
        }
        if (snap.attempt.lastSaveRequestId === input.requestId) {
          const view: SaveView = {
            attemptId: snap.attempt.attemptId,
            revision: snap.attempt.draftRevision,
            savedAt: snap.attempt.updatedAt,
            answeredCount: snap.attempt.answers.length
          };
          return { result: view, replayed: true, idem: { ...idemRecord, status: "succeeded", resultRef: view } };
        }
        if (snap.attempt.state !== "inProgress") {
          const closed = closedAttemptCode(snap.attempt.state);
          return { error: { code: closed.code, reason: closed.reason }, result: dummy };
        }
        if (snap.attempt.draftRevision !== envelope.expectedRevision) {
          return {
            error: {
              code: "DRAFT_CONFLICT",
              reason: "DRAFT_CONFLICT",
              details: { serverRevision: snap.attempt.draftRevision }
            },
            result: dummy
          };
        }
        const allowed = snap.version?.questionIds || [];
        if (!allowed.length) {
          return { error: { code: "INTERNAL_ERROR", reason: "PAPER_VERSION_MISSING" }, result: dummy };
        }
        const answers = normalizeAttemptAnswers(envelope.rawAnswers, allowed);
        if (!answers.ok) {
          return { error: { code: "INVALID_ARGUMENT", reason: "ANSWERS_INVALID", issues: answers.issues }, result: dummy };
        }
        const next: AttemptRecord = {
          ...snap.attempt,
          answers: answers.answers,
          draftRevision: snap.attempt.draftRevision + 1,
          lastSaveRequestId: input.requestId,
          updatedAt: input.now.toISOString()
        };
        const view: SaveView = {
          attemptId: next.attemptId,
          revision: next.draftRevision,
          savedAt: next.updatedAt,
          answeredCount: next.answers.length
        };
        return {
          attempt: next,
          active: toActive(next),
          idem: { ...idemRecord, status: "succeeded", resultRef: view },
          result: view
        };
      }
    })
  );
  if (!retried.ok) return fail("SERVICE_BUSY", "ATTEMPT_TX_RETRY_EXHAUSTED");
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  return {
    ok: true,
    data: retried.value.mutation.result,
    replayed: retried.value.mutation.replayed === true,
    budget: retried.value.budget
  };
}

export async function abandonAttempt(input: {
  store: AttemptWorkStore;
  memberId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<AttemptActionSuccess<{ attemptId: string; state: "abandoned"; revision: number }> | AttemptActionFailure> {
  const parsed = parseAttemptAbandonInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "ABANDON_INPUT_INVALID", { issues: parsed.issues });
  const idemRecord = buildIdempotencyRecord({
    actorId: input.memberId,
    action: "attempt.abandon",
    idempotencyKey: input.idempotencyKey,
    payload: { attemptId: parsed.attemptId, expectedRevision: parsed.expectedRevision, confirmed: true },
    requestId: input.requestId
  });
  type AbandonView = { attemptId: string; state: "abandoned"; revision: number };
  const dummy: AbandonView = { attemptId: parsed.attemptId, state: "abandoned", revision: parsed.expectedRevision };
  const retried = await runWithTxRetry(() =>
    input.store.transactWrite({
      memberId: input.memberId,
      attemptId: parsed.attemptId,
      idempotencyId: idemRecord.id,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, idemRecord.payloadHash, () => null);
        if (!replay.ok) return { error: { code: "IDEMPOTENCY_CONFLICT", reason: "IDEMPOTENCY_CONFLICT" }, result: dummy };
        const replayed = replayRef<AbandonView>(snap.idem);
        if (replay.replayed && replayed) return { result: replayed, replayed: true, idem: snap.idem };
        const memberBlocked = memberWriteBlocked(snap.member);
        if (memberBlocked) return { error: { code: memberBlocked.code, reason: memberBlocked.reason }, result: dummy };
        if (!snap.attempt || snap.attempt.memberId !== input.memberId) {
          return { error: { code: "NOT_FOUND", reason: "ATTEMPT_NOT_FOUND" }, result: dummy };
        }
        if (snap.attempt.state === "abandoned") {
          const view: AbandonView = { attemptId: snap.attempt.attemptId, state: "abandoned", revision: snap.attempt.draftRevision };
          return { result: view, replayed: true };
        }
        if (snap.attempt.state !== "inProgress") {
          const closed = closedAttemptCode(snap.attempt.state);
          return { error: { code: closed.code, reason: closed.reason }, result: dummy };
        }
        if (snap.attempt.draftRevision !== parsed.expectedRevision) {
          return { error: { code: "DRAFT_CONFLICT", reason: "DRAFT_CONFLICT" }, result: dummy };
        }
        const next = abandonInPlace(snap.attempt, input.now);
        const view: AbandonView = { attemptId: next.attemptId, state: "abandoned", revision: next.draftRevision };
        return {
          attempt: next,
          active: null,
          idem: { ...idemRecord, status: "succeeded", resultRef: view },
          result: view
        };
      }
    })
  );
  if (!retried.ok) return fail("SERVICE_BUSY", "ATTEMPT_TX_RETRY_EXHAUSTED");
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  return {
    ok: true,
    data: retried.value.mutation.result,
    replayed: retried.value.mutation.replayed === true,
    budget: retried.value.budget
  };
}

function submitView(input: SubmitResultData): SubmitResultData {
  return { ...input };
}

function emptyStats(memberId: string, now: Date): MemberStatsRecord {
  const at = now.toISOString();
  return {
    memberId,
    totalScore: 0,
    scoreSeq: 0,
    levelId: DEFAULT_LEVEL_ID,
    growthVersion: 0,
    revision: 1,
    schemaVersion: 1,
    createdAt: at,
    updatedAt: at
  };
}

function metricOf(
  list: ScoreMetricRecord[],
  id: string
): ScoreMetricRecord | undefined {
  return list.find((row) => row.metricId === id);
}

function upsertMetric(input: {
  previous?: ScoreMetricRecord;
  metricId: string;
  memberId: string;
  scope: ScoreMetricRecord["scope"];
  periodKey: string;
  categoryId: string;
  delta: number;
  nowIso: string;
}): ScoreMetricRecord {
  const next = applyScoreMetric(input.previous, input.delta, input.nowIso);
  return {
    metricId: input.metricId,
    metricGeneration: METRIC_GENERATION_BASE,
    scope: input.scope,
    periodKey: input.periodKey,
    categoryId: input.categoryId,
    memberId: input.memberId,
    value: next.value,
    reachedAt: next.reachedAt,
    revision: (input.previous?.revision ?? 0) + 1,
    schemaVersion: 1,
    updatedAt: input.nowIso
  };
}

async function loadGradeQuestions(
  store: AttemptWorkStore,
  version: { chunkIds: string[]; answerChunkIds: string[] }
): Promise<{ ok: true; questions: GradeableQuestion[] } | { ok: false; reason: string }> {
  const questions: GradeableQuestion[] = [];
  const count = Math.max(version.chunkIds.length, version.answerChunkIds.length);
  for (let index = 0; index < count; index += 1) {
    const chunkId = version.chunkIds[index];
    const answerId = version.answerChunkIds[index];
    const chunk = chunkId ? await store.getChunk(chunkId) : undefined;
    const answer = answerId ? await store.getAnswer(answerId) : undefined;
    if (!chunk || !answer) return { ok: false, reason: "ANSWER_CHUNK_MISSING" };
    const answersById = new Map(answer.items.map((item) => [item.questionId, item]));
    for (const item of chunk.items) {
      const key = answersById.get(item.questionId);
      if (!key) return { ok: false, reason: "ANSWER_ITEM_MISSING" };
      questions.push({
        questionId: item.questionId,
        points: item.points,
        optionIds: item.options.map((option) => option.optionId),
        correctOptionIds: [...key.answer.optionIds],
        analysis: key.analysis.text
      });
    }
  }
  return { ok: true, questions };
}

export async function submitAttempt(input: {
  store: AttemptWorkStore;
  memberId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
  maintenance?: MaintenanceConfig;
  entitlement?: PracticeEntitlementReader;
  readMaintenance?: () => Promise<MaintenanceConfig | undefined>;
  growth?: GrowthConfigRecord;
  readGrowth?: () => Promise<GrowthConfigRecord | undefined>;
}): Promise<AttemptActionSuccess<SubmitResultData> | AttemptActionFailure> {
  const envelope = parseAttemptSubmitEnvelope(input.data);
  if (!envelope.ok) return fail("INVALID_ARGUMENT", "SUBMIT_INPUT_INVALID", { issues: envelope.issues });
  const attempt = await input.store.getAttempt(envelope.attemptId);
  if (!attempt || attempt.memberId !== input.memberId) return fail("NOT_FOUND", "ATTEMPT_NOT_FOUND");
  const version = await input.store.getVersion(attempt.paperVersionId);
  if (!version) return fail("INTERNAL_ERROR", "PAPER_VERSION_MISSING");
  const loaded = await loadGradeQuestions(input.store, version);
  if (!loaded.ok) return fail("INTERNAL_ERROR", loaded.reason);
  const validated = validateSubmitAnswers(envelope.rawAnswers, loaded.questions);
  if (!validated.ok) return fail("INVALID_ARGUMENT", "ANSWERS_INVALID", { issues: validated.issues });
  if (validated.unansweredIds.length && envelope.confirmUnanswered !== true) {
    return fail("UNANSWERED_CONFIRM_REQUIRED", "UNANSWERED_CONFIRM_REQUIRED", {
      details: { unansweredCount: validated.unansweredIds.length, unansweredIds: validated.unansweredIds }
    });
  }
  const graded = gradeSelectedAnswers(validated.answers, loaded.questions);
  const submitHash = attemptSubmitHash(validated.answers);
  const entitlement = await (input.entitlement || isolatedEntitlementReader()).evaluate(input.memberId, input.now);
  const idemRecord = buildIdempotencyRecord({
    actorId: input.memberId,
    action: "attempt.submit",
    idempotencyKey: input.idempotencyKey,
    payload: {
      attemptId: envelope.attemptId,
      expectedRevision: envelope.expectedRevision,
      answers: validated.answers,
      confirmUnanswered: envelope.confirmUnanswered
    },
    requestId: input.requestId
  });
  const dummy = submitView({
    attemptId: envelope.attemptId,
    score: 0,
    maxScore: attempt.maxScore,
    correctCount: 0,
    questionCount: attempt.questionCount,
    bestScore: 0,
    delta: 0,
    totalScore: 0,
    levelId: DEFAULT_LEVEL_ID,
    gradeRevision: 1,
    submittedAt: ""
  });
  const retried = await runWithTxRetry(async () => {
    const maintenance = input.readMaintenance ? await input.readMaintenance() : input.maintenance;
    const growth = input.readGrowth ? await input.readGrowth() : input.growth;
    const levels = growth && growth.levels.length ? growth.levels : DEFAULT_GROWTH_LEVELS;
    const growthConfigVersion = growth?.configVersion ?? 0;
    const medalGrantIds = growthGrantIdsFor(input.memberId, levels);
    const paper = await input.store.getPaper(attempt.paperId);
    const category = paper ? await input.store.getCategory(paper.categoryId) : undefined;
    const categoryIds = categoryMetricIdsOf(paper?.categoryId || "", category?.ancestorIds || []);
    const weekKey = weekKeyShanghai(input.now);
    const monthKey = monthKeyShanghai(input.now);
    const metricSpecs = [
      { scope: "total" as const, periodKey: "all", categoryId: "" },
      { scope: "week" as const, periodKey: weekKey, categoryId: "" },
      { scope: "month" as const, periodKey: monthKey, categoryId: "" },
      ...categoryIds.map((categoryId) => ({ scope: "category" as const, periodKey: "all", categoryId }))
    ];
    const metricIds = metricSpecs.map((spec) =>
      scoreMetricId({
        metricGeneration: METRIC_GENERATION_BASE,
        scope: spec.scope,
        periodKey: spec.periodKey,
        categoryId: spec.categoryId,
        memberId: input.memberId
      })
    );
    return input.store.transactSubmit({
      memberId: input.memberId,
      attemptId: envelope.attemptId,
      paperId: attempt.paperId,
      idempotencyId: idemRecord.id,
      bestId: paperBestId(input.memberId, attempt.paperId),
      metricIds,
      medalGrantIds,
      mutate: (snap) => {
        const replay = replayOrConflict(snap.idem, idemRecord.payloadHash, () => null);
        if (!replay.ok) return { error: { code: "IDEMPOTENCY_CONFLICT", reason: "IDEMPOTENCY_CONFLICT" }, result: dummy };
        const replayed = replayRef<SubmitResultData>(snap.idem);
        if (replay.replayed && replayed) return { result: replayed, replayed: true, idem: snap.idem };
        if (!snap.attempt || snap.attempt.memberId !== input.memberId) {
          return { error: { code: "NOT_FOUND", reason: "ATTEMPT_NOT_FOUND" }, result: dummy };
        }
        if (snap.attempt.state === "submitted") {
          if (snap.attempt.submitHash === submitHash) {
            const view = submitView({
              attemptId: snap.attempt.attemptId,
              score: snap.attempt.score ?? graded.score,
              maxScore: snap.attempt.maxScore,
              correctCount: graded.correctCount,
              questionCount: snap.attempt.questionCount,
              bestScore: snap.best?.bestScore ?? snap.attempt.score ?? graded.score,
              delta: 0,
              totalScore: snap.stats?.totalScore ?? 0,
              levelId: snap.stats?.levelId ?? DEFAULT_LEVEL_ID,
              gradeRevision: snap.attempt.gradeRevision ?? 1,
              submittedAt: snap.attempt.submittedAt
            });
            return { result: view, replayed: true, idem: { ...idemRecord, status: "succeeded", resultRef: view } };
          }
          return { error: { code: "ALREADY_SUBMITTED", reason: "ATTEMPT_ALREADY_SUBMITTED" }, result: dummy };
        }
        const closedMaint = submitBlocked(snap.maintenance || maintenance);
        if (closedMaint) return { error: { code: closedMaint.code, reason: closedMaint.reason, details: closedMaint.details }, result: dummy };
        const memberBlocked = memberWriteBlocked(snap.member);
        if (memberBlocked) return { error: { code: memberBlocked.code, reason: memberBlocked.reason }, result: dummy };
        if (snap.attempt.state !== "inProgress") {
          const closed = closedAttemptCode(snap.attempt.state);
          return { error: { code: closed.code, reason: closed.reason }, result: dummy };
        }
        if (snap.attempt.draftRevision !== envelope.expectedRevision) {
          return {
            error: { code: "DRAFT_CONFLICT", reason: "DRAFT_CONFLICT", details: { serverRevision: snap.attempt.draftRevision } },
            result: dummy
          };
        }
        if (!snap.paper || !snap.version) return { error: { code: "NOT_FOUND", reason: "PAPER_NOT_FOUND" }, result: dummy };
        const gate = paperNewStartGate(snap.paper.status);
        if (gate.blocked) return { error: { code: gate.code, reason: gate.reason }, result: dummy };
        if (snap.category && (snap.category.enabled !== true || snap.category.deletedAt)) {
          return { error: { code: "CATEGORY_UNAVAILABLE", reason: "CATEGORY_UNAVAILABLE" }, result: dummy };
        }
        const vip = paperStartDeniedByAccess(snap.paper.access, entitlement);
        if (vip.blocked) return { error: { code: vip.code, reason: vip.reason }, result: dummy };
        const submittedAt = input.now.toISOString();
        const oldBest = snap.best?.bestScore ?? 0;
        const newBest = Math.max(oldBest, graded.score);
        const delta = paperDelta(oldBest, graded.score);
        const gradeRevision = 1;
        const nextAttempt: AttemptRecord = {
          ...snap.attempt,
          answers: validated.answers,
          state: "submitted",
          submittedAt,
          updatedAt: submittedAt,
          score: graded.score,
          gradeRevision,
          submitHash
        };
        const stats = snap.stats ? { ...snap.stats } : emptyStats(input.memberId, input.now);
        const totalScore = stats.totalScore + delta;
        const nextLevelId = levelIdForScore(totalScore, levels);
        const nextStats: MemberStatsRecord = {
          ...stats,
          totalScore,
          scoreSeq: stats.scoreSeq + 1,
          levelId: nextLevelId,
          growthVersion: growthConfigVersion,
          revision: stats.revision + 1,
          updatedAt: submittedAt
        };
        // 跨级补齐：一次交卷跨过多级时补发经过等级的勋章；已授予的不重复写。
        const backfilledGrants = planMedalGrants({
          memberId: input.memberId,
          totalScore,
          levels,
          existingMedalIds: snap.grants.map((grant) => grant.medalId),
          sourceType: MEDAL_GRANT_SOURCE_SUBMIT,
          sourceId: nextAttempt.attemptId,
          configVersion: growthConfigVersion,
          nowIso: submittedAt
        });
        const nextBest: PaperBestRecord = {
          memberId: input.memberId,
          paperId: snap.attempt.paperId,
          bestScore: newBest,
          bestAttemptId: newBest > oldBest || !snap.best ? nextAttempt.attemptId : snap.best.bestAttemptId,
          firstReachedAt: delta === 0 && snap.best ? snap.best.firstReachedAt : submittedAt,
          revision: (snap.best?.revision ?? 0) + 1,
          schemaVersion: 1,
          createdAt: snap.best?.createdAt || submittedAt,
          updatedAt: submittedAt
        };
        const event: ScoreEventRecord = {
          eventId: scoreEventId(nextAttempt.attemptId, gradeRevision),
          attemptId: nextAttempt.attemptId,
          gradeRevision,
          memberId: input.memberId,
          paperId: nextAttempt.paperId,
          scoreSeq: nextStats.scoreSeq,
          score: graded.score,
          delta,
          submittedAt,
          weekKey,
          monthKey,
          kind: SCORE_EVENT_KIND_SUBMIT,
          schemaVersion: 1,
          createdAt: submittedAt
        };
        const nextMetrics = metricSpecs.map((spec, index) =>
          upsertMetric({
            previous: metricOf(snap.metrics, metricIds[index]!),
            metricId: metricIds[index]!,
            memberId: input.memberId,
            scope: spec.scope,
            periodKey: spec.periodKey,
            categoryId: spec.categoryId,
            delta,
            nowIso: submittedAt
          })
        );
        const view = submitView({
          attemptId: nextAttempt.attemptId,
          score: graded.score,
          maxScore: nextAttempt.maxScore,
          correctCount: graded.correctCount,
          questionCount: nextAttempt.questionCount,
          bestScore: newBest,
          delta,
          totalScore,
          levelId: nextStats.levelId,
          gradeRevision,
          submittedAt
        });
        const mutation: SubmitWriteMutation<SubmitResultData> = {
          attempt: nextAttempt,
          active: snap.active?.attemptId === nextAttempt.attemptId ? null : snap.active,
          stats: nextStats,
          best: nextBest,
          event,
          metrics: nextMetrics,
          ...(backfilledGrants.length ? { grants: backfilledGrants } : {}),
          idem: { ...idemRecord, status: "succeeded", resultRef: view },
          result: view
        };
        return mutation;
      }
    });
  });
  if (!retried.ok) return fail("SERVICE_BUSY", "ATTEMPT_TX_RETRY_EXHAUSTED");
  if (retried.value.mutation.error) {
    const err = retried.value.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  return {
    ok: true,
    data: retried.value.mutation.result,
    replayed: retried.value.mutation.replayed === true,
    budget: retried.value.budget
  };
}

export async function readAttemptResult(input: {
  store: AttemptWorkStore;
  memberId: string;
  data: Record<string, unknown>;
}): Promise<
  | AttemptActionSuccess<
      | { status: "inProgress"; attemptId: string }
      | ({ status: "ready" } & SubmitResultData)
    >
  | AttemptActionFailure
> {
  const parsed = parseAttemptIdInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "RESULT_INPUT_INVALID", { issues: parsed.issues });
  const attempt = await input.store.getAttempt(parsed.attemptId);
  if (!attempt || attempt.memberId !== input.memberId) return fail("NOT_FOUND", "ATTEMPT_NOT_FOUND");
  if (attempt.state === "inProgress") {
    return { ok: true, data: { status: "inProgress", attemptId: attempt.attemptId }, budget: emptyBudget() };
  }
  if (attempt.state !== "submitted") return fail("NOT_FOUND", "ATTEMPT_NOT_SUBMITTED");
  const version = await input.store.getVersion(attempt.paperVersionId);
  const loaded = version ? await loadGradeQuestions(input.store, version) : { ok: false as const, reason: "PAPER_VERSION_MISSING" };
  const graded = loaded.ok ? gradeSelectedAnswers(attempt.answers, loaded.questions) : undefined;
  const [best, memberStats] = await Promise.all([
    input.store.getBest(input.memberId, attempt.paperId),
    input.store.getStats(input.memberId)
  ]);
  return {
    ok: true,
    data: {
      status: "ready",
      attemptId: attempt.attemptId,
      score: attempt.score ?? graded?.score ?? 0,
      maxScore: attempt.maxScore,
      correctCount: graded?.correctCount ?? 0,
      questionCount: attempt.questionCount,
      bestScore: best?.bestScore ?? attempt.score ?? 0,
      delta: 0,
      totalScore: memberStats?.totalScore ?? 0,
      levelId: memberStats?.levelId ?? DEFAULT_LEVEL_ID,
      gradeRevision: attempt.gradeRevision ?? 1,
      submittedAt: attempt.submittedAt
    },
    budget: emptyBudget()
  };
}

export async function readAttemptAnalysis(input: {
  store: AttemptWorkStore;
  memberId: string;
  data: Record<string, unknown>;
}): Promise<
  | AttemptActionSuccess<{
      attemptId: string;
      chunkNo: number;
      chunkCount: number;
      items: Array<{
        questionId: string;
        selectedOptionIds: string[];
        correctOptionIds: string[];
        score: number;
        analysis: string;
      }>;
    }>
  | AttemptActionFailure
> {
  const parsed = parseAttemptAnalysisInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "ANALYSIS_INPUT_INVALID", { issues: parsed.issues });
  const attempt = await input.store.getAttempt(parsed.attemptId);
  if (!attempt || attempt.memberId !== input.memberId) return fail("NOT_FOUND", "ATTEMPT_NOT_FOUND");
  if (attempt.state !== "submitted") return fail("NOT_FOUND", "ATTEMPT_NOT_SUBMITTED");
  if (parsed.chunkNo > attempt.chunkCount) return fail("INVALID_ARGUMENT", "CHUNK_OUT_OF_RANGE", { issues: ["chunkNo out of range"] });
  const version = await input.store.getVersion(attempt.paperVersionId);
  const chunkId = version?.chunkIds[parsed.chunkNo - 1] || paperChunkId(attempt.paperVersionId, parsed.chunkNo);
  const answerId = version?.answerChunkIds[parsed.chunkNo - 1];
  const chunk = await input.store.getChunk(chunkId);
  const answer = answerId ? await input.store.getAnswer(answerId) : undefined;
  if (!chunk || !answer) return fail("INTERNAL_ERROR", "ANALYSIS_CHUNK_MISSING");
  const selected = new Map(attempt.answers.map((row) => [row.questionId, row.optionIds]));
  const keys = new Map(answer.items.map((item) => [item.questionId, item]));
  const items = chunk.items.map((item) => {
    const key = keys.get(item.questionId);
    const picked = selected.get(item.questionId) || [];
    const correct = key?.answer.optionIds || [];
    const score = gradeSelectedAnswers([{ questionId: item.questionId, optionIds: picked }], [
      {
        questionId: item.questionId,
        points: item.points,
        optionIds: item.options.map((option) => option.optionId),
        correctOptionIds: correct,
        analysis: key?.analysis.text || ""
      }
    ]).items[0];
    return {
      questionId: item.questionId,
      selectedOptionIds: [...picked],
      correctOptionIds: [...correct],
      score: score?.score ?? 0,
      analysis: key?.analysis.text || ""
    };
  }).filter((item) => (parsed.wrongOnly ? item.score === 0 : true));
  return {
    ok: true,
    data: {
      attemptId: attempt.attemptId,
      chunkNo: parsed.chunkNo,
      chunkCount: attempt.chunkCount,
      items
    },
    budget: emptyBudget()
  };
}

export async function listAttemptHistory(input: {
  store: AttemptWorkStore;
  memberId: string;
  data: Record<string, unknown>;
}): Promise<
  | AttemptActionSuccess<{
      items: Array<{
        attemptId: string;
        paperId: string;
        paperTitle: string;
        score: number;
        maxScore: number;
        submittedAt: string;
      }>;
      nextCursor: string | null;
    }>
  | AttemptActionFailure
> {
  const parsed = parseAttemptHistoryInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "HISTORY_INPUT_INVALID", { issues: parsed.issues });
  const after = parsed.cursor ? parseHistoryCursor(parsed.cursor) : undefined;
  if (parsed.cursor && !after) return fail("INVALID_ARGUMENT", "CURSOR_INVALID", { issues: ["cursor invalid"] });
  const rows = await input.store.listSubmittedAttempts({
    memberId: input.memberId,
    paperId: parsed.paperId,
    after,
    limit: parsed.limit + 1
  });
  const page = rows.slice(0, parsed.limit);
  const last = page[page.length - 1];
  return {
    ok: true,
    data: {
      items: page.map((row) => ({
        attemptId: row.attemptId,
        paperId: row.paperId,
        paperTitle: row.paperTitle,
        score: row.score ?? 0,
        maxScore: row.maxScore,
        submittedAt: row.submittedAt
      })),
      nextCursor: rows.length > parsed.limit && last ? encodeHistoryCursor(last.submittedAt, last.attemptId) : null
    },
    budget: emptyBudget()
  };
}

export type { AttemptWriteMutation, PaperAnswerRecord };
