import { knownIdClipboardText } from "../../services/known-ids";
import { asRecord, closeOrder, errorInfo, fenLabel, listOrders, refreshOrder } from "../../services/purchase";

Page({
  data: {
    state: "loading",
    message: "",
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
        userHint: String(rec.userHint || ""),
        priceText: fenLabel(Number(rec.amountFen || 0))
      };
    });
    this.setData({ state: "ok", message: "", items });
  },
  async refresh(e?: { currentTarget?: { dataset?: { id?: string } } }) {
    const orderId = String(e?.currentTarget?.dataset?.id || "");
    await refreshOrder(orderId);
    await this.reload?.();
  },
  async close(e?: { currentTarget?: { dataset?: { id?: string } } }) {
    const orderId = String(e?.currentTarget?.dataset?.id || "");
    const res = await closeOrder(orderId);
    if (!res.ok) {
      wx.showToast({ title: errorInfo(res).reason || errorInfo(res).code, icon: "none" });
    }
    await this.reload?.();
  },
  copyLeftover() {
    wx.setClipboardData({ data: knownIdClipboardText() });
  }
});
