import { describe, expect, it } from "vitest";
import {
  FEEDBACK_TYPES,
  feedbackContainsExternalLink,
  feedbackDocId,
  feedbackTriesToMutateAnswers,
  paperBindsQuestionVersion,
  parseFeedbackCreateInput,
  parseFeedbackListInput,
  parseFeedbackResolveInput,
  publicSupportEntry
} from "./feedback.js";

describe("feedback create contract", () => {
  it("requires paper/question/version and rejects external links", () => {
    expect(FEEDBACK_TYPES).toEqual(["question_error", "analysis_error"]);
    expect(
      parseFeedbackCreateInput({
        type: "question_error",
        paperId: "p1",
        questionId: "q1",
        versionId: "v1",
        text: "题干与选项对不上"
      }).ok
    ).toBe(true);
    expect(
      parseFeedbackCreateInput({
        type: "analysis_error",
        paperId: "p1",
        questionId: "q1",
        versionId: "v1",
        text: "解析写了 https://evil.example"
      }).ok
    ).toBe(false);
    expect(parseFeedbackCreateInput({ type: "question_error", text: "缺少绑定" }).ok).toBe(false);
    expect(
      parseFeedbackCreateInput({
        type: "question_error",
        paperId: "p1",
        questionId: "q1",
        versionId: "v1",
        text: "题干错了",
        url: "https://evil.example"
      }).ok
    ).toBe(false);
    expect(feedbackContainsExternalLink("见 www.example.com")).toBe(true);
  });

  it("rejects answer-bank mutation keys and unknown types", () => {
    expect(feedbackTriesToMutateAnswers({ answer: "A", feedbackId: "x" })).toContain("answer");
    expect(parseFeedbackCreateInput({ type: "order_refund", paperId: "p", questionId: "q", versionId: "v", text: "售后" }).ok).toBe(
      false
    );
  });
});

describe("feedback list/resolve and version bind", () => {
  it("parses list/resolve and binds question version on a paper snapshot", () => {
    expect(parseFeedbackListInput({ status: "open", limit: 20 }).ok).toBe(true);
    expect(parseFeedbackResolveInput({ feedbackId: "fb1", note: "已核对原版解析无误" }).ok).toBe(true);
    expect(parseFeedbackResolveInput({ feedbackId: "fb1" }).ok).toBe(false);
    expect(
      paperBindsQuestionVersion({
        questionIds: ["q1", "q2"],
        questionVersionIds: ["qv1", "qv2"],
        questionId: "q2",
        versionId: "qv2"
      })
    ).toBe(true);
    expect(
      paperBindsQuestionVersion({
        questionIds: ["q1"],
        questionVersionIds: ["qv1"],
        questionId: "q1",
        versionId: "qv-other"
      })
    ).toBe(false);
    const left = feedbackDocId({
      memberId: "m1",
      paperId: "p1",
      questionId: "q1",
      versionId: "v1",
      idempotencyKey: "k1"
    });
    const right = feedbackDocId({
      memberId: "m1",
      paperId: "p1",
      questionId: "q1",
      versionId: "v1",
      idempotencyKey: "k1"
    });
    expect(left).toBe(right);
    expect(left).toHaveLength(64);
    const support = publicSupportEntry("2026-10-18T00:00:00.000Z");
    expect(support.channel).toBe("in-app");
    expect(support.placeholder).toBe(true);
    expect(support.note).toMatch(/题目或解析错误/);
  });
});
