import {
  IMPORT_SCHEMA_VERSION,
  IMPORT_VALIDATE_FIELDS,
  IMPORT_PREVIEW_FIELDS,
  IMPORT_COMMIT_FIELDS,
  IMPORT_STATUS_FIELDS,
  QUESTION_SCHEMA_VERSION,
  PAPER_SCHEMA_VERSION,
  auditDocId,
  buildAuditEntry,
  buildIdempotencyRecord,
  columnSpecOf,
  decodeUtf8Strict,
  errorListForExport,
  fileHashOf,
  importBatchId,
  importLeaseToken,
  importRowId,
  isImportKind,
  paperIdForSourceKey,
  parseCsv,
  parseImportKindInput,
  payloadHash,
  previewSummaryOf,
  questionIdForSourceKey,
  questionVersionId,
  replayOrConflict,
  sourceKeyDocId,
  utf8Bytes,
  validationHashOf,
  validatePaperCsv,
  validateQuestionCsv,
  type ImportBatchRecord,
  type ImportIssue,
  type ImportKind,
  type ImportRowRecord,
  type NormalizedPaperItem,
  type NormalizedQuestionRow,
  type QuestionRecord,
  type QuestionVersionRecord,
  type SourceKeyRecord
} from "@mw/shared";
import type { CategoryReadStore } from "./category-stores.js";
import type { TxBudget } from "./job-stores.js";
import type { ImportWorkStore } from "./import-stores.js";
import type { PaperWorkStore } from "./paper-stores.js";
import type { QuestionWorkStore } from "./question-stores.js";
import type { UploadWorkStore } from "./upload-stores.js";

export type ImportActionFailure = {
  ok: false;
  code: string;
  reason: string;
  issues?: string[];
  details?: Record<string, unknown>;
};

export type ImportActionSuccess<T> = {
  ok: true;
  data: T;
  replayed?: boolean;
  budget: TxBudget;
};

function emptyBudget(): TxBudget {
  return { reads: 0, writes: 0, total: 0, elapsedMs: 0 };
}

function fail(code: string, reason: string, extra?: { issues?: string[]; details?: Record<string, unknown> }): ImportActionFailure {
  return { ok: false, code, reason, ...(extra?.issues ? { issues: extra.issues } : {}), ...(extra?.details ? { details: extra.details } : {}) };
}

function batchView(batch: ImportBatchRecord, extra: Record<string, unknown> = {}) {
  return {
    batchId: batch.batchId,
    kind: batch.kind,
    state: batch.state,
    rowCount: batch.rowCount,
    fileHash: batch.fileHash,
    catalogVersion: batch.catalogVersion,
    columnSpec: batch.columnSpec,
    previewHash: batch.previewHash,
    validationHash: batch.validationHash,
    errorCount: batch.errorCount,
    warningCount: batch.warningCount,
    targetCount: batch.targetCount,
    committedAt: batch.committedAt,
    ...extra
  };
}

async function loadCatalogVersion(categories?: CategoryReadStore): Promise<number> {
  if (!categories) return 0;
  const catalog = await categories.getCatalog();
  return catalog.treeVersion;
}

async function categoryMap(categories?: CategoryReadStore) {
  const map = new Map<string, { deletedAt: string | null; enabled: boolean }>();
  if (!categories) return map;
  for (const row of await categories.listActive()) {
    map.set(row.categoryId, { deletedAt: row.deletedAt, enabled: row.enabled });
  }
  return map;
}

function collectAssetIdsFromCsv(text: string): string[] {
  const parsed = parseCsv(text);
  const ids = new Set<string>();
  for (const row of parsed.rows) {
    parsed.headers.forEach((name, index) => {
      if (name.includes("素材标识")) {
        const value = (row[index] || "").trim();
        if (value) ids.add(value);
      }
    });
  }
  return [...ids];
}

async function assetMap(questions?: QuestionWorkStore, upload?: UploadWorkStore, ids: string[] = []) {
  const map = new Map<string, { state: string; kind: string }>();
  for (const id of ids) {
    const asset = (questions ? await questions.getAsset(id) : undefined) || (upload ? await upload.getAsset(id) : undefined);
    if (asset) map.set(id, { state: asset.state, kind: asset.kind });
  }
  return map;
}

