import { asRecord } from "../../services/browse";
import { attemptError, memberAction } from "../../services/attempt";
import { markLeftoverAttemptId } from "../../services/known-ids";

Page({
  data: {
    state: "loading",
    message: "",
    attemptId: "",
    status: "",
    score: 0,
    maxScore: 0,
    bestScore: 0,
    delta: 0,
    totalScore: 0,
    levelId: "",
    correctCount: 0,
    questionCount: 0,
    leftoverMarked: false,
    corrected: false,
    correctionNote: ""
  },
  onLoad(query?: Record<string, string | undefined>) {
    this.setData({ attemptId: String(query?.attemptId || "") });
    void this.reload?.();
  },
  async reload() {
    const attemptId = String(this.data.attemptId || "");
    if (!attemptId) {
      this.setData({ state: "error", message: "缺少答题记录。" });
      return;
    }
    this.setData({ state: "loading" });
    const res = await memberAction("attempt.result", { attemptId });
    if (!res.ok) {
      const info = attemptError(res);
      this.setData({ state: "error", message: info.message });
      return;
    }
    const data = asRecord(res.data);
    const status = String(data.status || "");
    this.setData({
      state: "ok",
      status,
      score: Number(data.score || 0),
      maxScore: Number(data.maxScore || 0),
      bestScore: Number(data.bestScore || 0),
      delta: Number(data.delta || 0),
      totalScore: Number(data.totalScore || 0),
      levelId: String(data.levelId || ""),
      correctCount: Number(data.correctCount || 0),
      questionCount: Number(data.questionCount || 0),
      corrected: data.corrected === true,
      correctionNote: String(data.correctionNote || "")
    });
  },
  goAnalysis() {
    const attemptId = String(this.data.attemptId || "");
    wx.navigateTo({ url: `/pages/analysis/index?attemptId=${encodeURIComponent(attemptId)}` });
  },
  goHistory() {
    wx.navigateTo({ url: "/pages/history/index" });
  },
  goFeedback() {
    const attemptId = String(this.data.attemptId || "");
    wx.navigateTo({ url: `/pages/analysis/index?attemptId=${encodeURIComponent(attemptId)}` });
  },
  markLeftover() {
    if (!markLeftoverAttemptId(String(this.data.attemptId || ""))) {
      wx.showToast({ title: "无法记入本轮 leftover", icon: "none" });
      return;
    }
    this.setData({ leftoverMarked: true });
    wx.showToast({ title: "已记入本轮 leftover", icon: "none" });
  }
});
