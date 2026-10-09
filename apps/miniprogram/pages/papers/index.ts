import { asRecord, errorInfo, labelAccess, labelDifficulty, publicAction } from "../../services/browse";

type PaperItem = {
  paperId: string;
  title: string;
  access: string;
  accessLabel: string;
  difficultyLabel: string;
  maxScore: string;
};

Page({
  data: {
    state: "loading",
    message: "加载中…",
    categoryId: "",
    difficulty: "",
    access: "",
    progress: "",
    sort: "recommended",
    items: [] as PaperItem[],
    nextCursor: "",
    complete: true
  },
  onLoad(query?: Record<string, string | undefined>) {
    this.setData({ categoryId: String(query?.categoryId || "") });
    void this.reload?.(true);
  },
  filters() {
    const data: Record<string, unknown> = {
      includeDescendants: true,
      sort: String(this.data.sort || "recommended"),
      limit: 20
    };
    const categoryId = String(this.data.categoryId || "");
    const difficulty = String(this.data.difficulty || "");
    const access = String(this.data.access || "");
    const progress = String(this.data.progress || "");
    if (categoryId) data.categoryId = categoryId;
    if (difficulty) data.difficulty = difficulty;
    if (access) data.access = access;
    if (progress) data.progress = progress;
    return data;
  },
  async reload(reset?: boolean) {
    this.setData({ state: "loading", message: "加载中…" });
    const data = this.filters?.() || {};
    const cursor = String(this.data.nextCursor || "");
    if (!reset && cursor) data.cursor = cursor;
    const res = await publicAction("paper.list", data);
    if (!res.ok) {
      const info = errorInfo(res);
      const unavailable = info.code === "CATEGORY_UNAVAILABLE";
      this.setData({
        state: unavailable ? "unavailable" : "error",
        message: unavailable ? "该类目不可用。" : `${info.message}。可重试。`,
        items: reset ? [] : Array.isArray(this.data.items) ? this.data.items : []
      });
      return;
    }
    const body = asRecord(res.data);
    const incoming = Array.isArray(body.items)
      ? body.items.map((item) => {
          const rec = asRecord(item);
          return {
            paperId: String(rec.paperId || ""),
            title: String(rec.title || "未命名试卷"),
            access: String(rec.access || "free"),
            accessLabel: labelAccess(String(rec.access || "free")),
            difficultyLabel: labelDifficulty(String(rec.difficulty || "beginner")),
            maxScore: String(rec.maxScore ?? "")
          };
        })
      : [];
    const previous = Array.isArray(this.data.items) ? this.data.items : [];
    const items = reset ? incoming : [...previous, ...incoming];
    this.setData({
      state: items.length ? "ok" : "empty",
      message: items.length ? "" : "当前筛选无结果。",
      items,
      nextCursor: typeof body.nextCursor === "string" ? body.nextCursor : "",
      complete: body.complete !== false
    });
  },
  setDifficulty(event?: { currentTarget?: { dataset?: { value?: string } } }) {
    this.setData({ difficulty: String(event?.currentTarget?.dataset?.value || "") });
    void this.reload?.(true);
  },
  setAccess(event?: { currentTarget?: { dataset?: { value?: string } } }) {
    this.setData({ access: String(event?.currentTarget?.dataset?.value || "") });
    void this.reload?.(true);
  },
  setProgress(event?: { currentTarget?: { dataset?: { value?: string } } }) {
    this.setData({ progress: String(event?.currentTarget?.dataset?.value || "") });
    void this.reload?.(true);
  },
  setSort(event?: { currentTarget?: { dataset?: { value?: string } } }) {
    this.setData({ sort: String(event?.currentTarget?.dataset?.value || "recommended") });
    void this.reload?.(true);
  },
  clearFilters() {
    this.setData({ difficulty: "", access: "", progress: "", sort: "recommended" });
    void this.reload?.(true);
  },
  more() {
    if (this.data.complete === true || !this.data.nextCursor) return;
    void this.reload?.(false);
  },
  openPaper(event?: { currentTarget?: { dataset?: { id?: string } } }) {
    const id = String(event?.currentTarget?.dataset?.id || "");
    if (!id) return;
    wx.navigateTo({ url: `/pages/paper/index?paperId=${encodeURIComponent(id)}` });
  }
});
