import { knownIdClipboardText, markLeftoverOrderId } from "../../services/known-ids";
import {
  asRecord,
  closeOrder,
  errorInfo,
  fenLabel,
  listOrders,
  refreshOrder,
  requestRefund as submitRefundRequest
} from "../../services/purchase";

Page({
  data: {
    state: "loading",
    message: "",
    refundReason: "MW22 售后申请（测试）",
    items: [] as Array<Record<string, string>>
  },
  onShow() {
    void this.reload?.();
  },
  async reload() {
    const res = await listOrders();
    if (!res.ok) {
      this.setData({ state: "error", message: `${errorInfo(res).code} ${errorInfo(res).reason}`, items: [] });
      return;
    }
    const items = (Array.isArray(asRecord(res.data).items) ? (asRecord(res.data).items as unknown[]) : []).map((item) => {
      const rec = asRecord(item);
      const orderId = String(rec.orderId || "");
      return {
        orderId,
        title: String(rec.title || ""),
        displayStatus: String(rec.displayStatus || rec.payState || ""),
        payState: String(rec.payState || ""),
        grantState: String(rec.grantState || ""),
        refundState: String(rec.refundState || "none"),
        userHint: String(rec.userHint || ""),
        priceText: fenLabel(Number(rec.amountFen || 0)),
        merchantRefundSupported: rec.merchantRefundSupported === true ? "1" : "",
        canRequestRefund: rec.canRequestRefund === true ? "1" : "",
        appleGuidance: String(rec.appleGuidance || "")
      };
    });
    this.setData({ state: "ok", message: "", items });
  },
  markLeftover(e?: { currentTarget?: { dataset?: { id?: string } } }) {
    const orderId = String(e?.currentTarget?.dataset?.id || "");
    if (!markLeftoverOrderId(orderId)) {
      wx.showToast({ title: "无法记入本轮 leftover", icon: "none" });
      return;
    }
    wx.showToast({ title: "已记入本轮 leftover", icon: "none" });
  },
  async refresh(e?: { currentTarget?: { dataset?: { id?: string } } }) {
    const orderId = String(e?.currentTarget?.dataset?.id || "");
    await refreshOrder(orderId);
    await this.reload?.();
  },
  onReason(e?: { detail?: { value?: string } }) {
    this.setData({ refundReason: String(e?.detail?.value || "") });
  },
  async close(e?: { currentTarget?: { dataset?: { id?: string } } }) {
    const orderId = String(e?.currentTarget?.dataset?.id || "");
    const res = await closeOrder(orderId);
    if (!res.ok) {
      wx.showToast({ title: errorInfo(res).reason || errorInfo(res).code, icon: "none" });
    }
    await this.reload?.();
  },
  async requestRefund(e?: { currentTarget?: { dataset?: { id?: string } } }) {
    const orderId = String(e?.currentTarget?.dataset?.id || "");
    const reason = String(this.data.refundReason || "").trim();
    if (!reason) {
      wx.showToast({ title: "请填写原因", icon: "none" });
      return;
    }
    const res = await submitRefundRequest(orderId, reason);
    if (!res.ok) {
      wx.showToast({ title: errorInfo(res).reason || errorInfo(res).code, icon: "none" });
    }
    await this.reload?.();
  },
  copyLeftover() {
    wx.setClipboardData({ data: knownIdClipboardText() });
  }
});
