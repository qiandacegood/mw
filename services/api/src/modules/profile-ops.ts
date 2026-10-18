import {
  buildAuditEntry,
  buildIdempotencyRecord,
  categoryScoreView,
  disableBlocksWrites,
  parseMemberCategoryScoresInput,
  parseMemberDisableInput,
  parseMemberGetInput,
  parseMemberListInput,
  parseRankingBanInput,
  replayOrConflict,
  type PaperBest
} from "@mw/shared";
import type { MemberReadStore, MemberRecord, MemberWorkStore } from "./member-stores.js";
import type { AttemptReadStore } from "./attempt-stores.js";
import type { VipWorkStore } from "./vip-stores.js";
import { publicMemberView, runWithTxRetry, trustedMemberIds } from "./member.js";

export const ADMIN_MEMBER_READ_ACTIONS = ["member.list", "member.get"] as const;
export const ADMIN_MEMBER_DISABLE_ACTIONS = ["member.disable"] as const;
export const ADMIN_RANKING_BAN_ACTIONS = ["ranking.ban"] as const;
export const MEMBER_CATEGORY_SCORES_ACTION = "member.categoryScores";

type ActionFailure = { ok: false; code: string; reason: string; issues?: string[]; details?: Record<string, unknown> };
type ActionSuccess<T> = { ok: true; data: T; replayed?: boolean };

function fail(code: string, reason: string, extra?: { issues?: string[]; details?: Record<string, unknown> }): ActionFailure {
  return { ok: false, code, reason, ...(extra || {}) };
}

export function adminMemberView(
  member: MemberRecord,
  stats?: { totalScore: number; levelId: string },
  vip?: { active: boolean; expiresAt: string | null }
) {
  const view = publicMemberView(member, stats as never, undefined, undefined, vip);
  return {
    memberId: view.memberId,
    nickname: view.nickname,
    avatarKey: view.avatarKey,
    status: view.status,
    rankingOptIn: view.rankingOptIn,
    rankingBanned: view.rankingBanned,
    deletedAt: member.deletedAt || "",
    revision: view.revision,
    stats: {
      totalScore: view.stats.totalScore,
      levelId: view.stats.levelId
    },
    vip: view.vip
  };
}

export async function listAdminMembers(input: {
  stores: MemberReadStore;
  data: Record<string, unknown>;
}): Promise<ActionSuccess<{ items: ReturnType<typeof adminMemberView>[] }> | ActionFailure> {
  const parsed = parseMemberListInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "MEMBER_LIST_INPUT_INVALID", { issues: parsed.issues });
  if (!input.stores.listMembers) return fail("INTERNAL_ERROR", "MEMBER_LIST_UNAVAILABLE");
  const rows = await input.stores.listMembers({ limit: 80 });
  const filtered = rows.filter((row) => {
    if (parsed.status && row.status !== parsed.status) return false;
    if (parsed.nickname && !row.nickname.includes(parsed.nickname)) return false;
    return true;
  });
  const start = parsed.cursor ? filtered.findIndex((row) => row.memberId === parsed.cursor) + 1 : 0;
  const page = filtered.slice(Math.max(0, start), Math.max(0, start) + parsed.limit);
  const items = await Promise.all(
    page.map(async (row) => {
      const stats = await input.stores.getStats(row.memberId);
      return adminMemberView(row, stats);
    })
  );
  return { ok: true, data: { items } };
}

export async function getAdminMember(input: {
  stores: MemberReadStore;
  vip?: VipWorkStore;
  data: Record<string, unknown>;
  now: Date;
}): Promise<ActionSuccess<ReturnType<typeof adminMemberView>> | ActionFailure> {
  const parsed = parseMemberGetInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "MEMBER_GET_INPUT_INVALID", { issues: parsed.issues });
  const member = await input.stores.getMember(parsed.memberId);
  if (!member) return fail("NOT_FOUND", "MEMBER_NOT_FOUND");
  const stats = await input.stores.getStats(member.memberId);
  const vip = input.vip ? await input.vip.evaluate(member.memberId, input.now) : undefined;
  return {
    ok: true,
    data: adminMemberView(
      member,
      stats,
      vip ? { active: vip.active === true, expiresAt: vip.expiresAt || null } : undefined
    )
  };
}

