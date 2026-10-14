import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { weekKeyShanghai, monthKeyShanghai } from "./clock.js";
import {
  applyBestSequence,
  applyScoreMetric,
  categoryScoreView,
  gradeSelectedAnswers,
  paperBestId,
  scoreEventId,
  scoreMetricId
} from "./scoring.js";
import { scoreObjectiveQuestion } from "./question.js";

const samples = join(dirname(fileURLToPath(import.meta.url)), "../../../samples/contracts");

describe("scoring", () => {
  it("60/80/70 yields deltas 60/20/0", () => {
    const sample = JSON.parse(readFileSync(join(samples, "scoring-deltas.json"), "utf8"));
    const scores = sample.samePaperSequence.attempts.map((row: { score: number }) => row.score);
    const result = applyBestSequence(scores);
    expect(result.deltas).toEqual([60, 20, 0]);
    expect(result.best).toBe(80);
  });

  it("does not add parent and child category scores into total", () => {
    const view = categoryScoreView([
      { paperId: "paper_fict_logic_l1", categoryId: "cat_fict_logic", ancestorIds: [], bestScore: 50 },
      { paperId: "paper_fict_logic_l2", categoryId: "cat_fict_logic_deduction", ancestorIds: ["cat_fict_logic"], bestScore: 60 },
      { paperId: "paper_fict_logic_l3", categoryId: "cat_fict_logic_condition", ancestorIds: ["cat_fict_logic", "cat_fict_logic_deduction"], bestScore: 80 }
    ]);
    expect(view.totalScore).toBe(190);
    expect(view.nodes.find((n) => n.categoryId === "cat_fict_logic")).toEqual({
      categoryId: "cat_fict_logic",
      directScore: 50,
      inclusiveScore: 190
    });
    expect(view.nodes.find((n) => n.categoryId === "cat_fict_logic_deduction")?.inclusiveScore).toBe(140);
    expect(50 + 140 + 80).toBe(270);
    expect(view.totalScore).not.toBe(270);
  });

  it("scores single / multiple / trueFalse and requires a full multiple-choice set", () => {
    expect(scoreObjectiveQuestion(["A"], ["A"], 5)).toBe(5);
    expect(scoreObjectiveQuestion(["TRUE"], ["TRUE"], 2)).toBe(2);
    expect(scoreObjectiveQuestion(["A", "B"], ["A", "B", "C"], 10)).toBe(0);
    expect(scoreObjectiveQuestion(["A", "B", "C"], ["A", "B", "C"], 10)).toBe(10);
    const graded = gradeSelectedAnswers(
      [
        { questionId: "q1", optionIds: ["A"] },
        { questionId: "q2", optionIds: ["A", "C"] }
      ],
      [
        { questionId: "q1", points: 5, optionIds: ["A", "B"], correctOptionIds: ["A"], analysis: "单选" },
        { questionId: "q2", points: 10, optionIds: ["A", "B", "C"], correctOptionIds: ["A", "C"], analysis: "多选" },
        { questionId: "q3", points: 2, optionIds: ["TRUE", "FALSE"], correctOptionIds: ["FALSE"], analysis: "判断" }
      ]
    );
    expect(graded).toMatchObject({ score: 15, correctCount: 2, questionCount: 3 });
    expect(graded.items[2]?.unanswered).toBe(true);
  });

  it("keeps reachedAt when delta is 0 and uses deterministic score ids", () => {
    expect(applyScoreMetric({ value: 80, reachedAt: "old" }, 0, "new")).toEqual({ value: 80, reachedAt: "old" });
    expect(applyScoreMetric({ value: 60, reachedAt: "old" }, 20, "new")).toEqual({ value: 80, reachedAt: "new" });
    expect(paperBestId("m1", "p1")).toHaveLength(64);
    expect(scoreEventId("a1", 1)).not.toBe(scoreEventId("a1", 2));
    expect(
      scoreMetricId({
        metricGeneration: "base",
        scope: "total",
        periodKey: "all",
        categoryId: "",
        memberId: "m1"
      })
    ).toHaveLength(64);
  });

  it("uses Shanghai week Monday and YYYY-MM month keys", () => {
    expect(weekKeyShanghai(new Date("2026-10-11T16:00:00.000Z"))).toBe("2026-10-12");
    expect(monthKeyShanghai(new Date("2026-10-11T16:00:00.000Z"))).toBe("2026-10");
  });
});
