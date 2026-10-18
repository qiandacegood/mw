import {
  accountDeletedBlocksRegister,
  buildAuditEntry,
  buildIdempotencyRecord,
  collectDeletionPendingItems,
  deletionTerminalStatus,
  matchAcknowledgementVersion,
  minimizeDeletedProfile,
  parseDeletionInput,
  replayOrConflict,
  sessionOpenIdMatches,
  type DeletionPendingItem
} from "@mw/shared";
import type { MemberReadStore, MemberRecord, MemberWorkStore } from "./member-stores.js";
import { publicMemberView, readCurrentPolicies, runWithTxRetry, trustedMemberIds } from "./member.js";
import type { PolicyStore } from "./member-stores.js";
import type { OrderWorkStore } from "./order-stores.js";
import { markMemberFeedbacksDeleted } from "./feedback.js";
import type { FeedbackStore } from "./feedback-stores.js";
import type { Code2SessionFn } from "./wechat-session.js";

export const MEMBER_DELETION_READ_ACTIONS = ["member.deletionStatus"] as const;
export const MEMBER_DELETION_WRITE_ACTIONS = ["member.requestDeletion"] as const;

type ActionFailure = { ok: false; code: string; reason: string; issues?: string[]; details?: Record<string, unknown> };
type ActionSuccess<T> = { ok: true; data: T; replayed?: boolean };

function fail(code: string, reason: string, extra?: { issues?: string[]; details?: Record<string, unknown> }): ActionFailure {
  return { ok: false, code, reason, ...(extra || {}) };
}

function deletionView(input: {
  member: MemberRecord;
  pendingItems: DeletionPendingItem[];
  blocked: boolean;
  replayed?: boolean;
  feedbackMarked?: number;
}) {
  const view = publicMemberView(input.member);
  return {
    memberId: view.memberId,
    status: view.status,
    nickname: view.nickname,
    avatarKey: view.avatarKey,
    rankingOptIn: view.rankingOptIn,
    rankingBanned: view.rankingBanned,
    deletedAt: input.member.deletedAt || "",
    pendingItems: input.pendingItems,
    blocked: input.blocked,
    feedbackMarked: input.feedbackMarked ?? 0,
    note: input.blocked
      ? "请先处理未完成订单后再注销。支付与退款证据按最小必要保留。"
      : view.status === "deleted"
        ? "账号已注销。公开榜不可见；展示资料已最小保留。订单与退款记录按隐私口径保留。"
        : "可申请注销。"
  };
}

async function pendingForMember(orders: OrderWorkStore | undefined, memberId: string): Promise<DeletionPendingItem[]> {
  if (!orders) return [];
  const rows = await orders.listOrdersByMember(memberId, 50);
  return collectDeletionPendingItems(rows);
}

export async function readDeletionStatus(input: {
  stores: MemberReadStore;
  orders?: OrderWorkStore;
  fromAppId: string;
  fromOpenId: string;
}): Promise<ActionSuccess<ReturnType<typeof deletionView>> | ActionFailure> {
  const ids = trustedMemberIds(input.fromAppId, input.fromOpenId);
  const identity = await input.stores.getIdentity(ids.identityId);
  if (!identity) return fail("MEMBER_REQUIRED", "MEMBER_NOT_REGISTERED");
  const member = await input.stores.getMember(identity.memberId || ids.memberId);
  if (!member) return fail("INTERNAL_ERROR", "MEMBER_ROW_MISSING");
  const pendingItems = await pendingForMember(input.orders, member.memberId);
  return {
    ok: true,
    data: deletionView({
      member,
      pendingItems,
      blocked: pendingItems.length > 0 && !deletionTerminalStatus(member.status)
    })
  };
}

