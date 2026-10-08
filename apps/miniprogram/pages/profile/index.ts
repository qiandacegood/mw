import { callOfficialAction } from "../../services/shared-cloud";

const AVATARS = [
  "avatar.builtin.01",
  "avatar.builtin.02",
  "avatar.builtin.03",
  "avatar.builtin.04",
  "avatar.builtin.05",
  "avatar.builtin.06",
  "avatar.builtin.07",
  "avatar.builtin.08",
  "avatar.builtin.09",
  "avatar.builtin.10",
  "avatar.builtin.11",
  "avatar.builtin.12"
];

Page({
  data: {
    nickname: "",
    avatarKey: "avatar.builtin.01",
    revision: 1,
    avatars: AVATARS,
    result: "尚未保存"
  },
  async onShow() {
    const res = await callOfficialAction("mw-member", "member.me");
    const data = (res.data && typeof res.data === "object" ? res.data : {}) as Record<string, unknown>;
    if (res.ok) {
      this.setData({
        nickname: String(data.nickname || ""),
        avatarKey: String(data.avatarKey || "avatar.builtin.01"),
        revision: typeof data.revision === "number" ? data.revision : 1
      });
    } else {
      this.setData({ result: JSON.stringify({ ok: false, error: res.error }) });
    }
  },
  onNickname(event: { detail?: { value?: string } }) {
    this.setData({ nickname: event.detail?.value || "" });
  },
  onAvatar(event: { currentTarget?: { dataset?: { key?: string } } }) {
    const key = event.currentTarget?.dataset?.key;
    if (key) this.setData({ avatarKey: key });
  },
  async save() {
    const res = await callOfficialAction(
      "mw-member",
      "member.updateProfile",
      {
        nickname: this.data.nickname,
        avatarKey: this.data.avatarKey,
        expectedRevision: this.data.revision
      },
      { requestId: `req_mp_profile_${Date.now()}`, idempotencyKey: `mp_profile_${Date.now()}` }
    );
    const data = (res.data && typeof res.data === "object" ? res.data : {}) as Record<string, unknown>;
    this.setData({
      revision: typeof data.revision === "number" ? data.revision : this.data.revision,
      result: JSON.stringify({
        ok: res.ok,
        nickname: data.nickname,
        avatarKey: data.avatarKey,
        error: res.error
      })
    });
  }
});
