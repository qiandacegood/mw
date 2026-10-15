import { asRecord, memberMe } from "../../services/browse";
import { publicCategoryTree, rankingList, rankingMe, setRanking, type RankingScopeName } from "../../services/ranking";
import {
  SCOPE_LABEL,
  boundaryNoticeOf,
  categoryOptionsOf,
  emptyHintOf,
  errorTextOf,
  historyGapTextOf,
  meViewOf,
  refreshViewOf,
  rowViewsOf,
  scopeRule,
  staleNoticeOf,
  type CategoryOption,
  type RankingMeView,
  type RankingRefreshView,
  type RankingRowView
} from "../../services/ranking-ui";

const PAGE_SIZE = 20;

type RankingTab = { key: RankingScopeName; label: string };

const TABS: RankingTab[] = [
  { key: "total", label: SCOPE_LABEL.total },
  { key: "category", label: SCOPE_LABEL.category },
  { key: "week", label: SCOPE_LABEL.week },
  { key: "month", label: SCOPE_LABEL.month }
];

type RankingPageData = {
  tabs: RankingTab[];
  scope: RankingScopeName;
  rule: string;
  state: string;
  message: string;
  loadingMore: boolean;
  currency: string;
  rows: RankingRowView[];
  nextCursor: string;
  complete: boolean;
  boundaryNotice: string;
  staleNotice: string;
  historyGapText: string;
  refresh: RankingRefreshView;
  generation: string;
  me: RankingMeView;
  meRankKey: string;
  memberRevision: number;
  loggedIn: boolean;
  settingsOpen: boolean;
  settingBusy: boolean;
  categoryId: string;
  categoryName: string;
  categoryOptions: CategoryOption[];
  pickerOpen: boolean;
};

/** 小程序自带 Page 类型是宽松手写声明，这里统一收敛到本页的数据形状。 */
function d(self: PageInstance): RankingPageData {
  return self.data as unknown as RankingPageData;
}