export async function requestMemberDeletion(input: {
  stores: MemberReadStore & MemberWorkStore;
  policies?: PolicyStore;
  orders?: OrderWorkStore;
  feedback?: FeedbackStore;
  code2Session?: Code2SessionFn;
  fromAppId: string;
  fromOpenId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<ActionSuccess<ReturnType<typeof deletionView>> | ActionFailure> {
  const parsed = parseDeletionInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "DELETION_INPUT_INVALID", { issues: parsed.issues });
  const policies = await readCurrentPolicies(input.policies, input.now);
  const ack = matchAcknowledgementVersion(parsed.acknowledgementVersion, policies.agreementVersion);
  if (!ack.ok) return fail("INVALID_ARGUMENT", ack.reason);
  if (!input.code2Session) return fail("INTERNAL_ERROR", "REAUTH_UNAVAILABLE");
  const session = await input.code2Session(parsed.reauthProof.code);
  if (!session.ok) return fail("INVALID_ARGUMENT", "REAUTH_REQUIRED");
  if (!sessionOpenIdMatches(session.openid, input.fromOpenId)) {
    return fail("INVALID_ARGUMENT", "REAUTH_MISMATCH");
  }

  const ids = trustedMemberIds(input.fromAppId, input.fromOpenId);
  const identity = await input.stores.getIdentity(ids.identityId);
  if (!identity) return fail("MEMBER_REQUIRED", "MEMBER_NOT_REGISTERED");
  const current = await input.stores.getMember(identity.memberId || ids.memberId);
  if (!current) return fail("INTERNAL_ERROR", "MEMBER_ROW_MISSING");

  const pendingItems = await pendingForMember(input.orders, current.memberId);
  if (pendingItems.length && !deletionTerminalStatus(current.status)) {
    return {
      ok: true,
      data: deletionView({ member: current, pendingItems, blocked: true })
    };
  }

  if (current.status === "deleted") {
    const marked = input.feedback
      ? await markMemberFeedbacksDeleted({ store: input.feedback, memberId: current.memberId, now: input.now })
      : { marked: 0 };
    return {
      ok: true,
      data: deletionView({ member: current, pendingItems: [], blocked: false, replayed: true, feedbackMarked: marked.marked }),
      replayed: true
    };
  }

  const idemRecord = buildIdempotencyRecord({
    actorId: ids.identityId,
    action: "member.requestDeletion",
    idempotencyKey: input.idempotencyKey,
    payload: { acknowledgementVersion: parsed.acknowledgementVersion, kind: parsed.reauthProof.kind },
    requestId: input.requestId
  });
  type View = ReturnType<typeof deletionView>;
  const attempted = await runWithTxRetry(() =>
    input.stores.transactProfile(ids.identityId, ids.memberId, idemRecord.id, (snap) => {
      const replay = replayOrConflict(snap.idem, idemRecord.payloadHash, () => null);
      if (!replay.ok) return { error: "IDEMPOTENCY_CONFLICT", result: undefined as unknown as View };
      if (replay.replayed && snap.idem?.status === "succeeded" && snap.idem.resultRef) {
        return { result: snap.idem.resultRef as View, replayed: true };
      }
      if (!snap.identity) return { error: "MEMBER_REQUIRED", result: undefined as unknown as View };
      const row = snap.member;
      if (!row) return { error: "MEMBER_ROW_MISSING", result: undefined as unknown as View };
      if (row.status === "deleted") {
        const view = deletionView({ member: row, pendingItems: [], blocked: false, replayed: true });
        return { result: view, replayed: true, idem: { ...idemRecord, status: "succeeded", resultRef: view } };
      }
      const nowIso = input.now.toISOString();
      const minimized = minimizeDeletedProfile({ nickname: row.nickname, avatarKey: row.avatarKey, nowIso });
      const next: MemberRecord = {
        ...row,
        nickname: minimized.nickname,
        avatarKey: minimized.avatarKey,
        rankingOptIn: false,
        status: "deleted",
        deletionRequestedAt: row.deletionRequestedAt || nowIso,
        deletedAt: minimized.deletedAt,
        revision: row.revision + 1,
        updatedAt: nowIso
      };
      const view = deletionView({ member: next, pendingItems: [], blocked: false });
      return {
        member: next,
        idem: { ...idemRecord, status: "succeeded", resultRef: view },
        audit: buildAuditEntry({
          actorType: "member",
          actorId: row.memberId,
          action: "member.requestDeletion",
          target: `members/${row.memberId}`,
          reason: "account deletion",
          requestId: input.requestId,
          before: { status: row.status, rankingOptIn: row.rankingOptIn, nickname: row.nickname, revision: row.revision },
          after: { status: next.status, rankingOptIn: next.rankingOptIn, nickname: next.nickname, revision: next.revision },
          now: input.now
        }),
        result: view
      };
    })
  );
  if (!attempted.ok) return fail("SERVICE_BUSY", "DELETION_TX_CONFLICT");
  const { mutation } = attempted.value;
  if (mutation.error === "MEMBER_REQUIRED") return fail("MEMBER_REQUIRED", "MEMBER_NOT_REGISTERED");
  if (mutation.error === "IDEMPOTENCY_CONFLICT") return fail("IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT");
  if (mutation.error) return fail("INTERNAL_ERROR", mutation.error);
  const marked = input.feedback
    ? await markMemberFeedbacksDeleted({
        store: input.feedback,
        memberId: mutation.result.memberId,
        now: input.now
      })
    : { marked: 0 };
  return {
    ok: true,
    data: { ...mutation.result, feedbackMarked: marked.marked },
    replayed: mutation.replayed === true
  };
}

export { accountDeletedBlocksRegister };
