import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY_VERSIONS,
  emptyCatalog,
  isolatedEntitlementReader,
  seedCategoryId,
  setMaintenanceGate,
  type CategoryRecord,
  type PaperChunkRecord,
  type PaperRecord,
  type PaperVersionRecord
} from "@mw/shared";
import { handleOfficial } from "./official.js";
import { memoryMaintenanceStore } from "./modules/job-stores.js";
import { memoryMemberBundle, memoryPolicyStore } from "./modules/member-stores.js";
import { memoryAttemptStore } from "./modules/attempt-stores.js";
import { memoryCategoryStore } from "./modules/category-stores.js";

const allowedAppIds = ["wxmwallowedappid0001"];
const now = new Date("2026-10-10T02:00:00.000Z");
const fromA = { fromAppId: allowedAppIds[0], fromOpenId: "mw14_openid_a" };
const rootId = seedCategoryId("logical");

function req(action: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    apiVersion: "1",
    action,
    requestId: extra.requestId || `req_${action.replace(".", "_")}_${JSON.stringify(data).length}`,
    data,
    ...extra
  };
}

function cat(id: string, extra: Partial<CategoryRecord> = {}): CategoryRecord {
  return {
    categoryId: id,
    parentId: extra.parentId ?? null,
    depth: extra.depth ?? 1,
    ancestorIds: extra.ancestorIds ?? [],
    name: extra.name || "逻辑思维",
    normalizedName: extra.name || "逻辑思维",
    sort: extra.sort ?? 10,
    enabled: extra.enabled !== false,
    deletedAt: extra.deletedAt ?? null,
    revision: 1,
    treeVersion: 3,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...extra
  };
}

function paper(id: string, extra: Partial<PaperRecord> = {}): PaperRecord {
  return {
    paperId: id,
    title: extra.title || `虚构卷${id}`,
    summary: "虚构简介",
    goal: "虚构目标",
    categoryId: extra.categoryId || rootId,
    access: extra.access || "free",
    difficulty: extra.difficulty || "beginner",
    sort: extra.sort ?? 10,
    suggestedMinutes: 20,
    publishedAt: extra.publishedAt ?? "2026-10-09T06:00:00.000Z",
    status: extra.status ?? "published",
    activeVersionId: extra.activeVersionId === undefined ? `${id}_v` : extra.activeVersionId,
    revision: 2,
    draftItems: [],
    draftQuestionCount: 2,
    draftMaxScore: 10,
    accessLocked: false,
    withdrawReason: extra.withdrawReason ?? null,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...extra
  };
}

function version(paperId: string, extra: Partial<PaperVersionRecord> = {}): PaperVersionRecord {
  return {
    versionId: extra.versionId || `${paperId}_v`,
    paperId,
    questionCount: extra.questionCount ?? 2,
    maxScore: extra.maxScore ?? 10,
    chunkIds: extra.chunkIds ?? [`${paperId}_c1`],
    answerChunkIds: extra.answerChunkIds ?? [`${paperId}_a1`],
    chunkDigests: ["d1"],
    answerDigests: ["d2"],
    categoryPathSnapshot: ["逻辑思维"],
    manifestHash: "m1",
    questionIds: extra.questionIds ?? ["q1", "q2"],
    questionVersionIds: ["qv1", "qv2"],
    schemaVersion: 1,
    createdAt: now.toISOString(),
    createdBy: "uid_content_1"
  };
}

function chunk(paperId: string): PaperChunkRecord {
  return {
    chunkId: `${paperId}_c1`,
    versionId: `${paperId}_v`,
    chunkNo: 1,
    items: [
      {
        ord: 1,
        questionId: "q1",
        questionVersionId: "qv1",
        type: "single",
        stem: { text: "虚构题干一", assetIds: [] },
        options: [
          { optionId: "A", text: "甲", assetIds: [] },
          { optionId: "B", text: "乙", assetIds: [] }
        ],
        points: 5
      },
      {
        ord: 2,
        questionId: "q2",
        questionVersionId: "qv2",
        type: "single",
        stem: { text: "虚构题干二", assetIds: [] },
        options: [
          { optionId: "A", text: "丙", assetIds: [] },
          { optionId: "B", text: "丁", assetIds: [] }
        ],
        points: 5
      }
    ],
    digest: "d1",
    schemaVersion: 1
  };
}

