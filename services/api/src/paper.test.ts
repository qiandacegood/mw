import { describe, expect, it } from "vitest";
import { hasPaperSecrets, questionVersionId, seedCategoryId, type CategoryRecord, type QuestionRecord, type QuestionVersionRecord } from "@mw/shared";
import { handleOfficial, memoryAdminStore } from "./official.js";
import { memoryCategoryStore } from "./modules/category-stores.js";
import { memoryPaperStore } from "./modules/paper-stores.js";
import { memoryQuestionStore, memoryQuestionUsage } from "./modules/question-stores.js";
import { memoryUploadStore } from "./modules/upload-stores.js";

const allowedAppIds = ["wxmwallowedappid0001"];
const now = new Date("2026-10-09T06:00:00.000Z");
const contentUid = "uid_content_1";
const superUid = "uid_super_1";
const categoryId = seedCategoryId("logical");

function adminStore() {
  return memoryAdminStore([
    { uid: contentUid, roles: ["content"], enabled: true, authVersion: 1 },
    { uid: superUid, roles: ["super"], enabled: true, authVersion: 1 },
    { uid: "uid_ops", roles: ["operations"], enabled: true, authVersion: 1 }
  ]);
}

function seedCategory(extra: Partial<CategoryRecord> = {}): CategoryRecord {
  const stamp = now.toISOString();
  return {
    categoryId,
    parentId: null,
    depth: 1,
    ancestorIds: [],
    name: "逻辑思维",
    normalizedName: "逻辑思维",
    sort: 10,
    enabled: true,
    deletedAt: null,
    revision: 1,
    treeVersion: 1,
    seedKey: "logical",
    schemaVersion: 1,
    createdAt: stamp,
    updatedAt: stamp,
    ...extra
  };
}

function seedQuestion(
  store: ReturnType<typeof memoryQuestionStore>,
  questionId: string,
  extra: { assetIds?: string[]; status?: "active" | "disabled"; revision?: number } = {}
): { questionId: string; versionId: string } {
  const revision = extra.revision ?? 1;
  const versionId = questionVersionId(questionId, revision);
  const question: QuestionRecord = {
    questionId,
    categoryId,
    currentVersionId: versionId,
    status: extra.status || "active",
    revision,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  const version: QuestionVersionRecord = {
    versionId,
    questionId,
    type: "single",
    stem: { text: `虚构题干 ${questionId}`, assetIds: extra.assetIds?.filter((id) => id.startsWith("prompt")) || [] },
    options: [
      { optionId: "A", text: "甲", assetIds: [] },
      { optionId: "B", text: "乙", assetIds: [] }
    ],
    answer: { optionIds: ["A"] },
    analysis: { text: "因为条件成立。", assetIds: extra.assetIds?.filter((id) => id.startsWith("analysis")) || [] },
    assetIds: extra.assetIds || [],
    defaultPoints: 5,
    difficulty: "beginner",
    categoryId,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    createdBy: contentUid
  };
  store.questions.set(questionId, question);
  store.versions.set(versionId, version);
  return { questionId, versionId };
}

function ctx(options: {
  paperStore: ReturnType<typeof memoryPaperStore>;
  questionStore: ReturnType<typeof memoryQuestionStore>;
  categoryStore?: ReturnType<typeof memoryCategoryStore>;
  usage?: ReturnType<typeof memoryQuestionUsage>;
  uid?: string;
  entry?: "mw-admin" | "mw-public" | "mw-member";
  event: unknown;
  fromAppId?: string;
  fromOpenId?: string;
}) {
  return handleOfficial({
    entry: options.entry || "mw-admin",
    event: options.event,
    allowedAppIds,
    authUid: options.uid,
    adminStore: adminStore(),
    categoryStore: options.categoryStore,
    questionStore: options.questionStore,
    questionUsage: options.usage,
    uploadStore: memoryUploadStore(),
    paperStore: options.paperStore,
    fromAppId: options.fromAppId,
    fromOpenId: options.fromOpenId,
    now
  });
}

function req(action: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    apiVersion: "1",
    action,
    requestId: `req_${action}_${Math.random().toString(16).slice(2)}`,
    data,
    ...extra
  };
}

