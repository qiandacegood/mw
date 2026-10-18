import { asRecord, errorInfo, policiesCurrent } from "../../services/browse";

Page({
  data: {
    agreementVersion: "",
    privacyVersion: "",
    agreementTitle: "",
    privacyTitle: "",
    agreementText: "",
    privacyText: "",
    note: ""
  },
  onShow() {
    void this.reload?.();
  },
  async reload() {
    const res = await policiesCurrent();
    if (!res.ok) {
      this.setData({ note: `${errorInfo(res).message}。可重试。` });
      return;
    }
    const data = asRecord(res.data);
    this.setData({
      agreementVersion: String(data.agreementVersion || ""),
      privacyVersion: String(data.privacyVersion || ""),
      agreementTitle: String(data.agreementTitle || "用户协议（测试稿）"),
      privacyTitle: String(data.privacyTitle || "隐私政策（测试稿）"),
      agreementText: String(data.agreementText || ""),
      privacyText: String(data.privacyText || ""),
      note: String(data.note || "")
    });
  },
  goSupport() {
    wx.navigateTo({ url: "/pages/support/index" });
  },
  goDeletion() {
    wx.navigateTo({ url: "/pages/deletion/index" });
  }
});
