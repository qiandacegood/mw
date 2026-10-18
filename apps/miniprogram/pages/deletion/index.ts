import { asRecord, errorInfo, memberDeletionStatus, memberMe, policiesCurrent, requestMemberDeletion } from "../../services/browse";
import { loginCode } from "../../services/purchase";

type PendingItem = { orderId: string; hint: string; payState: string; grantState: string; refundState: string };

Page({
  data: {
    status: "",
    nickname: "",
    agreementVersion: "",
    privacyVersion: "",
    agreementText: "",
    acknowledged: false,
    reauthCode: "",
    reauthText: "尚未重新登录确认",
    busy: false,
    blocked: false,
    pendingItems: [] as PendingItem[],
    note: "注销须确认当前协议版本，并用微信重新登录证明身份。有未完成订单时只列待办，不删号。停用账号请走后台 disable，不是本页。",
    result: ""
  },
  onShow() {
    void this.reload?.();
  },
  async reload() {
    const policies = await policiesCurrent();
    const status = await memberDeletionStatus();
    const me = await memberMe();
    const policyData = asRecord(policies.data);
    const statusData = asRecord(status.ok ? status.data : {});
    const meData = asRecord(me.ok ? me.data : {});
    const pending = Array.isArray(statusData.pendingItems)
      ? statusData.pendingItems.map((row) => {
          const rec = asRecord(row);
          return {
            orderId: String(rec.orderId || ""),
            hint: String(rec.hint || ""),
            payState: String(rec.payState || ""),
            grantState: String(rec.grantState || ""),
            refundState: String(rec.refundState || "")
          };
        })
      : [];
    this.setData({
      status: String(statusData.status || meData.status || (me.ok ? "" : errorInfo(me).code)),
      nickname: String(meData.nickname || ""),
      agreementVersion: String(policyData.agreementVersion || ""),
      privacyVersion: String(policyData.privacyVersion || ""),
      agreementText: String(policyData.agreementText || ""),
      acknowledged: false,
      blocked: statusData.blocked === true,
      pendingItems: pending,
      note: String(statusData.note || this.data.note),
      result: status.ok ? "" : errorInfo(status).message
    });
  },
  onAck(event: { detail?: { value?: string[] } }) {
    const values = event.detail?.value || [];
    this.setData({ acknowledged: values.includes("ack") });
  },
  async reauth() {
    try {
      const code = await loginCode();
      this.setData({
        reauthCode: code,
        reauthText: code ? "已重新登录确认（未把 code 以外的身份字段提交）" : "重新登录失败"
      });
    } catch {
      this.setData({ reauthCode: "", reauthText: "wx.login 失败，无法重新认证" });
    }
  },
  async submit() {
    if (this.data.busy) return;
    if (this.data.acknowledged !== true) {
      this.setData({ result: "须勾选当前协议版本。未预勾选。" });
      return;
    }
    if (!this.data.reauthCode) {
      this.setData({ result: "须先重新登录确认身份。" });
      return;
    }
    this.setData({ busy: true, result: "提交中" });
    const res = await requestMemberDeletion({
      reauthProof: { kind: "wx_login_code", code: String(this.data.reauthCode || "") },
      acknowledgementVersion: String(this.data.agreementVersion || "")
    });
    const data = asRecord(res.data);
    const pending = Array.isArray(data.pendingItems)
      ? data.pendingItems.map((row) => {
          const rec = asRecord(row);
          return {
            orderId: String(rec.orderId || ""),
            hint: String(rec.hint || ""),
            payState: String(rec.payState || ""),
            grantState: String(rec.grantState || ""),
            refundState: String(rec.refundState || "")
          };
        })
      : [];
    this.setData({
      busy: false,
      status: String(data.status || this.data.status),
      nickname: String(data.nickname || this.data.nickname),
      blocked: data.blocked === true,
      pendingItems: pending,
      note: String(data.note || ""),
      result: res.ok
        ? JSON.stringify({
            ok: true,
            status: data.status,
            blocked: data.blocked === true,
            pending: pending.length,
            nickname: data.nickname
          })
        : JSON.stringify({ ok: false, error: res.error })
    });
  },
  goOrders() {
    wx.navigateTo({ url: "/pages/orders/index" });
  }
});
