import { asRecord, errorInfo } from "../../services/browse";
import { callOfficialAction } from "../../services/shared-cloud";
import { markLeftoverFeedbackId } from "../../services/known-ids";

Page({
  data: {
    type: "question_error",
    paperId: "",
    questionId: "",
    versionId: "",
    text: "",
    feedbackId: "",
    result: "尚未提交"
  },
  onLoad(query?: Record<string, string | undefined>) {
    this.setData({
      type: query?.type === "analysis_error" ? "analysis_error" : "question_error",
      paperId: String(query?.paperId || ""),
      questionId: String(query?.questionId || ""),
      versionId: String(query?.versionId || "")
    });
  },
  pickType(event?: { currentTarget?: { dataset?: { type?: string } } }) {
    const type = event?.currentTarget?.dataset?.type;
    if (type === "question_error" || type === "analysis_error") this.setData({ type });
  },
  onPaper(event?: { detail?: { value?: string } }) {
    this.setData({ paperId: event?.detail?.value || "" });
  },
  onQuestion(event?: { detail?: { value?: string } }) {
    this.setData({ questionId: event?.detail?.value || "" });
  },
  onVersion(event?: { detail?: { value?: string } }) {
    this.setData({ versionId: event?.detail?.value || "" });
  },
  onText(event?: { detail?: { value?: string } }) {
    this.setData({ text: event?.detail?.value || "" });
  },
  async submit() {
    const res = await callOfficialAction(
      "mw-member",
      "feedback.create",
      {
        type: this.data.type,
        paperId: this.data.paperId,
        questionId: this.data.questionId,
        versionId: this.data.versionId,
        text: this.data.text
      },
      { requestId: `req_mp_feedback_${Date.now()}`, idempotencyKey: `mp_feedback_${Date.now()}` }
    );
    const data = asRecord(res.data);
    this.setData({
      feedbackId: String(data.feedbackId || ""),
      result: JSON.stringify({
        ok: res.ok,
        feedbackId: data.feedbackId,
        status: data.status,
        error: res.ok ? undefined : errorInfo(res)
      })
    });
  },
  markLeftover() {
    const ok = markLeftoverFeedbackId(String(this.data.feedbackId || ""));
    wx.showToast({ title: ok ? "已记入本轮 leftover（反馈）" : "请先成功提交反馈", icon: "none" });
  }
});
