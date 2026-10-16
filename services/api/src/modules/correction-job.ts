import {
  CORRECTION_JOB_TYPE,
  DEFAULT_GROWTH_LEVELS,
  MEDAL_GRANT_SOURCE_CORRECTION,
  SCORE_EVENT_KIND_CORRECTION,
  acquireLease,
  applyCorrectionMetricValue,
  assertWritableLease,
  categoryMetricIdsOf,
  compensationEventOf,
  correctionCategoryGenerationKey,
  drainReady,
  gradeSelectedAnswers,
  levelIdForScore,
  markFailed,
  markSucceeded,
  openCorrectionGatesIfOwned,
  paperBestId,
  periodDeltasFromReplay,
  planMedalGrants,
  replayMemberPaper,
  saveCursor,
  scoreMetricId,
  shouldApplyExistingMetric,
  submitEventOf,
  priorCorrectionDeltasOf,
  type GradeableQuestion,
  type JobRecord,
  type ScoreEventRecord,
  type ScoreMetricRecord
} from "@mw/shared";
import type { CorrectionStore, CorrectionWorkRecord } from "./correction-stores.js";
import type { JobStore, MaintenanceStore } from "./job-stores.js";
import { rebuildRanking } from "./ranking.js";
import type { RankingWorkStore } from "./ranking-stores.js";

export const CORRECTION_LEASE_MS = 40_000;
export const CORRECTION_MEMBER_BATCH = 1;

export type CorrectionTickResult = {
  ok: boolean;
  reason?: string;
  jobId?: string;
  stage?: string;
  pendingUntil?: string;
  fencingToken?: number;
  rankingStatus?: string;
};

function workCursor(job: JobRecord): { done: number; total: number; stage: string; offset: number; lastMemberId?: string } {
  const stage = typeof job.cursor.stage === "string" ? job.cursor.stage : "drain";
  const lastMemberId = typeof job.cursor.summary?.lastMemberId === "string" ? job.cursor.summary.lastMemberId : undefined;
  return { done: job.cursor.done, total: job.cursor.total || 4, stage, offset: job.cursor.offset ?? 0, lastMemberId };
}

async function writeJob(
  store: JobStore,
  jobId: string,
  token: number,
  now: Date,
  apply: (job: JobRecord) => ReturnType<typeof saveCursor> | ReturnType<typeof markSucceeded> | ReturnType<typeof markFailed>
) {
  return store.transact(jobId, (job) => {
    if (!job) return { error: "NOT_FOUND", result: undefined };
    const writable = assertWritableLease(job, token, now);
    if (!writable.ok) return { error: writable.reason, result: undefined, job };
    const next = apply(job);
    if (!next.ok) return { error: next.reason, result: undefined, job };
    return { job: next.job, result: next.job };
  });
}

function gradeableFrom(chunks: Awaited<ReturnType<CorrectionStore["getChunks"]>>, answers: Awaited<ReturnType<CorrectionStore["getAnswers"]>>): GradeableQuestion[] {
  const keys = new Map<string, { optionIds: string[]; analysis: string }>();
  for (const chunk of answers) {
    for (const item of chunk.items) {
      keys.set(item.questionId, { optionIds: [...item.answer.optionIds], analysis: item.analysis.text });
    }
  }
  const questions: GradeableQuestion[] = [];
  for (const chunk of chunks) {
    for (const item of chunk.items) {
      const key = keys.get(item.questionId);
      questions.push({
        questionId: item.questionId,
        points: item.points,
        optionIds: item.options.map((option) => option.optionId),
        correctOptionIds: [...(key?.optionIds || [])],
        analysis: key?.analysis || ""
      });
    }
  }
  return questions;
}

