"use strict";

const FORGED = ["userId", "openid", "openId", "uid", "role", "score", "vipExpiresAt"];

function forgedOf(body) {
  if (!body || typeof body !== "object") {
    return [];
  }
  return FORGED.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
}

exports.main = async function main(event) {
  const action = event && event.action;
  const allowed = action === "catalog.list" || action === "ping";
  return {
    ok: allowed,
    entry: "mw-public",
    action: action || null,
    forged_fields: forgedOf(event),
    reason: allowed ? "PUBLIC_READ_ONLY" : "ACTION_DENIED"
  };
};