function seededAttempts(extraPapers: PaperRecord[] = []) {
  const papers = [
    paper("p_free"),
    paper("p_free_b", { title: "另一份免费虚构卷" }),
    paper("p_vip", { title: "VIP 虚构卷", access: "vip" }),
    paper("p_unpub", { title: "已下架", status: "unpublished" }),
    paper("p_withdrawn", { title: "已撤回", status: "withdrawn", withdrawReason: "测试" }),
    ...extraPapers
  ];
  const versions = papers.filter((row) => row.activeVersionId).map((row) => version(row.paperId));
  const chunks = papers.filter((row) => row.activeVersionId).map((row) => chunk(row.paperId));
  return memoryAttemptStore({
    papers,
    versions,
    chunks,
    categories: [cat(rootId)]
  });
}

async function register(
  stores: ReturnType<typeof memoryMemberBundle>,
  attempts: ReturnType<typeof seededAttempts>,
  identity = fromA
) {
  const res = await handleOfficial({
    entry: "mw-member",
    event: req(
      "member.register",
      {
        agreementVersion: DEFAULT_POLICY_VERSIONS.agreementVersion,
        privacyVersion: DEFAULT_POLICY_VERSIONS.privacyVersion,
        accepted: true
      },
      { idempotencyKey: "reg-1", requestId: "req_reg_1" }
    ),
    allowedAppIds,
    now,
    policyStore: memoryPolicyStore(),
    memberStore: stores,
    ...identity
  });
  const memberId = (res as { data?: { memberId?: string } }).data?.memberId || "";
  const member = stores.members.get(memberId);
  if (member) attempts.members.set(memberId, member);
  return { res, memberId, stores, attempts };
}

function ctx(
  event: unknown,
  stores: ReturnType<typeof memoryMemberBundle>,
  attempts: ReturnType<typeof seededAttempts>,
  extra: Record<string, unknown> = {}
) {
  return {
    entry: "mw-member" as const,
    event,
    allowedAppIds,
    now,
    policyStore: memoryPolicyStore(),
    memberStore: stores,
    attemptStore: attempts,
    maintenanceStore: memoryMaintenanceStore(),
    categoryStore: memoryCategoryStore([cat(rootId)], { ...emptyCatalog(now), treeVersion: 3, seeded: true }),
    ...fromA,
    ...extra
  };
}