async function readImportBytes(input: {
  upload?: UploadWorkStore;
  ticketId?: string;
  actorId: string;
  inlineBytes?: Uint8Array;
}): Promise<{ ok: true; bytes: Uint8Array; ticketId: string; assetId: string } | ImportActionFailure> {
  if (input.inlineBytes) {
    return { ok: true, bytes: input.inlineBytes, ticketId: "inline", assetId: "inline" };
  }
  if (!input.ticketId || !input.upload) return fail("INVALID_ARGUMENT", "TICKET_REQUIRED");
  const ticket = await input.upload.getTicket(input.ticketId);
  if (!ticket || ticket.adminUid !== input.actorId) return fail("NOT_FOUND", "TICKET_NOT_FOUND");
  if (ticket.purpose !== "import") return fail("INVALID_ARGUMENT", "TICKET_PURPOSE_MISMATCH");
  const asset = await input.upload.getAsset(ticket.assetId);
  if (!asset || asset.state !== "ready") return fail("INVALID_ARGUMENT", "IMPORT_FILE_NOT_READY");
  if (typeof asset.inlineUtf8 === "string" && asset.inlineUtf8.length > 0) {
    return { ok: true, bytes: utf8Bytes(asset.inlineUtf8), ticketId: ticket.ticketId, assetId: ticket.assetId };
  }
  try {
    const stored = await input.upload.storage.getObject(ticket.objectKey, asset.fileId);
    if (!stored) return fail("INVALID_ARGUMENT", "OBJECT_NOT_FOUND");
    return { ok: true, bytes: stored.bytes, ticketId: ticket.ticketId, assetId: ticket.assetId };
  } catch {
    return fail("INVALID_ARGUMENT", "OBJECT_NOT_FOUND");
  }
}

export async function validateImport(input: {
  store: ImportWorkStore;
  questions?: QuestionWorkStore;
  papers?: PaperWorkStore;
  categories?: CategoryReadStore;
  upload?: UploadWorkStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
  inlineBytes?: Uint8Array;
  knownAssets?: Map<string, { state: string; kind: string }>;
}): Promise<
  ImportActionSuccess<ReturnType<typeof batchView> & { errors: ImportIssue[]; warnings: ImportIssue[]; originalBatch?: boolean }> | ImportActionFailure
