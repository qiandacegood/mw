import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyBestSequence, categoryScoreView } from "./scoring.js";

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
});
