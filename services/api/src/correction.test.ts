import { describe, expect, it } from "vitest";
import {
  CORRECTION_DRAIN_MS,
  CORRECTION_RESULT_NOTE,
  SCORE_EVENT_KIND_CORRECTION,
  SCORE_EVENT_KIND_SUBMIT,
  defaultMaintenanceConfig,
  emptyCatalog,
  scoreEventId,
  scoreMetricId,
  signJobsInvoke,
  weekKeyShanghai
} from "@mw/shared";
import { handleOfficial, memoryAdminStore } from "./official.js";
import { memoryCorrectionStore } from "./modules/correction-stores.js";
import { processDueCorrectionJobs } from "./modules/correction-job.js";
import { memoryJobStore, memoryMaintenanceStore } from "./modules/job-stores.js";
import { memoryRankingStore } from "./modules/ranking-stores.js";
import type { AttemptRecord, PaperChunkRecord, PaperRecord, PaperVersionRecord, ScoreEventRecord } from "@mw/shared";
import type { MemberStatsRecord } from "./modules/member-stores.js";

const allowedAppIds = ["wxmwallowedappid0001"];
const superUid = "uid_super_1";
const contentUid = "uid_content_1";
const secret = "mw19-test-secret";
const paperId = "paper_corr_1";
const fromVersionId = "ver_from";
const toVersionId = "ver_to";
const memberId = "member_corr_1";
const t1 = "2026-09-01T02:00:00.000Z";
const t2 = "2026-09-08T02:00:00.000Z";
const t3 = "2026-09-08T03:00:00.000Z";
const weekA = weekKeyShanghai(new Date(t1));
const weekB = weekKeyShanghai(new Date(t2));
const now0 = new Date("2026-10-16T02:00:00.000Z");

function req(action: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { apiVersion: "1", action, requestId: `req_${action}`, data, ...extra };
}

function chunk(versionId: string, chunkId: string): PaperChunkRecord {
  return {
    chunkId,
    versionId,
    chunkNo: 1,
    digest: "d",
    schemaVersion: 1,
    items: [
      {
        ord: 1,
        questionId: "q1",
        questionVersionId: "qv1",
        type: "single",
        stem: { text: "虚构题", assetIds: [] },
        options: [
          { optionId: "A", text: "甲", assetIds: [] },
          { optionId: "B", text: "乙", assetIds: [] }
        ],
        points: 100
      }
    ]
  };
}

function answer(versionId: string, chunkId: string, optionId: string) {
  return {
    chunkId,
    versionId,
    chunkNo: 1,
    digest: "a",
    schemaVersion: 1,
    items: [{ ord: 1, questionId: "q1", questionVersionId: "qv1", answer: { optionIds: [optionId] }, analysis: { text: "解析", assetIds: [] } }]
  };
}

function paper(status: PaperRecord["status"]): PaperRecord {
  return {
    paperId,
    title: "MW19虚构纠错卷",
    summary: "s",
    goal: "g",
    categoryId: "cat1",
    access: "free",
    difficulty: "beginner",
    sort: 1,
    suggestedMinutes: 10,
    publishedAt: t1,
    status,
    activeVersionId: fromVersionId,
    revision: 3,
    draftItems: [{ questionId: "q1", versionId: "qv1", points: 100, ord: 1 }],
    draftQuestionCount: 1,
    draftMaxScore: 100,
    accessLocked: true,
    withdrawReason: status === "withdrawn" ? "答案错误" : null,
    schemaVersion: 1,
    createdAt: t1,
    updatedAt: t1
  };
}

function version(versionId: string): PaperVersionRecord {
  return {
    versionId,
    paperId,
    questionCount: 1,
    maxScore: 100,
    chunkIds: [`chunk_${versionId}`],
    answerChunkIds: [`ans_${versionId}`],
    chunkDigests: ["d"],
    answerDigests: ["a"],
    categoryPathSnapshot: ["cat1"],
    manifestHash: `man_${versionId}`,
    questionIds: ["q1"],
    questionVersionIds: ["qv1"],
    schemaVersion: 1,
    createdAt: t1,
    createdBy: contentUid
  };
}