async function regradeMembers(input: {
  store: CorrectionStore;
  work: CorrectionWorkRecord;
  now: Date;
}): Promise<{ done: boolean; processed: string[] }> {
  const toVersion = await input.store.getVersion(input.work.toVersionId);
  if (!toVersion) throw new Error("TO_VERSION_MISSING");
  const [chunks, answers] = await Promise.all([input.store.getChunks(toVersion), input.store.getAnswers(toVersion)]);
  const questions = gradeableFrom(chunks, answers);
  const processed = new Set(input.work.processedMemberIds);
  const paper = await input.store.getPaper(input.work.paperId);
  const category = paper ? await input.store.getCategory(paper.categoryId) : undefined;
  const catalog = await input.store.getCatalog();
  const generation = catalog.categoryMetricsGeneration;
  const categoryGenKey = correctionCategoryGenerationKey(generation);
  const growth = await input.store.getGrowth();
  const levels = growth?.levels.length ? growth.levels : DEFAULT_GROWTH_LEVELS;
  const newly: string[] = [];
  let afterAttemptId: string | undefined;
  while (newly.length < CORRECTION_MEMBER_BATCH) {
    const page = await input.store.listSubmittedAttempts({
      paperId: input.work.paperId,
      fromVersionId: input.work.fromVersionId,
      afterAttemptId,
      limit: 40
    });
    if (!page.length) return { done: true, processed: [...processed] };
    const pendingMembers: string[] = [];
    for (const row of page) {
      afterAttemptId = row.attemptId;
      if (!processed.has(row.memberId) && !pendingMembers.includes(row.memberId)) pendingMembers.push(row.memberId);
    }
    if (!pendingMembers.length) {
      if (page.length < 40) return { done: true, processed: [...processed] };
      continue;
    }
    const memberId = pendingMembers[0]!;
    const memberAttempts = await input.store.listSubmittedAttempts({
      paperId: input.work.paperId,
      fromVersionId: input.work.fromVersionId,
      memberId,
      limit: 100
    });
    const events = await input.store.listEvents(memberId, input.work.paperId);
    const replay = replayMemberPaper(
      memberAttempts.map((row) => {
        const submit = submitEventOf(events, row.attemptId);
        return {
          attemptId: row.attemptId,
          memberId,
          paperId: row.paperId,
          scoreSeq: submit?.scoreSeq || Date.parse(row.submittedAt) || 0,
          gradeRevision: row.gradeRevision || 1,
          newScore: gradeSelectedAnswers(row.answers, questions).score,
          submittedAt: row.submittedAt,
          weekKey: submit?.weekKey || events.find((item) => item.attemptId === row.attemptId)?.weekKey || "",
          monthKey: submit?.monthKey || events.find((item) => item.attemptId === row.attemptId)?.monthKey || "",
          originalSubmitDelta: submit?.delta ?? 0,
          priorCorrectionDeltas: priorCorrectionDeltasOf(events, row.attemptId),
          alreadyProcessed: events.some(
            (item) => item.attemptId === row.attemptId && item.kind === SCORE_EVENT_KIND_CORRECTION && item.correctionId === input.work.jobId
          ),
          correctionIds: events.filter((item) => item.attemptId === row.attemptId && item.correctionId).map((item) => String(item.correctionId))
        };
      }),
      input.work.jobId
    );
    if (!replay.alreadyProcessed) {
      const stats = await input.store.getStats(memberId);
      const best = await input.store.getBest(memberId, input.work.paperId);
      const nextAttempts = memberAttempts.map((row) => {
        const item = replay.items.find((line) => line.attemptId === row.attemptId);
        if (!item || item.skip) return row;
        return {
          ...row,
          score: item.newScore,
          gradeRevision: item.nextGradeRevision,
          gradingVersionId: input.work.toVersionId,
          correctionId: input.work.jobId,
          correctedAt: input.now.toISOString(),
          updatedAt: input.now.toISOString()
        };
      });
      const nextEvents: ScoreEventRecord[] = replay.items
        .filter((item) => !item.skip)
        .map((item) => {
          const source = submitEventOf(events, item.attemptId);
          return compensationEventOf({
            item,
            correctionId: input.work.jobId,
            sourceEventId: source?.eventId || "",
            createdAt: input.now.toISOString()
          });
        });
      const nextBest = {
        memberId,
        paperId: input.work.paperId,
        bestScore: replay.newBest,
        bestAttemptId: replay.items.find((item) => item.newScore === replay.newBest)?.attemptId || best?.bestAttemptId || memberAttempts[0]?.attemptId || "",
        firstReachedAt:
          replay.newBest === replay.oldBest && best?.firstReachedAt
            ? best.firstReachedAt
            : replay.items.find((item) => item.newScore === replay.newBest)?.submittedAt || best?.firstReachedAt || input.now.toISOString(),
        revision: (best?.revision ?? 0) + 1,
        schemaVersion: 1,
        createdAt: best?.createdAt || input.now.toISOString(),
        updatedAt: input.now.toISOString()
      };
      const totalScore = (stats?.totalScore ?? 0) + replay.totalDelta;
      const nextStats = stats
        ? {
            ...stats,
            totalScore,
            levelId: levelIdForScore(totalScore, levels),
            revision: stats.revision + 1,
            updatedAt: input.now.toISOString()
          }
        : undefined;
      const metricWrites: ScoreMetricRecord[] = [];
      const totalId = scoreMetricId({
        metricGeneration: "base",
        scope: "total",
        periodKey: "all",
        categoryId: "",
        memberId
      });
      const totalMetric = await input.store.getMetric(totalId);
      if (shouldApplyExistingMetric(totalMetric) && replay.totalDelta !== 0) {
        metricWrites.push(applyCorrectionMetricValue(totalMetric, replay.totalDelta));
      }
      for (const period of periodDeltasFromReplay(replay)) {
        const metricId = scoreMetricId({
          metricGeneration: "base",
          scope: period.scope,
          periodKey: period.periodKey,
          categoryId: "",
          memberId
        });
        const previous = await input.store.getMetric(metricId);
        if (shouldApplyExistingMetric(previous) && period.delta !== 0) {
          metricWrites.push(applyCorrectionMetricValue(previous, period.delta));
        }
      }
      const categoryIds = paper ? categoryMetricIdsOf(paper.categoryId, category?.ancestorIds || []) : [];
      for (const categoryId of categoryIds) {
        const metricId = scoreMetricId({
          metricGeneration: categoryGenKey,
          scope: "category",
          periodKey: "all",
          categoryId,
          memberId
        });
        const previous = await input.store.getMetric(metricId);
        if (shouldApplyExistingMetric(previous) && replay.totalDelta !== 0) {
          metricWrites.push(applyCorrectionMetricValue(previous, replay.totalDelta));
        }
      }
      const existingGrants = await input.store.listGrants(memberId);
      const grants = nextStats
        ? planMedalGrants({
            memberId,
            totalScore,
            levels,
            existingMedalIds: existingGrants.map((row) => row.medalId),
            sourceType: MEDAL_GRANT_SOURCE_CORRECTION,
            sourceId: input.work.jobId,
            configVersion: growth?.configVersion ?? 0,
            nowIso: input.now.toISOString()
          })
        : [];
      await input.store.applyMemberRegrade({
        attempts: nextAttempts,
        events: nextEvents,
        stats: nextStats,
        best: nextBest,
        metrics: metricWrites,
        grants
      });
    }
    processed.add(memberId);
    newly.push(memberId);
  }
  const more = await input.store.listSubmittedAttempts({
    paperId: input.work.paperId,
    fromVersionId: input.work.fromVersionId,
    limit: 100
  });
  const remaining = more.some((row) => !processed.has(row.memberId));
  return { done: !remaining, processed: [...processed] };
}