Page({
  data: {
    tabs: TABS,
    scope: "total",
    rule: scopeRule("total"),
    state: "loading",
    message: "加载中…",
    loadingMore: false,
    currency: "免费卷与 VIP 卷统一计入，不提供费用筛选。",
    rows: [],
    nextCursor: "",
    complete: true,
    boundaryNotice: "",
    staleNotice: "",
    historyGapText: "",
    refresh: { status: "unpublished", label: "", detail: "", tone: "muted" },
    generation: "",
    me: {
      participating: false,
      onBoard: false,
      rankText: "-",
      valueText: "",
      valueDiffText: "",
      hint: "",
      historyGapNote: ""
    },
    meRankKey: "",
    memberRevision: 0,
    loggedIn: false,
    settingsOpen: false,
    settingBusy: false,
    categoryId: "",
    categoryName: "",
    categoryOptions: [],
    pickerOpen: false
  },
  onLoad() {
    void this.loadCategories?.();
  },
  onShow() {
    void this.reload?.();
  },
  onPullDownRefresh() {
    void this.reload?.(true);
  },
  async loadCategories(this: PageInstance) {
    const res = await publicCategoryTree();
    if (!res.ok) return;
    const data = asRecord(res.data);
    this.setData({ categoryOptions: categoryOptionsOf(data.nodes) });
  },
  /** 榜单与本人名次并行读取；若两代不一致，按服务端最新代重取一次榜单，保证同一代展示。 */
  async reload(this: PageInstance, fromPull = false) {
    const current = d(this);
    this.setData({ state: "loading", message: "加载中…" });
    const scope = current.scope;
    const categoryId = scope === "category" ? current.categoryId : "";
    if (scope === "category" && !categoryId) {
      this.setData({
        state: "empty",
        message: emptyHintOf(scope, categoryId, ""),
        rows: [],
        nextCursor: "",
        complete: true
      });
      if (fromPull) wx.stopPullDownRefresh();
      return;
    }
    const [listRes, meRes, profileRes] = await Promise.all([
      rankingList({ scope, categoryId: categoryId || undefined, limit: PAGE_SIZE }),
      rankingMe(scope, categoryId || undefined),
      memberMe()
    ]);
    if (!listRes.ok) {
      const info = errorTextOf(listRes);
      this.setData({ state: "error", message: info.message, rows: [], nextCursor: "", complete: true });
      if (fromPull) wx.stopPullDownRefresh();
      return;
    }
    const meData = asRecord(meRes.data);
    const profile = asRecord(profileRes.data);
    const meView = meViewOf(meRes.ok ? meData : {}, scope, String(asRecord(meData.refresh).status || ""));
    this.setData({
      loggedIn: meRes.ok === true,
      me: profileRes.ok ? { ...meView, participating: profile.rankingOptIn === true } : meView,
      meRankKey: meRes.ok ? String(meData.rankKey || "") : "",
      memberRevision: profileRes.ok && typeof profile.revision === "number" ? profile.revision : 0,
      settingsOpen: false
    });

    let listData = asRecord(listRes.data);
    const meGeneration = meRes.ok ? String(meData.generation || "") : "";
    if (meGeneration && meGeneration !== String(listData.generation || "")) {
      const retry = await rankingList({ scope, categoryId: categoryId || undefined, limit: PAGE_SIZE });
      if (retry.ok) {
        listData = asRecord(retry.data);
        this.setData({ message: "榜单已刷新，本人名次与榜单已同步到同一代快照。" });
      }
    }
    this.applyList?.(listData, false);
    if (fromPull) wx.stopPullDownRefresh();
  },
  applyList(this: PageInstance, data: Record<string, unknown>, append: boolean) {
    const current = d(this);
    const refresh = refreshViewOf(asRecord(data.refresh));
    const rows = rowViewsOf(data.rows, current.meRankKey);
    const merged = append ? current.rows.concat(rows) : rows;
    const displayCount = Number(data.displayCount || 0);
    const participantCount = Number(data.participantCount || 0);
    const nextCursor = String(data.nextCursor || "");
    this.setData({
      rows: merged,
      nextCursor,
      complete: !nextCursor,
      generation: String(data.generation || ""),
      refresh,
      boundaryNotice: boundaryNoticeOf(participantCount, displayCount, data.boundaryTruncated === true),
      staleNotice: staleNoticeOf(Number(data.staleFiltered || 0)),
      historyGapText: historyGapTextOf(asRecord(data.historyGap)),
      state: merged.length ? "ok" : "empty",
      message: merged.length ? "" : emptyHintOf(current.scope, current.categoryId, refresh.status)
    });
  },
  async loadMore(this: PageInstance) {
    const current = d(this);
    if (current.loadingMore || !current.nextCursor) return;
    this.setData({ loadingMore: true });
    const scope = current.scope;
    const res = await rankingList({
      scope,
      categoryId: scope === "category" ? current.categoryId : undefined,
      cursor: current.nextCursor,
      limit: PAGE_SIZE
    });
    if (res.ok) {
      this.applyList?.(asRecord(res.data), true);
    } else {
      wx.showToast({ title: errorTextOf(res).message, icon: "none" });
    }
    this.setData({ loadingMore: false });
  },
  retry() {
    void this.reload?.();
  },
  onTabChange(this: PageInstance, event?: { detail?: { value?: unknown } }) {
    const scope = String(event?.detail?.value || "");
    if (!TABS.some((tab) => tab.key === scope)) return;
    this.setData({ scope: scope as RankingScopeName, rule: scopeRule(scope) });
    const current = d(this);
    if (scope === "category" && !current.categoryId) {
      this.setData({ rows: [], state: "empty", message: emptyHintOf(scope, "", "") });
      return;
    }
    void this.reload?.();
  },
  openCategoryPicker(this: PageInstance) {
    if (!d(this).categoryOptions.length) void this.loadCategories?.();
    this.setData({ pickerOpen: true });
  },
  closeCategoryPicker() {
    this.setData({ pickerOpen: false });
  },
  onPickerVisibleChange(this: PageInstance, event?: { detail?: { visible?: boolean } }) {
    this.setData({ pickerOpen: event?.detail?.visible === true });
  },
  chooseCategory(this: PageInstance, event?: { currentTarget?: { dataset?: { id?: string; name?: string } } }) {
    const categoryId = String(event?.currentTarget?.dataset?.id || "");
    if (!categoryId) return;
    this.setData({
      categoryId,
      categoryName: String(event?.currentTarget?.dataset?.name || ""),
      pickerOpen: false,
      scope: "category",
      rule: scopeRule("category")
    });
    void this.reload?.();
  },
  openSettings(this: PageInstance) {
    if (!d(this).loggedIn) {
      wx.showToast({ title: "请先注册成为会员", icon: "none" });
      return;
    }
    this.setData({ settingsOpen: true });
  },
  closeSettings() {
    this.setData({ settingsOpen: false });
  },
  onSettingsVisibleChange(this: PageInstance, event?: { detail?: { visible?: boolean } }) {
    this.setData({ settingsOpen: event?.detail?.visible === true });
  },
  async toggleRanking(this: PageInstance) {
    const current = d(this);
    if (current.settingBusy) return;
    if (!current.loggedIn) {
      wx.showToast({ title: "请先注册成为会员", icon: "none" });
      return;
    }
    const revision = current.memberRevision;
    if (!revision) {
      wx.showToast({ title: "资料未同步，请下拉刷新", icon: "none" });
      return;
    }
    this.setData({ settingBusy: true });
    const target = !current.me.participating;
    const res = await setRanking(target, revision);
    this.setData({ settingBusy: false });
    if (!res.ok) {
      wx.showToast({ title: errorTextOf(res).message, icon: "none" });
      return;
    }
    const optIn = asRecord(res.data).rankingOptIn === true;
    this.setData({
      settingsOpen: false,
      "me.participating": optIn,
      "me.hint": optIn
        ? "已参与公开排行。榜单会在下次刷新后出现你的名次（旧快照仍然有效）。"
        : "已退出公开排行。你已即时从公开榜隐藏，个人成绩与成长总分不变。"
    });
    wx.showToast({ title: optIn ? "已参与，榜单待刷新" : "已退出公开排行", icon: "none" });
    void this.reload?.();
  },
  goRegister() {
    wx.navigateTo({ url: "/pages/register/index" });
  }
});
