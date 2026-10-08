import { callOfficialAction } from "../../services/shared-cloud";

Page({
  data: {
    statusText: "未读取",
    nickname: "",
    avatarKey: "",
    totalScore: "",
    levelId: "",
    raw: ""
  },
  onShow() {
    void this.reload?.();
  },
  async reload() {
    const res = await callOfficialAction("mw-member", "member.me", {}, { requestId: `req_mp_me_${Date.now()}` });
    if (!res.ok) {
      const error = (res.error && typeof res.error === "object" ? res.error : {}) as {
        code?: string;
        details?: { reason?: string };
      };
      this.setData({
        statusText: String(error.code || "ERROR"),
        nickname: "",
        avatarKey: "",
        totalScore: "",
        levelId: "",
        raw: JSON.stringify({ ok: false, code: error.code, reason: error.details?.reason })
      });
      return;
    }
    const data = (res.data && typeof res.data === "object" ? res.data : {}) as Record<string, unknown>;
    const stats = (data.stats && typeof data.stats === "object" ? data.stats : {}) as Record<string, unknown>;
    this.setData({
      statusText: String(data.status || ""),
      nickname: String(data.nickname || ""),
      avatarKey: String(data.avatarKey || ""),
      totalScore: String(stats.totalScore ?? ""),
      levelId: String(stats.levelId || ""),
      raw: JSON.stringify({
        ok: true,
        status: data.status,
        revision: data.revision,
        rankingOptIn: data.rankingOptIn
      })
    });
  },
  goRegister() {
    wx.navigateTo({ url: "/pages/register/index" });
  },
  goProfile() {
    wx.navigateTo({ url: "/pages/profile/index" });
  }
});
