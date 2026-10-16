import type { PaperAccess } from "./types.js";
import { evaluateVipStatus, type VipAccountRecord, type VipGrantRecord, type VipStatusView } from "./vip.js";

export const ENTITLEMENT_SOURCE_ISOLATED_STUB = "isolated-stub" as const;
export const ENTITLEMENT_SOURCE_LEDGER = "ledger" as const;

export type PracticeEntitlement = {
  vipActive: boolean;
  source: typeof ENTITLEMENT_SOURCE_ISOLATED_STUB | typeof ENTITLEMENT_SOURCE_LEDGER;
  expiresAt?: string | null;
  reconcileState?: string;
};

export type PracticeEntitlementReader = {
  evaluate(memberId: string, now: Date): Promise<PracticeEntitlement> | PracticeEntitlement;
};

export function isolatedPracticeEntitlement(input: {
  memberId?: string;
  vipMemberIds?: readonly string[];
} = {}): PracticeEntitlement {
  const vipIds = input.vipMemberIds || [];
  const memberId = input.memberId || "";
  return {
    vipActive: Boolean(memberId) && vipIds.includes(memberId),
    source: ENTITLEMENT_SOURCE_ISOLATED_STUB
  };
}

export function isolatedEntitlementReader(vipMemberIds: readonly string[] = []): PracticeEntitlementReader {
  return {
    evaluate(memberId: string) {
      return isolatedPracticeEntitlement({ memberId, vipMemberIds });
    }
  };
}

export function ledgerPracticeEntitlement(status: VipStatusView): PracticeEntitlement {
  return {
    vipActive: status.active === true,
    source: ENTITLEMENT_SOURCE_LEDGER,
    expiresAt: status.expiresAt,
    reconcileState: status.reconcileState
  };
}

export function ledgerEntitlementFromDocs(input: {
  account?: VipAccountRecord;
  grants?: readonly VipGrantRecord[];
  now: Date;
}): PracticeEntitlement {
  return ledgerPracticeEntitlement(evaluateVipStatus(input));
}

export function paperStartDeniedByAccess(
  access: PaperAccess,
  entitlement: PracticeEntitlement
): { blocked: false } | { blocked: true; code: "VIP_REQUIRED"; reason: string } {
  if (access === "vip" && entitlement.vipActive !== true) {
    return { blocked: true, code: "VIP_REQUIRED", reason: "VIP_REQUIRED" };
  }
  return { blocked: false };
}
