export type IdempotencyRecord = {
  payloadHash: string;
  result: unknown;
};

export function replayOrConflict(
  stored: IdempotencyRecord | undefined,
  payloadHash: string,
  compute: () => unknown
): { ok: true; result: unknown; replayed: boolean } | { ok: false; code: "IDEMPOTENCY_CONFLICT" } {
  if (!stored) {
    return { ok: true, result: compute(), replayed: false };
  }
  if (stored.payloadHash !== payloadHash) {
    return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
  }
  return { ok: true, result: stored.result, replayed: true };
}