> {
  const parsed = parseImportKindInput(input.data, IMPORT_VALIDATE_FIELDS);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_VALIDATE", { issues: parsed.issues });
  if (!parsed.kind) return fail("INVALID_ARGUMENT", "kind required");
  const file = await readImportBytes({
    upload: input.upload,
    ticketId: parsed.ticketId,
    actorId: input.actorId,
    inlineBytes: input.inlineBytes
  });
  if (!file.ok) return file;
  if (file.bytes.length > 5 * 1024 * 1024) return fail("IMPORT_INVALID", "CSV_TOO_LARGE");
  const decoded = decodeUtf8Strict(file.bytes);
  if (!decoded.ok) return fail("IMPORT_INVALID", decoded.reason);
  const fileHash = fileHashOf(file.bytes);
  const existing = await input.store.getBatchByFileHash(parsed.kind, fileHash);
  if (existing) {
    const rows = await input.store.listRows(existing.batchId);
    return {
      ok: true,
      data: {
        ...batchView(existing, { originalBatch: true }),
        errors: errorListForExport(rows.flatMap((row) => row.errors)),
        warnings: [],
        originalBatch: true
      },
      replayed: true,
      budget: emptyBudget()
    };
  }
  const catalogVersion = await loadCatalogVersion(input.categories);
  const categories = await categoryMap(input.categories);
  const assets = input.knownAssets || (await assetMap(input.questions, input.upload, collectAssetIdsFromCsv(decoded.text)));
  const existingKeys = new Set(
    (await input.store.listCommittedSourceKeys(parsed.kind)).map((row) => row.sourceKey)
  );
  let blocking: ImportIssue[] = [];
  let warnings: ImportIssue[] = [];
  let targetCount = 0;
  let normalizedRows: Array<{ rowNo: number; sourceKey: string; targetId: string; data: Record<string, unknown>; errors: ImportIssue[] }> = [];
  if (parsed.kind === "question") {
    const existingStems = new Set<string>();
    if (input.questions) {
      try {
        const listed = await input.questions.listQuestions({ limit: 100 });
        for (const question of listed) {
          if (question.importBatchId && !(await input.store.getBatch(question.importBatchId).then((b) => b?.state === "committed"))) {
            continue;
          }
          const version = await input.questions.getVersion(question.currentVersionId);
          if (version?.stem.text) existingStems.add(version.stem.text);
        }
      } catch {
        existingStems.clear();
      }
    }
    const result = validateQuestionCsv(decoded.text, {
      categories,
      assets,
      existingSourceKeys: existingKeys,
      existingStems
    });
    if (result.headerIssues.length) {
      blocking = result.headerIssues.map((reason) => ({
        rowNo: 1,
        field: "表头",
        reason,
        example: "使用后台下载的题库模板",
        blocking: true
      }));
    } else {
      blocking = result.issues.filter((item) => item.blocking);
      warnings = result.warnings;
      targetCount = result.rows.length;
      normalizedRows = result.rows.map((row, index) => ({
        rowNo: index + 2,
        sourceKey: row.sourceKey,
        targetId: questionIdForSourceKey(row.sourceKey),
        data: row as unknown as Record<string, unknown>,
        errors: []
      }));
    }
  } else {
    const usable = new Map<string, { questionId: string; status: string }>();
    for (const key of await input.store.listCommittedSourceKeys("question")) {
      if (!input.questions) continue;
      const question = await input.questions.getQuestion(key.targetId);
      if (question && (!question.importBatchId || (await input.store.getBatch(question.importBatchId))?.state === "committed")) {
        usable.set(key.sourceKey, { questionId: question.questionId, status: question.status });
      }
    }
    const result = validatePaperCsv(decoded.text, {
      categories,
      usableQuestionKeys: usable,
      existingPaperKeys: existingKeys
    });
    if (result.headerIssues.length) {
      blocking = result.headerIssues.map((reason) => ({
        rowNo: 1,
        field: "表头",
        reason,
        example: "使用后台下载的试卷模板",
        blocking: true
      }));
    } else {
      blocking = result.issues.filter((item) => item.blocking);
      warnings = result.warnings;
      targetCount = result.papers.size;
      let rowNo = 2;
      for (const items of result.papers.values()) {
        for (const item of items) {
          normalizedRows.push({
            rowNo,
            sourceKey: item.paperSourceKey,
            targetId: paperIdForSourceKey(item.paperSourceKey),
            data: item as unknown as Record<string, unknown>,
            errors: []
          });
          rowNo += 1;
        }
      }
    }
  }
  const columnSpec = columnSpecOf(parsed.kind);
  const validationHash = validationHashOf({
    fileHash,
    kind: parsed.kind,
    catalogVersion,
    columnSpec,
    issues: blocking
  });
  const previewHash = previewSummaryOf({
    kind: parsed.kind,
    rowCount: decoded.text.split(/\n/).filter((line) => line.trim()).length - 1,
    targetCount,
    warningCount: warnings.length,
    fileHash,
    catalogVersion,
    columnSpec
  });
  const batchId = importBatchId(parsed.kind, fileHash);
  const failed = blocking.length > 0;
  const rowCount = Math.max(0, decoded.text.split(/\n/).filter((line) => line.trim()).length - 1);
  const payload = { kind: parsed.kind, ticketId: file.ticketId, fileHash };
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "import.validate",
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  });
  const created = await input.store.transactWrite({
    batchId,
    idempotencyId: idemRecord.id,
    mutate: (snap) => {
      const replay = replayOrConflict(snap.idem, payloadHash(payload), () => null);
      if (!replay.ok) return { result: null as never, error: { code: replay.code, reason: "IDEMPOTENCY_CONFLICT" } };
      if (replay.replayed) {
        return { result: replay.result as ImportBatchRecord };
      }
      if (snap.batch) return { result: snap.batch };
      const now = input.now.toISOString();
      const batch: ImportBatchRecord = {
        batchId,
        fileHash,
        kind: parsed.kind as ImportKind,
        state: failed ? "failed" : "validated",
        rowCount,
        validationHash,
        catalogVersion,
        columnSpec,
        previewHash,
        ticketId: file.ticketId,
        assetId: file.assetId,
        errorCount: blocking.length,
        warningCount: warnings.length,
        targetCount: failed ? 0 : targetCount,
        leaseToken: importLeaseToken(batchId, input.actorId),
        createdBy: input.actorId,
        schemaVersion: IMPORT_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
        committedAt: null
      };
      const audit = buildAuditEntry({
        actorType: "admin",
        actorId: input.actorId,
        action: "import.validate",
        target: batchId,
        reason: failed ? "IMPORT_INVALID" : "validated",
        requestId: input.requestId,
        before: null,
        after: { batchId, state: batch.state, fileHash },
        now: input.now
      });
      return {
        batch,
        idem: { ...idemRecord, status: "succeeded", resultRef: batch },
        audit,
        result: batch
      };
    }
  });
  if (created.mutation.error) {
    return fail(created.mutation.error.code, created.mutation.error.reason, {
      issues: created.mutation.error.issues,
      details: created.mutation.error.details
    });
  }
  const batch = created.mutation.result;
  if (failed) {
    return {
      ok: false,
      code: blocking.some((item) => item.reason.includes("不覆盖")) ? "SOURCE_KEY_CONFLICT" : "IMPORT_INVALID",
      reason: "IMPORT_INVALID",
      details: {
        batchId: batch.batchId,
        state: batch.state,
        errors: errorListForExport(blocking),
        warnings: errorListForExport(warnings)
      }
    };
  }
  for (const row of normalizedRows) {
    const rowId = importRowId(batch.batchId, row.rowNo);
    await input.store.transactWrite({
      batchId: batch.batchId,
      rowId,
      idempotencyId: `import.row/${rowId}`,
      mutate: () => ({
        row: {
          rowId,
          batchId: batch.batchId,
          rowNo: row.rowNo,
          sourceKey: row.sourceKey,
          targetId: row.targetId,
          normalizedData: row.data,
          errors: row.errors,
          schemaVersion: IMPORT_SCHEMA_VERSION
        },
        result: rowId
      })
    });
  }
  return {
    ok: true,
    data: {
      ...batchView(batch),
      errors: [],
      warnings: errorListForExport(warnings)
    },
    budget: created.budget
  };
}

