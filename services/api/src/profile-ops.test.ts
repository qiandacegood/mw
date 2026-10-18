import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY_VERSIONS,
  rankingBoardId,
  rankingRowId,
  type PaperRecord,
  type PaperVersionRecord,
  type RankingHeadRecord,
  type RankingRowRecord
} from "@mw/shared";
import { handleOfficial, type AdminUserRecord, type OfficialContext } from "./official.js";
import { memoryMemberBundle, memoryPolicyStore } from "./modules/member-stores.js";
import { memoryPaperStore } from "./modules/paper-stores.js";
import { memoryFeedbackStore } from "./modules/feedback-stores.js";
import { memoryRankingStore } from "./modules/ranking-stores.js";
import { listRanking } from "./modules/ranking.js";

const allowedAppIds = ["wxmwallowedappid0001"];
const now = new Date("2026-10-18T12:00:00.000Z");
const fromA = { fromAppId: allowedAppIds[0], fromOpenId: "mw23_openid_a" };

function req(action: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    apiVersion: "1",
    action,
    requestId: extra.requestId || `req_${action.replace(/\./g, "_")}`,
    data,
    ...extra
  };
}

function paper(): PaperRecord {
  return {
    paperId: "paper_mw23",
    title: "MW23虚构卷",
    summary: "虚构简介",
    goal: "练习",
    categoryId: "cat_logic",
    access: "free",
    difficulty: "beginner",
    sort: 10,
    suggestedMinutes: 10,
    publishedAt: now.toISOString(),
    status: "published",
    activeVersionId: "paper_mw23_v",
    revision: 1,
    draftItems: [],
    draftQuestionCount: 1,
    draftMaxScore: 5,
    accessLocked: false,
    withdrawReason: null,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function version(): PaperVersionRecord {
  return {
    versionId: "paper_mw23_v",
    paperId: "paper_mw23",
    questionCount: 1,
    maxScore: 5,
    chunkIds: ["c1"],
    answerChunkIds: ["a1"],
    chunkDigests: ["d1"],
    answerDigests: ["d2"],
    categoryPathSnapshot: ["逻辑"],
    manifestHash: "m1",
    questionIds: ["q1"],
    questionVersionIds: ["qv1"],
    schemaVersion: 1,
    createdAt: now.toISOString(),
    createdBy: "uid_content"
  };
}

function memberCtx(
  event: unknown,
  stores: ReturnType<typeof memoryMemberBundle>,
  extra: Partial<OfficialContext> = {}
): OfficialContext {
  return {
    entry: "mw-member",
    event,
    allowedAppIds,
    now,
    policyStore: memoryPolicyStore(),
    memberStore: stores,
    paperStore: extra.paperStore || memoryPaperStore({ papers: [paper()], versions: [version()] }),
    feedbackStore: extra.feedbackStore || memoryFeedbackStore(),
    ...fromA,
    ...extra
  };
}

function adminCtx(
  event: unknown,
  stores: ReturnType<typeof memoryMemberBundle>,
  roles: string[],
  extra: Partial<OfficialContext> = {}
): OfficialContext {
  return {
    entry: "mw-admin",
    event,
    allowedAppIds,
    now,
    authUid: "uid_mw23_admin",
    adminStore: {
      async getByUid(uid) {
        return { uid, roles: roles as AdminUserRecord["roles"], enabled: true, authVersion: 1 };
      }
    },
    memberStore: stores,
    feedbackStore: extra.feedbackStore || memoryFeedbackStore(),
    ...extra
  };
}

async function register(stores: ReturnType<typeof memoryMemberBundle>) {
  const res = (await handleOfficial(
    memberCtx(req("member.register", {
      agreementVersion: DEFAULT_POLICY_VERSIONS.agreementVersion,
      privacyVersion: DEFAULT_POLICY_VERSIONS.privacyVersion,
      accepted: true
    }, { idempotencyKey: "mw23-reg" }), stores)
  )) as { ok: true; data: { memberId: string; revision: number } };
  return res.data;
}

describe("MW23 profile ops and feedback", () => {
  it("exposes public support entry on policies.current", async () => {
    const res = await handleOfficial({
      entry: "mw-public",
      event: req("policies.current"),
      allowedAppIds,
      now,
      policyStore: memoryPolicyStore()
    });
    expect(res).toMatchObject({
      ok: true,
      data: {
        support: { channel: "in-app", placeholder: true }
      }
    });
    expect(JSON.stringify(res)).not.toMatch(/openid|OPENID/i);
  });

  it("creates version-bound feedback, rejects links and answer-bank mutation", async () => {
    const stores = memoryMemberBundle();
    const feedbacks = memoryFeedbackStore();
    const papers = memoryPaperStore({ papers: [paper()], versions: [version()] });
    await register(stores);
    const created = await handleOfficial(
      memberCtx(
        req(
          "feedback.create",
          { type: "question_error", paperId: "paper_mw23", questionId: "q1", versionId: "qv1", text: "题干与选项对不上" },
          { idempotencyKey: "fb-1" }
        ),
        stores,
        { feedbackStore: feedbacks, paperStore: papers }
      )
    );
    expect(created).toMatchObject({ ok: true, data: { type: "question_error", status: "open", versionId: "qv1" } });
    const link = await handleOfficial(
      memberCtx(
        req(
          "feedback.create",
          { type: "analysis_error", paperId: "paper_mw23", questionId: "q1", versionId: "qv1", text: "见 https://evil.example" },
          { idempotencyKey: "fb-link" }
        ),
        stores,
        { feedbackStore: feedbacks, paperStore: papers }
      )
    );
    expect(link).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    const mutate = await handleOfficial(
      memberCtx(
        req(
          "feedback.create",
          {
            type: "question_error",
            paperId: "paper_mw23",
            questionId: "q1",
            versionId: "qv1",
            text: "想改答案",
            answer: "A"
          },
          { idempotencyKey: "fb-ans" }
        ),
        stores,
        { feedbackStore: feedbacks, paperStore: papers }
      )
    );
    expect(mutate).toMatchObject({ ok: false, error: { details: { reason: "FEEDBACK_CANNOT_MUTATE_ANSWERS" } } });
    const unbound = await handleOfficial(
      memberCtx(
        req(
          "feedback.create",
          { type: "question_error", paperId: "paper_mw23", questionId: "q1", versionId: "qv-other", text: "不是这个版本" },
          { idempotencyKey: "fb-ver" }
        ),
        stores,
        { feedbackStore: feedbacks, paperStore: papers }
      )
    );
    expect(unbound).toMatchObject({ ok: false, error: { details: { reason: "PAPER_QUESTION_VERSION_MISMATCH" } } });
  });

  it("lets operations list/resolve feedback and forbids content", async () => {
    const stores = memoryMemberBundle();
    const feedbacks = memoryFeedbackStore();
    const papers = memoryPaperStore({ papers: [paper()], versions: [version()] });
    await register(stores);
    const created = (await handleOfficial(
      memberCtx(
        req(
          "feedback.create",
          { type: "analysis_error", paperId: "paper_mw23", questionId: "q1", versionId: "qv1", text: "解析写反了条件" },
          { idempotencyKey: "fb-ops" }
        ),
        stores,
        { feedbackStore: feedbacks, paperStore: papers }
      )
    )) as { ok: true; data: { feedbackId: string } };
    const content = await handleOfficial(
      adminCtx(req("feedback.resolve", { feedbackId: created.data.feedbackId, note: "已核对原版" }), stores, ["content"], {
        feedbackStore: feedbacks
      })
    );
    expect(content).toMatchObject({ ok: false, error: { details: { reason: "OPERATIONS_ROLE_REQUIRED" } } });
    const listed = await handleOfficial(
      adminCtx(req("feedback.list", { status: "open" }), stores, ["operations"], { feedbackStore: feedbacks })
    );
    expect(listed).toMatchObject({ ok: true });
    const resolved = await handleOfficial(
      adminCtx(
        req("feedback.resolve", { feedbackId: created.data.feedbackId, note: "已核对原版解析无误" }),
        stores,
        ["operations"],
        { feedbackStore: feedbacks }
      )
    );
    expect(resolved).toMatchObject({ ok: true, data: { status: "resolved" } });
  });

  it("separates disable and ban; only super can do either; me remains readable", async () => {
    const stores = memoryMemberBundle();
    const created = await register(stores);
    const opsDisable = await handleOfficial(
      adminCtx(
        req("member.disable", { targetMemberId: created.memberId, disabled: true, reason: "运营不能停用" }, { idempotencyKey: "ops-d" }),
        stores,
        ["operations"]
      )
    );
    expect(opsDisable).toMatchObject({ ok: false, error: { details: { reason: "SUPER_ROLE_REQUIRED" } } });
    const opsBan = await handleOfficial(
      adminCtx(
        req("ranking.ban", { targetMemberId: created.memberId, banned: true, reason: "运营不能禁榜" }, { idempotencyKey: "ops-b" }),
        stores,
        ["operations"]
      )
    );
    expect(opsBan).toMatchObject({ ok: false, error: { details: { reason: "SUPER_ROLE_REQUIRED" } } });
    const banned = await handleOfficial(
      adminCtx(
        req("ranking.ban", { targetMemberId: created.memberId, banned: true, reason: "刷榜禁榜测试" }, { idempotencyKey: "ban-1" }),
        stores,
        ["super"]
      )
    );
    expect(banned).toMatchObject({
      ok: true,
      data: { rankingBanned: true, status: "active" }
    });
    const bannedRevision = (banned as { ok: true; data: { revision: number } }).data.revision;
    const stillWrite = await handleOfficial(
      memberCtx(
        req("member.updateProfile", { nickname: "禁榜后可改名", expectedRevision: bannedRevision }, { idempotencyKey: "ban-w" }),
        stores
      )
    );
    expect(stillWrite).toMatchObject({ ok: true, data: { nickname: "禁榜后可改名", status: "active" } });
    const disabled = await handleOfficial(
      adminCtx(
        req("member.disable", { targetMemberId: created.memberId, disabled: true, reason: "违规停用测试" }, { idempotencyKey: "dis-1" }),
        stores,
        ["super"]
      )
    );
    expect(disabled).toMatchObject({ ok: true, data: { status: "disabled", rankingBanned: true } });
    const write = await handleOfficial(
      memberCtx(
        req("member.updateProfile", { nickname: "停用后改名", expectedRevision: 3 }, { idempotencyKey: "dis-w" }),
        stores
      )
    );
    expect(write).toMatchObject({ ok: false, error: { code: "ACCOUNT_DISABLED" } });
    const me = await handleOfficial(memberCtx(req("member.me"), stores));
    expect(me).toMatchObject({ ok: true, data: { status: "disabled", memberId: created.memberId } });
    expect(JSON.stringify(me)).not.toMatch(/openid|OPENID/i);
    const restored = await handleOfficial(
      adminCtx(
        req("member.disable", { targetMemberId: created.memberId, disabled: false, reason: "恢复写权限" }, { idempotencyKey: "dis-r" }),
        stores,
        ["super"]
      )
    );
    expect(restored).toMatchObject({ ok: true, data: { status: "active" } });
  });

  it("lists members for operations without OPENID or order details", async () => {
    const stores = memoryMemberBundle();
    const created = await register(stores);
    const listed = await handleOfficial(adminCtx(req("member.list", {}), stores, ["operations"]));
    expect(listed).toMatchObject({ ok: true });
    const text = JSON.stringify(listed);
    expect(text).toContain(created.memberId);
    expect(text).not.toMatch(/openid|OPENID|orderId|orders/i);
    const content = await handleOfficial(adminCtx(req("member.list", {}), stores, ["content"]));
    expect(content).toMatchObject({ ok: false, error: { details: { reason: "OPERATIONS_ROLE_REQUIRED" } } });
  });

  it("overlays live nickname on public ranking rows and hides banned members", async () => {
    const ranking = memoryRankingStore();
    const boardId = rankingBoardId({ scope: "total", periodKey: "all", categoryId: "" });
    const generation = "gen_mw23";
    const memberId = "mem_mw23_live";
    const head: RankingHeadRecord = {
      boardId,
      scope: "total",
      periodKey: "all",
      categoryId: "",
      generation,
      publishedAt: now.toISOString(),
      sampleStartedAt: now.toISOString(),
      sampleEndedAt: now.toISOString(),
      catalogVersion: 1,
      participantCount: 1,
      displayCount: 1,
      boundaryTruncated: false,
      schemaVersion: 1,
      revision: 1
    };
    const row: RankingRowRecord = {
      rowId: rankingRowId({ boardId, generation, memberId }),
      boardId,
      generation,
      scope: "total",
      periodKey: "all",
      categoryId: "",
      memberId,
      nickname: "旧昵称",
      avatarKey: "avatar.builtin.01",
      levelId: "L1",
      value: 12,
      rank: 1,
      sortOrdinal: 0,
      reachedAt: now.toISOString(),
      prevValueDiff: null,
      schemaVersion: 1
    };
    ranking.heads.set(boardId, head);
    ranking.rows.set(row.rowId, row);
    ranking.seedMember({
      memberId,
      nickname: "旧昵称",
      avatarKey: "avatar.builtin.01",
      status: "active",
      rankingOptIn: true,
      rankingBanned: false,
      revision: 1
    });
    ranking.runtime = {
      publishedGeneration: generation,
      publishedAt: now.toISOString(),
      requestedAt: "",
      buildingSince: "",
      lastBuildStartedAt: now.toISOString(),
      lastBuildEndedAt: now.toISOString(),
      lastBuildOk: true,
      lastBuildError: "",
      catalogVersion: 1,
      boardCount: 1,
      rowCount: 1,
      rowCounts: { total: 1 },
      historyGapMembers: 0,
      historyGapScore: 0,
      truncated: false,
      schemaVersion: 1,
      revision: 1
    };
    const stores = memoryMemberBundle();
    stores.members.set(memberId, {
      memberId,
      nickname: "新昵称甲",
      avatarKey: "avatar.builtin.02",
      status: "active",
      rankingOptIn: true,
      rankingBanned: false,
      consentVersions: { agreementVersion: "a", privacyVersion: "p", acceptedAt: now.toISOString() },
      revision: 2,
      schemaVersion: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
    const listed = await listRanking({ store: ranking, members: stores, data: { scope: "total" }, now });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.data.rows[0]?.nickname).toBe("新昵称甲");
      expect(JSON.stringify(listed.data.rows)).not.toMatch(/mem_mw23_live|openid|OPENID/i);
    }
    stores.members.set(memberId, { ...stores.members.get(memberId)!, rankingBanned: true });
    const banned = await listRanking({ store: ranking, members: stores, data: { scope: "total" }, now });
    expect(banned.ok).toBe(true);
    if (banned.ok) expect(banned.data.rows).toEqual([]);
  });
});
