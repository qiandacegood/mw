"use strict";

exports.main = async function main(event) {
  const clientLike = Boolean(event && (event.userId || event.openid || event.role || event.fromClient));
  const timerClaim = event && event.Type === "Timer";
  if (clientLike) {
    return { ok: false, entry: "mw-jobs", reason: "CLIENT_INVOKE_DENIED" };
  }
  if (timerClaim && !event.trustedScheduler) {
    return { ok: false, entry: "mw-jobs", reason: "TIMER_CLAIM_NOT_TRUSTED" };
  }
  return { ok: false, entry: "mw-jobs", reason: "NO_TRUSTED_SERVER_TRIGGER" };
};
