import { callOfficialAction } from "../../services/shared-cloud";

function codeOf(res: Record<string, unknown>): string {
  const error = res.error && typeof res.error === "object" ? (res.error as { code?: string; details?: { reason?: string } }) : {};
  return String(error.details?.reason || error.code || (res.ok ? "OK" : "FAIL"));
}

function memberIdOf(res: Record<string, unknown>): string {
  const data = res.data && typeof res.data === "object" ? (res.data as { memberId?: unknown }) : {};
  return typeof data.memberId === "string" ? data.memberId : "";
}

Page({
  data: {
    summary: "尚未运行"
  },
  async runSuite() {
    const stamp = Date.now();
    const policies = await callOfficialAction("mw-public", "policies.current", {}, { requestId: `mw08/test/pol/${stamp}` });
    const policyData = (policies.data && typeof policies.data === "object" ? policies.data : {}) as {
      agreementVersion?: string;
      privacyVersion?: string;
    };
    const registerPayload = {
      agreementVersion: policyData.agreementVersion,
      privacyVersion: policyData.privacyVersion,
      accepted: true
    };
    const first = await callOfficialAction("mw-member", "member.register", registerPayload, {
      requestId: `mw08/test/reg/${stamp}/a`,
      idempotencyKey: `mw08/test/reg/${stamp}`
    });
    const replay = await callOfficialAction("mw-member", "member.register", registerPayload, {
      requestId: `mw08/test/reg/${stamp}/replay`,
      idempotencyKey: `mw08/test/reg/${stamp}`
    });
    const [left, right] = await Promise.all([
      callOfficialAction("mw-member", "member.register", registerPayload, {
        requestId: `mw08/test/reg/${stamp}/race1`,
        idempotencyKey: `mw08/test/reg/${stamp}/race1`
      }),
      callOfficialAction("mw-member", "member.register", registerPayload, {
        requestId: `mw08/test/reg/${stamp}/race2`,
        idempotencyKey: `mw08/test/reg/${stamp}/race2`
      })
    ]);
    const me = await callOfficialAction("mw-member", "member.me", {}, { requestId: `mw08/test/me/${stamp}` });
    const meData = (me.data && typeof me.data === "object" ? me.data : {}) as { revision?: number };
    const profile = await callOfficialAction(
      "mw-member",
      "member.updateProfile",
      { nickname: "验证学员甲", avatarKey: "avatar.builtin.02", expectedRevision: meData.revision || 1 },
      { requestId: `mw08/test/up/${stamp}`, idempotencyKey: `mw08/test/up/${stamp}` }
    );
    const forged = await callOfficialAction(
      "mw-member",
      "member.updateProfile",
      { nickname: "验证学员乙", expectedRevision: 2, openid: "forged", memberId: "x", role: "super" },
      { requestId: `mw08/test/forged/${stamp}`, idempotencyKey: `mw08/test/forged/${stamp}` }
    );
    const ids = [memberIdOf(first), memberIdOf(replay), memberIdOf(left), memberIdOf(right), memberIdOf(me)].filter(Boolean);
    const unique = [...new Set(ids)];
    this.setData({
      summary: JSON.stringify({
        marker: "MW08",
        policies: Boolean(policies.ok),
        register: codeOf(first),
        replaySameKey: codeOf(replay),
        raceSameMember: unique.length === 1,
        memberCountHint: unique.length,
        me: codeOf(me),
        profile: codeOf(profile),
        forged: codeOf(forged),
        memberIdPresent: unique.length === 1
      })
    });
  }
});
