import { describe, expect, it } from "vitest";
import { evaluateJobsTrust, signJobsInvoke } from "./jobs-invoke.js";

const secret = "test-jobs-invoke-token-not-real";
const now = new Date("2026-10-08T12:00:00.000Z");

describe("jobs invoke trust", () => {
  it("rejects clients and forged timer Type fields", () => {
    expect(
      evaluateJobsTrust({
        event: { fromClient: true, Type: "Timer" },
        secret,
        now
      }).reason
    ).toBe("CLIENT_INVOKE_DENIED");
    expect(
      evaluateJobsTrust({
        event: { Type: "Timer", TriggerName: "mw-jobs-tick" },
        secret,
        now
      }).reason
    ).toBe("FORGED_TIMER_DENIED");
    expect(
      evaluateJobsTrust({
        event: { type: "timer" },
        fromAppId: "wxmwallowedappid0001",
        secret,
        now
      }).reason
    ).toBe("CLIENT_INVOKE_DENIED");
  });

  it("accepts a signed server invoke and ignores Type impersonation once signed", () => {
    const invoke = signJobsInvoke(secret, {
      action: "jobs.process",
      issuedAt: now.toISOString(),
      nonce: "n1",
      jobId: "mw06/test/job_1",
      command: "acquire"
    });
    const trusted = evaluateJobsTrust({
      event: { serverInvoke: invoke },
      secret,
      now
    });
    expect(trusted.trusted).toBe(true);
    const forgedMac = evaluateJobsTrust({
      event: { serverInvoke: { ...invoke, mac: "00".repeat(32) }, Type: "Timer" },
      secret,
      now
    });
    expect(forgedMac).toMatchObject({ trusted: false, reason: "FORGED_TIMER_DENIED" });
  });
});
