import { asRecord, errorInfo, labelAccess, labelDifficulty, memberMe, paperPath, publicAction } from "../../services/browse";
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
    const vipRequired = !guest && access === "vip";
    const canShowStart = !guest && access === "free";
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
      guest,
      vipRequired,
      canShowStart,
      startHint: canShowStart ? "开始入口已显示，但 MW14 未接通，不会真正开局。" : ""
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
  startFree() {
    wx.showModal({
      title: "尚未接通答题",
      content: "MW14 未接通，不能创建答题记录，也不会真正开局。",
      showCancel: false
    });
  }
});