export async function previewImport(input: {
  store: ImportWorkStore;
  data: Record<string, unknown>;
}): Promise<ImportActionSuccess<ReturnType<typeof batchView> & { errors: ImportIssue[]; warnings: ImportIssue[]; sampleKeys: string[] }> | ImportActionFailure> {
  const parsed = parseImportKindInput(input.data, IMPORT_PREVIEW_FIELDS);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_PREVIEW", { issues: parsed.issues });
  if (!parsed.batchId) return fail("INVALID_ARGUMENT", "batchId required");
  const batch = await input.store.getBatch(parsed.batchId);
  if (!batch) return fail("NOT_FOUND", "BATCH_NOT_FOUND");
  const rows = await input.store.listRows(batch.batchId);
  return {
    ok: true,
    data: {
      ...batchView(batch),
      errors: errorListForExport(rows.flatMap((row) => row.errors)),
      warnings: [],
      sampleKeys: rows.slice(0, 5).map((row) => row.sourceKey)
    },
    budget: emptyBudget()
  };
}

function questionDraftsFrom(row: NormalizedQuestionRow, batchId: string, actorId: string, now: string): {
  question: QuestionRecord;
  version: QuestionVersionRecord;
} {
  const questionId = questionIdForSourceKey(row.sourceKey);
  const versionId = questionVersionId(questionId, 1);
  const options =
    row.type === "trueFalse"
      ? row.options.map((item) => ({ optionId: item.optionId, text: item.text, assetIds: [] }))
      : row.options.map((item) => ({ optionId: item.optionId, text: item.text, assetIds: item.assetId ? [item.assetId] : [] }));
  const version: QuestionVersionRecord = {
    versionId,
    questionId,
    type: row.type,
    stem: { text: row.stem, assetIds: row.stemAssetId ? [row.stemAssetId] : [] },
    options,
    answer: { optionIds: row.answerIds },
    analysis: { text: row.analysis, assetIds: [] },
    assetIds: [...(row.stemAssetId ? [row.stemAssetId] : []), ...row.options.flatMap((item) => (item.assetId ? [item.assetId] : []))],
    defaultPoints: row.defaultPoints,
    difficulty: row.difficulty,
    categoryId: row.categoryId,
    schemaVersion: QUESTION_SCHEMA_VERSION,
    createdAt: now,
    createdBy: actorId
  };
  const question: QuestionRecord = {
    questionId,
    categoryId: row.categoryId,
    currentVersionId: versionId,
    status: "active",
    revision: 1,
    schemaVersion: QUESTION_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    importBatchId: batchId,
    sourceKey: row.sourceKey
  };
  return { question, version };
}

