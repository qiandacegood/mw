import { describe, expect, it } from "vitest";
import { buildIdempotencyRecord, payloadHash, replayOrConflict } from "./idempotency.js";

describe("idempotency", () => {
  it("replays same hash and conflicts on different payload", () => {
    const first = replayOrConflict(undefined, "hash-a", () => ({ score: 80 }));
    expect(first).toEqual({ ok: true, result: { score: 80 }, replayed: false });
    if (!first.ok) throw new Error("expected success");
    const replay = replayOrConflict({ payloadHash: "hash-a", resultRef: first.result, status: "succeeded" }, "hash-a", () => ({
      score: 1
    }));
    expect(replay).toEqual({ ok: true, result: { score: 80 }, replayed: true });
    const conflict = replayOrConflict(
      { payloadHash: "hash-a", resultRef: first.result, status: "succeeded" },
      "hash-b",
      () => ({ score: 70 })
    );
    expect(conflict).toEqual({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("does not treat requestId as the idempotency identity", () => {
    const record = buildIdempotencyRecord({
      actorId: "mw06/test/actor_a",
      action: "job.resume",
      idempotencyKey: "mw06/test/key_1",
      payload: { jobId: "mw06/test/job_1", reason: "continue" },
      requestId: "req_one"
    });
    const otherRequest = buildIdempotencyRecord({
      actorId: "mw06/test/actor_a",
      action: "job.resume",
      idempotencyKey: "mw06/test/key_1",
      payload: { jobId: "mw06/test/job_1", reason: "continue" },
      requestId: "req_two"
    });
    expect(record.id).toBe(otherRequest.id);
    expect(record.payloadHash).toBe(payloadHash({ reason: "continue", jobId: "mw06/test/job_1" }));
    expect(record.id).not.toBe(record.requestId);
    const pending = replayOrConflict(record, record.payloadHash, () => ({ created: true }));
    expect(pending).toMatchObject({ ok: true, pending: true, replayed: true });
  });
});
