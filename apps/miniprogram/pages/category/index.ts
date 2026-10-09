import { asRecord, errorInfo, publicAction } from "../../services/browse";

type Node = {
  id: string;
  parentId: string;
  depth: number;
  name: string;
  sort: number;
};

function asNode(item: unknown): Node {
  const rec = asRecord(item);
  return {
    id: String(rec.id || ""),
    parentId: rec.parentId == null ? "" : String(rec.parentId),
    depth: Number(rec.depth || 1),
    name: String(rec.name || ""),
    sort: Number(rec.sort || 0)
  };
}

Page({
  data: {
    state: "loading",
    message: "加载中…",
    currentId: "",
    title: "分类",
    crumbs: [] as Array<{ id: string; name: string }>,
    children: [] as Node[],
    canGoDeeper: false
  },
  onShow() {
    const app = getApp<{ globalData: { pendingCategoryId: string } }>();
    const pending = String(app.globalData.pendingCategoryId || "");
    app.globalData.pendingCategoryId = "";
    void this.loadTree?.(pending);
  },
  async loadTree(preferredId?: string) {
    this.setData({ state: "loading", message: "加载中…" });
    const res = await publicAction("category.tree");
    if (!res.ok) {
      const info = errorInfo(res);
      this.setData({ state: "error", message: `${info.message}。可重试。` });
      return;
    }
    const data = asRecord(res.data);
    const nodes = Array.isArray(data.nodes) ? data.nodes.map(asNode).filter((item) => item.id) : [];
    if (!nodes.length) {
      this.setData({ state: "empty", message: "暂无可用类目。", children: [], crumbs: [] });
      return;
    }
    const currentId = preferredId && nodes.some((item) => item.id === preferredId) ? preferredId : "";
    this.applyNode?.(nodes, currentId);
  },
  applyNode(nodes: unknown, currentId?: string) {
    const list = Array.isArray(nodes) ? (nodes as Node[]) : [];
    const selected = String(currentId || "");
    const byId = new Map(list.map((item) => [item.id, item]));
    const current = selected ? byId.get(selected) : undefined;
    const crumbs: Array<{ id: string; name: string }> = [{ id: "", name: "分类" }];
    if (current) {
      const trail: Node[] = [];
      let walk: Node | undefined = current;
      const seen = new Set<string>();
      while (walk && !seen.has(walk.id)) {
        seen.add(walk.id);
        trail.unshift(walk);
        walk = walk.parentId ? byId.get(walk.parentId) : undefined;
      }
      crumbs.push(...trail.map((item) => ({ id: item.id, name: item.name })));
    }
    const parentKey = current ? current.id : "";
    const children = list
      .filter((item) => (current ? item.parentId === current.id : !item.parentId && item.depth === 1))
      .sort((left, right) => left.sort - right.sort || left.id.localeCompare(right.id));
    this.setData({
      state: "ok",
      message: children.length ? "" : current ? "已到当前级。可查看本级及后代试卷。" : "暂无可用类目。",
      currentId: parentKey,
      title: current?.name || "分类",
      crumbs,
      children,
      canGoDeeper: Boolean(current && current.depth < 3)
    });
  },
  async reload() {
    await this.loadTree?.(String(this.data.currentId || ""));
  },
  selectCrumb(event?: { currentTarget?: { dataset?: { id?: string } } }) {
    void this.loadTree?.(String(event?.currentTarget?.dataset?.id || ""));
  },
  enterChild(event?: { currentTarget?: { dataset?: { id?: string } } }) {
    void this.loadTree?.(String(event?.currentTarget?.dataset?.id || ""));
  },
  openList() {
    const currentId = String(this.data.currentId || "");
    const query = currentId ? `?categoryId=${encodeURIComponent(currentId)}` : "";
    wx.navigateTo({ url: `/pages/papers/index${query}` });
  }
});