export async function disableMember(input: {
  stores: MemberReadStore & MemberWorkStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<ActionSuccess<ReturnType<typeof adminMemberView>> | ActionFailure> {
  const parsed = parseMemberDisableInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "MEMBER_DISABLE_INPUT_INVALID", { issues: parsed.issues });
  if (!input.stores.transactAdminMember) return fail("INTERNAL_ERROR", "MEMBER_ADMIN_TX_UNAVAILABLE");
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "member.disable",
    idempotencyKey: input.idempotencyKey,
    payload: { memberId: parsed.memberId, disabled: parsed.disabled, reason: parsed.reason, expectedRevision: parsed.expectedRevision || 0 },
    requestId: input.requestId
  });
  type View = ReturnType<typeof adminMemberView>;
  const attempted = await runWithTxRetry(() =>
    input.stores.transactAdminMember!(parsed.memberId, idemRecord.id, (snap) => {
      const replay = replayOrConflict(snap.idem, idemRecord.payloadHash, () => null);
      if (!replay.ok) return { error: "IDEMPOTENCY_CONFLICT", result: undefined as unknown as View };
      if (replay.replayed && snap.idem?.status === "succeeded" && snap.idem.resultRef) {
        return { result: snap.idem.resultRef as View, replayed: true };
      }
      const current = snap.member;
      if (!current) return { error: "NOT_FOUND", result: undefined as unknown as View };
      if (parsed.expectedRevision !== undefined && current.revision !== parsed.expectedRevision) {
        return { error: "VERSION_CONFLICT", result: undefined as unknown as View };
      }
      if (current.status === "deleting" || current.status === "deleted") {
        return { error: "ACCOUNT_DELETED", result: undefined as unknown as View };
      }
      const nextStatus = parsed.disabled ? "disabled" : "active";
      if (current.status === nextStatus) {
        const view = adminMemberView(current, snap.stats);
        return { result: view, replayed: true, idem: { ...idemRecord, status: "succeeded", resultRef: view } };
      }
      const next: MemberRecord = {
        ...current,
        status: nextStatus,
        revision: current.revision + 1,
        updatedAt: input.now.toISOString()
      };
      const view = adminMemberView(next, snap.stats);
      return {
        member: next,
        idem: { ...idemRecord, status: "succeeded", resultRef: view },
        audit: buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: parsed.disabled ? "member.disable" : "member.enable",
          target: `members/${current.memberId}`,
          reason: parsed.reason,
          requestId: input.requestId,
          before: { status: current.status, rankingBanned: current.rankingBanned, revision: current.revision },
          after: { status: next.status, rankingBanned: next.rankingBanned, revision: next.revision },
          now: input.now
        }),
        result: view
      };
    })
  );
  if (!attempted.ok) return fail("SERVICE_BUSY", "MEMBER_DISABLE_TX_CONFLICT");
  const { mutation } = attempted.value;
  if (mutation.error === "NOT_FOUND") return fail("NOT_FOUND", "MEMBER_NOT_FOUND");
  if (mutation.error === "VERSION_CONFLICT") return fail("VERSION_CONFLICT", "MEMBER_REVISION_MISMATCH");
  if (mutation.error === "ACCOUNT_DISABLED") return fail("ACCOUNT_DISABLED", "MEMBER_NOT_RESTORABLE");
  if (mutation.error === "ACCOUNT_DELETED") return fail("ACCOUNT_DELETED", "ACCOUNT_DELETED");
  if (mutation.error === "IDEMPOTENCY_CONFLICT") return fail("IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT");
  if (mutation.error) return fail("INTERNAL_ERROR", mutation.error);
  return { ok: true, data: mutation.result, replayed: mutation.replayed === true };
}

