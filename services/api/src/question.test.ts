import { describe, expect, it } from "vitest";
import {
  MINIMAL_PNG,
  fakePngNamedHtml,
  hasQuestionSecrets,
  oversizedImageBytes,
  seedCategoryId,
  sha256OfBytes,
  type CategoryRecord
} from "@mw/shared";
import { handleOfficial, memoryAdminStore } from "./official.js";
import { memoryCategoryStore } from "./modules/category-stores.js";
import { memoryQuestionStore, memoryQuestionUsage } from "./modules/question-stores.js";
import { memoryObjectStorage, memoryUploadStore } from "./modules/upload-stores.js";

const allowedAppIds = ["wxmwallowedappid0001"];
const now = new Date("2026-10-09T04:00:00.000Z");
const contentUid = "uid_content_1";
const superUid = "uid_super_1";
const categoryId = seedCategoryId("logical");

function adminStore() {
  return memoryAdminStore([
    { uid: contentUid, roles: ["content"], enabled: true, authVersion: 1 },
    { uid: superUid, roles: ["super"], enabled: true, authVersion: 1 },
    { uid: "uid_ops", roles: ["operations"], enabled: true, authVersion: 1 },
    { uid: "uid_disabled", roles: ["content"], enabled: false, authVersion: 1 }
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

function ctx(options: {
  questionStore: ReturnType<typeof memoryQuestionStore>;
  uploadStore: ReturnType<typeof memoryUploadStore>;
  categoryStore?: ReturnType<typeof memoryCategoryStore>;
  usage?: ReturnType<typeof memoryQuestionUsage>;
  uid?: string;
  entry?: "mw-admin" | "mw-public" | "mw-member" | "mw-upload";
  event: unknown;
  fromAppId?: string;
  fromOpenId?: string;
  clock?: Date;
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
    uploadStore: options.uploadStore,
    fromAppId: options.fromAppId,
    fromOpenId: options.fromOpenId,
    now: options.clock || now
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

function singleBody(extra: Record<string, unknown> = {}) {
  return {
    expectedRevision: 0,
    categoryId,
    type: "single",
    stem: { text: "虚构单选题干" },
    options: [
      { optionId: "A", text: "选项甲" },
      { optionId: "B", text: "选项乙" }
    ],
    answer: { optionIds: ["A"] },
    analysis: { text: "因为条件甲成立。" },
    defaultPoints: 5,
    difficulty: "beginner",
    ...extra
  };
}

describe("MW10 question bank and media", () => {
  it("saves three types and rejects illegal payloads", async () => {
    const questionStore = memoryQuestionStore();
    const uploadStore = memoryUploadStore();
    const categoryStore = memoryCategoryStore([seedCategory()]);
    const common = { questionStore, uploadStore, categoryStore, uid: contentUid };

    const single = await ctx({
      ...common,
      event: req("question.save", singleBody(), { idempotencyKey: "save-single" })
    });
    expect(single).toMatchObject({ ok: true, data: { type: "single", revision: 1 } });

    const multi = await ctx({
      ...common,
      event: req(
        "question.save",
        singleBody({
          type: "multiple",
          options: [
            { optionId: "A", text: "甲" },
            { optionId: "B", text: "乙" },
            { optionId: "C", text: "丙" }
          ],
          answer: { optionIds: ["A", "C"] },
          analysis: { text: "漏选 C 不得分，误选 B 也不得分。" }
        }),
        { idempotencyKey: "save-multi" }
      )
    });
    expect(multi).toMatchObject({ ok: true, data: { type: "multiple" } });

    const judge = await ctx({
      ...common,
      event: req(
        "question.save",
        singleBody({
          type: "trueFalse",
          options: [
            { optionId: "TRUE", text: "正确" },
            { optionId: "FALSE", text: "错误" }
          ],
          answer: { optionIds: ["FALSE"] },
          analysis: { text: "陈述与前提矛盾。" }
        }),
        { idempotencyKey: "save-tf" }
      )
    });
    expect(judge).toMatchObject({ ok: true, data: { type: "trueFalse" } });

    const badCount = await ctx({
      ...common,
      event: req("question.save", singleBody({ options: [{ optionId: "A", text: "甲" }] }), { idempotencyKey: "bad-count" })
    });
    expect(badCount).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });

    const emptyAnalysis = await ctx({
      ...common,
      event: req("question.save", singleBody({ analysis: { text: "" } }), { idempotencyKey: "empty-analysis" })
    });
    expect(emptyAnalysis).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });

    const badPoints = await ctx({
      ...common,
      event: req("question.save", singleBody({ defaultPoints: 0 }), { idempotencyKey: "bad-points" })
    });
    expect(badPoints).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });

    const unknown = await ctx({
      ...common,
      event: req("question.save", singleBody({ leak: true }), { idempotencyKey: "unknown" })
    });
    expect(unknown).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });

    const disabledCat = memoryCategoryStore([seedCategory({ enabled: false })]);
    const disabled = await ctx({
      questionStore: memoryQuestionStore(),
      uploadStore,
      categoryStore: disabledCat,
      uid: contentUid,
      event: req("question.save", singleBody(), { idempotencyKey: "disabled-cat" })
    });
    expect(disabled).toMatchObject({ ok: false, error: { code: "CATEGORY_UNAVAILABLE" } });
  });

  it("requires expectedRevision and does not overwrite old versions", async () => {
    const questionStore = memoryQuestionStore();
    const uploadStore = memoryUploadStore();
    const categoryStore = memoryCategoryStore([seedCategory()]);
    const created = (await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      event: req("question.save", singleBody(), { idempotencyKey: "v1" })
    })) as { ok: true; data: { questionId: string; versionId: string; revision: number } };
    const questionId = created.data.questionId;
    const versionId = created.data.versionId;
    const conflict = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      event: req("question.save", singleBody({ questionId, expectedRevision: 0, stem: { text: "旧页" } }), {
        idempotencyKey: "conflict"
      })
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: "VERSION_CONFLICT" } });

    const updated = (await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      event: req("question.save", singleBody({ questionId, expectedRevision: 1, stem: { text: "新题干" } }), {
        idempotencyKey: "v2"
      })
    })) as { ok: true; data: { versionId: string; revision: number; stem: { text: string } } };
    expect(updated.data.revision).toBe(2);
    expect(updated.data.versionId).not.toBe(versionId);
    const old = questionStore.versions.get(versionId);
    expect(old?.stem.text).toBe("虚构单选题干");
    expect(updated.data.stem.text).toBe("新题干");
  });

  it("binds upload tickets and rejects replay expire sha256 purpose and fake images", async () => {
    const questionStore = memoryQuestionStore();
    const storage = memoryObjectStorage();
    const uploadStore = memoryUploadStore(storage);
    const categoryStore = memoryCategoryStore([seedCategory()]);
    const pngHash = sha256OfBytes(MINIMAL_PNG);
    const authorized = (await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      event: req(
        "upload.authorize",
        {
          purpose: "prompt",
          contentType: "image/png",
          size: MINIMAL_PNG.length,
          sha256: pngHash,
          caption: "虚构题干图"
        },
        { idempotencyKey: "auth-png" }
      )
    })) as { ok: true; data: { uploadTicket: string; assetId: string; ticketId: string } };
    expect(authorized.ok).toBe(true);
    expect(authorized.data.uploadTicket.startsWith("tkt_")).toBe(true);

    const first = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      entry: "mw-upload",
      event: {
        requestId: "req_up_1",
        uploadTicket: authorized.data.uploadTicket,
        sha256: pngHash,
        size: MINIMAL_PNG.length,
        fileBase64: Buffer.from(MINIMAL_PNG).toString("base64")
      }
    });
    expect(first).toMatchObject({ ok: true, data: { assetState: "ready", purpose: "prompt" } });

    const replay = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      entry: "mw-upload",
      event: {
        requestId: "req_up_2",
        uploadTicket: authorized.data.uploadTicket,
        sha256: pngHash,
        size: MINIMAL_PNG.length,
        fileBase64: Buffer.from(MINIMAL_PNG).toString("base64")
      }
    });
    expect(replay).toMatchObject({ ok: false, error: { details: { reason: "TICKET_REPLAY" } } });

    const html = fakePngNamedHtml();
    const htmlAuth = (await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      event: req(
        "upload.authorize",
        {
          purpose: "analysis",
          contentType: "image/png",
          size: html.length,
          sha256: sha256OfBytes(html),
          caption: "假图"
        },
        { idempotencyKey: "auth-html" }
      )
    })) as { ok: true; data: { uploadTicket: string } };
    const htmlComplete = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      entry: "mw-upload",
      event: {
        requestId: "req_html",
        uploadTicket: htmlAuth.data.uploadTicket,
        sha256: sha256OfBytes(html),
        size: html.length,
        fileBase64: Buffer.from(html).toString("base64")
      }
    });
    expect(htmlComplete).toMatchObject({ ok: false, error: { details: { reason: "FORBIDDEN_FORMAT" } } });

    const tooBig = oversizedImageBytes();
    const bigAuth = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      event: req(
        "upload.authorize",
        {
          purpose: "prompt",
          contentType: "image/jpeg",
          size: tooBig.length,
          sha256: sha256OfBytes(tooBig),
          caption: "超限"
        },
        { idempotencyKey: "auth-big" }
      )
    });
    expect(bigAuth).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });

    const analysisAuth = (await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      event: req(
        "upload.authorize",
        {
          purpose: "analysis",
          contentType: "image/png",
          size: MINIMAL_PNG.length,
          sha256: pngHash,
          caption: "解析图"
        },
        { idempotencyKey: "auth-analysis" }
      )
    })) as { ok: true; data: { uploadTicket: string; assetId: string } };
    await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      entry: "mw-upload",
      event: {
        requestId: "req_an",
        uploadTicket: analysisAuth.data.uploadTicket,
        sha256: pngHash,
        size: MINIMAL_PNG.length,
        fileBase64: Buffer.from(MINIMAL_PNG).toString("base64")
      }
    });
    const wrongPurpose = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      event: req(
        "question.save",
        singleBody({ stem: { text: "带错用途图", assetIds: [analysisAuth.data.assetId] } }),
        { idempotencyKey: "wrong-purpose" }
      )
    });
    expect(wrongPurpose).toMatchObject({ ok: false, error: { details: { reason: "ASSET_PURPOSE_MISMATCH" } } });

    const expiredAuth = (await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      event: req(
        "upload.authorize",
        {
          purpose: "prompt",
          contentType: "image/png",
          size: MINIMAL_PNG.length,
          sha256: pngHash,
          caption: "过期票"
        },
        { idempotencyKey: "auth-exp" }
      )
    })) as { ok: true; data: { uploadTicket: string } };
    const expired = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      entry: "mw-upload",
      clock: new Date("2026-10-09T04:20:00.000Z"),
      event: {
        requestId: "req_exp",
        uploadTicket: expiredAuth.data.uploadTicket,
        sha256: pngHash,
        size: MINIMAL_PNG.length,
        fileBase64: Buffer.from(MINIMAL_PNG).toString("base64")
      }
    });
    expect(expired).toMatchObject({ ok: false, error: { details: { reason: "TICKET_EXPIRED" } } });

    const shaAuth = (await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      event: req(
        "upload.authorize",
        {
          purpose: "prompt",
          contentType: "image/png",
          size: MINIMAL_PNG.length,
          sha256: pngHash,
          caption: "换摘要"
        },
        { idempotencyKey: "auth-sha" }
      )
    })) as { ok: true; data: { uploadTicket: string } };
    const wrongSha = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      entry: "mw-upload",
      event: {
        requestId: "req_sha",
        uploadTicket: shaAuth.data.uploadTicket,
        sha256: "ab".repeat(32),
        size: MINIMAL_PNG.length,
        fileBase64: Buffer.from(MINIMAL_PNG).toString("base64")
      }
    });
    expect(wrongSha).toMatchObject({ ok: false, error: { details: { reason: "TICKET_SHA256_MISMATCH" } } });
  });

  it("hides answers and analysis from public member ops and forged admin", async () => {
    const questionStore = memoryQuestionStore();
    const uploadStore = memoryUploadStore();
    const categoryStore = memoryCategoryStore([seedCategory()]);
    const saved = (await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      event: req(
        "question.save",
        singleBody({ analysis: { text: "解析正文不应外泄", assetIds: [] } }),
        { idempotencyKey: "secret-q" }
      )
    })) as { ok: true; data: { questionId: string } };

    const ops = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: "uid_ops",
      event: req("question.get", { questionId: saved.data.questionId })
    });
    expect(ops).toMatchObject({ ok: false, error: { details: { reason: "CONTENT_ROLE_REQUIRED" } } });

    const forged = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      event: req("question.get", { questionId: saved.data.questionId, role: "super", uid: "forged" })
    });
    expect(forged).toMatchObject({ ok: false, error: { details: { reason: "CLIENT_IDENTITY_IGNORED" } } });

    const unauth = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      event: req("question.save", singleBody(), { idempotencyKey: "noauth" })
    });
    expect(unauth).toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });

    const member = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      entry: "mw-member",
      fromAppId: allowedAppIds[0],
      fromOpenId: "from_openid",
      event: req("question.get", { questionId: saved.data.questionId })
    });
    expect(member).toMatchObject({ ok: false, error: { details: { reason: "ACTION_DENIED" } } });
    expect(hasQuestionSecrets(member)).toEqual([]);

    const pub = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      entry: "mw-public",
      event: req("home.get", {})
    });
    expect(pub).toMatchObject({ ok: true });
    expect(hasQuestionSecrets(pub)).toEqual([]);

    const listed = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      uid: contentUid,
      event: req("question.list", { categoryId })
    });
    expect(listed).toMatchObject({ ok: true });
    expect(hasQuestionSecrets(listed)).toEqual([]);
  });

  it("disables unused questions and refuses paper-referenced fixtures", async () => {
    const questionStore = memoryQuestionStore();
    const uploadStore = memoryUploadStore();
    const categoryStore = memoryCategoryStore([seedCategory()]);
    const usage = memoryQuestionUsage();
    const saved = (await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      usage,
      uid: contentUid,
      event: req("question.save", singleBody(), { idempotencyKey: "dis-1" })
    })) as { ok: true; data: { questionId: string; revision: number } };
    const disabled = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      usage,
      uid: contentUid,
      event: req(
        "question.disable",
        { questionId: saved.data.questionId, expectedRevision: 1, reason: "unused fixture" },
        { idempotencyKey: "dis-ok" }
      )
    });
    expect(disabled).toMatchObject({ ok: true, data: { status: "disabled" } });
    expect(questionStore.versions.size).toBe(1);

    const second = (await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      usage,
      uid: contentUid,
      event: req("question.save", singleBody({ stem: { text: "另一题" } }), { idempotencyKey: "dis-2" })
    })) as { ok: true; data: { questionId: string } };
    usage.setPaperRefs(second.data.questionId, ["paper_fict_ref"]);
    const refused = await ctx({
      questionStore,
      uploadStore,
      categoryStore,
      usage,
      uid: contentUid,
      event: req(
        "question.disable",
        { questionId: second.data.questionId, expectedRevision: 1, reason: "in use" },
        { idempotencyKey: "dis-no" }
      )
    });
    expect(refused).toMatchObject({ ok: false, error: { details: { reason: "QUESTION_IN_USE" } } });
    expect(questionStore.questions.get(second.data.questionId)?.status).toBe("active");
  });

  it("does not accept client identity as authorization for upload.authorize", async () => {
    const res = await ctx({
      questionStore: memoryQuestionStore(),
      uploadStore: memoryUploadStore(),
      categoryStore: memoryCategoryStore([seedCategory()]),
      event: req(
        "upload.authorize",
        {
          purpose: "prompt",
          contentType: "image/png",
          size: 12,
          sha256: "a".repeat(64),
          caption: "x",
          role: "super",
          uid: "forged"
        },
        { idempotencyKey: "forged-up" }
      )
    });
    expect(res).toMatchObject({ ok: false, error: { details: { reason: "CLIENT_IDENTITY_IGNORED" } } });
  });
});