function attempt(id: string, submittedAt: string, score: number, _seq: number): AttemptRecord {
  return {
    attemptId: id,
    memberId,
    paperId,
    paperVersionId: fromVersionId,
    paperTitle: "MW19虚构纠错卷",
    access: "free",
    questionCount: 1,
    maxScore: 100,
    chunkCount: 1,
    answers: [{ questionId: "q1", optionIds: ["B"] }],
    draftRevision: 1,
    state: "submitted",
    submittedAt,
    abandonedAt: "",
    lastSaveRequestId: "",
    score,
    gradeRevision: 1,
    submitHash: "h",
    schemaVersion: 1,
    createdAt: submittedAt,
    updatedAt: submittedAt
  };
}

function submitEvent(id: string, submittedAt: string, weekKey: string, seq: number, score: number, delta: number): ScoreEventRecord {
  return {
    eventId: scoreEventId(id, 1),
    attemptId: id,
    gradeRevision: 1,
    memberId,
    paperId,
    scoreSeq: seq,
    score,
    delta,
    submittedAt,
    weekKey,
    monthKey: "2026-09",
    kind: SCORE_EVENT_KIND_SUBMIT,
    schemaVersion: 1,
    createdAt: submittedAt
  };
}

function harness(status: PaperRecord["status"] = "withdrawn") {
  const maintenance = memoryMaintenanceStore(defaultMaintenanceConfig(now0));
  const correction = memoryCorrectionStore({ catalog: emptyCatalog(now0), maintenance: defaultMaintenanceConfig(now0) });
  correction.seedPaper(paper(status));
  correction.seedVersion(version(fromVersionId), [chunk(fromVersionId, `chunk_${fromVersionId}`)], [answer(fromVersionId, `ans_${fromVersionId}`, "A")]);
  correction.seedVersion(version(toVersionId), [chunk(toVersionId, `chunk_${toVersionId}`)], [answer(toVersionId, `ans_${toVersionId}`, "B")]);
  correction.seedCategory({
    categoryId: "cat1",
    parentId: null,
    depth: 1,
    ancestorIds: [],
    name: "测",
    normalizedName: "测",
    sort: 1,
    enabled: true,
    deletedAt: null,
    treeVersion: 1,
    revision: 1,
    schemaVersion: 1,
    createdAt: t1,
    updatedAt: t1
  });
  correction.seedAttempt(attempt("att1", t1, 0, 1));
  correction.seedAttempt(attempt("att2", t2, 0, 2));
  correction.seedAttempt(attempt("att3", t3, 0, 3));
  correction.seedEvent(submitEvent("att1", t1, weekA, 1, 0, 0));
  correction.seedEvent(submitEvent("att2", t2, weekB, 2, 0, 0));
  correction.seedEvent(submitEvent("att3", t3, weekB, 3, 0, 0));
  const stats: MemberStatsRecord = {
    memberId,
    totalScore: 0,
    scoreSeq: 3,
    levelId: "L1",
    growthVersion: 1,
    revision: 1,
    schemaVersion: 1,
    createdAt: t1,
    updatedAt: t3
  };
  correction.seedStats(stats);
  correction.seedBest({
    memberId,
    paperId,
    bestScore: 0,
    bestAttemptId: "att1",
    firstReachedAt: t1,
    revision: 1,
    schemaVersion: 1,
    createdAt: t1,
    updatedAt: t3
  });
  correction.seedMetric({
    metricId: scoreMetricId({ metricGeneration: "base", scope: "total", periodKey: "all", categoryId: "", memberId }),
    metricGeneration: "base",
    scope: "total",
    periodKey: "all",
    categoryId: "",
    memberId,
    value: 0,
    reachedAt: t1,
    revision: 1,
    schemaVersion: 1,
    updatedAt: t1
  });
  correction.seedMetric({
    metricId: scoreMetricId({ metricGeneration: "base", scope: "week", periodKey: weekA, categoryId: "", memberId }),
    metricGeneration: "base",
    scope: "week",
    periodKey: weekA,
    categoryId: "",
    memberId,
    value: 0,
    reachedAt: t1,
    revision: 1,
    schemaVersion: 1,
    updatedAt: t1
  });
  const jobStore = memoryJobStore();
  const ranking = memoryRankingStore();
  return { correction, maintenance, jobStore, ranking };
}

function admins() {
  return memoryAdminStore([
    { uid: superUid, roles: ["super"], enabled: true, authVersion: 1 },
    { uid: contentUid, roles: ["content"], enabled: true, authVersion: 1 }
  ]);
}

