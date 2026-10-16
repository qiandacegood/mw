import { hashNamedFields } from "./canonical.js";
import { drainReady } from "./category-change.js";
import { rejectUnknownKeys } from "./validate.js";
import {
  METRIC_GENERATION_BASE,
  SCORE_EVENT_KIND_CORRECTION,
  SCORE_EVENT_KIND_SUBMIT,
  applyBestSequence,
  scoreEventId,
  type ScoreEventKind,
  type ScoreMetricRecord
} from "./scoring.js";
import type { PaperChunkRecord } from "./paper.js";
import type { PaperVersionRecord } from "./paper.js";

/** 与类目迁移相同的排空约定：关闭交卷成功后再等 35 秒。 */
export const CORRECTION_DRAIN_MS = 35_000;
export const CORRECTION_PREVIEW_TTL_MS = 10 * 60 * 1000;
export const CORRECTION_JOB_TYPE = "grade.correction";
export const CORRECTION_PREVIEW_COLLECTION = "correction_previews";
export const CORRECTION_WORK_COLLECTION = "correction_jobs";
export const CORRECTION_RESULT_NOTE = "本记录已因题目纠错修正";
export const CORRECTION_REASON_MIN = 1;
export const CORRECTION_REASON_MAX = 200;

export const CORRECTION_PREVIEW_FIELDS = ["paperId", "fromVersionId", "toVersionId"] as const;
export const CORRECTION_COMMIT_FIELDS = ["previewId", "planHash", "reason", "confirmed"] as const;
export const CORRECTION_STATUS_FIELDS = ["jobId"] as const;

export type CorrectionStage = "drain" | "regrade" | "open" | "ranking" | "done";

export type CorrectionCursor = {
  done: number;
  total: number;
  stage: CorrectionStage;
  offset: number;
  lastMemberId?: string;
};

export type PaperStructureFingerprint = {
  questionCount: number;
  maxScore: number;
  questions: Array<{ questionId: string; points: number; optionIds: string[] }>;
};

export type CorrectionPlan = {
  paperId: string;
  fromVersionId: string;
  toVersionId: string;
  fromStructureHash: string;
  toStructureHash: string;
  affectedAttemptCount: number;
  affectedMemberCount: number;
  warnings: string[];
};

export type CorrectionPreviewRecord = {
  previewId: string;
  planHash: string;
  actorId: string;
  paperId: string;
  fromVersionId: string;
  toVersionId: string;
  plan: CorrectionPlan;
  expiresAt: string;
  createdAt: string;
  consumedAt: string | null;
};

export type RegradeAttemptInput = {
  attemptId: string;
  memberId: string;
  paperId: string;
  scoreSeq: number;
  gradeRevision: number;
  newScore: number;
  submittedAt: string;
  weekKey: string;
  monthKey: string;
  originalSubmitDelta: number;
  priorCorrectionDeltas: number[];
  alreadyProcessed: boolean;
  correctionIds: string[];
};

export type RegradeItem = {
  attemptId: string;
  memberId: string;
  paperId: string;
  scoreSeq: number;
  newScore: number;
  newDelta: number;
  appliedDelta: number;
  compensationDelta: number;
  submittedAt: string;
  weekKey: string;
  monthKey: string;
  nextGradeRevision: number;
  skip: boolean;
};

export type MemberPaperReplay = {
  memberId: string;
  paperId: string;
  newScores: number[];
  newDeltas: number[];
  newBest: number;
  oldBest: number;
  totalDelta: number;
  alreadyProcessed: boolean;
  items: RegradeItem[];
};

export function correctionDrainUntil(closedAt: Date): Date {
  return new Date(closedAt.getTime() + CORRECTION_DRAIN_MS);
}

export { drainReady };

export function emptyCorrectionCursor(): CorrectionCursor {
  return { done: 0, total: 4, stage: "drain", offset: 0 };
}

export function correctionPreviewId(actorId: string, idempotencyKey: string): string {
  return hashNamedFields(
    { kind: "correction.preview", actorId, idempotencyKey },
    ["kind", "actorId", "idempotencyKey"]
  );
}

export function correctionJobId(paperId: string, planHash: string): string {
  return hashNamedFields({ kind: CORRECTION_JOB_TYPE, paperId, planHash }, ["kind", "paperId", "planHash"]);
}

export function paperStructureOf(
  version: Pick<PaperVersionRecord, "questionCount" | "maxScore" | "questionIds">,
  chunks: readonly PaperChunkRecord[]
): PaperStructureFingerprint {
  const byQuestion = new Map<string, { points: number; optionIds: string[] }>();
  for (const chunk of chunks) {
    for (const item of chunk.items) {
      byQuestion.set(item.questionId, {
        points: item.points,
        optionIds: item.options.map((option) => option.optionId)
      });
    }
  }
  return {
    questionCount: version.questionCount,
    maxScore: version.maxScore,
    questions: version.questionIds.map((questionId) => {
      const row = byQuestion.get(questionId);
      return {
        questionId,
        points: row?.points ?? 0,
        optionIds: [...(row?.optionIds || [])]
      };
    })
  };
}

