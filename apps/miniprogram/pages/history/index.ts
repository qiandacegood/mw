import { asRecord } from "../../services/browse";
import { attemptError, memberAction } from "../../services/attempt";

Page({
  data: {
    state: "loading",
    message: "",
    paperId: "",
    items: [] as Array<{
      attemptId: string;
      paperTitle: string;
      score: number;
      maxScore: number;
      submittedAt: string;
      corrected: boolean;
      correctionNote: string;
    }>,
    nextCursor: ""
  },
  onLoad(query?: Record<string, string | undefined>) {
    this.setData({ paperId: String(query?.paperId || "") });
    void this.reload?.();
  },
  async reload() {
    this.setData({ items: [], nextCursor: "", state: "loading" });
    await this.fetchPage?.("");
  },
  async more() {
    await this.fetchPage?.(String(this.data.nextCursor || ""));
  },
  async fetchPage(cursor?: string) {
    const data: Record<string, unknown> = { limit: 20 };
    if (this.data.paperId) data.paperId = this.data.paperId;
    if (cursor) data.cursor = cursor;
    const res = await memberAction("attempt.history", data);
    if (!res.ok) {
      const info = attemptError(res);
      this.setData({ state: "error", message: info.message });
      return;
    }
    const payload = asRecord(res.data);
    const incoming = (Array.isArray(payload.items) ? payload.items : []).map((row) => {
      const rec = asRecord(row);
      return {
        attemptId: String(rec.attemptId || ""),
        paperTitle: String(rec.paperTitle || "试卷"),
        score: Number(rec.score || 0),
        maxScore: Number(rec.maxScore || 0),
        submittedAt: String(rec.submittedAt || ""),
        corrected: rec.corrected === true,
        correctionNote: String(rec.correctionNote || "")
      };
    });
    this.setData({
      state: "ok",
      items: cursor ? [...((this.data.items || []) as typeof incoming), ...incoming] : incoming,
      nextCursor: String(payload.nextCursor || "")
    });
  },
  goResult(event?: { currentTarget?: { dataset?: { id?: string } } }) {
    const attemptId = String(event?.currentTarget?.dataset?.id || "");
    if (!attemptId) return;
    wx.navigateTo({ url: `/pages/result/index?attemptId=${encodeURIComponent(attemptId)}` });
  }
});
