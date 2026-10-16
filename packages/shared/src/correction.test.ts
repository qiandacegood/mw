import { describe, expect, it } from "vitest";
import { weekKeyShanghai, monthKeyShanghai } from "./clock.js";
import {
  CORRECTION_DRAIN_MS,
  CORRECTION_JOB_TYPE,
  CORRECTION_RESULT_NOTE,
  applyCorrectionMetricValue,
  attemptCorrected,
  compensationEventOf,
  correctionCategoryGenerationKey,
  correctionJobId,
  correctionNoteFor,
  correctionPlanHash,
  drainReady,
  paperStructureEqual,
  paperStructureHash,
  paperStructureOf,
  parseCorrectionCommitInput,
  parseCorrectionPreviewInput,
  periodDeltasFromReplay,
  replayMemberPaper,
  shouldApplyExistingMetric
} from "./correction.js";
import { METRIC_GENERATION_BASE, SCORE_EVENT_KIND_CORRECTION } from "./scoring.js";

const weekA = weekKeyShanghai(new Date("2026-09-01T02:00:00.000Z"));
const weekB = weekKeyShanghai(new Date("2026-09-08T02:00:00.000Z"));
const monthA = monthKeyShanghai(new Date("2026-09-01T02:00:00.000Z"));

function attempt(partial: {
  attemptId: string;
  scoreSeq: number;
  newScore: number;
  originalSubmitDelta: number;
  submittedAt: string;
  weekKey: string;
  alreadyProcessed?: boolean;
  priorCorrectionDeltas?: number[];
  correctionIds?: string[];
}) {
  return {
    memberId: "m1",
    paperId: "p1",
    gradeRevision: 1,
    monthKey: monthA,
    priorCorrectionDeltas: [],
    alreadyProcessed: false,
    correctionIds: [],
    ...partial
  };
}

