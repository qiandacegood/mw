import { describe, expect, it } from "vitest";
import { buildAuditEntry, sanitizeAuditValue } from "./audit.js";

describe("audit redaction", () => {
  it("redacts secrets and does not keep raw identity or answers", () => {
    const sanitized = sanitizeAuditValue({
      jobId: "mw06/test/job_1",
      password: "x",
      openId: "wx-open-id",
      answer: ["A", "B"],
      CLOUDBASE_ENV_ID: "mw-secret-env",
      state: "queued"
    }) as Record<string, unknown>;
    expect(sanitized.password).toBe("[redacted]");
    expect(sanitized.openId).toBe("[redacted]");
    expect(sanitized.answer).toBe("[redacted]");
    expect(sanitized.CLOUDBASE_ENV_ID).toBe("[redacted]");
    expect(sanitized.state).toBe("queued");
    const entry = buildAuditEntry({
      actorType: "admin",
      actorId: "mw06/test/admin",
      action: "job.resume",
      target: "jobs/mw06/test/job_1",
      reason: "continue after review",
      requestId: "req_mw06_audit",
      before: { password: "x", state: "needsReview" },
      after: { state: "queued" },
      now: new Date("2026-10-08T12:00:00.000Z")
    });
    expect(entry.beforeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(entry)).not.toContain("x");
  });
});