export async function processCorrectionJob(input: {
  jobStore: JobStore;
  correction: CorrectionStore;
  maintenance: MaintenanceStore;
  ranking?: RankingWorkStore;
  actorId: string;
  job: JobRecord;
  now: Date;
  requestId: string;
}): Promise<CorrectionTickResult> {
  if (input.job.type !== CORRECTION_JOB_TYPE) return { ok: false, reason: "NOT_CORRECTION" };
  const acquired = await input.jobStore.transact(input.job.jobId, (job) => {
    if (!job) return { error: "NOT_FOUND", result: undefined };
    const next = acquireLease(job, input.now, CORRECTION_LEASE_MS);
    if (!next.ok) return { error: next.reason, result: undefined, job };
    return { job: next.job, result: next.job };
  });
  if (acquired.mutation.error || !acquired.mutation.result) {
    return { ok: false, reason: acquired.mutation.error || "ACQUIRE_FAILED", jobId: input.job.jobId };
  }
  const token = acquired.mutation.result.fencingToken;
  const work = await input.correction.getWork(input.job.jobId);
  if (!work) {
    await writeJob(input.jobStore, input.job.jobId, token, input.now, (job) =>
      markFailed(job, token, input.now, { code: "WORK_MISSING", message: "correction work missing" })
    );
    return { ok: false, reason: "WORK_MISSING", jobId: input.job.jobId, fencingToken: token };
  }
  if (!drainReady(work.notBefore, input.now)) {
    await writeJob(input.jobStore, input.job.jobId, token, input.now, (job) =>
      saveCursor(job, token, { ...workCursor(job), stage: "drain" }, input.now)
    );
    return {
      ok: true,
      reason: "DRAIN_PENDING",
      jobId: input.job.jobId,
      stage: "drain",
      pendingUntil: work.notBefore,
      fencingToken: token
    };
  }
  try {
    let cursor = workCursor(acquired.mutation.result);
    if (cursor.stage === "drain") cursor = { ...cursor, stage: "regrade", done: 1 };
    if (cursor.stage === "regrade") {
      const batch = await regradeMembers({ store: input.correction, work, now: input.now });
      await input.correction.saveWork({
        ...work,
        processedMemberIds: batch.processed,
        updatedAt: input.now.toISOString()
      });
      if (!batch.done) {
        await writeJob(input.jobStore, input.job.jobId, token, input.now, (job) =>
          saveCursor(
            job,
            token,
            { done: 1, total: 4, stage: "regrade", offset: batch.processed.length, summary: { lastMemberId: batch.processed[batch.processed.length - 1] } },
            input.now
          )
        );
        return { ok: true, jobId: input.job.jobId, stage: "regrade", fencingToken: token };
      }
      cursor = { done: 2, total: 4, stage: "open", offset: batch.processed.length };
    }
    if (cursor.stage === "open") {
      const current = await input.maintenance.get();
      await input.maintenance.save(openCorrectionGatesIfOwned(current, input.job.jobId, input.now));
      const latest = (await input.correction.getWork(input.job.jobId)) || work;
      await input.correction.saveWork({ ...latest, opened: true, updatedAt: input.now.toISOString() });
      cursor = { done: 3, total: 4, stage: "ranking", offset: cursor.offset };
    }
    if (cursor.stage === "ranking") {
      const latest = (await input.correction.getWork(input.job.jobId)) || work;
      if (!input.ranking) {
        await input.correction.saveWork({
          ...latest,
          rankingStatus: "failed",
          rankingError: "RANKING_STORE_UNAVAILABLE",
          updatedAt: input.now.toISOString()
        });
        await writeJob(input.jobStore, input.job.jobId, token, input.now, (job) => markSucceeded(job, token, input.now));
        return { ok: true, jobId: input.job.jobId, stage: "done", rankingStatus: "failed", fencingToken: token, reason: "REGRADE_DONE_RANKING_PENDING" };
      }
      const rebuilt = await rebuildRanking({
        store: input.ranking,
        actorId: input.actorId,
        data: { reason: `grade.correction ${input.job.jobId}` },
        requestId: input.requestId,
        idempotencyKey: `${input.job.jobId}/ranking`,
        now: input.now
      });
      await input.correction.saveWork({
        ...latest,
        rankingStatus: rebuilt.ok ? "ok" : "failed",
        rankingError: rebuilt.ok ? "" : rebuilt.reason,
        updatedAt: input.now.toISOString()
      });
      await writeJob(input.jobStore, input.job.jobId, token, input.now, (job) => markSucceeded(job, token, input.now));
      return {
        ok: true,
        jobId: input.job.jobId,
        stage: "done",
        rankingStatus: rebuilt.ok ? "ok" : "failed",
        fencingToken: token,
        reason: rebuilt.ok ? "DONE" : "REGRADE_DONE_RANKING_PENDING"
      };
    }
    await writeJob(input.jobStore, input.job.jobId, token, input.now, (job) => markSucceeded(job, token, input.now));
    return { ok: true, jobId: input.job.jobId, stage: "done", fencingToken: token };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJob(input.jobStore, input.job.jobId, token, input.now, (job) =>
      markFailed(job, token, input.now, { code: "CORRECTION_BATCH_FAILED", message })
    );
    return { ok: false, reason: message, jobId: input.job.jobId, fencingToken: token };
  }
}

export async function processDueCorrectionJobs(input: {
  jobStore: JobStore;
  correction: CorrectionStore;
  maintenance: MaintenanceStore;
  ranking?: RankingWorkStore;
  now: Date;
  requestId: string;
}): Promise<{ ok: true; processed: CorrectionTickResult[] }> {
  const ids = await input.correction.listDueJobIds({ now: input.now, types: [CORRECTION_JOB_TYPE] });
  const processed: CorrectionTickResult[] = [];
  for (const jobId of ids.slice(0, 3)) {
    const job = await input.jobStore.get(jobId);
    if (!job || job.state === "succeeded" || job.state === "cancelled") continue;
    processed.push(
      await processCorrectionJob({
        jobStore: input.jobStore,
        correction: input.correction,
        maintenance: input.maintenance,
        ranking: input.ranking,
        actorId: "mw-jobs",
        job,
        now: input.now,
        requestId: input.requestId
      })
    );
  }
  return { ok: true, processed };
}

export function paperBestKey(memberId: string, paperId: string): string {
  return paperBestId(memberId, paperId);
}
