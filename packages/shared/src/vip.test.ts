import { describe, expect, it } from "vitest";
import { durationSecondsFromDays, isVipActive, nextExpiresAt } from "./vip.js";

describe("vip duration", () => {
  it("first 30-day grant and renewal match the baseline example", () => {
    const granted = Date.parse("2026-10-03T02:00:00.000Z");
    const seconds = durationSecondsFromDays(30);
    expect(seconds).toBe(2592000);
    const first = nextExpiresAt({ grantedAtMs: granted, durationSeconds: seconds, currentExpiresAtMs: null });
    expect(new Date(first).toISOString()).toBe("2026-11-02T02:00:00.000Z");
    const renewed = nextExpiresAt({
      grantedAtMs: Date.parse("2026-10-20T02:00:00.000Z"),
      durationSeconds: seconds,
      currentExpiresAtMs: first
    });
    expect(new Date(renewed).toISOString()).toBe("2026-12-02T02:00:00.000Z");
    expect(isVipActive(first, Date.parse("2026-11-02T02:00:00.000Z"))).toBe(false);
    expect(isVipActive(first, Date.parse("2026-11-02T01:59:59.000Z"))).toBe(true);
  });
});
