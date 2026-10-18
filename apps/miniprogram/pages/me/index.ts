import { asRecord, errorInfo, memberGrowth, memberMe } from "../../services/browse";
import { markLeftoverMemberId } from "../../services/known-ids";

type MedalRow = {
  levelName: string;
  medalName: string;
  minScore: number;
  earned: boolean;
  awardedAt: string;
};

function toMedals(input: unknown): MedalRow[] {
  if (!Array.isArray(input)) return [];
  return input.map((item) => {
    const rec = asRecord(item);
    return {
      levelName: String(rec.name || ""),
      medalName: String(rec.medalName || ""),
      minScore: Number(rec.minScore || 0),
      earned: rec.earned === true,
      awardedAt: String(rec.awardedAt || "")
    };
  });
}

Page({
  data: {
    memberId: "",
    statusText: "未读取",
    nickname: "",
    avatarKey: "",
    totalScore: "",
    levelId: "",
    levelName: "",
    growthState: "idle",
    growthMessage: "",
    progressText: "",
    progressPercent: 0,
    nextLevelName: "",
    remaining: "",
    earnedCount: 0,
    medalCount: 0,
    medals: [] as MedalRow[],
    growthNote: "",
    vipActive: false,
    vipText: "未读取",
    vipExpiresAt: "",
    raw: ""
  },
  onShow() {
    void this.reload?.();
  },
  async reload() {
    const res = await memberMe();
    const growth = await memberGrowth();
    if (!res.ok) {
      const info = errorInfo(res);
      this.setData({
        statusText: info.code,
        nickname: "",
        avatarKey: "",
        totalScore: "",
        levelId: "",
        levelName: "",
        growthState: info.code === "MEMBER_REQUIRED" ? "guest" : "error",
        growthMessage:
          info.code === "MEMBER_REQUIRED" ? "注册后可查看成长等级与勋章。" : `${info.message}。可重试。`,
        medals: [],
        vipActive: false,
        vipText: info.code === "MEMBER_REQUIRED" ? "注册后可查看 VIP 状态。" : "未读取",
        vipExpiresAt: "",
        raw: JSON.stringify({ ok: false, code: info.code, reason: info.reason })
      });
      return;
    }
    const data = asRecord(res.data);
    const stats = asRecord(data.stats);
    const growthData = asRecord(growth.data);
    const medals = growth.ok ? toMedals(growthData.medals) : [];
    const remaining = growth.ok ? Number(growthData.remaining || 0) : 0;
    const nextLevelName = growth.ok ? String(growthData.nextLevelName || "") : "";
    const vip = asRecord(data.vip);
    const vipActive = vip.active === true;
    const vipExpiresAt = String(vip.expiresAt || "");
    this.setData({
      statusText: String(data.status || ""),
      memberId: String(data.memberId || ""),
      nickname: String(data.nickname || ""),
      avatarKey: String(data.avatarKey || ""),
      totalScore: String(stats.totalScore ?? 0),
      levelId: String(growth.ok ? growthData.levelId || stats.levelId || "" : stats.levelId || ""),
      levelName: growth.ok ? String(growthData.levelName || "") : "",
      growthState: growth.ok ? "ok" : "error",
      growthMessage: growth.ok
        ? String(growthData.note || "")
        : `${errorInfo(growth).message}。可重试。`,
      progressText: growth.ok
        ? nextLevelName
          ? `距离「${nextLevelName}」还差 ${remaining} 分`
          : "已是当前最高等级"
        : "",
      progressPercent: growth.ok ? Number(growthData.percent || 0) : 0,
      nextLevelName,
      remaining: growth.ok ? String(remaining) : "",
      earnedCount: growth.ok ? Number(growthData.earnedCount || 0) : 0,
      medalCount: medals.length,
      medals,
      growthNote: growth.ok ? `门槛版本 ${growthData.configVersion ?? 0}` : "",
      vipActive,
      vipText: vipActive ? "有效 VIP" : vipExpiresAt ? "已过期" : "未开通",
      vipExpiresAt,
      raw: JSON.stringify({
        ok: true,
        status: data.status,
        revision: data.revision,
        rankingOptIn: data.rankingOptIn,
        growthOk: growth.ok === true,
        vipActive,
        vipExpiresAt
      })
    });
  },
  goRegister() {
    wx.navigateTo({ url: "/pages/register/index" });
  },
  goProfile() {
    wx.navigateTo({ url: "/pages/profile/index" });
  },
  goHistory() {
    wx.navigateTo({ url: "/pages/history/index" });
  },
  goVip() {
    wx.navigateTo({ url: "/pages/vip/index" });
  },
  goOrders() {
    wx.navigateTo({ url: "/pages/orders/index" });
  },
  /** 只有用户主动点击才把本人身份记入本轮 leftover，用于按 member 独立核查。 */
  markLeftover() {
    const ok = markLeftoverMemberId(String(this.data.memberId || ""));
    wx.showToast({ title: ok ? "已记入本轮 leftover（本人）" : "暂无可记入的本人身份", icon: "none" });
  }
});
