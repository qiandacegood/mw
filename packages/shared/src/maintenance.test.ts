import { describe, expect, it } from "vitest";
import {
  checkMaintenanceGate,
  closeCorrectionGates,
  defaultMaintenanceConfig,
  paymentNotifyBlockedByMaintenance,
  setMaintenanceGate
} from "./maintenance.js";

describe("maintenance gates", () => {
  it("keeps content, attempt, purchase and entitlement switches independent", () => {
    const now = new Date("2026-10-08T12:00:00.000Z");
    let config = defaultMaintenanceConfig(now);
    config = setMaintenanceGate(
      config,
      "contentWrites",
      { enabled: false, reason: "category move", jobId: "mw06/test/job_maint" },
      now
    );
    expect(checkMaintenanceGate(config, "contentWrites").allowed).toBe(false);
    expect(checkMaintenanceGate(config, "attemptStart").allowed).toBe(true);
    expect(checkMaintenanceGate(config, "attemptSubmit").allowed).toBe(true);
    expect(checkMaintenanceGate(config, "purchaseCreate").allowed).toBe(true);
    expect(checkMaintenanceGate(config, "entitlementApply").allowed).toBe(true);
    expect(paymentNotifyBlockedByMaintenance(config, "mw-pay-hook")).toEqual({
      blocked: false,
      reason: "PAYMENT_NOTIFY_NOT_GATED"
    });

    config = setMaintenanceGate(
      config,
      "purchaseCreate",
      { enabled: false, reason: "plan freeze", jobId: "mw06/test/job_pay" },
      now
    );
    expect(checkMaintenanceGate(config, "purchaseCreate").allowed).toBe(false);
    expect(checkMaintenanceGate(config, "entitlementApply").allowed).toBe(true);
    expect(paymentNotifyBlockedByMaintenance(config, "mw-pay-hook").blocked).toBe(false);
  });

  it("correction gates only close attemptSubmit", () => {
    const now = new Date("2026-10-16T02:00:00.000Z");
    const closed = closeCorrectionGates(defaultMaintenanceConfig(now), "job-corr", "grade correction drain", now);
    expect(checkMaintenanceGate(closed, "attemptSubmit").allowed).toBe(false);
    expect(checkMaintenanceGate(closed, "attemptStart").allowed).toBe(true);
    expect(checkMaintenanceGate(closed, "contentWrites").allowed).toBe(true);
    expect(checkMaintenanceGate(closed, "purchaseCreate").allowed).toBe(true);
  });
});
