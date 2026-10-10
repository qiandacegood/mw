import { describe, expect, it } from "vitest";
import {
  attemptIdFor,
  draftSummaryOf,
  emptyDraftSummary,
  normalizeAttemptAnswers,
  parseAttemptAbandonInput,
  parseAttemptReplaceInput,
  parseAttemptSaveInput,
  parseAttemptStartInput
} from "./attempt.js";

describe("attempt parsers and full-set answers", () => {
  it("derives a stable attempt id without leaking member text", () => {
    const first = attemptIdFor("member_a", "start-1");
    expect(first).toBe(attemptIdFor("member_a", "start-1"));
    expect(first).not.toBe(attemptIdFor("member_a", "start-2"));
    expect(first).toHaveLength(64);
    expect(first.includes("member_a")).toBe(false);
  });

  it("replaces the full selected set and treats missing question ids as unanswered", () => {
    const allowed = ["q1", "q2", "q3"];
    const normalized = normalizeAttemptAnswers(
      [
        { questionId: "q2", optionIds: ["B", "A", "B"] },
        { questionId: "q1", optionIds: [] }
      ],
      allowed
    );
    expect(normalized).toEqual({
      ok: true,
      answers: [{ questionId: "q2", optionIds: ["A", "B"] }]
    });
    expect(parseAttemptSaveInput({ attemptId: "a1", expectedRevision: 0, answers: [{ questionId: "q9", optionIds: ["A"] }] }, allowed).ok).toBe(
      false
    );
    expect(normalizeAttemptAnswers(new Array(101).fill({ questionId: "q1", optionIds: ["A"] }), allowed).ok).toBe(false);
  });

  it("rejects startReplacing / abandon without confirmed=true", () => {
    expect(parseAttemptStartInput({ paperId: "p1" }).ok).toBe(true);
    expect(parseAttemptReplaceInput({ paperId: "p2", abandonAttemptId: "a1", expectedRevision: 1 }).ok).toBe(false);
    expect(parseAttemptAbandonInput({ attemptId: "a1", expectedRevision: 1, confirmed: false }).ok).toBe(false);
    expect(
      parseAttemptReplaceInput({ paperId: "p2", abandonAttemptId: "a1", expectedRevision: 1, confirmed: true }).ok
    ).toBe(true);
  });

  it("builds a real draft summary only when an active attempt exists", () => {
    expect(emptyDraftSummary()).toEqual({ attemptId: null });
    expect(
      draftSummaryOf({
        memberId: "m1",
        attemptId: "a1",
        paperId: "p1",
        paperTitle: "虚构卷",
        paperVersionId: "v1",
        revision: 2,
        answeredCount: 1,
        questionCount: 3,
        updatedAt: "2026-10-10T00:00:00.000Z",
        schemaVersion: 1
      })
    ).toMatchObject({ attemptId: "a1", paperId: "p1", revision: 2, answeredCount: 1 });
  });
});