async function stageQuestionRows(input: {
  store: ImportWorkStore;
  questions: QuestionWorkStore;
  batch: ImportBatchRecord;
  rows: ImportRowRecord[];
  actorId: string;
  now: Date;
}): Promise<ImportActionFailure | undefined> {
  for (const row of input.rows) {
    const data = row.normalizedData as unknown as NormalizedQuestionRow;
    const drafts = questionDraftsFrom(data, input.batch.batchId, input.actorId, input.now.toISOString());
    const sourceKeyId = sourceKeyDocId("question", data.sourceKey);
    const existing = await input.store.getSourceKey("question", data.sourceKey);
    if (existing && existing.batchId !== input.batch.batchId) {
      return fail("SOURCE_KEY_CONFLICT", "SOURCE_KEY_CONFLICT");
    }
    await input.store.transactWrite({
      batchId: input.batch.batchId,
      sourceKeyId,
      idempotencyId: `import.source/${sourceKeyId}`,
      mutate: (snap) => {
        if (snap.sourceKey && snap.sourceKey.batchId !== input.batch.batchId) {
          return { result: null as never, error: { code: "SOURCE_KEY_CONFLICT", reason: "SOURCE_KEY_CONFLICT" } };
        }
        const record: SourceKeyRecord = {
          sourceKeyId,
          kind: "question",
          sourceKey: data.sourceKey,
          targetId: drafts.question.questionId,
          batchId: input.batch.batchId,
          state: "staging",
          schemaVersion: IMPORT_SCHEMA_VERSION,
          createdAt: input.now.toISOString()
        };
        return { sourceKey: record, result: record };
      }
    });
    await input.questions.transactWrite({
      questionId: drafts.question.questionId,
      versionId: drafts.version.versionId,
      idempotencyId: `import.question/${drafts.question.questionId}`,
      mutate: (snap) => {
        if (snap.question && snap.question.importBatchId !== input.batch.batchId) {
          return { result: null as never, error: { code: "SOURCE_KEY_CONFLICT", reason: "SOURCE_KEY_CONFLICT" } };
        }
        return { question: drafts.question, version: drafts.version, result: drafts.question.questionId };
      }
    });
  }
  return undefined;
}

