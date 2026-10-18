import { asRecord, errorInfo, policiesCurrent } from "../../services/browse";

Page({
  data: {
    title: "客服入口（测试稿）",
    channel: "in-app",
    hours: "",
    note: "正式客服方式由 MW24 接入。"
  },
  onShow() {
    void this.reload?.();
  },
  async reload() {
    const res = await policiesCurrent();
    if (!res.ok) {
      const info = errorInfo(res);
      this.setData({ note: `${info.message}。可重试。` });
      return;
    }
    const support = asRecord(asRecord(res.data).support);
    this.setData({
      title: String(support.title || "客服入口（测试稿）"),
      channel: String(support.channel || "in-app"),
      hours: String(support.hours || ""),
      note: String(support.note || "")
    });
  },
  goFeedback() {
    wx.navigateTo({ url: "/pages/feedback/index" });
  },
  goOrders() {
    wx.navigateTo({ url: "/pages/orders/index" });
  }
});