describe("MW19 correction plan", () => {
  it("replays 60/80/70 to 90/80/70 with original-period compensation", () => {
    const replay = replayMemberPaper(
      [
        attempt({
          attemptId: "a1",
          scoreSeq: 1,
          newScore: 90,
          originalSubmitDelta: 60,
          submittedAt: "2026-09-01T02:00:00.000Z",
          weekKey: weekA
        }),
        attempt({
          attemptId: "a2",
          scoreSeq: 2,
          newScore: 80,
          originalSubmitDelta: 20,
          submittedAt: "2026-09-08T02:00:00.000Z",
          weekKey: weekB
        }),
        attempt({
          attemptId: "a3",
          scoreSeq: 3,
          newScore: 70,
          originalSubmitDelta: 0,
          submittedAt: "2026-09-08T03:00:00.000Z",
          weekKey: weekB
        })
      ],
      "corr-1"
    );
    expect(replay.newDeltas).toEqual([90, 0, 0]);
    expect(replay.newBest).toBe(90);
    expect(replay.oldBest).toBe(80);
    expect(replay.totalDelta).toBe(10);
    expect(replay.items.map((row) => row.compensationDelta)).toEqual([30, -20, 0]);
    const periods = periodDeltasFromReplay(replay);
    expect(periods).toEqual(
      expect.arrayContaining([
        { scope: "week", periodKey: weekA, delta: 30 },
        { scope: "week", periodKey: weekB, delta: -20 }
      ])
    );
    expect(periods.find((row) => row.scope === "week" && row.periodKey === weekKeyShanghai(new Date("2026-10-16T02:00:00.000Z")))).toBeUndefined();
    const event = compensationEventOf({
      item: replay.items[0]!,
      correctionId: "corr-1",
      sourceEventId: "src-a1",
      createdAt: "2026-10-16T02:00:00.000Z"
    });
    expect(event.kind).toBe(SCORE_EVENT_KIND_CORRECTION);
    expect(event.weekKey).toBe(weekA);
    expect(event.submittedAt).toBe("2026-09-01T02:00:00.000Z");
    expect(event.delta).toBe(30);
    expect(event.createdAt).toBe("2026-10-16T02:00:00.000Z");
  });

  it("skips the same correction task instead of double-crediting", () => {
    const rows = [
      attempt({
        attemptId: "a1",
        scoreSeq: 1,
        newScore: 90,
        originalSubmitDelta: 60,
        submittedAt: "2026-09-01T02:00:00.000Z",
        weekKey: weekA,
        alreadyProcessed: true,
        correctionIds: ["corr-1"]
      })
    ];
    const replay = replayMemberPaper(rows, "corr-1");
    expect(replay.alreadyProcessed).toBe(true);
    expect(replay.totalDelta).toBe(0);
    expect(replay.items[0]?.compensationDelta).toBe(0);
    expect(replay.items[0]?.skip).toBe(true);
  });

  it("rejects structural fingerprint mismatch and treats identical structure as comparable", () => {
    const from = paperStructureOf(
      { questionCount: 2, maxScore: 15, questionIds: ["q1", "q2"] },
      [
        {
          chunkId: "c1",
          versionId: "v1",
          chunkNo: 1,
          digest: "d",
          schemaVersion: 1,
          items: [
            {
              ord: 1,
              questionId: "q1",
              questionVersionId: "qv1",
              type: "single",
              stem: { text: "s", assetIds: [] },
              options: [
                { optionId: "A", text: "甲", assetIds: [] },
                { optionId: "B", text: "乙", assetIds: [] }
              ],
              points: 5
            },
            {
              ord: 2,
              questionId: "q2",
              questionVersionId: "qv2",
              type: "single",
              stem: { text: "s2", assetIds: [] },
              options: [
                { optionId: "A", text: "甲", assetIds: [] },
                { optionId: "B", text: "乙", assetIds: [] }
              ],
              points: 10
            }
          ]
        }
      ]
    );
    const samePoints = paperStructureOf(
      { questionCount: 2, maxScore: 15, questionIds: ["q1", "q2"] },
      [
        {
          chunkId: "c2",
          versionId: "v2",
          chunkNo: 1,
          digest: "d2",
          schemaVersion: 1,
          items: from.questions.map((row, ord) => ({
            ord: ord + 1,
            questionId: row.questionId,
            questionVersionId: "new",
            type: "single" as const,
            stem: { text: "revised", assetIds: [] },
            options: row.optionIds.map((optionId) => ({ optionId, text: optionId, assetIds: [] })),
            points: row.points
          }))
        }
      ]
    );
    const changedPoints = {
      ...samePoints,
      maxScore: 20,
      questions: samePoints.questions.map((row, index) => (index === 1 ? { ...row, points: 15 } : row))
    };
    expect(paperStructureEqual(from, samePoints)).toBe(true);
    expect(paperStructureEqual(from, changedPoints)).toBe(false);
    expect(paperStructureHash(from)).toHaveLength(64);
  });

  it("does not backfill missing metrics and keeps category generation from rolling back", () => {
    expect(shouldApplyExistingMetric(undefined)).toBe(false);
    const updated = applyCorrectionMetricValue(
      {
        metricId: "m",
        metricGeneration: "1",
        scope: "week",
        periodKey: weekA,
        categoryId: "",
        memberId: "m1",
        value: 60,
        reachedAt: "old",
        revision: 1,
        schemaVersion: 1,
        updatedAt: "old"
      },
      30
    );
    expect(updated.value).toBe(90);
    expect(updated.reachedAt).toBe("old");
    expect(correctionCategoryGenerationKey(0)).toBe(METRIC_GENERATION_BASE);
    expect(correctionCategoryGenerationKey(2)).toBe("2");
    expect(correctionCategoryGenerationKey(2)).not.toBe(METRIC_GENERATION_BASE);
  });

  it("requires withdrawn-bound preview fields and confirmed commit", () => {
    expect(parseCorrectionPreviewInput({ paperId: "p", fromVersionId: "v1", toVersionId: "v1" }).ok).toBe(false);
    expect(parseCorrectionPreviewInput({ paperId: "p", fromVersionId: "v1", toVersionId: "v2" })).toMatchObject({
      ok: true,
      paperId: "p"
    });
    expect(parseCorrectionCommitInput({ previewId: "x", planHash: "h", reason: "fix", confirmed: false }).ok).toBe(false);
    expect(parseCorrectionCommitInput({ previewId: "x", planHash: "h", reason: "fix", confirmed: true }).ok).toBe(true);
  });

  it("uses 35s drain, stable job id, and user-visible correction note", () => {
    const closed = new Date("2026-10-16T00:00:00.000Z");
    expect(CORRECTION_DRAIN_MS).toBe(35_000);
    expect(drainReady(new Date(closed.getTime() + 34_000).toISOString(), new Date(closed.getTime() + 34_000))).toBe(true);
    expect(drainReady(new Date(closed.getTime() + 35_000).toISOString(), new Date(closed.getTime() + 34_000))).toBe(false);
    expect(correctionJobId("p1", "hash")).toHaveLength(64);
    expect(correctionJobId("p1", "hash")).toBe(correctionJobId("p1", "hash"));
    expect(CORRECTION_JOB_TYPE).toBe("grade.correction");
    expect(attemptCorrected({ gradeRevision: 2 })).toBe(true);
    expect(correctionNoteFor({ gradeRevision: 2 })).toBe(CORRECTION_RESULT_NOTE);
    expect(correctionNoteFor({ gradeRevision: 1 })).toBe("");
    expect(
      correctionPlanHash({
        paperId: "p",
        fromVersionId: "a",
        toVersionId: "b",
        fromStructureHash: "1",
        toStructureHash: "1",
        affectedAttemptCount: 1,
        affectedMemberCount: 1,
        warnings: []
      })
    ).toHaveLength(64);
  });
});
