import { concurrentRegisterPassed } from "@mw/shared";
import { callOfficialAction, sharedCloudReady } from "../../services/shared-cloud";

type CallResult = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function codeOf(res: CallResult): string {
  const error = asRecord(res.error);
  const details = asRecord(error.details);
  return String(details.reason || error.code || (res.ok ? "OK" : "FAIL"));
}

function fieldOf(res: CallResult, key: string): string {
  const data = asRecord(res.data);
  return typeof data[key] === "string" ? String(data[key]) : "";
}

function memberIdOf(res: CallResult): string {
  return fieldOf(res, "memberId");
}

function identityIdOf(res: CallResult): string {
  return fieldOf(res, "identityId");
}

function flagOf(res: CallResult, key: string): boolean | undefined {
  const data = asRecord(res.data);
  return typeof data[key] === "boolean" ? Boolean(data[key]) : undefined;
}

function pushId(list: string[], value: string) {
  if (value && !list.includes(value)) list.push(value);
}

function collectKnownIds(results: CallResult[]) {
  const knownIds = {
    identities: [] as string[],
    members: [] as string[],
    stats: [] as string[],
    idempotency: [] as string[],
    audits: [] as string[]
  };
  for (const res of results) {
    const identityId = identityIdOf(res);
    const memberId = memberIdOf(res);
    pushId(knownIds.identities, identityId);
    pushId(knownIds.members, memberId);
    pushId(knownIds.stats, memberId);
    pushId(knownIds.idempotency, fieldOf(res, "idempotencyId"));
    pushId(knownIds.audits, fieldOf(res, "auditId"));
  }
  return knownIds;
}

Page({
  data: {
    summary: "尚未运行",
    knownIdsText: "",
    copied: ""
  },
  async runSuite() {
    const ready = sharedCloudReady();
    if (!ready.ready) {
      this.setData({
        summary: JSON.stringify({
          marker: "MW08",
          sharedConfig: false,
          denied: true,
          reason: ready.reason,
          raceSameMember: false
        }),
        knownIdsText: "",
        copied: ""
      });
      return;
    }
    const stamp = Date.now();
    const policies = await callOfficialAction("mw-public", "policies.current", {}, { requestId: `mw08/test/pol/${stamp}` });
    const policyData = asRecord(policies.data);
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
    const meData = asRecord(me.data);
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
    const raceSameMember = concurrentRegisterPassed(
      { ok: left.ok === true, memberId: memberIdOf(left) },
      { ok: right.ok === true, memberId: memberIdOf(right) }
    );
    const knownIds = collectKnownIds([first, replay, left, right, me, profile]);
    const knownIdsText = JSON.stringify({ wroteDocs: true, knownIds }, null, 2);
    this.setData({
      summary: JSON.stringify({
        marker: "MW08",
        sharedConfig: true,
        policies: Boolean(policies.ok),
        register: {
          code: codeOf(first),
          created: flagOf(first, "created"),
          replayed: flagOf(first, "replayed"),
          memberId: memberIdOf(first),
          identityId: identityIdOf(first)
        },
        replaySameKey: {
          code: codeOf(replay),
          created: flagOf(replay, "created"),
          replayed: flagOf(replay, "replayed"),
          memberId: memberIdOf(replay)
        },
        race: {
          left: { ok: left.ok === true, code: codeOf(left), memberId: memberIdOf(left) },
          right: { ok: right.ok === true, code: codeOf(right), memberId: memberIdOf(right) },
          bothOk: left.ok === true && right.ok === true,
          raceSameMember
        },
        me: {
          code: codeOf(me),
          memberId: memberIdOf(me),
          identityId: identityIdOf(me),
          hasOpenId: JSON.stringify(me).toLowerCase().includes("openid")
        },
        profile: { code: codeOf(profile), created: flagOf(profile, "created"), replayed: flagOf(profile, "replayed") },
        forged: { code: codeOf(forged) }
      }),
      knownIdsText,
      copied: ""
    });
  },
  copyKnownIds() {
    const text = String(this.data.knownIdsText || "");
    if (!text) {
      wx.showToast({ title: "暂无可复制 ID", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => {
        this.setData({ copied: "已复制 knownIds" });
      }
    });
  }
});
