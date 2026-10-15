/**
 * MW17 排行榜纯展示逻辑（不触碰 wx API，便于本地单测）。
 *
 * 只做展示映射：名次文案、真实更新时间、刷新状态、空榜/未参与/延迟提示。
 * 不伪造刷新时间——显示的时间一律来自服务端返回的 updatedAt / requestedAt。
 */
import type { RankingScopeName } from "./ranking";

export type RankingRefreshView = {
  status: string;
  label: string;
  detail: string;
  tone: "ok" | "warn" | "muted";
};

export type RankingRowView = {
  rank: number;
  rankText: string;
  rankKey: string;
  nickname: string;
  avatarKey: string;
  initial: string;
  levelText: string;
  value: number;
  valueText: string;
  valueDiffText: string;
  isTop: boolean;
  isMine: boolean;
};

export type RankingMeView = {
  participating: boolean;
  onBoard: boolean;
  rankText: string;
  valueText: string;
  valueDiffText: string;
  hint: string;
  historyGapNote: string;
};

export type CategoryOption = {
  categoryId: string;
  name: string;
  label: string;
  depth: number;
};

export const SCOPE_LABEL: Record<RankingScopeName, string> = {
  total: "总分",
  category: "分类",
  week: "本周进步",
  month: "本月进步"
};

export const SCOPE_RULE: Record<RankingScopeName, string> = {
  total: "历史有效最高分之和（免费与 VIP 统一计入）",
  category: "选定类目及其全部后代类目的累计分",
  week: "本周（北京时间周一 00:00 起）新增有效分之和",
  month: "本月（北京时间 1 日 00:00 起）新增有效分之和"
};

const AVATAR_INITIAL_KEYS = ["avatar.builtin.", "avatar."];

export function scopeLabel(scope: string): string {
  return SCOPE_LABEL[scope as RankingScopeName] || String(scope || "");
}

export function scopeRule(scope: string): string {
  return SCOPE_RULE[scope as RankingScopeName] || "";
}

/** UTC ISO → 北京时间（UTC+8）"YYYY-MM-DD HH:mm:ss"，不依赖设备时区、不伪造时间。 */
export function formatBeijingTime(iso: string): string {
  if (!iso) return "";
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  const shifted = new Date(parsed + 8 * 60 * 60 * 1000).toISOString();
  return `${shifted.slice(0, 10)} ${shifted.slice(11, 19)}`;
}

export function secondsOf(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  return `${Math.floor(ms / 1000)} 秒`;
}

/** 「更新时间 / 更新中 / 更新延迟 / 从未发布」四态；文案与颜色都来自服务端真实状态。 */
export function refreshViewOf(refresh: Record<string, unknown> | undefined): RankingRefreshView {
  const rec = refresh || {};
  const status = String(rec.status || "unpublished");
  const updatedAt = formatBeijingTime(String(rec.updatedAt || ""));
  const requestedAt = formatBeijingTime(String(rec.requestedAt || ""));
  if (status === "unpublished") {
    return {
      status,
      label: "尚未生成榜单",
      detail: "后台还未发布榜单快照。",
      tone: "muted"
    };
  }
  if (status === "updating") {
    return {
      status,
      label: updatedAt ? `更新于 ${updatedAt}` : "更新中",
      detail: requestedAt ? `有新的计分待刷新（请求于 ${requestedAt}），正在更新。` : "正在更新快照。",
      tone: "warn"
    };
  }
  if (status === "delayed") {
    return {
      status,
      label: updatedAt ? `更新于 ${updatedAt}` : "更新延迟",
      detail: requestedAt
        ? `榜单更新延迟：最近一次刷新请求在 ${requestedAt}（${secondsOf(
            typeof rec.pendingMs === "number" ? rec.pendingMs : null
          )}前），尚未完成。`
        : "榜单更新延迟，尚未完成刷新。",
      tone: "warn"
    };
  }
  return { status: "fresh", label: updatedAt ? `更新于 ${updatedAt}` : "已更新", detail: "", tone: "ok" };
}

export function rankTextOf(rank: number): string {
  return Number.isFinite(rank) && rank > 0 ? `${rank}` : "-";
}

