import { asRecord } from "../../services/browse";
import { attemptError, memberAction } from "../../services/attempt";

Page({
  data: {
    state: "loading",
    message: "",
    attemptId: "",
    wrongOnly: false,
    items: [] as Array<{ questionId: string; score: number; selectedText: string; correctText: string; analysis: string }>
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
    const first = await memberAction("attempt.analysis", {
      attemptId,
      chunkNo: 1,
      wrongOnly: this.data.wrongOnly === true
    });
    if (!first.ok) {
      const info = attemptError(first);
      this.setData({ state: "error", message: info.message });
      return;
    }
    const page = asRecord(first.data);
    const chunkCount = Number(page.chunkCount || 1);
    const raw = [...(Array.isArray(page.items) ? page.items : [])];
    for (let chunkNo = 2; chunkNo <= chunkCount; chunkNo += 1) {
      const next = await memberAction("attempt.analysis", {
        attemptId,
        chunkNo,
        wrongOnly: this.data.wrongOnly === true
      });
      if (!next.ok) {
        const info = attemptError(next);
        this.setData({ state: "error", message: info.message });
        return;
      }
      const items = asRecord(next.data).items;
      if (Array.isArray(items)) raw.push(...items);
    }
    this.setData({
      state: "ok",
      items: raw.map((row) => {
        const rec = asRecord(row);
        const selected = Array.isArray(rec.selectedOptionIds) ? rec.selectedOptionIds.map(String) : [];
        const correct = Array.isArray(rec.correctOptionIds) ? rec.correctOptionIds.map(String) : [];
        return {
          questionId: String(rec.questionId || ""),
          score: Number(rec.score || 0),
          selectedText: selected.length ? selected.join(" ") : "未答",
          correctText: correct.join(" "),
          analysis: String(rec.analysis || "")
        };
      })
    });
  },
  toggleWrong() {
    this.setData({ wrongOnly: !this.data.wrongOnly });
    void this.reload?.();
  },
  goResult() {
    const attemptId = String(this.data.attemptId || "");
    wx.navigateTo({ url: `/pages/result/index?attemptId=${encodeURIComponent(attemptId)}` });
  }
});
