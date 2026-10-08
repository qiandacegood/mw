"use strict";

const FORGED = ["userId", "openid", "openId", "uid", "role", "score", "vipExpiresAt"];

function forgedOf(body) {
  if (!body || typeof body !== "object") {
    return [];
  }
  return FORGED.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
}

function present(value) {
  return Boolean(value && String(value).trim());
}

exports.main = async function main(event, context) {
  const forged_fields = forgedOf(event);
  let wx = { available: false };
  try {
    const sdk = require("wx-server-sdk");
    sdk.init({ env: sdk.DYNAMIC_CURRENT_ENV });
    const ctx = sdk.getWXContext() || {};
    wx = {
      available: true,
      appid_present: present(ctx.APPID),
      openid_present: present(ctx.OPENID),
      tourist: ctx.APPID === "touristappid"
    };
  } catch (error) {
    wx = { available: false, reason: error && error.message ? String(error.message) : "wx-sdk-missing" };
  }

  const trusted = wx.appid_present && wx.openid_present && !wx.tourist;
  return {
    ok: false,
    entry: "mw-member",
    forged_fields,
    trusted_mini_context: trusted,
    reason: trusted ? "TRUSTED_CONTEXT_PRESENT_NO_BUSINESS" : "AUTH_REQUIRED",
    request_id_present: Boolean(context && context.request_id)
  };
};
