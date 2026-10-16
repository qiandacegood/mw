export const MAINTENANCE_GATES = [
  "contentWrites",
  "attemptStart",
  "attemptSubmit",
  "purchaseCreate",
  "entitlementApply"
] as const;

export type MaintenanceGate = (typeof MAINTENANCE_GATES)[number];

export interface MaintenanceFlag {
  enabled: boolean;
  reason: string;
  jobId: string;
  revision: number;
}

export interface MaintenanceConfig {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  contentWrites: MaintenanceFlag;
  attemptStart: MaintenanceFlag;
  attemptSubmit: MaintenanceFlag;
  purchaseCreate: MaintenanceFlag;
  entitlementApply: MaintenanceFlag;
}

export const PAYMENT_NOTIFY_ENTRY = "mw-pay-hook";

export function emptyMaintenanceFlag(revision = 1): MaintenanceFlag {
  return { enabled: true, reason: "", jobId: "", revision };
}

export function defaultMaintenanceConfig(now: Date): MaintenanceConfig {
  return {
    schemaVersion: 1,
    revision: 1,
    updatedAt: now.toISOString(),
    contentWrites: emptyMaintenanceFlag(),
    attemptStart: emptyMaintenanceFlag(),
    attemptSubmit: emptyMaintenanceFlag(),
    purchaseCreate: emptyMaintenanceFlag(),
    entitlementApply: emptyMaintenanceFlag()
  };
}

export function isMaintenanceGate(value: string): value is MaintenanceGate {
  return (MAINTENANCE_GATES as readonly string[]).includes(value);
}

export function gateOpen(config: MaintenanceConfig, gate: MaintenanceGate): boolean {
  return config[gate].enabled === true;
}

export function checkMaintenanceGate(
  config: MaintenanceConfig,
  gate: MaintenanceGate
): { allowed: boolean; reason: string; jobId: string; revision: number } {
  const flag = config[gate];
  if (flag.enabled) {
    return { allowed: true, reason: "", jobId: flag.jobId, revision: flag.revision };
  }
  return {
    allowed: false,
    reason: flag.reason || "MAINTENANCE_GATE_CLOSED",
    jobId: flag.jobId,
    revision: flag.revision
  };
}

export function paymentNotifyBlockedByMaintenance(
  config: MaintenanceConfig,
  entry: string
): { blocked: boolean; reason: string } {
  if (entry !== PAYMENT_NOTIFY_ENTRY) {
    return { blocked: false, reason: "NOT_PAYMENT_NOTIFY" };
  }
  for (const gate of MAINTENANCE_GATES) {
    if (!config[gate].enabled) {
      return { blocked: false, reason: "PAYMENT_NOTIFY_NOT_GATED" };
    }
  }
  return { blocked: false, reason: "PAYMENT_NOTIFY_NOT_GATED" };
}

export const CATALOG_CHANGE_GATES: readonly MaintenanceGate[] = ["contentWrites", "attemptStart", "attemptSubmit"];
/** 纠错首版：全站短时关闭交卷，不关内容写、不关开始、不关支付。 */
export const CORRECTION_GATES: readonly MaintenanceGate[] = ["attemptSubmit"];

export function closeCatalogChangeGates(
  config: MaintenanceConfig,
  jobId: string,
  reason: string,
  now: Date
): MaintenanceConfig {
  let next = config;
  for (const gate of CATALOG_CHANGE_GATES) {
    next = setMaintenanceGate(next, gate, { enabled: false, reason, jobId }, now);
  }
  return next;
}

export function closeCorrectionGates(
  config: MaintenanceConfig,
  jobId: string,
  reason: string,
  now: Date
): MaintenanceConfig {
  let next = config;
  for (const gate of CORRECTION_GATES) {
    next = setMaintenanceGate(next, gate, { enabled: false, reason, jobId }, now);
  }
  return next;
}

export function openCorrectionGatesIfOwned(
  config: MaintenanceConfig,
  jobId: string,
  now: Date
): MaintenanceConfig {
  let next = config;
  for (const gate of CORRECTION_GATES) {
    if (next[gate].jobId && next[gate].jobId !== jobId) continue;
    next = setMaintenanceGate(next, gate, { enabled: true, reason: "", jobId: "" }, now);
  }
  return next;
}

/** 只打开本任务占用的门；其他任务占用的支付等开关不误开。 */
export function openCatalogChangeGatesIfOwned(
  config: MaintenanceConfig,
  jobId: string,
  now: Date
): MaintenanceConfig {
  let next = config;
  for (const gate of CATALOG_CHANGE_GATES) {
    if (next[gate].jobId && next[gate].jobId !== jobId) continue;
    next = setMaintenanceGate(next, gate, { enabled: true, reason: "", jobId: "" }, now);
  }
  return next;
}

export function setMaintenanceGate(
  config: MaintenanceConfig,
  gate: MaintenanceGate,
  flag: Omit<MaintenanceFlag, "revision">,
  now: Date
): MaintenanceConfig {
  const current = config[gate];
  return {
    ...config,
    [gate]: {
      enabled: flag.enabled,
      reason: flag.reason,
      jobId: flag.jobId,
      revision: current.revision + 1
    },
    revision: config.revision + 1,
    updatedAt: now.toISOString()
  };
}
