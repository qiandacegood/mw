import { fetchPaperDetail } from "../../services/mock-client";

Page({
  data: {
    title: "尚未读取",
    access: "",
    raw: ""
  },
  onLoad() {
    this.loadPaper?.();
  },
  loadPaper() {
    const res = fetchPaperDetail("paper_fict_logic_l1");
    if (res.ok) {
      this.setData({
        title: res.data.title,
        access: res.data.access,
        raw: JSON.stringify(res.data)
      });
      return;
    }
    this.setData({ title: res.error.message, raw: JSON.stringify(res) });
  },
  goMe() {
    wx.navigateTo({ url: "/pages/me/index" });
  },
  goRegister() {
    wx.navigateTo({ url: "/pages/register/index" });
  },
  goMw08() {
    wx.navigateTo({ url: "/pages/mw08/index" });
  }
});