export async function banRanking(input: {
  stores: MemberReadStore & MemberWorkStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<ActionSuccess<ReturnType<typeof adminMemberView>> | ActionFailure> {
  const parsed = parseRankingBanInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "RANKING_BAN_INPUT_INVALID", { issues: parsed.issues });
  if (!input.stores.transactAdminMember) return fail("INTERNAL_ERROR", "MEMBER_ADMIN_TX_UNAVAILABLE");
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "ranking.ban",
    idempotencyKey: input.idempotencyKey,
    payload: { memberId: parsed.memberId, banned: parsed.banned, reason: parsed.reason, expectedRevision: parsed.expectedRevision || 0 },
    requestId: input.requestId
  });
  type View = ReturnType<typeof adminMemberView>;
  const attempted = await runWithTxRetry(() =>
    input.stores.transactAdminMember!(parsed.memberId, idemRecord.id, (snap) => {
      const replay = replayOrConflict(snap.idem, idemRecord.payloadHash, () => null);
      if (!replay.ok) return { error: "IDEMPOTENCY_CONFLICT", result: undefined as unknown as View };
      if (replay.replayed && snap.idem?.status === "succeeded" && snap.idem.resultRef) {
        return { result: snap.idem.resultRef as View, replayed: true };
      }
      const current = snap.member;
      if (!current) return { error: "NOT_FOUND", result: undefined as unknown as View };
      if (parsed.expectedRevision !== undefined && current.revision !== parsed.expectedRevision) {
        return { error: "VERSION_CONFLICT", result: undefined as unknown as View };
      }
      if (current.status === "deleting" || current.status === "deleted") {
        return { error: "ACCOUNT_DELETED", result: undefined as unknown as View };
      }
      if (current.rankingBanned === parsed.banned) {
        const view = adminMemberView(current, snap.stats);
        return { result: view, replayed: true, idem: { ...idemRecord, status: "succeeded", resultRef: view } };
      }
      const next: MemberRecord = {
        ...current,
        rankingBanned: parsed.banned,
        revision: current.revision + 1,
        updatedAt: input.now.toISOString()
      };
      const view = adminMemberView(next, snap.stats);
      return {
        member: next,
        idem: { ...idemRecord, status: "succeeded", resultRef: view },
        audit: buildAuditEntry({
          actorType: "admin",
          actorId: input.actorId,
          action: parsed.banned ? "ranking.ban" : "ranking.unban",
          target: `members/${current.memberId}`,
          reason: parsed.reason,
          requestId: input.requestId,
          before: { status: current.status, rankingBanned: current.rankingBanned, revision: current.revision },
          after: { status: next.status, rankingBanned: next.rankingBanned, revision: next.revision },
          now: input.now
        }),
        result: view
      };
    })
  );
  if (!attempted.ok) return fail("SERVICE_BUSY", "RANKING_BAN_TX_CONFLICT");
  const { mutation } = attempted.value;
  if (mutation.error === "NOT_FOUND") return fail("NOT_FOUND", "MEMBER_NOT_FOUND");
  if (mutation.error === "VERSION_CONFLICT") return fail("VERSION_CONFLICT", "MEMBER_REVISION_MISMATCH");
  if (mutation.error === "IDEMPOTENCY_CONFLICT") return fail("IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT");
  if (mutation.error === "ACCOUNT_DELETED") return fail("ACCOUNT_DELETED", "ACCOUNT_DELETED");
  if (mutation.error) return fail("INTERNAL_ERROR", mutation.error);
  return { ok: true, data: mutation.result, replayed: mutation.replayed === true };
}

export async function readMemberCategoryScores(input: {
  members: MemberReadStore;
  attempts?: AttemptReadStore;
  fromAppId: string;
  fromOpenId: string;
  data: Record<string, unknown>;
}): Promise<ActionSuccess<{ treeVersion: number; nodes: { categoryId: string; directScore: number; inclusiveScore: number }[] }> | ActionFailure> {
  const parsed = parseMemberCategoryScoresInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", "CATEGORY_SCORES_INPUT_INVALID", { issues: parsed.issues });
  const ids = trustedMemberIds(input.fromAppId, input.fromOpenId);
  const identity = await input.members.getIdentity(ids.identityId);
  if (!identity) return fail("MEMBER_REQUIRED", "MEMBER_NOT_REGISTERED");
  const member = await input.members.getMember(identity.memberId || ids.memberId);
  if (!member) return fail("INTERNAL_ERROR", "MEMBER_ROW_MISSING");
  if (!input.attempts?.listMemberBests) {
    return { ok: true, data: { treeVersion: 0, nodes: [] } };
  }
  const bests = await input.attempts.listMemberBests(member.memberId);
  const papers: PaperBest[] = [];
  for (const row of bests) {
    const paper = await input.attempts.getPaper(row.paperId);
    if (!paper) continue;
    const category = await input.attempts.getCategory(paper.categoryId);
    papers.push({
      paperId: row.paperId,
      categoryId: paper.categoryId,
      ancestorIds: category?.ancestorIds || [],
      bestScore: row.bestScore
    });
  }
  const view = categoryScoreView(papers);
  const nodes = parsed.categoryId ? view.nodes.filter((row) => row.categoryId === parsed.categoryId) : view.nodes;
  const catalog = input.attempts.getCatalog ? await input.attempts.getCatalog() : undefined;
  return { ok: true, data: { treeVersion: catalog?.treeVersion ?? 0, nodes } };
}

export { disableBlocksWrites };
