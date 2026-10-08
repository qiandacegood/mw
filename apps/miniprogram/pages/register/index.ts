import { callOfficialAction } from "../../services/shared-cloud";

Page({
  data: {
    agreementVersion: "",
    privacyVersion: "",
    agreementTitle: "",
    privacyTitle: "",
    accepted: false,
    busy: false,
    result: "尚未提交"
  },
  async onLoad() {
    const res = await callOfficialAction("mw-public", "policies.current");
    const data = (res.data && typeof res.data === "object" ? res.data : {}) as Record<string, unknown>;
    this.setData({
      agreementVersion: String(data.agreementVersion || ""),
      privacyVersion: String(data.privacyVersion || ""),
      agreementTitle: String(data.agreementTitle || "用户协议（测试稿）"),
      privacyTitle: String(data.privacyTitle || "隐私政策（测试稿）"),
      accepted: false
    });
  },
  onAgree(event: { detail?: { value?: string[] } }) {
    const values = event.detail?.value || [];
    this.setData({ accepted: values.includes("agreement") });
  },
  async submit() {
    if (this.data.busy) return;
    this.setData({ busy: true, result: "提交中" });
    const res = await callOfficialAction(
      "mw-member",
      "member.register",
      {
        agreementVersion: this.data.agreementVersion,
        privacyVersion: this.data.privacyVersion,
        accepted: this.data.accepted === true
      },
      { requestId: `req_mp_register_${Date.now()}`, idempotencyKey: `mp_register_${Date.now()}` }
    );
    this.setData({
      busy: false,
      result: JSON.stringify({
        ok: res.ok,
        memberId: (res.data as { memberId?: string } | undefined)?.memberId ? "present" : "absent",
        created: (res.data as { created?: boolean } | undefined)?.created,
        error: res.error
      })
    });
  }
});
