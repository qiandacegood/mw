import { describe, expect, it } from "vitest";
import {
  categoryUsableForQuestion,
  hasQuestionSecrets,
  parseQuestionSaveInput,
  scoreObjectiveQuestion,
  stripQuestionSecrets,
  toPublicQuestionView
} from "./question.js";

function validSingle(extra: Record<string, unknown> = {}) {
  return {
    expectedRevision: 0,
    categoryId: "cat_logic",
    type: "single",
    stem: { text: "虚构单选题干" },
    options: [
      { optionId: "A", text: "选项甲" },
      { optionId: "B", text: "选项乙" }
    ],
    answer: { optionIds: ["A"] },
    analysis: { text: "因为条件甲成立。" },
    defaultPoints: 5,
    difficulty: "beginner",
    ...extra
  };
}

describe("MW10 question validation", () => {
  it("accepts single multiple and trueFalse", () => {
    expect(parseQuestionSaveInput(validSingle()).ok).toBe(true);
    expect(
      parseQuestionSaveInput({
        ...validSingle(),
        type: "multiple",
        options: [
          { optionId: "A", text: "甲" },
          { optionId: "B", text: "乙" },
          { optionId: "C", text: "丙" }
        ],
        answer: { optionIds: ["A", "C"] },
        analysis: { text: "漏选 C 或误选 B 都不给分。" }
      }).ok
    ).toBe(true);
    expect(
      parseQuestionSaveInput({
        ...validSingle(),
        type: "trueFalse",
        options: [
          { optionId: "TRUE", text: "正确" },
          { optionId: "FALSE", text: "错误" }
        ],
        answer: { optionIds: ["TRUE"] },
        analysis: { text: "陈述与条件一致。" }
      }).ok
    ).toBe(true);
  });

  it("rejects illegal option counts answers empty analysis non-positive points and unknown fields", () => {
    expect(parseQuestionSaveInput(validSingle({ options: [{ optionId: "A", text: "甲" }] })).ok).toBe(false);
    expect(
      parseQuestionSaveInput(
        validSingle({
          type: "multiple",
          options: [
            { optionId: "A", text: "甲" },
            { optionId: "B", text: "乙" },
            { optionId: "C", text: "丙" }
          ],
          answer: { optionIds: ["A"] }
        })
      ).ok
    ).toBe(false);
    expect(parseQuestionSaveInput(validSingle({ analysis: { text: "" } })).ok).toBe(false);
    expect(parseQuestionSaveInput(validSingle({ defaultPoints: 0 })).ok).toBe(false);
    expect(parseQuestionSaveInput(validSingle({ extra: true })).ok).toBe(false);
    expect(parseQuestionSaveInput(validSingle({ stem: { text: "题", url: "https://x" } })).ok).toBe(false);
  });

  it("rejects disabled or missing categories", () => {
    expect(categoryUsableForQuestion(undefined)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(categoryUsableForQuestion({ deletedAt: "2026-10-09T00:00:00.000Z", enabled: true })).toMatchObject({
      ok: false,
      code: "CATEGORY_UNAVAILABLE"
    });
    expect(categoryUsableForQuestion({ enabled: false })).toMatchObject({ ok: false, code: "CATEGORY_UNAVAILABLE" });
    expect(categoryUsableForQuestion({ enabled: true, deletedAt: null })).toMatchObject({ ok: true });
  });

  it("strips answers and analysis from public views", () => {
    const publicView = toPublicQuestionView(
      {
        questionId: "q1",
        categoryId: "c1",
        currentVersionId: "v1",
        status: "active",
        revision: 1,
        schemaVersion: 1,
        createdAt: "t",
        updatedAt: "t"
      },
      {
        versionId: "v1",
        questionId: "q1",
        type: "single",
        stem: { text: "题干", assetIds: ["prompt1"] },
        options: [{ optionId: "A", text: "甲", assetIds: [] }],
        answer: { optionIds: ["A"] },
        analysis: { text: "解析", assetIds: ["analysis1"] },
        assetIds: ["prompt1", "analysis1"],
        defaultPoints: 5,
        difficulty: "beginner",
        categoryId: "c1",
        schemaVersion: 1,
        createdAt: "t",
        createdBy: "uid"
      }
    );
    expect(hasQuestionSecrets(publicView)).toEqual([]);
    expect("answer" in publicView).toBe(false);
    expect("analysis" in publicView).toBe(false);
    const leaked = stripQuestionSecrets({
      ok: true,
      data: { answer: { optionIds: ["A"] }, analysis: { text: "x" }, stem: { text: "题干" } }
    });
    expect(hasQuestionSecrets(leaked)).toEqual([]);
  });

  it("scores locally without claiming A04", () => {
    expect(scoreObjectiveQuestion(["A"], ["A"], 5)).toBe(5);
    expect(scoreObjectiveQuestion(["A", "C"], ["A", "C"], 5)).toBe(5);
    expect(scoreObjectiveQuestion(["A"], ["A", "C"], 5)).toBe(0);
  });
});