function paperBody(items: Array<{ questionId: string; versionId: string; points?: number }>, extra: Record<string, unknown> = {}) {
  return {
    expectedRevision: 0,
    title: "MW11虚构卷",
    summary: "虚构简介",
    goal: "练习条件判断",
    categoryId,
    access: "free",
    difficulty: "beginner",
    sort: 10,
    suggestedMinutes: 20,
    items: items.map((item, index) => ({
      questionId: item.questionId,
      versionId: item.versionId,
      points: item.points ?? 5,
      ord: index + 1
    })),
    ...extra
  };
}

describe("MW11 paper compose and publish snapshot", () => {
  it("saves 1 and 21 question drafts, computes maxScore, and rejects illegal payloads", async () => {
    const questionStore = memoryQuestionStore();
    const paperStore = memoryPaperStore();
    const categoryStore = memoryCategoryStore([seedCategory()]);
    const one = seedQuestion(questionStore, "q1");
    const saved = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.save", paperBody([one]), { idempotencyKey: "save-1" })
    });
    expect(saved).toMatchObject({ ok: true, data: { draftQuestionCount: 1, draftMaxScore: 5, status: "draft" } });

    const manyItems = Array.from({ length: 21 }, (_, index) => seedQuestion(questionStore, `q21_${index + 1}`));
    const many = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.save", paperBody(manyItems, { title: "MW11跨块卷" }), { idempotencyKey: "save-21" })
    });
    expect(many).toMatchObject({ ok: true, data: { draftQuestionCount: 21, draftMaxScore: 105 } });

    const badCount = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.save", paperBody([]), { idempotencyKey: "bad-count" })
    });
    expect(badCount).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });

    const badPoints = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.save", paperBody([{ ...one, points: 0 }]), { idempotencyKey: "bad-points" })
    });
    expect(badPoints).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });

    const unknown = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.save", paperBody([one], { leak: true }), { idempotencyKey: "unknown" })
    });
    expect(unknown).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  });

  it("publishes a closed snapshot and rejects missing chunk, bad manifest, and unready assets", async () => {
    const questionStore = memoryQuestionStore();
    const paperStore = memoryPaperStore();
    const categoryStore = memoryCategoryStore([seedCategory()]);
    questionStore.assets.set("prompt-pending", {
      assetId: "prompt-pending",
      fileId: "f",
      objectKey: "mw-test/media/prompt/x",
      kind: "prompt",
      mime: "image/png",
      size: 12,
      sha256: "a".repeat(64),
      caption: "x",
      state: "pending",
      uploader: contentUid,
      ticketId: "t",
      schemaVersion: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
    const readyQ = seedQuestion(questionStore, "q-ok");
    const saved = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.save", paperBody([readyQ]), { idempotencyKey: "pub-save" })
    });
    expect(saved).toMatchObject({ ok: true });
    const paperId = (saved as { data: { paperId: string } }).data.paperId;

    const published = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.publish", { paperId, expectedRevision: 1 }, { idempotencyKey: "pub-ok" })
    });
    expect(published).toMatchObject({
      ok: true,
      data: { status: "published", questionCount: 1, maxScore: 5 }
    });
    const versionId = (published as { data: { versionId: string } }).data.versionId;
    const frozen = JSON.stringify(paperStore.versions.get(versionId));

    const missing = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req(
        "paper.publish",
        { paperId, expectedRevision: 2, injectPublishFault: "missingChunk" },
        { idempotencyKey: "pub-missing" }
      )
    });
    expect(missing).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });

    const badHash = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req(
        "paper.publish",
        { paperId, expectedRevision: 2, injectPublishFault: "badManifest" },
        { idempotencyKey: "pub-bad" }
      )
    });
    expect(badHash).toMatchObject({ ok: false, error: { details: { reason: "MANIFEST_HASH_MISMATCH" } } });

    const pendingQ = seedQuestion(questionStore, "q-pending", { assetIds: ["prompt-pending"] });
    const pendingPaper = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.save", paperBody([pendingQ], { title: "缺图卷" }), { idempotencyKey: "save-pending" })
    });
    const pendingId = (pendingPaper as { data: { paperId: string } }).data.paperId;
    const pendingPub = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.publish", { paperId: pendingId, expectedRevision: 1 }, { idempotencyKey: "pub-pending" })
    });
    expect(pendingPub).toMatchObject({ ok: false, error: { details: { reason: "ASSET_NOT_READY" } } });
    expect(JSON.stringify(paperStore.versions.get(versionId))).toBe(frozen);
  });

  it("keeps published versions/chunks/answers unchanged after the question is edited", async () => {
    const questionStore = memoryQuestionStore();
    const paperStore = memoryPaperStore();
    const categoryStore = memoryCategoryStore([seedCategory()]);
    const seeded = seedQuestion(questionStore, "q-edit");
    const saved = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.save", paperBody([seeded]), { idempotencyKey: "edit-save" })
    });
    const paperId = (saved as { data: { paperId: string } }).data.paperId;
    const published = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.publish", { paperId, expectedRevision: 1 }, { idempotencyKey: "edit-pub" })
    });
    const versionId = (published as { data: { versionId: string } }).data.versionId;
    const beforeVersion = JSON.stringify(paperStore.versions.get(versionId));
    const beforeChunks = JSON.stringify([...paperStore.chunks.values()]);
    const beforeAnswers = JSON.stringify([...paperStore.answers.values()]);

    const nextVersionId = questionVersionId("q-edit", 2);
    questionStore.questions.get("q-edit")!.revision = 2;
    questionStore.questions.get("q-edit")!.currentVersionId = nextVersionId;
    questionStore.versions.set(nextVersionId, {
      ...questionStore.versions.get(seeded.versionId)!,
      versionId: nextVersionId,
      stem: { text: "改过的题干", assetIds: [] }
    });

    const preview = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.preview", { paperId })
    });
    expect(preview).toMatchObject({ ok: true });
    const publishedPreview = (preview as { data: { publishedPreview: { items: Array<{ stem: { text: string } }>; versionId: string } } }).data
      .publishedPreview;
    expect(publishedPreview.versionId).toBe(versionId);
    expect(publishedPreview.items[0]?.stem.text).toContain("虚构题干");
    expect(JSON.stringify(paperStore.versions.get(versionId))).toBe(beforeVersion);
    expect(JSON.stringify([...paperStore.chunks.values()])).toBe(beforeChunks);
    expect(JSON.stringify([...paperStore.answers.values()])).toBe(beforeAnswers);

    const stale = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.publish", { paperId, expectedRevision: 2 }, { idempotencyKey: "edit-stale" })
    });
    expect(stale).toMatchObject({ ok: false, error: { details: { reason: "QUESTION_VERSION_STALE" } } });
  });

  it("separates unpublish and withdraw start gates", async () => {
    const questionStore = memoryQuestionStore();
    const paperStore = memoryPaperStore();
    const categoryStore = memoryCategoryStore([seedCategory()]);
    const seeded = seedQuestion(questionStore, "q-gate");
    const saved = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.save", paperBody([seeded]), { idempotencyKey: "gate-save" })
    });
    const paperId = (saved as { data: { paperId: string } }).data.paperId;
    await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.publish", { paperId, expectedRevision: 1 }, { idempotencyKey: "gate-pub" })
    });
    const unpublished = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.unpublish", { paperId, expectedRevision: 2 }, { idempotencyKey: "gate-unpub" })
    });
    expect(unpublished).toMatchObject({
      ok: true,
      data: { status: "unpublished", startGate: { blocked: true, reason: "PAPER_UNPUBLISHED" } }
    });
    const withdrawn = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req(
        "paper.withdraw",
        { paperId, expectedRevision: 3, reason: "答案错误需撤回" },
        { idempotencyKey: "gate-withdraw" }
      )
    });
    expect(withdrawn).toMatchObject({
      ok: true,
      data: { status: "withdrawn", startGate: { blocked: true, code: "PAPER_WITHDRAWN" } }
    });
    expect((unpublished as { data: { status: string } }).data.status).not.toBe(
      (withdrawn as { data: { status: string } }).data.status
    );
  });

  it("hides answers from public, member, and operations, and ignores forged identity writes", async () => {
    const questionStore = memoryQuestionStore();
    const paperStore = memoryPaperStore();
    const categoryStore = memoryCategoryStore([seedCategory()]);
    const seeded = seedQuestion(questionStore, "q-secret");
    const saved = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.save", paperBody([seeded], { title: "公开摘要卷" }), { idempotencyKey: "sec-save" })
    });
    const paperId = (saved as { data: { paperId: string } }).data.paperId;
    await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.publish", { paperId, expectedRevision: 1 }, { idempotencyKey: "sec-pub" })
    });

    const publicDetail = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      entry: "mw-public",
      event: req("paper.detail", { paperId })
    });
    expect(publicDetail).toMatchObject({ ok: true, data: { paper: { paperId, status: "published" } } });
    expect(hasPaperSecrets(publicDetail)).toEqual([]);
    expect(JSON.stringify(publicDetail)).not.toMatch(/"answer"|"analysis"|"paper_answers"|"question_versions"/);

    const member = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      entry: "mw-member",
      fromAppId: allowedAppIds[0],
      fromOpenId: "from_openid",
      event: req("paper.get", { paperId })
    });
    expect(member).toMatchObject({ ok: false, error: { details: { reason: "ACTION_DENIED" } } });

    const ops = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: "uid_ops",
      event: req("paper.save", paperBody([seeded]), { idempotencyKey: "ops-save" })
    });
    expect(ops).toMatchObject({ ok: false, error: { details: { reason: "CONTENT_ROLE_REQUIRED" } } });

    const forged = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.save", { ...paperBody([seeded]), uid: "forged", role: "super" }, { idempotencyKey: "forged" })
    });
    expect(forged).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", details: { reason: "CLIENT_IDENTITY_IGNORED" } }
    });
  });

  it("refuses disable of a question referenced by a published paper", async () => {
    const questionStore = memoryQuestionStore();
    const paperStore = memoryPaperStore();
    const categoryStore = memoryCategoryStore([seedCategory()]);
    const usage = memoryQuestionUsage();
    const seeded = seedQuestion(questionStore, "q-ref");
    const saved = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      usage,
      uid: contentUid,
      event: req("paper.save", paperBody([seeded]), { idempotencyKey: "ref-save" })
    });
    const paperId = (saved as { data: { paperId: string } }).data.paperId;
    await ctx({
      paperStore,
      questionStore,
      categoryStore,
      usage,
      uid: contentUid,
      event: req("paper.publish", { paperId, expectedRevision: 1 }, { idempotencyKey: "ref-pub" })
    });
    const disabled = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      usage,
      uid: contentUid,
      event: req("question.disable", { questionId: "q-ref", expectedRevision: 1, reason: "try" }, { idempotencyKey: "ref-dis" })
    });
    expect(disabled).toMatchObject({ ok: false, error: { details: { reason: "QUESTION_IN_USE" } } });
  });

  it("does not silently overwrite on expectedRevision mismatch", async () => {
    const questionStore = memoryQuestionStore();
    const paperStore = memoryPaperStore();
    const categoryStore = memoryCategoryStore([seedCategory()]);
    const seeded = seedQuestion(questionStore, "q-cas");
    const saved = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.save", paperBody([seeded]), { idempotencyKey: "cas-save" })
    });
    const paperId = (saved as { data: { paperId: string } }).data.paperId;
    const conflict = await ctx({
      paperStore,
      questionStore,
      categoryStore,
      uid: contentUid,
      event: req("paper.save", { ...paperBody([seeded]), paperId, expectedRevision: 0, title: "旧写" }, { idempotencyKey: "cas-old" })
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: "VERSION_CONFLICT" } });
  });
});
