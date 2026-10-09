import { describe, expect, it } from "vitest";
import {
  IMPORT_MAX_ROWS,
  emptyCatalog,
  importBatchId,
  questionIdForSourceKey,
  questionTemplateCsv,
  questionVersionId,
  paperIdForSourceKey,
  paperTemplateCsv,
  seedCategoryId,
  sha256OfBytes,
  utf8Bytes,
  type CategoryRecord
} from "@mw/shared";
import { handleOfficial, memoryAdminStore } from "./official.js";
import { memoryCategoryStore } from "./modules/category-stores.js";
import { memoryImportStore } from "./modules/import-stores.js";
import { commitImport, previewImport, validateImport } from "./modules/import.js";
import { memoryPaperStore } from "./modules/paper-stores.js";
import { memoryQuestionStore } from "./modules/question-stores.js";
import { getQuestion, listQuestions } from "./modules/question.js";
import { getAdminPaper, listPapers } from "./modules/paper.js";
import { authorizeUpload, completeUpload } from "./modules/upload.js";
import { memoryObjectStorage, memoryUploadStore } from "./modules/upload-stores.js";

const now = new Date("2026-10-09T08:00:00.000Z");
const contentUid = "uid_content_1";
const categoryId = seedCategoryId("logical");
const allowedAppIds = ["wxmwallowedappid0001"];

function seedCategory(): CategoryRecord {
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
    updatedAt: stamp
  };
}

function catalog(treeVersion = 1) {
  return { ...emptyCatalog(now), treeVersion, seeded: true };
}

function questionCsv(): string {
  return questionTemplateCsv().replace(/请填入已有类目标识/g, categoryId);
}

function paperCsv(): string {
  return paperTemplateCsv().replace(/请填入已有类目标识/g, categoryId);
}

function adminStore() {
  return memoryAdminStore([
    { uid: contentUid, roles: ["content"], enabled: true, authVersion: 1 },
    { uid: "uid_super_1", roles: ["super"], enabled: true, authVersion: 1 },
    { uid: "uid_ops", roles: ["operations"], enabled: true, authVersion: 1 }
  ]);
}

