"use strict";

const FORGED = ["userId", "openid", "openId", "uid", "role", "score", "vipExpiresAt"];

function forgedOf(body) {
  if (!body || typeof body !== "object") {
    return [];
  }
  return FORGED.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
}

exports.main = async function main(event) {
  const forged_fields = forgedOf(event);
  const claimedUid = event && (event.uid || event.userId);
  return {
    ok: false,
    entry: "mw-admin",
    forged_fields,
    client_uid_ignored: Boolean(claimedUid),
    auth_uid_present: false,
    whitelist_hit: false,
    reason: "NO_AUTH_UID",
    note: "后台权需要 CloudBase Auth uid 再查 admin_users；本次无测试管理员登录"
  };
};
