import { rejectUnknownKeys } from "./validate.js";
import { DEFAULT_AVATAR_KEY } from "./member.js";
import type { GrantState, PayState, RefundState } from "./types.js";

/**
 * MW24 账号注销纯逻辑。
 *
 * 重新认证 + 当前协议版本确认。未完成订单阻断。
 * 成功路径：opt-out、status deleting→deleted、资料最小保留、反馈标记已注销。
 * 停用 ≠ 注销。禁榜 ≠ 注销。已 deleted 身份再 register 拒绝，不 silently 新建。
 */

export const MEMBER_DELETION_FIELDS = ["reauthProof", "acknowledgementVersion"] as const;
export const DELETED_NICKNAME = "已注销用户";
export const DELETED_AVATAR_KEY = DEFAULT_AVATAR_KEY;

export const DELETION_PENDING_HINTS = {
  pendingPay: "待支付订单须先关闭或完成支付",
  confirmingPay: "确认中订单须等待支付结果",
  paidUnsettled: "已支付未关闭：权益仍在处理中",
  refundOpen: "退款处理中，须等待终态"
} as const;

export type DeletionPendingItem = {
  kind: "order";
  orderId: string;
  payState: string;
  grantState: string;
  refundState: string;
  hint: string;
};

export type ReauthProof = {
  kind: "wx_login_code";
  code: string;
};

export function parseReauthProof(value: unknown): { ok: true; proof: ReauthProof } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, issues: ["reauthProof required"] };
  }
  const rec = value as Record<string, unknown>;
  const extra = rejectUnknownKeys(rec, ["kind", "code"]);
  if (extra.length) issues.push(`unknown fields: ${extra.join(",")}`);
  if (rec.kind !== "wx_login_code") issues.push("reauthProof.kind must be wx_login_code");
  const code = typeof rec.code === "string" ? rec.code.trim() : "";
  if (!code || code.length > 256) issues.push("reauthProof.code required");
  if (issues.length) return { ok: false, issues };
  return { ok: true, proof: { kind: "wx_login_code", code } };
}

export function parseDeletionInput(data: Record<string, unknown>):
  | { ok: true; reauthProof: ReauthProof; acknowledgementVersion: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...MEMBER_DELETION_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const ack = typeof data.acknowledgementVersion === "string" ? data.acknowledgementVersion.trim() : "";
  if (!ack) issues.push("acknowledgementVersion required");
  const proof = parseReauthProof(data.reauthProof);
  if (!proof.ok) issues.push(...proof.issues);
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    reauthProof: (proof as { ok: true; proof: ReauthProof }).proof,
    acknowledgementVersion: ack
  };
}

export function matchAcknowledgementVersion(
  submitted: string,
  currentAgreementVersion: string
): { ok: true } | { ok: false; reason: string } {
  if (!currentAgreementVersion) return { ok: false, reason: "POLICY_VERSION_MISSING" };
  if (submitted !== currentAgreementVersion) return { ok: false, reason: "POLICY_VERSION_MISMATCH" };
  return { ok: true };
}

export function orderBlocksAccountDeletion(order: {
  payState: PayState | string;
  grantState: GrantState | string;
  refundState: RefundState | string;
}): { block: true; hint: string } | { block: false } {
  if (order.payState === "pending") return { block: true, hint: DELETION_PENDING_HINTS.pendingPay };
  if (order.payState === "confirming") return { block: true, hint: DELETION_PENDING_HINTS.confirmingPay };
  if (order.payState === "paid" && order.grantState !== "granted" && order.grantState !== "revokedRemaining") {
    return { block: true, hint: DELETION_PENDING_HINTS.paidUnsettled };
  }
  if (order.refundState === "requested" || order.refundState === "processing") {
    return { block: true, hint: DELETION_PENDING_HINTS.refundOpen };
  }
  return { block: false };
}

export function collectDeletionPendingItems(
  orders: readonly {
    orderId: string;
    payState: PayState | string;
    grantState: GrantState | string;
    refundState: RefundState | string;
  }[]
): DeletionPendingItem[] {
  const items: DeletionPendingItem[] = [];
  for (const order of orders) {
    const checked = orderBlocksAccountDeletion(order);
    if (!checked.block) continue;
    items.push({
      kind: "order",
      orderId: order.orderId,
      payState: String(order.payState),
      grantState: String(order.grantState),
      refundState: String(order.refundState),
      hint: checked.hint
    });
  }
  return items;
}

export function deletionTerminalStatus(status: string): boolean {
  return status === "deleting" || status === "deleted";
}

export function accountDeletedBlocksRegister(status: string): boolean {
  return deletionTerminalStatus(status);
}

export function minimizeDeletedProfile(input: { nickname: string; avatarKey: string; nowIso: string }): {
  nickname: string;
  avatarKey: string;
  rankingOptIn: false;
  status: "deleted";
  deletedAt: string;
} {
  return {
    nickname: DELETED_NICKNAME,
    avatarKey: DELETED_AVATAR_KEY,
    rankingOptIn: false,
    status: "deleted",
    deletedAt: input.nowIso
  };
}

export function publicProfileForStatus(input: {
  status: string;
  nickname: string;
  avatarKey: string;
  rankingOptIn: boolean;
}): { nickname: string; avatarKey: string; rankingOptIn: boolean } {
  if (deletionTerminalStatus(input.status)) {
    return { nickname: DELETED_NICKNAME, avatarKey: DELETED_AVATAR_KEY, rankingOptIn: false };
  }
  return {
    nickname: input.nickname,
    avatarKey: input.avatarKey,
    rankingOptIn: input.rankingOptIn === true
  };
}

/** 反馈只标记提交人已注销，不得改答案库。 */
export function markFeedbackSubmitterDeleted<T extends { submitterDeleted?: boolean; submitterDeletedAt?: string; updatedAt: string }>(
  row: T,
  nowIso: string
): T {
  return {
    ...row,
    submitterDeleted: true,
    submitterDeletedAt: nowIso,
    updatedAt: nowIso
  };
}

export function feedbackIsAnswerBank(_row: { submitterDeleted?: boolean }): boolean {
  return false;
}
