import { asRecord, errorInfo, labelAccess, memberMe, publicAction } from "../../services/browse";
import { knownIdClipboardText } from "../../services/known-ids";

type ShelfItem = {
  paperId: string;
  title: string;
  access: string;
  accessLabel: string;
  difficultyLabel: string;
};

function toShelf(items: unknown): ShelfItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const rec = asRecord(item);
    return {
      paperId: String(rec.paperId || ""),
      title: String(rec.title || "未命名试卷"),
      access: String(rec.access || "free"),
      accessLabel: labelAccess(String(rec.access || "free")),
      difficultyLabel: rec.difficulty === "challenge" ? "挑战" : rec.difficulty === "intermediate" ? "进阶" : "入门"
    };
  });
}

Page({
  data: {
    state: "loading",
    message: "加载中…",
    intro: "用选择与解析练习思路。分数不代表智力测评。",
    guest: true,
    totalScore: "",
    levelId: "",
    roots: [] as Array<{ id: string; name: string }>,
    recommended: [] as ShelfItem[],
    latest: [] as ShelfItem[],
    lookupId: ""
  },
  onShow() {
    void this.reload?.();
  },
  async reload() {
    this.setData({ state: "loading", message: "加载中…" });
    const home = await publicAction("home.get");
    if (!home.ok) {
      const info = errorInfo(home);
      this.setData({ state: "error", message: `${info.message}。可重试。` });
      return;
    }
    const data = asRecord(home.data);
    const roots = Array.isArray(data.roots)
      ? data.roots
          .map((item) => asRecord(item))
          .filter((item) => item.depth === 1)
          .map((item) => ({ id: String(item.id || ""), name: String(item.name || "") }))
          .filter((item) => item.id)
      : [];
    const recommended = toShelf(data.recommended);
    const latest = toShelf(data.latest);
    const me = await memberMe();
    const guest = !me.ok;
    const meData = asRecord(me.data);
    const stats = asRecord(meData.stats);
    this.setData({
      state: recommended.length || latest.length || roots.length ? "ok" : "empty",
      message: recommended.length || latest.length ? "" : "暂无推荐卷。可从分类浏览。",
      guest,
      totalScore: guest ? "" : String(stats.totalScore ?? 0),
      levelId: guest ? "" : String(stats.levelId || "L1"),
      roots,
      recommended,
      latest
    });
  },
  goCategory(event?: { currentTarget?: { dataset?: { id?: string } } }) {
    const app = getApp<{ globalData: { pendingCategoryId: string } }>();
    app.globalData.pendingCategoryId = String(event?.currentTarget?.dataset?.id || "");
    wx.switchTab({ url: "/pages/category/index" });
  },
  goPaper(event?: { currentTarget?: { dataset?: { id?: string } } }) {
    const id = String(event?.currentTarget?.dataset?.id || "");
    if (!id) return;
    wx.navigateTo({ url: `/pages/paper/index?paperId=${encodeURIComponent(id)}` });
  },
  goRegister() {
    wx.navigateTo({ url: "/pages/register/index" });
  },
  onLookupInput(event: { detail?: { value?: string } }) {
    this.setData({ lookupId: String(event.detail?.value || "") });
  },
  openLookup() {
    const id = String(this.data.lookupId || "").trim();
    if (!id) {
      wx.showToast({ title: "请输入试卷标识", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/paper/index?paperId=${encodeURIComponent(id)}` });
  },
  copyKnownIds() {
    const text = knownIdClipboardText();
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: JSON.parse(text).papers.length ? "已复制本轮哈希" : "本轮 leftover 为空", icon: "none" });
      }
    });
  }
});