export function paperStructureHash(fingerprint: PaperStructureFingerprint): string {
  return hashNamedFields(
    {
      questionCount: fingerprint.questionCount,
      maxScore: fingerprint.maxScore,
      questions: fingerprint.questions
    },
    ["questionCount", "maxScore", "questions"]
  );
}

export function paperStructureEqual(left: PaperStructureFingerprint, right: PaperStructureFingerprint): boolean {
  return paperStructureHash(left) === paperStructureHash(right);
}

export function correctionPlanHash(plan: CorrectionPlan): string {
  return hashNamedFields(
    {
      paperId: plan.paperId,
      fromVersionId: plan.fromVersionId,
      toVersionId: plan.toVersionId,
      fromStructureHash: plan.fromStructureHash,
      toStructureHash: plan.toStructureHash
    },
    ["paperId", "fromVersionId", "toVersionId", "fromStructureHash", "toStructureHash"]
  );
}

export function parseCorrectionPreviewInput(data: Record<string, unknown>):
  | { ok: true; paperId: string; fromVersionId: string; toVersionId: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...CORRECTION_PREVIEW_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (typeof data.paperId !== "string" || !data.paperId.trim()) issues.push("paperId required");
  if (typeof data.fromVersionId !== "string" || !data.fromVersionId.trim()) issues.push("fromVersionId required");
  if (typeof data.toVersionId !== "string" || !data.toVersionId.trim()) issues.push("toVersionId required");
  if (
    typeof data.fromVersionId === "string" &&
    typeof data.toVersionId === "string" &&
    data.fromVersionId.trim() === data.toVersionId.trim()
  ) {
    issues.push("fromVersionId and toVersionId must differ");
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    paperId: String(data.paperId).trim(),
    fromVersionId: String(data.fromVersionId).trim(),
    toVersionId: String(data.toVersionId).trim()
  };
}

export function parseCorrectionCommitInput(data: Record<string, unknown>):
  | { ok: true; previewId: string; planHash: string; reason: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...CORRECTION_COMMIT_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (typeof data.previewId !== "string" || !data.previewId.trim()) issues.push("previewId required");
  if (typeof data.planHash !== "string" || !data.planHash.trim()) issues.push("planHash required");
  if (typeof data.reason !== "string" || !data.reason.trim()) issues.push("reason required");
  const reason = typeof data.reason === "string" ? data.reason.trim() : "";
  if (reason.length < CORRECTION_REASON_MIN || reason.length > CORRECTION_REASON_MAX) {
    issues.push("reason length invalid");
  }
  if (data.confirmed !== true) issues.push("confirmed must be true");
  if (issues.length) return { ok: false, issues };
  return { ok: true, previewId: String(data.previewId).trim(), planHash: String(data.planHash).trim(), reason };
}

export function parseCorrectionStatusInput(data: Record<string, unknown>):
  | { ok: true; jobId: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...CORRECTION_STATUS_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const jobId = typeof data.jobId === "string" ? data.jobId.trim() : "";
  if (issues.length) return { ok: false, issues };
  return { ok: true, jobId };
}

export function appliedDeltaOf(attempt: Pick<RegradeAttemptInput, "originalSubmitDelta" | "priorCorrectionDeltas">): number {
  return attempt.originalSubmitDelta + attempt.priorCorrectionDeltas.reduce((sum, delta) => sum + delta, 0);
}

/**
 * 按 scoreSeq 重放新分数，计算应对原周期入账的补偿分差。
 * 相同纠错任务已处理的会员整单跳过，避免二次补分。
 */
export function replayMemberPaper(
  attempts: RegradeAttemptInput[],
  correctionId: string
): MemberPaperReplay {
  const ordered = [...attempts].sort((left, right) => {
    if (left.scoreSeq !== right.scoreSeq) return left.scoreSeq - right.scoreSeq;
    return left.attemptId.localeCompare(right.attemptId);
  });
  const memberId = ordered[0]?.memberId || "";
  const paperId = ordered[0]?.paperId || "";
  const alreadyProcessed = ordered.some((row) => row.alreadyProcessed || row.correctionIds.includes(correctionId));
  const newScores = ordered.map((row) => row.newScore);
  const sequenced = applyBestSequence(newScores);
  const items: RegradeItem[] = ordered.map((row, index) => {
    const appliedDelta = appliedDeltaOf(row);
    const newDelta = sequenced.deltas[index] ?? 0;
    return {
      attemptId: row.attemptId,
      memberId: row.memberId,
      paperId: row.paperId,
      scoreSeq: row.scoreSeq,
      newScore: row.newScore,
      newDelta,
      appliedDelta,
      compensationDelta: alreadyProcessed ? 0 : newDelta - appliedDelta,
      submittedAt: row.submittedAt,
      weekKey: row.weekKey,
      monthKey: row.monthKey,
      nextGradeRevision: row.gradeRevision + 1,
      skip: alreadyProcessed
    };
  });
  const oldBest = items.reduce((sum, item) => sum + item.appliedDelta, 0);
  return {
    memberId,
    paperId,
    newScores,
    newDeltas: sequenced.deltas,
    newBest: sequenced.best,
    oldBest,
    totalDelta: alreadyProcessed ? 0 : sequenced.best - oldBest,
    alreadyProcessed,
    items
  };
}

