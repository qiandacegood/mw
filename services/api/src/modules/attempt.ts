import {
  ATTEMPT_SCHEMA_VERSION,
  attemptIdFor,
  buildIdempotencyRecord,
  checkMaintenanceGate,
  defaultMaintenanceConfig,
  draftSummaryOf,
  emptyDraftSummary,
  normalizeAttemptAnswers,
  paperChunkId,
  paperNewStartGate,
  paperStartDeniedByAccess,
  parseAttemptAbandonInput,
  parseAttemptIdInput,
  parseAttemptReplaceInput,
  parseAttemptSaveEnvelope,
  parseAttemptStartInput,
  parseQuestionPageInput,
  replayOrConflict,
  toPublicAttemptView,
  type ActiveAttemptRecord,
  type AttemptDraftSummary,
  type AttemptRecord,
  type IdempotencyRecord,
  type MaintenanceConfig,
  type PaperChunkRecord,
  isolatedEntitlementReader,
  type PracticeEntitlementReader
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { AttemptWorkStore, AttemptWriteMutation } from "./attempt-stores.js";

export const ATTEMPT_TX_MAX_ATTEMPTS = 3;
export const ATTEMPT_WRITE_ACTIONS = ["attempt.start", "attempt.startReplacing", "attempt.save", "attempt.abandon"] as const;
export const ATTEMPT_READ_ACTIONS = ["attempt.get", "attempt.questionPage"] as const;

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

export type { AttemptWriteMutation };
