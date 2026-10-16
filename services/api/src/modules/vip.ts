import {
  VIP_SOURCE_GIFT,
  applyVipGrant,
  buildAuditEntry,
  buildIdempotencyRecord,
  checkMaintenanceGate,
  defaultMaintenanceConfig,
  evaluateVipStatus,
  parseVipGrantInput,
  parseVipRevokeInput,
  replayOrConflict,
  revokeVipGift,
  vipGrantId,
  type MaintenanceConfig,
  type VipStatusView
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { MemberReadStore } from "./member-stores.js";
import { ledgerEntitlementReaderFromStore, type VipWorkStore } from "./vip-stores.js";

export const VIP_ADMIN_WRITE_ACTIONS = ["vip.grant", "vip.revokeGift"] as const;
export const VIP_MEMBER_READ_ACTIONS = ["vip.status"] as const;

export type VipActionFailure = {
  ok: false;
  code: string;
  reason: string;
  issues?: string[];
  details?: Record<string, unknown>;
};

export type VipActionSuccess<T> = {
  ok: true;
  data: T;
  replayed?: boolean;
  budget: TxBudget;
};

function emptyBudget(): TxBudget {
  return { reads: 0, writes: 0, total: 0, elapsedMs: 0 };
}

function fail(code: string, reason: string, extra?: { issues?: string[]; details?: Record<string, unknown> }): VipActionFailure {
  return {
    ok: false,
    code,
    reason,
    ...(extra?.issues ? { issues: extra.issues } : {}),
    ...(extra?.details ? { details: extra.details } : {})
  };
}

function entitlementApplyBlocked(config: MaintenanceConfig | undefined): VipActionFailure | undefined {
  const checked = checkMaintenanceGate(config || defaultMaintenanceConfig(new Date()), "entitlementApply");
  if (checked.allowed) return undefined;
  return fail("CONTENT_UPDATING", checked.reason || "ENTITLEMENT_APPLY_CLOSED", {
    details: { gate: "entitlementApply", jobId: checked.jobId }
  });
}

export async function readVipStatus(
  store: VipWorkStore | undefined,
  memberId: string,
  now: Date
): Promise<VipActionSuccess<VipStatusView> | VipActionFailure> {
  if (!store) return fail("INTERNAL_ERROR", "VIP_STORE_UNAVAILABLE");
  const data = await store.evaluate(memberId, now);
  return { ok: true, data, budget: emptyBudget() };
}

export function vipEntitlementReader(store: VipWorkStore | undefined) {
  if (!store) return undefined;
  return ledgerEntitlementReaderFromStore(store);
}

export async function grantVipGift(input: {
  store: VipWorkStore;
  members?: MemberReadStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
  maintenance?: MaintenanceConfig;
}): Promise<
  | VipActionSuccess<{
      memberId: string;
      sourceType: typeof VIP_SOURCE_GIFT;
      sourceId: string;
      grantId: string;
      active: boolean;
      expiresAt: string | null;
      remainingSeconds: number;
      durationSeconds: number;
      replayed: boolean;
    }>
  | VipActionFailure
> {
  const blocked = entitlementApplyBlocked(input.maintenance);
  if (blocked) return blocked;
  const parsed = parseVipGrantInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "VIP_GRANT_INPUT_INVALID", { issues: parsed.issues });
  if (input.members) {
    const member = await input.members.getMember(parsed.memberId);
    if (!member) return fail("NOT_FOUND", "MEMBER_NOT_FOUND");
    if (member.status === "disabled") return fail("ACCOUNT_DISABLED", "ACCOUNT_DISABLED");
  }
  const sourceId = parsed.sourceId || input.idempotencyKey;
  const grantId = vipGrantId(VIP_SOURCE_GIFT, sourceId);
  const existing = await input.store.listGrants(parsed.memberId);
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "vip.grant",
    idempotencyKey: input.idempotencyKey,
    payload: { memberId: parsed.memberId, sourceId, durationSeconds: parsed.durationSeconds, reason: parsed.reason },
    requestId: input.requestId
  });
  const grantIds = [...new Set([grantId, ...existing.map((row) => row.grantId)])];
  const { mutation, budget } = await input.store.transactLedger({
    memberId: parsed.memberId,
    grantIds,
    idempotencyId: idemRecord.id,
    mutate: (snap) => {
      const replay = replayOrConflict(snap.idem, idemRecord.payloadHash, () => null);
      if (!replay.ok) {
        return { error: "IDEMPOTENCY_CONFLICT", result: null };
      }
      if (replay.replayed && snap.idem?.resultRef) {
        return { result: snap.idem.resultRef, replayed: true, idem: snap.idem };
      }
      const applied = applyVipGrant({
        account: snap.account,
        grants: snap.grants,
        memberId: parsed.memberId,
        sourceType: VIP_SOURCE_GIFT,
        sourceId,
        durationSeconds: parsed.durationSeconds,
        grantedAt: input.now,
        reason: parsed.reason,
        actorId: input.actorId
      });
      if (!applied.ok) {
        return { error: applied.reason, result: null };
      }
      const status = evaluateVipStatus({ account: applied.account, grants: applied.grants, now: input.now });
      const view = {
        memberId: parsed.memberId,
        sourceType: VIP_SOURCE_GIFT,
        sourceId,
        grantId: applied.grant.grantId,
        active: status.active,
        expiresAt: applied.account.expiresAt,
        remainingSeconds: applied.account.remainingSeconds,
        durationSeconds: parsed.durationSeconds,
        replayed: applied.replayed
      };
      return {
        account: applied.account,
        grants: applied.grants,
        events: applied.events,
        idem: { ...idemRecord, status: "succeeded", resultRef: view },
        audit: buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: "vip.grant",
          target: parsed.memberId,
          reason: parsed.reason,
          requestId: input.requestId,
          before: snap.account,
          after: applied.account,
          now: input.now
        }),
        result: view,
        replayed: applied.replayed
      };
    }
  });
  if (mutation.error === "IDEMPOTENCY_CONFLICT") return fail("IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT");
  if (mutation.error) return fail("INVALID_ARGUMENT", mutation.error);
  const data = mutation.result as {
    memberId: string;
    sourceType: typeof VIP_SOURCE_GIFT;
    sourceId: string;
    grantId: string;
    active: boolean;
    expiresAt: string | null;
    remainingSeconds: number;
    durationSeconds: number;
    replayed: boolean;
  };
  return { ok: true, data, replayed: mutation.replayed === true || data.replayed === true, budget };
}