export function compensationEventOf(input: {
  item: RegradeItem;
  correctionId: string;
  sourceEventId: string;
  createdAt: string;
}): {
  eventId: string;
  attemptId: string;
  gradeRevision: number;
  memberId: string;
  paperId: string;
  scoreSeq: number;
  score: number;
  delta: number;
  submittedAt: string;
  weekKey: string;
  monthKey: string;
  kind: ScoreEventKind;
  sourceEventId: string;
  correctionId: string;
  schemaVersion: number;
  createdAt: string;
} {
  return {
    eventId: scoreEventId(input.item.attemptId, input.item.nextGradeRevision),
    attemptId: input.item.attemptId,
    gradeRevision: input.item.nextGradeRevision,
    memberId: input.item.memberId,
    paperId: input.item.paperId,
    scoreSeq: input.item.scoreSeq,
    score: input.item.newScore,
    delta: input.item.compensationDelta,
    submittedAt: input.item.submittedAt,
    weekKey: input.item.weekKey,
    monthKey: input.item.monthKey,
    kind: SCORE_EVENT_KIND_CORRECTION,
    sourceEventId: input.sourceEventId,
    correctionId: input.correctionId,
    schemaVersion: 1,
    createdAt: input.createdAt
  };
}

export function periodDeltasFromReplay(replay: MemberPaperReplay): Array<{
  scope: "week" | "month";
  periodKey: string;
  delta: number;
}> {
  const week = new Map<string, number>();
  const month = new Map<string, number>();
  for (const item of replay.items) {
    if (item.skip || item.compensationDelta === 0) continue;
    week.set(item.weekKey, (week.get(item.weekKey) || 0) + item.compensationDelta);
    month.set(item.monthKey, (month.get(item.monthKey) || 0) + item.compensationDelta);
  }
  return [
    ...[...week.entries()].map(([periodKey, delta]) => ({ scope: "week" as const, periodKey, delta })),
    ...[...month.entries()].map(([periodKey, delta]) => ({ scope: "month" as const, periodKey, delta }))
  ];
}

/** 缺失指标不补记：没有现有行就跳过，也不准用当前周/月键新建。 */
export function shouldApplyExistingMetric(previous: ScoreMetricRecord | undefined): previous is ScoreMetricRecord {
  return Boolean(previous);
}

export function applyCorrectionMetricValue(previous: ScoreMetricRecord, delta: number): ScoreMetricRecord {
  return {
    ...previous,
    value: previous.value + delta,
    reachedAt: previous.reachedAt,
    revision: previous.revision + 1,
    updatedAt: previous.updatedAt
  };
}

/**
 * 分类指标必须用当前代际键。generation>0 时禁止缺行回退 base。
 */
export function correctionCategoryGenerationKey(generation: number | null | undefined): string {
  if (generation == null || generation <= 0) return METRIC_GENERATION_BASE;
  return String(generation);
}

export function attemptCorrected(input: { gradeRevision?: number | null; correctionId?: string | null }): boolean {
  return (input.gradeRevision ?? 1) > 1 || Boolean(input.correctionId);
}

export function correctionNoteFor(input: { gradeRevision?: number | null; correctionId?: string | null }): string {
  return attemptCorrected(input) ? CORRECTION_RESULT_NOTE : "";
}

export function submitEventOf<T extends { kind?: string; attemptId: string }>(events: T[], attemptId: string): T | undefined {
  return events.find(
    (row) => row.attemptId === attemptId && (row.kind === SCORE_EVENT_KIND_SUBMIT || row.kind == null || row.kind === "")
  );
}

export function priorCorrectionDeltasOf(
  events: Array<{ kind?: string; attemptId: string; delta: number; correctionId?: string }>,
  attemptId: string
): number[] {
  return events
    .filter((row) => row.attemptId === attemptId && row.kind === SCORE_EVENT_KIND_CORRECTION)
    .map((row) => row.delta);
}
