import { asRecord, errorInfo, labelAccess, labelDifficulty, memberMe, paperPath, publicAction } from "../../services/browse";
import { attemptError, decideActiveDraft, memberAction, paperStartFlags, replaceStartBody } from "../../services/attempt";
import { markLeftoverPaperId } from "../../services/known-ids";

Page({
  data: {
    state: "loading",
    message: "加载中…",
    paperId: "",
    title: "",
    summary: "",
    goal: "",
    meta: "",
    path: "",
    access: "free",
    accessLabel: "",
    guest: true,
    vipRequired: false,
    startHint: "",
    canShowStart: false,
    leftoverMarked: false
  },
  onLoad(query?: Record<string, string | undefined>) {
    const paperId = String(query?.paperId || "");
    this.setData({ paperId, leftoverMarked: false });
    void this.reload?.();
  },
  async reload() {
    const paperId = String(this.data.paperId || "");
    if (!paperId) {
      this.setData({ state: "error", message: "缺少试卷标识。" });
      return;
    }
    this.setData({ state: "loading", message: "加载中…" });
    const res = await publicAction("paper.detail", { paperId });
    if (!res.ok) {
      const info = errorInfo(res);
      let message = `${info.message}。不可开始。`;
      if (info.reason === "PAPER_UNPUBLISHED" || info.code === "NOT_FOUND") {
        message = "试卷已下架，不能新开始。";
      }
      if (info.code === "PAPER_WITHDRAWN") {
        message = "试卷已紧急撤回，不能新开始。";
      }
      if (info.code === "CATEGORY_UNAVAILABLE") {
        message = "类目不可用，不能开始。";
      }
      if (info.code === "SERVICE_BUSY") {
        message = "网络失败或服务繁忙。可重试。";
      }
      this.setData({
        state: info.code === "SERVICE_BUSY" ? "error" : "unavailable",
        message
      });
      return;
    }
    const paper = asRecord(asRecord(res.data).paper);
    const me = await memberMe();
    const guest = !me.ok;
    const access = String(paper.access || "free");
    const flags = paperStartFlags(guest, access);
    this.setData({
      state: "ok",
      message: "",
      title: String(paper.title || "未命名试卷"),
      summary: String(paper.summary || ""),
      goal: String(paper.goal || ""),
      meta: `${paper.questionCount || 0} 题 · 满分 ${paper.maxScore || 0} · ${labelDifficulty(String(paper.difficulty || ""))} · 建议 ${paper.suggestedMinutes || 0} 分钟`,
      path: paperPath(paper),
      access,
      accessLabel: labelAccess(access),
      ...flags
    });
  },
  goRegister() {
    wx.navigateTo({ url: "/pages/register/index" });
  },
  markLeftover() {
    const paperId = String(this.data.paperId || "");
    if (!markLeftoverPaperId(paperId)) {
      wx.showToast({ title: "无法记入本轮 leftover", icon: "none" });
      return;
    }
    this.setData({ leftoverMarked: true });
    wx.showToast({ title: "已记入本轮 leftover", icon: "none" });
  },
  async startFree() {
    const paperId = String(this.data.paperId || "");
    if (!paperId) return;
    const res = await memberAction(
      "attempt.start",
      { paperId },
      { requestId: `req_mp_start_${Date.now()}`, idempotencyKey: `mp_start_${paperId}_${Date.now()}` }
    );
    if (res.ok) {
      const attemptId = String(asRecord(res.data).attemptId || "");
      if (!attemptId) return;
      wx.navigateTo({ url: `/pages/quiz/index?attemptId=${encodeURIComponent(attemptId)}` });
      return;
    }
    const info = attemptError(res);
    if (info.code === "ACTIVE_ATTEMPT_EXISTS") {
      const existingId = String(info.details.existingAttemptId || "");
      const existingTitle = String(info.details.existingTitle || "原试卷");
      const existingRevision = Number(info.details.existingRevision || 0);
      wx.showModal({
        title: "已有进行中的试卷",
        content: `继续「${existingTitle}」，还是放弃原草稿并开始本卷？放弃不计分。未确认不会丢掉原草稿。`,
        confirmText: "继续原卷",
        cancelText: "放弃原卷",
        success: (choice) => {
          const decision = decideActiveDraft(choice);
          if (decision === "continue") {
            if (existingId) wx.navigateTo({ url: `/pages/quiz/index?attemptId=${encodeURIComponent(existingId)}` });
            return;
          }
          if (decision === "replace") void this.replaceStart?.(existingId, existingRevision);
        }
      });
      return;
    }
    if (info.code === "MEMBER_REQUIRED") {
      this.goRegister?.();
      return;
    }
    if (info.code === "VIP_REQUIRED") {
      this.setData({ vipRequired: true, canShowStart: false, startHint: "" });
    }
    wx.showModal({ title: "不能开始", content: info.message, showCancel: false });
  },
  async replaceStart(abandonAttemptId: string, expectedRevision = 0) {
    const paperId = String(this.data.paperId || "");
    if (!paperId || !abandonAttemptId) return;
    const res = await memberAction(
      "attempt.startReplacing",
      replaceStartBody(paperId, abandonAttemptId, expectedRevision),
      { requestId: `req_mp_replace_${Date.now()}`, idempotencyKey: `mp_replace_${paperId}_${Date.now()}` }
    );
    if (!res.ok) {
      wx.showModal({ title: "未能开始新卷", content: attemptError(res).message, showCancel: false });
      return;
    }
    const attemptId = String(asRecord(res.data).attemptId || "");
    if (attemptId) wx.navigateTo({ url: `/pages/quiz/index?attemptId=${encodeURIComponent(attemptId)}` });
  }
});