async function stagePaperRows(input: {
  store: ImportWorkStore;
  papers: PaperWorkStore;
  questions?: QuestionWorkStore;
  batch: ImportBatchRecord;
  rows: ImportRowRecord[];
  actorId: string;
  now: Date;
}): Promise<ImportActionFailure | undefined> {
  const grouped = new Map<string, NormalizedPaperItem[]>();
  for (const row of input.rows) {
    const item = row.normalizedData as unknown as NormalizedPaperItem;
    const list = grouped.get(item.paperSourceKey) || [];
    list.push(item);
    grouped.set(item.paperSourceKey, list);
  }
  for (const [sourceKey, items] of grouped) {
    const paperId = paperIdForSourceKey(sourceKey);
    const first = items[0] as NormalizedPaperItem;
    const draftItems: Array<{ questionId: string; versionId: string; points: number; ord: number }> = [];
    for (const item of items.sort((a, b) => a.ord - b.ord)) {
      const key = await input.store.getSourceKey("question", item.questionSourceKey);
      if (!key || key.state !== "committed") return fail("IMPORT_INVALID", "QUESTION_SOURCE_NOT_READY");
      const question = input.questions ? await input.questions.getQuestion(key.targetId) : undefined;
      if (!question || question.status !== "active") return fail("IMPORT_INVALID", "QUESTION_SOURCE_NOT_READY");
      if (question.importBatchId) {
        const qBatch = await input.store.getBatch(question.importBatchId);
        if (qBatch?.state !== "committed") return fail("NOT_FOUND", "QUESTION_NOT_VISIBLE");
      }
      draftItems.push({
        questionId: question.questionId,
        versionId: question.currentVersionId,
        points: item.points,
        ord: item.ord
      });
    }
    const now = input.now.toISOString();
    const sourceKeyId = sourceKeyDocId("paper", sourceKey);
    await input.store.transactWrite({
      batchId: input.batch.batchId,
      sourceKeyId,
      idempotencyId: `import.source/${sourceKeyId}`,
      mutate: () => ({
        sourceKey: {
          sourceKeyId,
          kind: "paper" as const,
          sourceKey,
          targetId: paperId,
          batchId: input.batch.batchId,
          state: "staging" as const,
          schemaVersion: IMPORT_SCHEMA_VERSION,
          createdAt: now
        },
        result: sourceKeyId
      })
    });
    await input.papers.transactWrite({
      paperId,
      idempotencyId: `import.paper/${paperId}`,
      mutate: (snap) => {
        if (snap.paper && snap.paper.importBatchId !== input.batch.batchId) {
          return { result: null as never, error: { code: "SOURCE_KEY_CONFLICT", reason: "SOURCE_KEY_CONFLICT" } };
        }
        return {
          paper: {
            paperId,
            title: first.title,
            summary: first.summary,
            goal: first.goal,
            categoryId: first.categoryId,
            access: first.access,
            difficulty: first.difficulty,
            sort: 10,
            suggestedMinutes: first.suggestedMinutes,
            publishedAt: null,
            status: "draft" as const,
            activeVersionId: null,
            revision: 1,
            draftItems,
            draftQuestionCount: draftItems.length,
            draftMaxScore: draftItems.reduce((sum, item) => sum + item.points, 0),
            accessLocked: false,
            withdrawReason: null,
            schemaVersion: PAPER_SCHEMA_VERSION,
            createdAt: now,
            updatedAt: now,
            importBatchId: input.batch.batchId,
            sourceKey
          },
          result: paperId
        };
      }
    });
  }
  return undefined;
}