export function initialOf(nickname: string, fallbackKey: string): string {
  const text = String(nickname || "").trim();
  if (text) return text.slice(0, 1);
  const key = String(fallbackKey || "").trim();
  return key ? key.slice(0, 1).toUpperCase() : "学";
}

export function isBuiltinAvatarKey(value: unknown): boolean {
  const key = String(value || "");
  return AVATAR_INITIAL_KEYS.some((prefix) => key.startsWith(prefix));
}

export function levelTextOf(levelId: string): string {
  const id = String(levelId || "").trim();
  return id ? id.toUpperCase() : "";
}

export function valueDiffTextOf(valueDiff: number | null | undefined): string {
  if (typeof valueDiff !== "number" || !Number.isFinite(valueDiff)) return "";
  return valueDiff > 0 ? `差 ${valueDiff}` : "";
}

export function rowViewOf(row: Record<string, unknown>, myRankKey: string): RankingRowView {
  const rank = Number(row.rank || 0);
  const value = Number(row.value || 0);
  const rankKey = String(row.rankKey || "");
  return {
    rank,
    rankText: rankTextOf(rank),
    rankKey,
    nickname: String(row.nickname || "匿名学员"),
    avatarKey: String(row.avatarKey || ""),
    initial: initialOf(String(row.nickname || ""), rankKey),
    levelText: levelTextOf(String(row.levelId || "")),
    value,
    valueText: String(value),
    valueDiffText: valueDiffTextOf(row.valueDiff as number | null),
    isTop: rank > 0 && rank <= 3,
    isMine: Boolean(rankKey) && rankKey === myRankKey
  };
}

export function rowViewsOf(rows: unknown, myRankKey: string): RankingRowView[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((item) => rowViewOf((item && typeof item === "object" ? item : {}) as Record<string, unknown>, myRankKey));
}

/**
 * 本人名次展示。
 *
 * 未上榜有两种完全不同的原因，必须分开说，否则会把"快照还没刷新"误报成"零分不上榜"：
 * - 可追溯榜值为 0 → 真的没有正分（零分不上榜）；
 * - 可追溯榜值 > 0 但快照未包含（`unpublished` / `updating` / `delayed`）→ 等后台发布或刷新快照。
 */
export function meViewOf(
  data: Record<string, unknown> | undefined,
  scope: string,
  refreshStatus = ""
): RankingMeView {
  const rec = data || {};
  const participating = rec.participating === true;
  const onBoard = rec.onBoard === true;
  const rank = typeof rec.rank === "number" ? rec.rank : null;
  const value = Number(rec.value || 0);
  const historyGapNote = String(rec.historyGapNote || "");
  if (!participating) {
    const privateTotal = Number(rec.privateTotalScore || 0);
    return {
      participating,
      onBoard: false,
      rankText: "未上榜",
      valueText: privateTotal > 0 ? `私人总分 ${privateTotal}` : "—",
      valueDiffText: "",
      hint: "你还没有参与公开排行。参与后按已有有效成绩上榜，可随时退出。",
      historyGapNote
    };
  }
  if (!onBoard) {
    const status = String(refreshStatus || "");
    if (value > 0) {
      return {
        participating,
        onBoard: false,
        rankText: "未上榜",
        valueText: String(value),
        valueDiffText: "",
        hint:
          status === "fresh"
            ? `你已有 ${value} 分，但不在这一代快照里：下拉刷新后若仍不在，请在后台重建并发布榜单快照。`
            : `你已有 ${value} 分待进榜：后台还没发布或刷新榜单快照，发布后才会显示名次。`,
        historyGapNote
      };
    }
    return {
      participating,
      onBoard: false,
      rankText: "未上榜",
      valueText: "0",
      valueDiffText: "",
      hint:
        scope === "category"
          ? "本类目还没有可追溯的得分，暂无公开名次。"
          : "本榜只收录正分（零分不上榜），暂未进入前百。",
      historyGapNote
    };
  }
  return {
    participating,
    onBoard,
    rankText: rankTextOf(rank || 0),
    valueText: String(value),
    valueDiffText: valueDiffTextOf(rec.valueDiff as number | null),
    hint: "你的名次与上方榜单来自同一代快照。",
    historyGapNote
  };
}

