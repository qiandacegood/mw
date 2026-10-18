import { memberMe } from "../../services/browse";
import { markLeftoverOrderId, knownIdClipboardText } from "../../services/known-ids";
import {
  asRecord,
  checkoutParamsOf,
  closeOrder,
  createOrder,
  daysLabel,
  errorInfo,
  fenLabel,
  loginCode,
  preparePayment,
  refreshOrder,
  requestVirtualPayment,
  tryForgePayment,
  vipPlans,
  type PlanView
} from "../../services/purchase";

type PlanRow = PlanView & { daysText: string; priceText: string };

Page({
  data: {
    state: "loading",
    message: "",
    vipText: "未读取",
    expiresAt: "",
    capabilityHint: "",
    plans: [] as PlanRow[],
    lastOrderId: "",
    lastDisplay: "",
    lastHint: "",
    raw: ""
  },
  onShow() {
    void this.reload?.();
  },
  async reload() {
    const me = await memberMe();
    const device = asRecord(wx.getSystemInfoSync() || {});
    const plansRes = await vipPlans({
      platform: String(device.platform || device.osName || "android"),
      system: String(device.system || ""),
      wechatVersion: String(device.version || "")
    });
    const meData = asRecord(me.data);
    const vip = asRecord(meData.vip);
    const planData = asRecord(plansRes.data);
    const capability = asRecord(planData.capability);
    const plans = Array.isArray(planData.plans)
      ? planData.plans.map((item) => {
          const rec = asRecord(item);
          return {
            planId: String(rec.planId || ""),
            planVersion: Number(rec.planVersion || 0),
            title: String(rec.title || ""),
            durationDays: Number(rec.durationDays || 0),
            priceFen: Number(rec.priceFen || 0),
            priceNote: String(rec.priceNote || "TEST_PRICE"),
            sort: Number(rec.sort || 0),
            daysText: daysLabel(Number(rec.durationDays || 0)),
            priceText: fenLabel(Number(rec.priceFen || 0))
          };
        })
      : [];
    this.setData({
      state: plansRes.ok ? "ok" : "error",
      message: plansRes.ok ? "" : `${errorInfo(plansRes).code} ${errorInfo(plansRes).reason}`,
      vipText: vip.active === true ? "有效 VIP" : vip.expiresAt ? "已过期" : "未开通",
      expiresAt: String(vip.expiresAt || ""),
      capabilityHint: String(capability.hint || "设备声明不能授予权限。"),
      plans,
      raw: JSON.stringify({
        plansOk: plansRes.ok === true,
        channel: planData.channel,
        purchaseAvailable: capability.purchaseAvailable === true,
        deviceDoesNotGrant: planData.deviceDoesNotGrant === true
      })
    });
  },
  async buy(e?: { currentTarget?: { dataset?: { id?: string; version?: string } } }) {
    const planId = String(e?.currentTarget?.dataset?.id || "");
    const planVersion = Number(e?.currentTarget?.dataset?.version || 0);
    const plan = (this.data.plans as PlanRow[]).find((row) => row.planId === planId && row.planVersion === planVersion);
    if (!plan) return;
    const res = await createOrder(plan, "android");
    if (!res.ok) {
      this.setData({ message: `${errorInfo(res).code} ${errorInfo(res).reason}`, state: "error" });
      return;
    }
    const data = asRecord(res.data);
    const orderId = String(data.orderId || "");
    markLeftoverOrderId(orderId);
    this.setData({
      lastOrderId: orderId,
      lastDisplay: `${data.displayStatus || data.payState} · ${fenLabel(Number(data.amountFen || 0))}`,
      lastHint: "金额已由服务端冻结。客户端改价不能便宜买。",
      raw: JSON.stringify({ orderId, amountFen: data.amountFen, payState: data.payState })
    });
  },
  async pay() {
    const orderId = String(this.data.lastOrderId || "");
    if (!orderId) return;
    try {
      const code = await loginCode();
      const prepared = await preparePayment(orderId, code);
      if (!prepared.ok) {
        this.setData({ lastHint: `${errorInfo(prepared).code} ${errorInfo(prepared).reason}` });
        return;
      }
      const params = checkoutParamsOf(prepared);
      if (!params) {
        this.setData({ lastHint: "收银台参数不完整，未发放。" });
        return;
      }
      const result = await requestVirtualPayment(params);
      this.setData({ lastHint: `收银台返回 ${result.errMsg}。客户端成功不作履约依据，正在查单。` });
      await this.refresh?.();
    } catch {
      this.setData({ lastHint: "未取得登录 code，未发放。" });
    }
  },
  async fakeSuccess() {
    const orderId = String(this.data.lastOrderId || "");
    if (!orderId) return;
    const res = await tryForgePayment(orderId);
    const denied = !res.ok;
    const refreshed = await refreshOrder(orderId);
    const data = asRecord(refreshed.data);
    this.setData({
      lastHint: `伪造成功未作为履约依据。prepare拒绝=${denied} · 当前 ${data.payState || errorInfo(refreshed).code}`,
      lastDisplay: String(data.displayStatus || data.payState || "")
    });
  },
  async refresh() {
    const orderId = String(this.data.lastOrderId || "");
    if (!orderId) return;
    const res = await refreshOrder(orderId);
    const data = asRecord(res.data);
    this.setData({
      lastDisplay: String(data.displayStatus || data.payState || errorInfo(res).code),
      lastHint: String(data.userHint || data.payState || errorInfo(res).reason)
    });
    await this.reload?.();
  },
  async close() {
    const orderId = String(this.data.lastOrderId || "");
    if (!orderId) return;
    const res = await closeOrder(orderId);
    const data = asRecord(res.data);
    this.setData({
      lastDisplay: String(data.displayStatus || errorInfo(res).code),
      lastHint: res.ok ? "已先查原单再关。" : `${errorInfo(res).code} ${errorInfo(res).reason}`
    });
  },
  goOrders() {
    wx.navigateTo({ url: "/pages/orders/index" });
  },
  copyLeftover() {
    const text = knownIdClipboardText();
    wx.setClipboardData({ data: text });
  }
});
