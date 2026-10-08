"use strict";

exports.main = async function main(event) {
  const hasSignature = Boolean(event && (event.signature || event.sign));
  const forged = event && (event.userId || event.openid || event.role);
  if (forged) {
    return { ok: false, entry: "mw-pay-hook", reason: "CLIENT_IDENTITY_IGNORED" };
  }
  if (!hasSignature) {
    return { ok: false, entry: "mw-pay-hook", reason: "SIGNATURE_REQUIRED" };
  }
  return { ok: false, entry: "mw-pay-hook", reason: "NOT_A_REAL_PAYMENT_CHANNEL" };
};
