export const UNTRUSTED_CLIENT_FIELDS = [
  "userId",
  "userid",
  "openid",
  "openId",
  "open_id",
  "unionid",
  "unionId",
  "uid",
  "memberId",
  "identityId",
  "role",
  "score",
  "vipExpiresAt",
  "fromAppId",
  "fromOpenId",
  "FROM_APPID",
  "FROM_OPENID",
  "APPID",
  "OPENID"
] as const;

export type UntrustedClientField = (typeof UNTRUSTED_CLIENT_FIELDS)[number];

const UNTRUSTED_SET = new Set<string>(UNTRUSTED_CLIENT_FIELDS);

export function forgedClientFields(body: unknown): UntrustedClientField[] {
  const found = new Set<UntrustedClientField>();
  walkKeys(body, (key) => {
    if (UNTRUSTED_SET.has(key)) {
      found.add(key as UntrustedClientField);
    }
  });
  return UNTRUSTED_CLIENT_FIELDS.filter((field) => found.has(field));
}

function walkKeys(value: unknown, onKey: (key: string) => void, depth = 0): void {
  if (!value || typeof value !== "object" || depth > 8) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, onKey, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    onKey(key);
    walkKeys(child, onKey, depth + 1);
  }
}

export const ADMIN_ROLES = ["content", "operations", "super"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const MW_OFFICIAL_FUNCTIONS = [
  "mw-public",
  "mw-member",
  "mw-admin",
  "mw-upload",
  "mw-pay-hook",
  "mw-jobs"
] as const;

export const MW_SHARED_MINI_FUNCTIONS = ["mw-public", "mw-member"] as const;

export function presentText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function isPlaceholderAppId(appId: string): boolean {
  const value = appId.trim();
  return (
    value.length === 0 ||
    value === "touristappid" ||
    /placeholder|example|xxxx|your-/i.test(value)
  );
}

export function parseAllowedMiniAppIds(raw: string | string[] | undefined): string[] {
  const parts = Array.isArray(raw)
    ? raw
    : String(raw || "")
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);
  return [...new Set(parts.filter((item) => !isPlaceholderAppId(item)))];
}

export function identityFromTrustedContext(input: {
  appId?: string;
  openIdPresent: boolean;
  touristAppId?: boolean;
}): { trusted: boolean; reason: string } {
  if (input.touristAppId) {
    return { trusted: false, reason: "TOURIST_APPID" };
  }
  if (!input.appId || !input.openIdPresent) {
    return { trusted: false, reason: "NO_TRUSTED_MINI_CONTEXT" };
  }
  return { trusted: true, reason: "TRUSTED_MINI_CONTEXT" };
}

export function sharedMiniIdentity(input: {
  fromAppId?: string;
  fromOpenId?: string;
  resourceAppId?: string;
  resourceOpenId?: string;
  allowedAppIds: string[];
}): { trusted: boolean; reason: string } {
  const fromAppId = presentText(input.fromAppId) ? String(input.fromAppId).trim() : "";
  const fromOpenId = presentText(input.fromOpenId) ? String(input.fromOpenId).trim() : "";
  const allowed = parseAllowedMiniAppIds(input.allowedAppIds);
  if (fromAppId === "touristappid") {
    return { trusted: false, reason: "TOURIST_APPID" };
  }
  if (!fromAppId) {
    return {
      trusted: false,
      reason: presentText(input.resourceAppId) ? "RESOURCE_IDENTITY_IGNORED" : "NO_FROM_APPID"
    };
  }
  if (!fromOpenId) {
    return {
      trusted: false,
      reason: presentText(input.resourceOpenId) ? "RESOURCE_IDENTITY_IGNORED" : "NO_FROM_OPENID"
    };
  }
  if (allowed.length === 0) {
    return { trusted: false, reason: "APPID_WHITELIST_EMPTY" };
  }
  if (!allowed.includes(fromAppId)) {
    return { trusted: false, reason: "APPID_NOT_ALLOWED" };
  }
  return { trusted: true, reason: "TRUSTED_SHARED_MINI" };
}

export function cloudbaseAuthDecision(input: {
  fromAppId?: string;
  fromOpenId?: string;
  resourceAppId?: string;
  resourceOpenId?: string;
  allowedAppIds: string[];
}): { errCode: number; errMsg: string; allow: boolean; allowedFunctions: string[] } {
  const identity = sharedMiniIdentity(input);
  if (!identity.trusted) {
    return { errCode: 403, errMsg: identity.reason, allow: false, allowedFunctions: [] };
  }
  return {
    errCode: 0,
    errMsg: "",
    allow: true,
    allowedFunctions: [...MW_SHARED_MINI_FUNCTIONS]
  };
}

export function adminHasRole(roles: readonly string[] | undefined, required: AdminRole): boolean {
  const list = Array.isArray(roles) ? roles : [];
  if (list.includes("super")) {
    return true;
  }
  return list.includes(required);
}

export function adminAuthorized(input: {
  authUidPresent: boolean;
  whitelistHit: boolean;
  enabled: boolean;
}): { allowed: boolean; reason: string } {
  if (!input.authUidPresent) {
    return { allowed: false, reason: "NO_AUTH_UID" };
  }
  if (!input.whitelistHit) {
    return { allowed: false, reason: "NOT_IN_ADMIN_WHITELIST" };
  }
  if (!input.enabled) {
    return { allowed: false, reason: "ADMIN_DISABLED" };
  }
  return { allowed: true, reason: "AUTH_UID_AND_WHITELIST" };
}