describe("MW14 attempt drafts", () => {
  it("starts a free paper, saves a full answer set, and exposes a real member.me draft", async () => {
    const stores = memoryMemberBundle();
    const attempts = seededAttempts();
    const { memberId } = await register(stores, attempts);
    const started = (await handleOfficial(
      ctx(req("attempt.start", { paperId: "p_free" }, { idempotencyKey: "start-free", requestId: "req_start_free" }), stores, attempts)
    )) as { ok: true; data: { attemptId: string; revision: number } };
    expect(started).toMatchObject({ ok: true, data: { paperId: "p_free", revision: 0, questionCount: 2 } });

    const saved = await handleOfficial(
      ctx(
        req(
          "attempt.save",
          { attemptId: started.data.attemptId, expectedRevision: 0, answers: [{ questionId: "q1", optionIds: ["A"] }] },
          { idempotencyKey: "save-1", requestId: "req_save_1" }
        ),
        stores,
        attempts
      )
    );
    expect(saved).toMatchObject({ ok: true, data: { revision: 1, answeredCount: 1 } });

    const me = (await handleOfficial(ctx(req("member.me"), stores, attempts))) as {
      ok: true;
      data: { draft: { attemptId: string | null; paperId?: string; revision?: number } };
    };
    expect(me.data.draft.attemptId).toBe(started.data.attemptId);
    expect(me.data.draft.paperId).toBe("p_free");
    expect(me.data.draft.revision).toBe(1);
    expect(memberId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not auto-discard an existing inProgress draft", async () => {
    const stores = memoryMemberBundle();
    const attempts = seededAttempts();
    await register(stores, attempts);
    const first = (await handleOfficial(
      ctx(req("attempt.start", { paperId: "p_free" }, { idempotencyKey: "start-a", requestId: "req_start_a" }), stores, attempts)
    )) as { ok: true; data: { attemptId: string } };
    const second = await handleOfficial(
      ctx(req("attempt.start", { paperId: "p_free_b" }, { idempotencyKey: "start-b", requestId: "req_start_b" }), stores, attempts)
    );
    expect(second).toMatchObject({
      ok: false,
      error: {
        code: "ACTIVE_ATTEMPT_EXISTS",
        details: { existingAttemptId: first.data.attemptId, existingPaperId: "p_free" }
      }
    });
    expect(attempts.actives.size).toBe(1);
  });

  it("replaces an old draft in one transaction after confirmed=true", async () => {
    const stores = memoryMemberBundle();
    const attempts = seededAttempts();
    await register(stores, attempts);
    const first = (await handleOfficial(
      ctx(req("attempt.start", { paperId: "p_free" }, { idempotencyKey: "start-old", requestId: "req_start_old" }), stores, attempts)
    )) as { ok: true; data: { attemptId: string } };
    const denied = await handleOfficial(
      ctx(
        req(
          "attempt.startReplacing",
          { paperId: "p_free_b", abandonAttemptId: first.data.attemptId, expectedRevision: 0 },
          { idempotencyKey: "rep-no", requestId: "req_rep_no" }
        ),
        stores,
        attempts
      )
    );
    expect(denied).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    const replaced = (await handleOfficial(
      ctx(
        req(
          "attempt.startReplacing",
          { paperId: "p_free_b", abandonAttemptId: first.data.attemptId, expectedRevision: 0, confirmed: true },
          { idempotencyKey: "rep-yes", requestId: "req_rep_yes" }
        ),
        stores,
        attempts
      )
    )) as { ok: true; data: { attemptId: string; abandonedAttemptId: string } };
    expect(replaced.ok).toBe(true);
    expect(replaced.data.abandonedAttemptId).toBe(first.data.attemptId);
    expect(attempts.attempts.get(first.data.attemptId)?.state).toBe("abandoned");
    expect(attempts.actives.values().next().value?.attemptId).toBe(replaced.data.attemptId);
  });

  it("replays the same save requestId and rejects an old revision", async () => {
    const stores = memoryMemberBundle();
    const attempts = seededAttempts();
    await register(stores, attempts);
    const started = (await handleOfficial(
      ctx(req("attempt.start", { paperId: "p_free" }, { idempotencyKey: "start-save", requestId: "req_start_save" }), stores, attempts)
    )) as { ok: true; data: { attemptId: string } };
    const first = await handleOfficial(
      ctx(
        req(
          "attempt.save",
          { attemptId: started.data.attemptId, expectedRevision: 0, answers: [{ questionId: "q1", optionIds: ["A"] }] },
          { idempotencyKey: "save-same", requestId: "req_save_same" }
        ),
        stores,
        attempts
      )
    );
    const replay = await handleOfficial(
      ctx(
        req(
          "attempt.save",
          { attemptId: started.data.attemptId, expectedRevision: 0, answers: [{ questionId: "q1", optionIds: ["A"] }] },
          { idempotencyKey: "save-same", requestId: "req_save_same" }
        ),
        stores,
        attempts
      )
    );
    expect(first).toMatchObject({ ok: true, data: { revision: 1 } });
    expect(replay).toMatchObject({ ok: true, data: { revision: 1 }, replayed: true });
    const stale = await handleOfficial(
      ctx(
        req(
          "attempt.save",
          { attemptId: started.data.attemptId, expectedRevision: 0, answers: [{ questionId: "q2", optionIds: ["B"] }] },
          { idempotencyKey: "save-old", requestId: "req_save_old" }
        ),
        stores,
        attempts
      )
    );
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "DRAFT_CONFLICT", details: { serverRevision: 1 } }
    });
    const got = (await handleOfficial(
      ctx(req("attempt.get", { attemptId: started.data.attemptId }), stores, attempts)
    )) as { ok: true; data: { answers: Array<{ questionId: string }> } };
    expect(got.data.answers).toEqual([{ questionId: "q1", optionIds: ["A"] }]);
  });

  it("rejects save after a submitted fixture and does not move it back to inProgress", async () => {
    const stores = memoryMemberBundle();
    const attempts = seededAttempts();
    const { memberId } = await register(stores, attempts);
    const started = (await handleOfficial(
      ctx(req("attempt.start", { paperId: "p_free" }, { idempotencyKey: "start-sub", requestId: "req_start_sub" }), stores, attempts)
    )) as { ok: true; data: { attemptId: string } };
    const current = attempts.attempts.get(started.data.attemptId);
    expect(current).toBeTruthy();
    attempts.seedSubmitted({
      ...current!,
      state: "submitted",
      submittedAt: now.toISOString(),
      score: 5,
      gradeRevision: 1,
      submitHash: "fixture"
    });
    attempts.actives.delete(memberId);
    const save = await handleOfficial(
      ctx(
        req(
          "attempt.save",
          { attemptId: started.data.attemptId, expectedRevision: 0, answers: [{ questionId: "q1", optionIds: ["A"] }] },
          { idempotencyKey: "save-sub", requestId: "req_save_sub" }
        ),
        stores,
        attempts
      )
    );
    expect(save).toMatchObject({ ok: false, error: { code: "ALREADY_SUBMITTED" } });
    expect(attempts.attempts.get(started.data.attemptId)?.state).toBe("submitted");
  });

  it("rejects save after abandon and keeps the abandoned record", async () => {
    const stores = memoryMemberBundle();
    const attempts = seededAttempts();
    await register(stores, attempts);
    const started = (await handleOfficial(
      ctx(req("attempt.start", { paperId: "p_free" }, { idempotencyKey: "start-abd", requestId: "req_start_abd" }), stores, attempts)
    )) as { ok: true; data: { attemptId: string } };
    const abandoned = await handleOfficial(
      ctx(
        req(
          "attempt.abandon",
          { attemptId: started.data.attemptId, expectedRevision: 0, confirmed: true },
          { idempotencyKey: "abd-1", requestId: "req_abd_1" }
        ),
        stores,
        attempts
      )
    );
    expect(abandoned).toMatchObject({ ok: true, data: { state: "abandoned" } });
    const save = await handleOfficial(
      ctx(
        req(
          "attempt.save",
          { attemptId: started.data.attemptId, expectedRevision: 0, answers: [{ questionId: "q1", optionIds: ["A"] }] },
          { idempotencyKey: "save-abd", requestId: "req_save_abd" }
        ),
        stores,
        attempts
      )
    );
    expect(save).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(attempts.attempts.get(started.data.attemptId)?.state).toBe("abandoned");
    expect(attempts.actives.size).toBe(0);
  });

  it("keeps questionPage and unpaid get free of answers and analysis", async () => {
    const stores = memoryMemberBundle();
    const attempts = seededAttempts();
    await register(stores, attempts);
    const started = (await handleOfficial(
      ctx(req("attempt.start", { paperId: "p_free" }, { idempotencyKey: "start-page", requestId: "req_start_page" }), stores, attempts)
    )) as { ok: true; data: { attemptId: string } };
    const page = await handleOfficial(
      ctx(req("attempt.questionPage", { attemptId: started.data.attemptId, chunkNo: 1 }), stores, attempts)
    );
    const got = await handleOfficial(ctx(req("attempt.get", { attemptId: started.data.attemptId }), stores, attempts));
    const text = JSON.stringify({ page, got });
    expect(page).toMatchObject({ ok: true });
    expect(got).toMatchObject({ ok: true });
    expect(text).not.toMatch(/correctOptionIds|paper_answers|question_versions|解析机密|"answer":/);
    expect((page as { data: { items: unknown[] } }).data.items).toHaveLength(2);
  });

  it("returns VIP_REQUIRED for a free member on a VIP paper unless the isolated stub injects VIP", async () => {
    const stores = memoryMemberBundle();
    const attempts = seededAttempts();
    const { memberId } = await register(stores, attempts);
    const denied = await handleOfficial(
      ctx(req("attempt.start", { paperId: "p_vip" }, { idempotencyKey: "start-vip", requestId: "req_start_vip" }), stores, attempts)
    );
    expect(denied).toMatchObject({ ok: false, error: { code: "VIP_REQUIRED" } });
    const allowed = await handleOfficial(
      ctx(req("attempt.start", { paperId: "p_vip" }, { idempotencyKey: "start-vip-ok", requestId: "req_start_vip_ok" }), stores, attempts, {
        entitlement: isolatedEntitlementReader([memberId])
      })
    );
    expect(allowed).toMatchObject({ ok: true, data: { paperId: "p_vip" } });
  });

  it("requires registration and refuses unknown member actions such as submit", async () => {
    const stores = memoryMemberBundle();
    const attempts = seededAttempts();
    const guest = await handleOfficial(
      ctx(req("attempt.start", { paperId: "p_free" }, { idempotencyKey: "g1", requestId: "req_g1" }), stores, attempts)
    );
    expect(guest).toMatchObject({ ok: false, error: { code: "MEMBER_REQUIRED" } });
    await register(stores, attempts);
    const submit = await handleOfficial(
      ctx(req("attempt.submit", { attemptId: "x" }, { idempotencyKey: "sub", requestId: "req_sub" }), stores, attempts)
    );
    expect(submit).toMatchObject({ ok: false, error: { code: "FORBIDDEN", details: { reason: "ACTION_DENIED" } } });
  });

  it("blocks start when the attemptStart maintenance gate is closed", async () => {
    const stores = memoryMemberBundle();
    const attempts = seededAttempts();
    await register(stores, attempts);
    const maintenance = memoryMaintenanceStore();
    const closed = setMaintenanceGate(await maintenance.get(), "attemptStart", { enabled: false, reason: "freeze", jobId: "job1" }, now);
    await maintenance.save(closed);
    const res = await handleOfficial(
      ctx(req("attempt.start", { paperId: "p_free" }, { idempotencyKey: "mnt", requestId: "req_mnt" }), stores, attempts, {
        maintenanceStore: maintenance
      })
    );
    expect(res).toMatchObject({ ok: false, error: { code: "CONTENT_UPDATING" } });
  });
});