export function historyGapTextOf(gap: Record<string, unknown> | undefined): string {
  const rec = gap || {};
  const members = Number(rec.members || 0);
  if (!members) return "";
  const score = Number(rec.score || 0);
  const note = String(rec.note || "本榜值只从可追溯的计分事件累计。");
  return `${members} 位会员的历史成长总分（合计 ${score} 分）暂未纳入可追溯榜值：${note}`;
}

export function staleNoticeOf(staleFiltered: number): string {
  if (!Number.isFinite(staleFiltered) || staleFiltered <= 0) return "";
  return "有会员已退出公开排行或账号已停用，已即时隐藏；其名次仍属上一代快照，等待下次刷新。";
}

export function boundaryNoticeOf(participantCount: number, displayCount: number, truncated: boolean): string {
  if (truncated) {
    return `第 ${displayCount} 名存在大量并列，已按产品约定截断展示，等待下次刷新收敛。`;
  }
  if (participantCount > displayCount) {
    return `共 ${participantCount} 人上榜，本页公开前 ${displayCount} 名（含第 100 名的并列）。`;
  }
  return "";
}

export function emptyHintOf(scope: string, categoryId: string, refreshStatus: string): string {
  if (scope === "category" && !categoryId) return "请先选择类目，再查看分类榜。";
  if (refreshStatus === "unpublished") return "榜单还未生成，请稍后下拉刷新。";
  if (refreshStatus === "updating" || refreshStatus === "delayed") {
    return "榜单快照还没刷新：已有新的计分待发布，稍后下拉刷新。";
  }
  return "本期暂无正分记录。零分不会上榜。";
}

/** 公开类目树 → 选择器选项（按树序平铺，父级含后代由服务端保证）。 */
export function categoryOptionsOf(nodes: unknown): CategoryOption[] {
  if (!Array.isArray(nodes)) return [];
  const rows = nodes
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : {}))
    .map((item) => ({
      categoryId: String(item.id || item.categoryId || ""),
      parentId: item.parentId === null || item.parentId === undefined ? null : String(item.parentId),
      depth: Number(item.depth || 1),
      name: String(item.name || "")
    }))
    .filter((item) => item.categoryId && item.name);
  const byParent = new Map<string | null, typeof rows>();
  for (const row of rows) {
    const list = byParent.get(row.parentId) || [];
    list.push(row);
    byParent.set(row.parentId, list);
  }
  const out: CategoryOption[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const row of byParent.get(parentId) || []) {
      out.push({
        categoryId: row.categoryId,
        name: row.name,
        label: `${"　".repeat(Math.max(0, depth - 1))}${row.name}`,
        depth
      });
      walk(row.categoryId, depth + 1);
    }
  };
  walk(null, 1);
  // 父级缺失（数据异常）时兜底按深度平铺，避免整块不可选。
  if (!out.length) {
    return rows
      .sort((left, right) => left.depth - right.depth)
      .map((row) => ({
        categoryId: row.categoryId,
        name: row.name,
        label: `${"　".repeat(Math.max(0, row.depth - 1))}${row.name}`,
        depth: row.depth
      }));
  }
  return out;
}

export function errorTextOf(res: Record<string, unknown>): { code: string; message: string; reason: string } {
  const error = (res.error && typeof res.error === "object" ? res.error : {}) as Record<string, unknown>;
  const details = (error.details && typeof error.details === "object" ? error.details : {}) as Record<string, unknown>;
  const code = String(error.code || "SERVICE_BUSY");
  const reason = String(details.reason || "");
  if (code === "CATEGORY_UNAVAILABLE") {
    return { code, reason, message: "该类目已停用或不存在，请重新选择类目。" };
  }
  if (code === "MEMBER_REQUIRED" || code === "AUTH_REQUIRED") {
    return { code, reason, message: "需要先注册成为会员才能查看本人名次。" };
  }
  if (code === "VERSION_CONFLICT") {
    return { code, reason, message: "本人资料已更新，请下拉刷新后重试。" };
  }
  return { code, reason, message: String(error.message || "网络失败或服务繁忙，可重试。") };
}
