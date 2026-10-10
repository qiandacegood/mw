import type { PaperAccess } from "./types.js";

export const ENTITLEMENT_SOURCE_ISOLATED_STUB = "isolated-stub" as const;

export type PracticeEntitlement = {
  vipActive: boolean;
  source: typeof ENTITLEMENT_SOURCE_ISOLATED_STUB;
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

export function paperStartDeniedByAccess(
  access: PaperAccess,
  entitlement: PracticeEntitlement
): { blocked: false } | { blocked: true; code: "VIP_REQUIRED"; reason: string } {
  if (access === "vip" && entitlement.vipActive !== true) {
    return { blocked: true, code: "VIP_REQUIRED", reason: "VIP_REQUIRED" };
  }
  return { blocked: false };
}