describe("MW12 import validate / commit / visibility", () => {
  it("commits fictional questions then papers and hides uncommitted drafts by id", async () => {
    const imports = memoryImportStore();
    const questions = memoryQuestionStore();
    const papers = memoryPaperStore();
    const categories = memoryCategoryStore([seedCategory()], catalog());
    const bytes = utf8Bytes(questionCsv());
    const validated = await validateImport({
      store: imports,
      questions,
      papers,
      categories,
      actorId: contentUid,
      data: { kind: "question" },
      requestId: "req_q_validate",
      idempotencyKey: "mw12/q/validate",
      now,
      inlineBytes: bytes
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const questionId = questionIdForSourceKey("q_fict_mw12_single_01");
    const ghostBatchId = importBatchId("question", "mw12-ghost-uncommitted");
    const ghostQuestionId = questionIdForSourceKey("q_fict_mw12_hidden_01");
    const ghostVersionId = questionVersionId(ghostQuestionId, 1);
    await imports.transactWrite({
      batchId: ghostBatchId,
      idempotencyId: "mw12/ghost-batch",
      mutate: () => ({
        batch: {
          batchId: ghostBatchId,
          fileHash: "mw12-ghost-uncommitted",
          kind: "question",
          state: "validated",
          rowCount: 1,
          validationHash: "x",
          catalogVersion: 1,
          columnSpec: "question",
          previewHash: "x",
          ticketId: "inline",
          assetId: "inline",
          errorCount: 0,
          warningCount: 0,
          targetCount: 1,
          leaseToken: "ghost",
          createdBy: contentUid,
          schemaVersion: 1,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          committedAt: null
        },
        result: ghostBatchId
      })
    });
    await questions.transactWrite({
      questionId: ghostQuestionId,
      versionId: ghostVersionId,
      idempotencyId: "mw12/seed-uncommitted",
      mutate: () => ({
        question: {
          questionId: ghostQuestionId,
          categoryId,
          currentVersionId: ghostVersionId,
          status: "active",
          revision: 1,
          schemaVersion: 1,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          importBatchId: ghostBatchId,
          sourceKey: "q_fict_mw12_hidden_01"
        },
        version: {
          versionId: ghostVersionId,
          questionId: ghostQuestionId,
          type: "single",
          stem: { text: "未提交草稿不可见", assetIds: [] },
          options: [
            { optionId: "A", text: "甲", assetIds: [] },
            { optionId: "B", text: "乙", assetIds: [] }
          ],
          answer: { optionIds: ["A"] },
          analysis: { text: "x", assetIds: [] },
          assetIds: [],
          defaultPoints: 5,
          difficulty: "beginner",
          categoryId,
          schemaVersion: 1,
          createdAt: now.toISOString(),
          createdBy: contentUid
        },
        result: ghostQuestionId
      })
    });
    const hidden = await getQuestion({
      store: questions,
      imports,
      data: { questionId: ghostQuestionId },
      includeSecrets: true
    });
    expect(hidden).toMatchObject({ ok: false, reason: "QUESTION_NOT_FOUND" });
    const listedHidden = await listQuestions({ store: questions, imports, data: { limit: 20 } });
    expect(listedHidden.ok && listedHidden.data.items.some((item) => item.questionId === questionId)).toBe(false);

    const committed = await commitImport({
      store: imports,
      questions,
      papers,
      categories,
      actorId: contentUid,
      data: { batchId: validated.data.batchId },
      requestId: "req_q_commit",
      idempotencyKey: "mw12/q/commit",
      now
    });
    expect(committed.ok).toBe(true);
    if (committed.ok) expect(committed.data.state).toBe("committed");
    const visible = await getQuestion({
      store: questions,
      imports,
      data: { questionId },
      includeSecrets: true
    });
    expect(visible).toMatchObject({ ok: true, data: { question: { questionId } } });

    const paperFirst = await validateImport({
      store: memoryImportStore(),
      questions: memoryQuestionStore(),
      papers: memoryPaperStore(),
      categories,
      actorId: contentUid,
      data: { kind: "paper" },
      requestId: "req_p_early",
      idempotencyKey: "mw12/p/early",
      now,
      inlineBytes: utf8Bytes(paperCsv())
    });
    expect(paperFirst.ok).toBe(false);
    if (!paperFirst.ok) expect(paperFirst.code).toBe("IMPORT_INVALID");

    const paperValidated = await validateImport({
      store: imports,
      questions,
      papers,
      categories,
      actorId: contentUid,
      data: { kind: "paper" },
      requestId: "req_p_validate",
      idempotencyKey: "mw12/p/validate",
      now,
      inlineBytes: utf8Bytes(paperCsv())
    });
    expect(paperValidated.ok).toBe(true);
    if (!paperValidated.ok) return;
    const paperId = paperIdForSourceKey("paper_fict_mw12_01");
    const paperHidden = await getAdminPaper({ store: papers, imports, data: { paperId } });
    expect(paperHidden).toMatchObject({ ok: false, reason: "PAPER_NOT_FOUND" });
    const paperCommitted = await commitImport({
      store: imports,
      questions,
      papers,
      categories,
      actorId: contentUid,
      data: { batchId: paperValidated.data.batchId },
      requestId: "req_p_commit",
      idempotencyKey: "mw12/p/commit",
      now
    });
    expect(paperCommitted.ok).toBe(true);
    const paperVisible = await getAdminPaper({ store: papers, imports, data: { paperId } });
    expect(paperVisible.ok).toBe(true);
    const listed = await listPapers({ store: papers, imports, data: { limit: 20 }, publicView: false });
    expect(listed.ok && listed.data.items.some((item) => item.paperId === paperId)).toBe(true);
  });

  it("rejects a blocking last row for the whole batch and does not expose drafts", async () => {
    const imports = memoryImportStore();
    const questions = memoryQuestionStore();
    const categories = memoryCategoryStore([seedCategory()], catalog());
    const bad = `${questionCsv().trim()}\nq_fict_mw12_bad_last,${categoryId},单选,虚构末行错题,甲,乙,,,,,,Z,解析,5,入门,,,,,,,,,\n`;
    const result = await validateImport({
      store: imports,
      questions,
      categories,
      actorId: contentUid,
      data: { kind: "question" },
      requestId: "req_last",
      idempotencyKey: "mw12/last",
      now,
      inlineBytes: utf8Bytes(bad)
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("IMPORT_INVALID");
      const errors = (result.details?.errors as Array<{ rowNo: number; reason: string }>) || [];
      expect(errors.some((item) => item.reason.includes("答案") || (item as { field?: string }).field === "正确答案")).toBe(true);
    }
    expect(questions.questions.size).toBe(0);
    const replay = await validateImport({
      store: imports,
      questions,
      categories,
      actorId: contentUid,
      data: { kind: "question" },
      requestId: "req_last_2",
      idempotencyKey: "mw12/last2",
      now,
      inlineBytes: utf8Bytes(bad)
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.data.originalBatch).toBe(true);
      expect(replay.data.state).toBe("failed");
    }
  });

  it("rejects more than 1000 data rows and same-file returns the original batch", async () => {
    const imports = memoryImportStore();
    const categories = memoryCategoryStore([seedCategory()], catalog());
    const header = questionTemplateCsv().trim().split("\n")[0];
    const lines = [header];
    for (let i = 0; i < IMPORT_MAX_ROWS + 1; i += 1) {
      lines.push(`q_fict_limit_${i},${categoryId},单选,虚构题干${i},甲,乙,,,,,,A,虚构解析,5,入门,,,,,,,,,`);
    }
    const over = await validateImport({
      store: imports,
      categories,
      actorId: contentUid,
      data: { kind: "question" },
      requestId: "req_limit",
      idempotencyKey: "mw12/limit",
      now,
      inlineBytes: utf8Bytes(lines.join("\n") + "\n")
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(JSON.stringify(over.details || over.issues || {})).toMatch(/1000/);

    const questions = memoryQuestionStore();
    const first = await validateImport({
      store: imports,
      questions,
      categories,
      actorId: contentUid,
      data: { kind: "question" },
      requestId: "req_same_1",
      idempotencyKey: "mw12/same1",
      now,
      inlineBytes: utf8Bytes(questionCsv())
    });
    expect(first.ok).toBe(true);
    const second = await validateImport({
      store: imports,
      questions,
      categories,
      actorId: contentUid,
      data: { kind: "question" },
      requestId: "req_same_2",
      idempotencyKey: "mw12/same2",
      now,
      inlineBytes: utf8Bytes(questionCsv())
    });
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.data.batchId).toBe(first.data.batchId);
      expect(second.data.originalBatch).toBe(true);
    }
  });

  it("does not overwrite an existing source key and rechecks catalog version", async () => {
    const imports = memoryImportStore();
    const questions = memoryQuestionStore();
    const papers = memoryPaperStore();
    const categories = memoryCategoryStore([seedCategory()], catalog(1));
    const first = await validateImport({
      store: imports,
      questions,
      papers,
      categories,
      actorId: contentUid,
      data: { kind: "question" },
      requestId: "req_src_1",
      idempotencyKey: "mw12/src1",
      now,
      inlineBytes: utf8Bytes(questionCsv())
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const committed = await commitImport({
      store: imports,
      questions,
      papers,
      categories,
      actorId: contentUid,
      data: { batchId: first.data.batchId },
      requestId: "req_src_commit",
      idempotencyKey: "mw12/src_commit",
      now
    });
    expect(committed.ok).toBe(true);
    const conflictCsv = questionCsv().replace("虚构题干：条件甲成立时应选哪一项？", "另一份文件里的同来源键虚构题干");
    const conflict = await validateImport({
      store: imports,
      questions,
      papers,
      categories,
      actorId: contentUid,
      data: { kind: "question" },
      requestId: "req_src_2",
      idempotencyKey: "mw12/src2",
      now,
      inlineBytes: utf8Bytes(conflictCsv)
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.code).toBe("SOURCE_KEY_CONFLICT");

    const pendingStore = memoryImportStore();
    const pendingQuestions = memoryQuestionStore();
    const pending = await validateImport({
      store: pendingStore,
      questions: pendingQuestions,
      papers,
      categories,
      actorId: contentUid,
      data: { kind: "question" },
      requestId: "req_pending",
      idempotencyKey: "mw12/pending",
      now,
      inlineBytes: utf8Bytes(
        questionCsv()
          .replace(/q_fict_mw12_single_01/g, "q_fict_mw12_pending_01")
          .replace(/q_fict_mw12_multi_01/g, "q_fict_mw12_pending_02")
          .replace(/q_fict_mw12_tf_01/g, "q_fict_mw12_pending_03")
      )
    });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    const blocked = await commitImport({
      store: pendingStore,
      questions: pendingQuestions,
      papers,
      categories: memoryCategoryStore([seedCategory()], catalog(2)),
      actorId: contentUid,
      data: { batchId: pending.data.batchId },
      requestId: "req_pending_commit",
      idempotencyKey: "mw12/pending_commit",
      now
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("VERSION_CONFLICT");
      expect(blocked.reason).toBe("CATALOG_VERSION_CHANGED");
    }

    const preview = await previewImport({ store: imports, data: { batchId: first.data.batchId } });
    expect(preview.ok).toBe(true);
  });

  it("denies operations and unauthenticated official import writes", async () => {
    const imports = memoryImportStore();
    const denied = await handleOfficial({
      entry: "mw-admin",
      event: {
        apiVersion: "1",
        action: "import.validate",
        requestId: "req_ops",
        idempotencyKey: "mw12/ops",
        data: { kind: "question", ticketId: "t1" }
      },
      allowedAppIds,
      authUid: "uid_ops",
      adminStore: adminStore(),
      importStore: imports,
      now
    });
    expect(denied).toMatchObject({ ok: false, error: { details: { reason: "CONTENT_ROLE_REQUIRED" } } });

    const unauth = await handleOfficial({
      entry: "mw-admin",
      event: {
        apiVersion: "1",
        action: "import.commit",
        requestId: "req_unauth",
        idempotencyKey: "mw12/unauth",
        data: { batchId: "x" }
      },
      allowedAppIds,
      importStore: imports,
      now
    });
    expect(unauth).toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });
  });

  it("validates import csv from inline utf8 when object download throws", async () => {
    const storage = memoryObjectStorage();
    const upload = memoryUploadStore(storage);
    const imports = memoryImportStore();
    const questions = memoryQuestionStore();
    const papers = memoryPaperStore();
    const categories = memoryCategoryStore([seedCategory()], catalog());
    const bytes = utf8Bytes(questionCsv());
    const hash = sha256OfBytes(bytes);
    const authorized = await authorizeUpload({
      store: upload,
      actorId: contentUid,
      data: {
        purpose: "import",
        contentType: "text/csv",
        size: bytes.length,
        sha256: hash,
        caption: "csv-import"
      },
      requestId: "req_inline_auth",
      idempotencyKey: "mw12/inline-auth",
      now
    });
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    const completed = await completeUpload({
      store: upload,
      uploadTicket: authorized.data.uploadTicket,
      sha256: hash,
      size: bytes.length,
      bytes,
      adminUid: contentUid,
      now
    });
    expect(completed.ok).toBe(true);
    const asset = await upload.getAsset(authorized.data.assetId);
    expect(asset?.inlineUtf8).toContain("导入来源键");
    storage.getObject = async () => {
      throw new Error("download exploded");
    };
    const validated = await validateImport({
      store: imports,
      questions,
      papers,
      categories,
      upload,
      actorId: contentUid,
      data: { kind: "question", ticketId: authorized.data.ticketId },
      requestId: "req_inline_validate",
      idempotencyKey: "mw12/inline-validate",
      now
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.data.state).toBe("validated");
  });
});
