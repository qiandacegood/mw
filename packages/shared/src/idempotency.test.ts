import { describe, expect, it } from "vitest";
import { replayOrConflict } from "./idempotency.js";

describe("idempotency", () => {
  it("replays same hash and conflicts on different payload", () => {
    const first = replayOrConflict(undefined, "hash-a", () => ({ score: 80 }));
    expect(first).toEqual({ ok: true, result: { score: 80 }, replayed: false });
    if (!first.ok) throw new Error("expected success");
    const replay = replayOrConflict({ payloadHash: "hash-a", result: first.result }, "hash-a", () => ({ score: 1 }));
    expect(replay).toEqual({ ok: true, result: { score: 80 }, replayed: true });
    const conflict = replayOrConflict({ payloadHash: "hash-a", result: first.result }, "hash-b", () => ({ score: 70 }));
    expect(conflict).toEqual({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });
});