async function adminCall(
  action: string,
  data: Record<string, unknown>,
  ctx: ReturnType<typeof harness>,
  extra: { uid?: string; suffix?: string; now?: Date } = {}
) {
  return handleOfficial({
    entry: "mw-admin",
    event: req(action, data, action === "correction.status" ? {} : { idempotencyKey: `mw19/${action}/${extra.suffix || "1"}` }),
    allowedAppIds,
    authUid: extra.uid || superUid,
    adminStore: admins(),
    correctionStore: ctx.correction,
    jobStore: ctx.jobStore,
    maintenanceStore: ctx.maintenance,
    rankingStore: ctx.ranking,
    now: extra.now || now0
  });
}

describe("MW19 correction.preview / commit", () => {
  it("rejects unpublished papers, structural change, and content role", async () => {
    const live = harness("published");
    const notWithdrawn = await adminCall(
      "correction.preview",
      { paperId, fromVersionId, toVersionId },
      live
    );
    expect(notWithdrawn).toMatchObject({ ok: false, error: { details: { reason: "PAPER_NOT_WITHDRAWN" } } });

    const ctx = harness();
    const forbidden = await adminCall("correction.preview", { paperId, fromVersionId, toVersionId }, ctx, { uid: contentUid });
    expect(forbidden).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    ctx.correction.seedVersion(
      { ...version(toVersionId), maxScore: 80, questionIds: ["q1"] },
      [
        {
          ...chunk(toVersionId, `chunk_${toVersionId}`),
          items: [{ ...chunk(toVersionId, `chunk_${toVersionId}`).items[0]!, points: 80 }]
        }
      ],
      [answer(toVersionId, `ans_${toVersionId}`, "B")]
    );
    const structural = await adminCall("correction.preview", { paperId, fromVersionId, toVersionId }, ctx, { suffix: "struct" });
    expect(structural).toMatchObject({ ok: false, error: { details: { reason: "STRUCTURAL_CHANGE" } } });
  });

  it("closes submit, waits 35s, replays into original weeks, and is idempotent", async () => {
    const ctx = harness();
    const preview = await adminCall("correction.preview", { paperId, fromVersionId, toVersionId }, ctx);
    expect(preview).toMatchObject({
      ok: true,
      data: { affectedAttemptCount: 3, affectedMemberCount: 1, drainMs: CORRECTION_DRAIN_MS }
    });
    const previewId = (preview as { data: { previewId: string; planHash: string } }).data.previewId;
    const planHash = (preview as { data: { planHash: string } }).data.planHash;
    const expired = await adminCall(
      "correction.commit",
      { previewId, planHash, reason: "fix answers", confirmed: true },
      ctx,
      { now: new Date(now0.getTime() + 11 * 60 * 1000), suffix: "exp" }
    );
    expect(expired).toMatchObject({ ok: false, error: { details: { reason: "PREVIEW_EXPIRED" } } });

    const preview2 = await adminCall("correction.preview", { paperId, fromVersionId, toVersionId }, ctx, { suffix: "2" });
    const pid = (preview2 as { data: { previewId: string; planHash: string } }).data.previewId;
    const hash = (preview2 as { data: { planHash: string } }).data.planHash;
    const committed = await adminCall(
      "correction.commit",
      { previewId: pid, planHash: hash, reason: "fix answers", confirmed: true },
      ctx,
      { suffix: "c1" }
    );
    expect(committed).toMatchObject({ ok: true, data: { state: "queued" } });
    expect(ctx.maintenance.get ? (await ctx.maintenance.get()).attemptSubmit.enabled : true).toBe(false);
    expect((await ctx.maintenance.get()).attemptStart.enabled).toBe(true);

    const early = await processDueCorrectionJobs({
      jobStore: ctx.jobStore,
      correction: ctx.correction,
      maintenance: ctx.maintenance,
      ranking: ctx.ranking,
      now: new Date(now0.getTime() + 10_000),
      requestId: "tick-early"
    });
    expect(early.processed).toEqual([]);

    const later = new Date(now0.getTime() + CORRECTION_DRAIN_MS + 1000);
    await processDueCorrectionJobs({
      jobStore: ctx.jobStore,
      correction: ctx.correction,
      maintenance: ctx.maintenance,
      ranking: ctx.ranking,
      now: later,
      requestId: "tick-1"
    });
    const att1 = await ctx.correction.getPaper(paperId);
    expect(att1?.status).toBe("withdrawn");
    const a1 = ctx.correction.attempts.get("att1");
    expect(a1?.score).toBe(100);
    expect(a1?.gradeRevision).toBe(2);
    expect(a1?.gradingVersionId).toBe(toVersionId);
    const events = await ctx.correction.listEvents(memberId, paperId);
    const comps = events.filter((row) => row.kind === SCORE_EVENT_KIND_CORRECTION);
    expect(comps).toHaveLength(3);
    expect(comps.map((row) => row.weekKey)).toEqual([weekA, weekB, weekB]);
    expect(comps.map((row) => row.delta)).toEqual([100, 0, 0]);
    const weekAMetric = await ctx.correction.getMetric(
      scoreMetricId({ metricGeneration: "base", scope: "week", periodKey: weekA, categoryId: "", memberId })
    );
    const currentWeek = weekKeyShanghai(later);
    const currentMetric = await ctx.correction.getMetric(
      scoreMetricId({ metricGeneration: "base", scope: "week", periodKey: currentWeek, categoryId: "", memberId })
    );
    expect(weekAMetric?.value).toBe(100);
    expect(currentMetric).toBeUndefined();
    const stats = await ctx.correction.getStats(memberId);
    expect(stats?.totalScore).toBe(100);
    expect(stats?.levelId).toBe("L2");
    expect((await ctx.maintenance.get()).attemptSubmit.enabled).toBe(true);

    const replay = await adminCall(
      "correction.commit",
      { previewId: pid, planHash: hash, reason: "fix answers", confirmed: true },
      ctx,
      { suffix: "c1" }
    );
    expect(replay).toMatchObject({ ok: true });
    const events2 = await ctx.correction.listEvents(memberId, paperId);
    expect(events2.filter((row) => row.kind === SCORE_EVENT_KIND_CORRECTION)).toHaveLength(3);
    expect(a1 && CORRECTION_RESULT_NOTE).toBe(CORRECTION_RESULT_NOTE);
  });

  it("does not backfill missing week metrics and keeps category generation", async () => {
    const ctx = harness();
    ctx.correction.setCatalog({ ...emptyCatalog(now0), categoryMetricsGeneration: 2 });
    const preview = await adminCall("correction.preview", { paperId, fromVersionId, toVersionId }, ctx, { suffix: "g" });
    const pid = (preview as { data: { previewId: string; planHash: string } }).data.previewId;
    const hash = (preview as { data: { planHash: string } }).data.planHash;
    await adminCall(
      "correction.commit",
      { previewId: pid, planHash: hash, reason: "fix answers", confirmed: true },
      ctx,
      { suffix: "g1" }
    );
    await processDueCorrectionJobs({
      jobStore: ctx.jobStore,
      correction: ctx.correction,
      maintenance: ctx.maintenance,
      ranking: ctx.ranking,
      now: new Date(now0.getTime() + CORRECTION_DRAIN_MS + 1000),
      requestId: "tick-g"
    });
    const legacy = await ctx.correction.getMetric(
      scoreMetricId({ metricGeneration: "base", scope: "category", periodKey: "all", categoryId: "cat1", memberId })
    );
    const gen2 = await ctx.correction.getMetric(
      scoreMetricId({ metricGeneration: "2", scope: "category", periodKey: "all", categoryId: "cat1", memberId })
    );
    expect(legacy).toBeUndefined();
    expect(gen2).toBeUndefined();
  });

  it("unsigned jobs.tick still requires catalog or correction stores; forged timer stays denied", async () => {
    const ctx = harness();
    const forged = await handleOfficial({
      entry: "mw-jobs",
      event: { Type: "Timer", TriggerName: "mw-jobs-tick" },
      allowedAppIds,
      jobsSecret: secret,
      jobStore: ctx.jobStore,
      correctionStore: ctx.correction,
      maintenanceStore: ctx.maintenance,
      now: now0
    });
    expect(forged).toMatchObject({ ok: false, reason: "FORGED_TIMER_DENIED" });
    const ticked = await handleOfficial({
      entry: "mw-jobs",
      event: {
        serverInvoke: signJobsInvoke(secret, {
          action: "jobs.tick",
          issuedAt: now0.toISOString(),
          nonce: "n1"
        })
      },
      allowedAppIds,
      jobsSecret: secret,
      jobStore: ctx.jobStore,
      correctionStore: ctx.correction,
      maintenanceStore: ctx.maintenance,
      rankingStore: ctx.ranking,
      now: now0
    });
    expect(ticked).toMatchObject({ ok: true, reason: "JOBS_TICK" });
  });
});