export async function commitImport(input: {
  store: ImportWorkStore;
  questions?: QuestionWorkStore;
  papers?: PaperWorkStore;
  categories?: CategoryReadStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<ImportActionSuccess<ReturnType<typeof batchView>> | ImportActionFailure> {
  const parsed = parseImportKindInput(input.data, IMPORT_COMMIT_FIELDS);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_COMMIT", { issues: parsed.issues });
  if (!parsed.batchId) return fail("INVALID_ARGUMENT", "batchId required");
  const batch = await input.store.getBatch(parsed.batchId);
  if (!batch) return fail("NOT_FOUND", "BATCH_NOT_FOUND");
  if (batch.state === "committed") {
    return { ok: true, data: batchView(batch, { originalBatch: true }), replayed: true, budget: emptyBudget() };
  }
  if (batch.state === "failed") return fail("IMPORT_INVALID", "BATCH_FAILED");
  if (batch.state !== "validated" && batch.state !== "staging") {
    return fail("INVALID_ARGUMENT", "BATCH_NOT_VALIDATED");
  }
  const catalogVersion = await loadCatalogVersion(input.categories);
  if (catalogVersion !== batch.catalogVersion) {
    return fail("VERSION_CONFLICT", "CATALOG_VERSION_CHANGED");
  }
  const rows = await input.store.listRows(batch.batchId);
  if (rows.length !== batch.rowCount) {
    return fail("IMPORT_INVALID", "ROW_COUNT_MISMATCH");
  }
  const payload = { batchId: batch.batchId, validationHash: batch.validationHash, previewHash: batch.previewHash };
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "import.commit",
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  });
  const staged = await input.store.transactWrite({
    batchId: batch.batchId,
    idempotencyId: `${idemRecord.id}/staging`,
    mutate: (snap) => {
      if (!snap.batch) return { result: null as never, error: { code: "NOT_FOUND", reason: "BATCH_NOT_FOUND" } };
      if (snap.batch.state === "committed") return { result: snap.batch };
      return {
        batch: { ...snap.batch, state: "staging", updatedAt: input.now.toISOString() },
        result: { ...snap.batch, state: "staging" as const }
      };
    }
  });
  if (staged.mutation.error) return fail(staged.mutation.error.code, staged.mutation.error.reason);
  const current = staged.mutation.result;
  if (current.state === "committed") return { ok: true, data: batchView(current), replayed: true, budget: emptyBudget() };
  if (batch.kind === "question") {
    if (!input.questions) return fail("INTERNAL_ERROR", "QUESTION_STORE_UNAVAILABLE");
    const err = await stageQuestionRows({
      store: input.store,
      questions: input.questions,
      batch: current,
      rows,
      actorId: input.actorId,
      now: input.now
    });
    if (err) {
      await markFailed(input.store, current.batchId, input.now);
      return err;
    }
  } else {
    if (!input.papers) return fail("INTERNAL_ERROR", "PAPER_STORE_UNAVAILABLE");
    const err = await stagePaperRows({
      store: input.store,
      papers: input.papers,
      questions: input.questions,
      batch: current,
      rows,
      actorId: input.actorId,
      now: input.now
    });
    if (err) {
      await markFailed(input.store, current.batchId, input.now);
      return err;
    }
  }
  const committed = await input.store.transactWrite({
    batchId: current.batchId,
    idempotencyId: idemRecord.id,
    mutate: (snap) => {
      const replay = replayOrConflict(snap.idem, payloadHash(payload), () => null);
      if (!replay.ok) return { result: null as never, error: { code: replay.code, reason: "IDEMPOTENCY_CONFLICT" } };
      if (replay.replayed) return { result: replay.result as ImportBatchRecord };
      if (!snap.batch) return { result: null as never, error: { code: "NOT_FOUND", reason: "BATCH_NOT_FOUND" } };
      const next: ImportBatchRecord = {
        ...snap.batch,
        state: "committed",
        committedAt: input.now.toISOString(),
        updatedAt: input.now.toISOString()
      };
      const audit = buildAuditEntry({
        actorType: "admin",
        actorId: input.actorId,
        action: "import.commit",
        target: next.batchId,
        reason: "committed",
        requestId: input.requestId,
        before: { state: snap.batch.state },
        after: { state: "committed" },
        now: input.now
      });
      return {
        batch: next,
        idem: { ...idemRecord, status: "succeeded", resultRef: next },
        audit,
        result: next
      };
    }
  });
  if (committed.mutation.error) return fail(committed.mutation.error.code, committed.mutation.error.reason);
  const keys = await input.store.listSourceKeys(current.batchId);
  for (const key of keys) {
    await input.store.transactWrite({
      batchId: current.batchId,
      sourceKeyId: key.sourceKeyId,
      idempotencyId: `import.source.commit/${key.sourceKeyId}`,
      mutate: (snap) => {
        if (!snap.sourceKey) return { result: key.sourceKeyId };
        return { sourceKey: { ...snap.sourceKey, state: "committed" }, result: key.sourceKeyId };
      }
    });
  }
  return { ok: true, data: batchView(committed.mutation.result), budget: committed.budget };
}

async function markFailed(store: ImportWorkStore, batchId: string, now: Date): Promise<void> {
  await store.transactWrite({
    batchId,
    idempotencyId: `import.fail/${batchId}/${now.toISOString()}`,
    mutate: (snap) => {
      if (!snap.batch || snap.batch.state === "committed") return { result: snap.batch };
      return { batch: { ...snap.batch, state: "failed", updatedAt: now.toISOString() }, result: snap.batch };
    }
  });
}

export async function readImportStatus(input: {
  store: ImportWorkStore;
  data: Record<string, unknown>;
}): Promise<ImportActionSuccess<ReturnType<typeof batchView> & { errors: ImportIssue[] }> | ImportActionFailure> {
  const parsed = parseImportKindInput(input.data, IMPORT_STATUS_FIELDS);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_STATUS", { issues: parsed.issues });
  if (!parsed.batchId) return fail("INVALID_ARGUMENT", "batchId required");
  const batch = await input.store.getBatch(parsed.batchId);
  if (!batch) return fail("NOT_FOUND", "BATCH_NOT_FOUND");
  const rows = await input.store.listRows(batch.batchId);
  return {
    ok: true,
    data: { ...batchView(batch), errors: errorListForExport(rows.flatMap((row) => row.errors)) },
    budget: emptyBudget()
  };
}

export function canReleaseFailedBatch(batch: ImportBatchRecord, downstreamRefs: number, leaseToken: string): boolean {
  return batch.state !== "committed" && downstreamRefs === 0 && batch.leaseToken === leaseToken;
}

export { isImportKind };
