"use strict";

const LIMIT = 5 * 1024 * 1024;

function byteLength(event) {
  if (event && typeof event.byteLength === "number") {
    return event.byteLength;
  }
  if (event && typeof event.csv === "string") {
    return Buffer.byteLength(event.csv);
  }
  if (Buffer.isBuffer(event)) {
    return event.length;
  }
  try {
    return Buffer.byteLength(JSON.stringify(event || {}));
  } catch {
    return 0;
  }
}

exports.main = async function main(event) {
  const ticket = event && event.uploadTicket;
  const bytes = byteLength(event);
  if (!ticket) {
    return { ok: false, entry: "mw-upload", reason: "TICKET_REQUIRED", bytes };
  }
  if (bytes > LIMIT) {
    return { ok: false, entry: "mw-upload", reason: "PAYLOAD_TOO_LARGE", bytes, limit: LIMIT };
  }
  return { ok: true, entry: "mw-upload", reason: "TICKET_AND_SIZE_OK", bytes, limit: LIMIT };
};
