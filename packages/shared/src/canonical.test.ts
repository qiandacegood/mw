import { createHmac, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, hashNamedFields, idempotencyId, payloadHash, sha256Hex } from "./canonical.js";
import { hmacSha256Hex } from "./jobs-invoke.js";

describe("canonical hashing", () => {
  it("matches known SHA-256 vectors and never truncates", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abc").length).toBe(64);
  });

  it("uses field names and fixed order for idempotency ids", () => {
    const first = idempotencyId("mw06/test/actor_a", "job.resume", "mw06/test/key_1");
    const second = hashNamedFields(
      { actorId: "mw06/test/actor_a", action: "job.resume", idempotencyKey: "mw06/test/key_1" },
      ["actorId", "action", "idempotencyKey"]
    );
    expect(first).toBe(second);
    expect(first).toBe(createHash("sha256").update(JSON.stringify({
      actorId: "mw06/test/actor_a",
      action: "job.resume",
      idempotencyKey: "mw06/test/key_1"
    })).digest("hex"));
    expect(first).not.toBe(
      hashNamedFields(
        { actorId: "mw06/test/actor_a", action: "job.resume", idempotencyKey: "mw06/test/key_1" },
        ["idempotencyKey", "action", "actorId"]
      )
    );
  });

  it("hashes payloads after sorting keys", () => {
    expect(payloadHash({ b: 2, a: 1 })).toBe(payloadHash({ a: 1, b: 2 }));
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("signs invoke envelopes with HMAC-SHA256", () => {
    const secret = "test-jobs-invoke-token-not-real";
    const message = '{"action":"jobs.process"}';
    expect(hmacSha256Hex(secret, message)).toBe(createHmac("sha256", secret).update(message).digest("hex"));
  });
});
