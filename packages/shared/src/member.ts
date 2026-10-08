import { hashNamedFields } from "./canonical.js";
import { rejectUnknownKeys } from "./validate.js";

export const IDENTITY_PROVIDER_WECHAT_MINI = "wechat_mini";
export const IDENTITY_ID_FIELDS = ["provider", "appId", "openId"] as const;
export const MEMBER_ID_FIELDS = ["kind", "identityId"] as const;

export const MEMBER_STATUSES = ["active", "disabled", "deleting", "deleted"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const DEFAULT_LEVEL_ID = "L1";
export const DEFAULT_AVATAR_KEY = "avatar.builtin.01";
export const BUILTIN_AVATAR_COUNT = 12;
export const BUILTIN_AVATAR_KEYS = Array.from(
  { length: BUILTIN_AVATAR_COUNT },
  (_, index) => `avatar.builtin.${String(index + 1).padStart(2, "0")}`
);

export const NICKNAME_MIN_CHARS = 2;
export const NICKNAME_MAX_CHARS = 16;
export const MEMBER_WRITE_MAX_BYTES = 4096;
export const MEMBER_SCHEMA_VERSION = 1;

export const DEFAULT_POLICY_VERSIONS = {
  agreementVersion: "mw08-test-agreement-v1",
  privacyVersion: "mw08-test-privacy-v1"
} as const;

export const NICKNAME_CONTENT_SAFETY = {
  status: "NOT_RUN",
  strategy: "conservative-charset",
  note: "微信内容安全 / msgSecCheck 未在 MW08 真实验证。昵称只接受保守字符集，不开放任意昵称。"
} as const;

export const AUDIT_ID_FIELDS = ["requestId", "action", "target"] as const;

export const MEMBER_PROFILE_FIELDS = ["nickname", "avatarKey", "expectedRevision"] as const;
export const MEMBER_REGISTER_FIELDS = ["agreementVersion", "privacyVersion", "accepted"] as const;
export const MEMBER_SERVER_FIELDS = [
  "memberId",
  "identityId",
  "status",
  "role",
  "score",
  "totalScore",
  "scoreSeq",
  "levelId",
  "rankingOptIn",
  "vip",
  "vipExpiresAt",
  "expiresAt",
  "revision"
] as const;

const RESERVED_NICKNAMES = new Set(
  [
    "管理员",
    "官方",
    "客服",
    "系统",
    "思维工坊",
    "思维作坊",
    "admin",
    "official",
    "system",
    "support",
    "administrator",
    "weixin",
    "wechat",
    "微信"
  ].map((item) => normalizeNicknameKey(item))
);

const NICKNAME_CHAR = /^(?:[\u4e00-\u9fff]|[\u3400-\u4dbf]|[A-Za-z0-9]|·)+$/;
const NICKNAME_URL = /https?:\/\/|www\.|\.com|\.cn|\.net|\.org/i;

export type PolicyVersions = {
  agreementVersion: string;
  privacyVersion: string;
};

export type ConsentVersions = PolicyVersions & {
  acceptedAt: string;
};

export function identityDocId(appId: string, openId: string): string {
  return hashNamedFields(
    { provider: IDENTITY_PROVIDER_WECHAT_MINI, appId, openId },
    IDENTITY_ID_FIELDS
  );
}

export function memberDocId(identityId: string): string {
  return hashNamedFields({ kind: "member", identityId }, MEMBER_ID_FIELDS);
}

export function auditDocId(input: { requestId: string; action: string; target: string }): string {
  return hashNamedFields(
    { requestId: input.requestId, action: input.action, target: input.target },
    AUDIT_ID_FIELDS
  );
}

export function concurrentRegisterPassed(left: { ok?: boolean; memberId?: string }, right: {
  ok?: boolean;
  memberId?: string;
}): boolean {
  return left.ok === true && right.ok === true && Boolean(left.memberId) && left.memberId === right.memberId;
}

export function defaultNickname(memberId: string): string {
  return `思维学员${memberId.slice(-4).toUpperCase()}`;
}

export function isBuiltinAvatarKey(value: string): boolean {
  return BUILTIN_AVATAR_KEYS.includes(value);
}

export function unicodeCharCount(text: string): number {
  return Array.from(text).length;
}

export function normalizeNicknameKey(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function validateNickname(input: unknown): { ok: true; nickname: string } | { ok: false; issues: string[] } {
  if (typeof input !== "string") {
    return { ok: false, issues: ["nickname must be string"] };
  }
  if (input !== input.trim() || /\s/.test(input.trim())) {
    return { ok: false, issues: ["nickname must not contain whitespace"] };
  }
  const nickname = input.normalize("NFC");
  const chars = unicodeCharCount(nickname);
  if (chars < NICKNAME_MIN_CHARS || chars > NICKNAME_MAX_CHARS) {
    return { ok: false, issues: [`nickname length must be ${NICKNAME_MIN_CHARS}-${NICKNAME_MAX_CHARS}`] };
  }
  if (!NICKNAME_CHAR.test(nickname)) {
    return { ok: false, issues: ["nickname contains disallowed characters"] };
  }
  if (NICKNAME_URL.test(nickname)) {
    return { ok: false, issues: ["nickname must not look like a url"] };
  }
  const key = normalizeNicknameKey(nickname);
  if (RESERVED_NICKNAMES.has(key) || key.startsWith("官方") || key.startsWith("管理")) {
    return { ok: false, issues: ["nickname is reserved"] };
  }
  return { ok: true, nickname };
}

export function validateAvatarKey(input: unknown): { ok: true; avatarKey: string } | { ok: false; issues: string[] } {
  if (typeof input !== "string") {
    return { ok: false, issues: ["avatarKey must be string"] };
  }
  if (!isBuiltinAvatarKey(input)) {
    return { ok: false, issues: ["avatarKey must be a builtin avatar"] };
  }
  return { ok: true, avatarKey: input };
}

export function parseRegisterInput(data: Record<string, unknown>): {
  ok: true;
  agreementVersion: string;
  privacyVersion: string;
  accepted: true;
} | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...MEMBER_REGISTER_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (data.accepted !== true) {
    issues.push("accepted must be true");
  }
  if (typeof data.agreementVersion !== "string" || !data.agreementVersion.trim()) {
    issues.push("agreementVersion required");
  }
  if (typeof data.privacyVersion !== "string" || !data.privacyVersion.trim()) {
    issues.push("privacyVersion required");
  }
  if (issues.length) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    agreementVersion: String(data.agreementVersion).trim(),
    privacyVersion: String(data.privacyVersion).trim(),
    accepted: true
  };
}

