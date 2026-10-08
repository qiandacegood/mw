import { idempotencyId, payloadHash } from "./canonical.js";

export type IdempotencyStatus = "pending" | "succeeded" | "failed" | "conflict";

export type IdempotencyRecord = {
  id: string;
  actorId: string;
  action: string;
  idempotencyKey: string;
  payloadHash: string;
  status: IdempotencyStatus;
  resultRef: unknown;
  requestId: string;
};

export function replayOrConflict(
  stored: Pick<IdempotencyRecord, "payloadHash" | "resultRef" | "status"> | undefined,
  nextPayloadHash: string,
  compute: () => unknown
):
  | { ok: true; result: unknown; replayed: boolean; pending?: boolean }
  | { ok: false; code: "IDEMPOTENCY_CONFLICT" } {
  if (!stored) {
    return { ok: true, result: compute(), replayed: false };
  }
  if (stored.payloadHash !== nextPayloadHash) {
    return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
  }
  if (stored.status === "pending") {
    return { ok: true, result: stored.resultRef, replayed: true, pending: true };
  }
  return { ok: true, result: stored.resultRef, replayed: true };
}

export function buildIdempotencyRecord(input: {
  actorId: string;
  action: string;
  idempotencyKey: string;
  payload: unknown;
  requestId: string;
  status?: IdempotencyStatus;
  resultRef?: unknown;
}): IdempotencyRecord {
  return {
    id: idempotencyId(input.actorId, input.action, input.idempotencyKey),
    actorId: input.actorId,
    action: input.action,
    idempotencyKey: input.idempotencyKey,
    payloadHash: payloadHash(input.payload),
    status: input.status ?? "pending",
    resultRef: input.resultRef ?? null,
    requestId: input.requestId
  };
}

export { idempotencyId, payloadHash };
