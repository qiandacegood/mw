"use strict";

const LIMIT = 5 * 1024 * 1024;

function bodyBytes(event) {
  if (!event) return 0;
  if (Buffer.isBuffer(event)) return event.length;
  if (typeof event === "string") return Buffer.byteLength(event);
  if (typeof event.body === "string") return Buffer.byteLength(event.body);
  if (Buffer.isBuffer(event.body)) return event.body.length;
  if (typeof event.byteLength === "number") return event.byteLength;
  try {
    return Buffer.byteLength(JSON.stringify(event));
  } catch {
    return 0;
  }
}

exports.main = async function main(event) {
  const bytes = bodyBytes(event);
  return {
    ok: bytes <= LIMIT,
    entry: "mw-http-size-probe",
    bytes,
    limit: LIMIT,
    reason: bytes <= LIMIT ? "WITHIN_5MB" : "PAYLOAD_TOO_LARGE"
  };
};
