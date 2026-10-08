import { describe, expect, it } from "vitest";
import {
  BUILTIN_AVATAR_KEYS,
  DEFAULT_AVATAR_KEY,
  NICKNAME_CONTENT_SAFETY,
  defaultNickname,
  identityDocId,
  matchPolicyVersions,
  memberDocId,
  memberWriteTooLarge,
  parseProfileInput,
  parseRegisterInput,
  validateAvatarKey,
  validateNickname
} from "./member.js";

describe("member identity and profile rules", () => {
  it("derives stable identity and member ids without exposing openid", () => {
    const first = identityDocId("wxmwallowedappid0001", "mw08_openid_a");
    const second = identityDocId("wxmwallowedappid0001", "mw08_openid_a");
    const other = identityDocId("wxmwallowedappid0001", "mw08_openid_b");
    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toHaveLength(64);
    expect(first.includes("mw08_openid_a")).toBe(false);
    expect(memberDocId(first)).toBe(memberDocId(first));
    expect(memberDocId(first)).not.toBe(memberDocId(other));
    expect(defaultNickname(memberDocId(first))).toMatch(/^思维学员[0-9A-F]{4}$/);
  });

  it("accepts conservative nicknames and builtin avatars only", () => {
    expect(validateNickname("练习学员甲").ok).toBe(true);
    expect(validateNickname("AB").ok).toBe(true);
    expect(validateNickname(" 空格 ").ok).toBe(false);
    expect(validateNickname("一二三四五六七八九十十一十二十三十四十五")).toMatchObject({ ok: false });
    expect(validateNickname("管理员").ok).toBe(false);
    expect(validateNickname("官方客服").ok).toBe(false);
    expect(validateNickname("https://evil.example").ok).toBe(false);
    expect(validateNickname("emoji😀").ok).toBe(false);
    expect(validateAvatarKey(DEFAULT_AVATAR_KEY).ok).toBe(true);
    expect(validateAvatarKey("https://evil.example/a.png").ok).toBe(false);
    expect(validateAvatarKey("avatar.remote.99").ok).toBe(false);
    expect(BUILTIN_AVATAR_KEYS).toHaveLength(12);
    expect(NICKNAME_CONTENT_SAFETY.status).toBe("NOT_RUN");
  });

  it("rejects register and profile payloads that miss consent or use unknown fields", () => {
    expect(parseRegisterInput({ accepted: true, agreementVersion: "a", privacyVersion: "b" }).ok).toBe(true);
    expect(parseRegisterInput({ accepted: false, agreementVersion: "a", privacyVersion: "b" }).ok).toBe(false);
    expect(parseRegisterInput({ accepted: true, agreementVersion: "a" }).ok).toBe(false);
    expect(
      parseProfileInput({
        nickname: "练习学员乙",
        expectedRevision: 1,
        status: "active"
      }).ok
    ).toBe(false);
    expect(parseProfileInput({ nickname: "练习学员乙", expectedRevision: 1 }).ok).toBe(true);
    expect(
      matchPolicyVersions(
        { agreementVersion: "v1", privacyVersion: "p1" },
        { agreementVersion: "v2", privacyVersion: "p1" }
      )
    ).toEqual({ ok: false, reason: "POLICY_VERSION_MISMATCH" });
    expect(memberWriteTooLarge(4097)).toBe(true);
    expect(memberWriteTooLarge(16)).toBe(false);
  });
});