export async function revokeVipGiftAction(input: {
  store: VipWorkStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
  maintenance?: MaintenanceConfig;
}): Promise<
  | VipActionSuccess<{
      memberId: string;
      sourceId: string;
      grantId: string;
      revokedSeconds: number;
      active: boolean;
      expiresAt: string | null;
      remainingSeconds: number;
      replayed: boolean;
    }>
  | VipActionFailure
> {
  const blocked = entitlementApplyBlocked(input.maintenance);
  if (blocked) return blocked;
  const parsed = parseVipRevokeInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "VIP_REVOKE_INPUT_INVALID", { issues: parsed.issues });
  const grantId = vipGrantId(VIP_SOURCE_GIFT, parsed.sourceId);
  const existing = await input.store.listGrants(parsed.memberId);
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "vip.revokeGift",
    idempotencyKey: input.idempotencyKey,
    payload: { memberId: parsed.memberId, sourceId: parsed.sourceId, reason: parsed.reason },
    requestId: input.requestId
  });
  const grantIds = [...new Set([grantId, ...existing.map((row) => row.grantId)])];
  const { mutation, budget } = await input.store.transactLedger({
    memberId: parsed.memberId,
    grantIds,
    idempotencyId: idemRecord.id,
    mutate: (snap) => {
      const replay = replayOrConflict(snap.idem, idemRecord.payloadHash, () => null);
      if (!replay.ok) {
        return { error: "IDEMPOTENCY_CONFLICT", result: null };
      }
      if (replay.replayed && snap.idem?.resultRef) {
        return { result: snap.idem.resultRef, replayed: true, idem: snap.idem };
      }
      const applied = revokeVipGift({
        account: snap.account,
        grants: snap.grants,
        sourceId: parsed.sourceId,
        now: input.now,
        reason: parsed.reason
      });
      if (!applied.ok) {
        return { error: applied.reason, result: null };
      }
      const status = evaluateVipStatus({ account: applied.account, grants: applied.grants, now: input.now });
      const view = {
        memberId: parsed.memberId,
        sourceId: parsed.sourceId,
        grantId: applied.grant.grantId,
        revokedSeconds: applied.revokedSeconds,
        active: status.active,
        expiresAt: applied.account.expiresAt,
        remainingSeconds: applied.account.remainingSeconds,
        replayed: applied.replayed
      };
      return {
        account: applied.account,
        grants: applied.grants,
        events: applied.events,
        idem: { ...idemRecord, status: "succeeded", resultRef: view },
        audit: buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: "vip.revokeGift",
          target: parsed.memberId,
          reason: parsed.reason,
          requestId: input.requestId,
          before: snap.account,
          after: applied.account,
          now: input.now
        }),
        result: view,
        replayed: applied.replayed
      };
    }
  });
  if (mutation.error === "IDEMPOTENCY_CONFLICT") return fail("IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT");
  if (mutation.error === "GIFT_GRANT_NOT_FOUND") return fail("NOT_FOUND", "GIFT_GRANT_NOT_FOUND");
  if (mutation.error === "PAID_SOURCE_NOT_REVOCABLE") return fail("FORBIDDEN", "PAID_SOURCE_NOT_REVOCABLE");
  if (mutation.error) return fail("INVALID_ARGUMENT", mutation.error);
  const data = mutation.result as {
    memberId: string;
    sourceId: string;
    grantId: string;
    revokedSeconds: number;
    active: boolean;
    expiresAt: string | null;
    remainingSeconds: number;
    replayed: boolean;
  };
  return { ok: true, data, replayed: mutation.replayed === true || data.replayed === true, budget };
}
