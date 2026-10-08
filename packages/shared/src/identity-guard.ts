export const UNTRUSTED_CLIENT_FIELDS = [
  "userId",
  "userid",
  "openid",
  "openId",
  "open_id",
  "unionid",
  "unionId",
  "uid",
  "role",
  "score",
  "vipExpiresAt"
] as const;

export type UntrustedClientField = (typeof UNTRUSTED_CLIENT_FIELDS)[number];

export function forgedClientFields(body: unknown): UntrustedClientField[] {
  if (!body || typeof body !== "object") {
    return [];
  }
  return UNTRUSTED_CLIENT_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field)
  );
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