export function parseProfileInput(data: Record<string, unknown>): {
  ok: true;
  nickname?: string;
  avatarKey?: string;
  expectedRevision: number;
} | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...MEMBER_PROFILE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (typeof data.expectedRevision !== "number" || !Number.isInteger(data.expectedRevision) || data.expectedRevision < 1) {
    issues.push("expectedRevision must be a positive integer");
  }
  let nickname: string | undefined;
  let avatarKey: string | undefined;
  if (data.nickname !== undefined) {
    const checked = validateNickname(data.nickname);
    if (!checked.ok) issues.push(...checked.issues);
    else nickname = checked.nickname;
  }
  if (data.avatarKey !== undefined) {
    const checked = validateAvatarKey(data.avatarKey);
    if (!checked.ok) issues.push(...checked.issues);
    else avatarKey = checked.avatarKey;
  }
  if (nickname === undefined && avatarKey === undefined) {
    issues.push("nickname or avatarKey required");
  }
  if (issues.length) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    nickname,
    avatarKey,
    expectedRevision: data.expectedRevision as number
  };
}

export function matchPolicyVersions(
  submitted: PolicyVersions,
  current: PolicyVersions
): { ok: true } | { ok: false; reason: string } {
  if (!current.agreementVersion || !current.privacyVersion) {
    return { ok: false, reason: "POLICY_VERSION_MISSING" };
  }
  if (submitted.agreementVersion !== current.agreementVersion || submitted.privacyVersion !== current.privacyVersion) {
    return { ok: false, reason: "POLICY_VERSION_MISMATCH" };
  }
  return { ok: true };
}

export function defaultPolicyRecord(now: Date) {
  return {
    agreementVersion: DEFAULT_POLICY_VERSIONS.agreementVersion,
    privacyVersion: DEFAULT_POLICY_VERSIONS.privacyVersion,
    agreementTitle: "用户协议（测试稿）",
    privacyTitle: "隐私政策（测试稿）",
    placeholder: true,
    note: "正式文案由 MW24 接入",
    updatedAt: now.toISOString(),
    schemaVersion: MEMBER_SCHEMA_VERSION
  };
}

export function memberWriteTooLarge(bytes: number): boolean {
  return bytes > MEMBER_WRITE_MAX_BYTES;
}
