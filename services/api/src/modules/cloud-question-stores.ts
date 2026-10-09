import {
  auditDocId,
  type AuditEntry,
  type IdempotencyRecord,
  type MediaAssetRecord,
  type QuestionRecord,
  type QuestionVersionRecord
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { QuestionWorkStore, QuestionWriteSnapshot } from "./question-stores.js";

export const MW10_COLLECTIONS = {
  questions: "questions",
  questionVersions: "question_versions",
  mediaAssets: "media_assets",
  uploadTickets: "upload_tickets",
  idempotency: "idempotency",
  auditLogs: "audit_logs"
} as const;

function cloudApp() {
  const cloudbase = require("@cloudbase/node-sdk") as {
    init: (opts: { env: unknown }) => { database: () => CloudDb };
    SYMBOL_CURRENT_ENV: unknown;
  };
  return cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
}

type CloudColl = {
  doc: (id: string) => {
    get: () => Promise<unknown>;
    set: (data: Record<string, unknown>) => Promise<unknown>;
    update: (data: Record<string, unknown>) => Promise<unknown>;
  };
  where?: (query: Record<string, unknown>) => {
    orderBy?: (field: string, dir: string) => {
      limit: (n: number) => { get: () => Promise<unknown> };
    };
    limit: (n: number) => { get: () => Promise<unknown> };
  };
  limit?: (n: number) => { get: () => Promise<unknown> };
  get?: () => Promise<unknown>;
};

type CloudDb = {
  collection: (name: string) => CloudColl;
  runTransaction: <T>(fn: (tx: CloudDb) => Promise<T>) => Promise<T>;
};

function unwrapDoc(snap: unknown): Record<string, unknown> | undefined {
  if (!snap || typeof snap !== "object") return undefined;
  const rec = snap as Record<string, unknown>;
  if (rec.data && typeof rec.data === "object" && !Array.isArray(rec.data)) {
    const inner = rec.data as Record<string, unknown>;
    if (Array.isArray(inner.data)) {
      const first = inner.data[0];
      return first && typeof first === "object" ? (first as Record<string, unknown>) : undefined;
    }
    if (Object.keys(inner).length === 0) return undefined;
    return inner;
  }
  if (Array.isArray(rec.data)) {
    const first = rec.data[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : undefined;
  }
  return undefined;
}

function unwrapList(snap: unknown): Record<string, unknown>[] {
  if (!snap || typeof snap !== "object") return [];
  const rec = snap as Record<string, unknown>;
  if (Array.isArray(rec.data)) {
    return rec.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (rec.data && typeof rec.data === "object") {
    const inner = rec.data as Record<string, unknown>;
    if (Array.isArray(inner.data)) {
      return inner.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    }
  }
  return [];
}

function asIso(value: unknown, fallback: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return fallback;
}

function asQuestion(id: string, data: Record<string, unknown>): QuestionRecord {
  const now = new Date().toISOString();
  return {
    questionId: typeof data.questionId === "string" ? data.questionId : id,
    categoryId: typeof data.categoryId === "string" ? data.categoryId : "",
    currentVersionId: typeof data.currentVersionId === "string" ? data.currentVersionId : "",
    status: data.status === "disabled" ? "disabled" : "active",
    revision: typeof data.revision === "number" ? data.revision : 0,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now),
    updatedAt: asIso(data.updatedAt, now)
  };
}

function asVersion(id: string, data: Record<string, unknown>): QuestionVersionRecord {
  const now = new Date().toISOString();
  const stem = data.stem && typeof data.stem === "object" ? (data.stem as Record<string, unknown>) : {};
  const analysis = data.analysis && typeof data.analysis === "object" ? (data.analysis as Record<string, unknown>) : {};
  const answer = data.answer && typeof data.answer === "object" ? (data.answer as Record<string, unknown>) : {};
  const options = Array.isArray(data.options) ? data.options : [];
  return {
    versionId: typeof data.versionId === "string" ? data.versionId : id,
    questionId: typeof data.questionId === "string" ? data.questionId : "",
    type: data.type === "multiple" || data.type === "trueFalse" ? data.type : "single",
    stem: {
      text: typeof stem.text === "string" ? stem.text : "",
      assetIds: Array.isArray(stem.assetIds) ? stem.assetIds.filter((item): item is string => typeof item === "string") : []
    },
    options: options
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        optionId: typeof item.optionId === "string" ? item.optionId : "",
        text: typeof item.text === "string" ? item.text : "",
        assetIds: Array.isArray(item.assetIds) ? item.assetIds.filter((entry): entry is string => typeof entry === "string") : []
      })),
    answer: {
      optionIds: Array.isArray(answer.optionIds)
        ? answer.optionIds.filter((item): item is string => typeof item === "string")
        : []
    },
    analysis: {
      text: typeof analysis.text === "string" ? analysis.text : "",
      assetIds: Array.isArray(analysis.assetIds)
        ? analysis.assetIds.filter((item): item is string => typeof item === "string")
        : []
    },
    assetIds: Array.isArray(data.assetIds) ? data.assetIds.filter((item): item is string => typeof item === "string") : [],
    defaultPoints: typeof data.defaultPoints === "number" ? data.defaultPoints : 1,
    difficulty:
      data.difficulty === "intermediate" || data.difficulty === "challenge" ? data.difficulty : "beginner",
    categoryId: typeof data.categoryId === "string" ? data.categoryId : "",
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : ""
  };
}

function asAsset(id: string, data: Record<string, unknown>): MediaAssetRecord {
  const now = new Date().toISOString();
  return {
    assetId: typeof data.assetId === "string" ? data.assetId : id,
    fileId: typeof data.fileId === "string" ? data.fileId : "",
    objectKey: typeof data.objectKey === "string" ? data.objectKey : "",
    kind: data.kind === "analysis" ? "analysis" : "prompt",
    mime: typeof data.mime === "string" ? data.mime : "",
    size: typeof data.size === "number" ? data.size : 0,
    sha256: typeof data.sha256 === "string" ? data.sha256 : "",
    caption: typeof data.caption === "string" ? data.caption : "",
    state: data.state === "ready" || data.state === "failed" ? data.state : "pending",
    uploader: typeof data.uploader === "string" ? data.uploader : "",
    ticketId: typeof data.ticketId === "string" ? data.ticketId : "",
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now),
    updatedAt: asIso(data.updatedAt, now)
  };
}

function asIdem(id: string, data: Record<string, unknown>): IdempotencyRecord {
  return {
    id,
    actorId: typeof data.actorId === "string" ? data.actorId : "",
    action: typeof data.action === "string" ? data.action : "",
    idempotencyKey: typeof data.idempotencyKey === "string" ? data.idempotencyKey : "",
    payloadHash: typeof data.payloadHash === "string" ? data.payloadHash : "",
    status:
      data.status === "succeeded" || data.status === "conflict" || data.status === "pending" || data.status === "failed"
        ? data.status
        : "pending",
    resultRef: data.resultRef ?? null,
    requestId: typeof data.requestId === "string" ? data.requestId : ""
  };
}

function questionWrite(row: QuestionRecord): Record<string, unknown> {
  return { ...row };
}

function versionWrite(row: QuestionVersionRecord): Record<string, unknown> {
  return { ...row };
}

function auditWrite(entry: AuditEntry): Record<string, unknown> {
  return {
    actorType: entry.actorType,
    actorId: entry.actorId,
    action: entry.action,
    target: entry.target,
    reason: entry.reason,
    requestId: entry.requestId,
    beforeHash: entry.beforeHash,
    afterHash: entry.afterHash,
    createdAt: entry.createdAt,
    schemaVersion: entry.schemaVersion
  };
}

function idemWrite(record: IdempotencyRecord): Record<string, unknown> {
  return {
    actorId: record.actorId,
    action: record.action,
    idempotencyKey: record.idempotencyKey,
    payloadHash: record.payloadHash,
    status: record.status,
    resultRef: record.resultRef,
    requestId: record.requestId
  };
}

export function cloudQuestionWorkStore(): QuestionWorkStore {
  return {
    async getQuestion(questionId) {
      const snap = await cloudApp().database().collection(MW10_COLLECTIONS.questions).doc(questionId).get();
      const data = unwrapDoc(snap);
      return data ? asQuestion(questionId, data) : undefined;
    },
    async getVersion(versionId) {
      const snap = await cloudApp().database().collection(MW10_COLLECTIONS.questionVersions).doc(versionId).get();
      const data = unwrapDoc(snap);
      return data ? asVersion(versionId, data) : undefined;
    },
    async listQuestions(input) {
      const db = cloudApp().database();
      const coll = db.collection(MW10_COLLECTIONS.questions);
      const query: Record<string, unknown> = {};
      if (input.categoryId) query.categoryId = input.categoryId;
      if (input.status) query.status = input.status;
      let snap: unknown;
      if (coll.where) {
        const filtered = coll.where(query);
        snap = filtered.orderBy
          ? await filtered.orderBy("updatedAt", "desc").limit(input.limit).get()
          : await filtered.limit(input.limit).get();
      } else if (coll.limit) {
        snap = await coll.limit(input.limit).get();
      } else {
        snap = { data: [] };
      }
      return unwrapList(snap)
        .map((row) => asQuestion(typeof row._id === "string" ? row._id : String(row.questionId || ""), row))
        .filter((row) => !input.categoryId || row.categoryId === input.categoryId)
        .filter((row) => !input.status || row.status === input.status)
        .slice(0, input.limit);
    },
    async getAsset(assetId) {
      const snap = await cloudApp().database().collection(MW10_COLLECTIONS.mediaAssets).doc(assetId).get();
      const data = unwrapDoc(snap);
      return data ? asAsset(assetId, data) : undefined;
    },
    async transactWrite(input) {
      const started = Date.now();
      let reads = 0;
      let writes = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        const questionSnap = input.questionId
          ? await tx.collection(MW10_COLLECTIONS.questions).doc(input.questionId).get()
          : undefined;
        if (input.questionId) reads += 1;
        const questionData = questionSnap ? unwrapDoc(questionSnap) : undefined;
        const question = questionData && input.questionId ? asQuestion(input.questionId, questionData) : undefined;
        const versionSnap = question
          ? await tx.collection(MW10_COLLECTIONS.questionVersions).doc(question.currentVersionId).get()
          : undefined;
        if (question) reads += 1;
        const currentVersion = versionSnap && question ? asVersion(question.currentVersionId, unwrapDoc(versionSnap) || {}) : undefined;
        const idemSnap = await tx.collection(MW10_COLLECTIONS.idempotency).doc(input.idempotencyId).get();
        reads += 1;
        const snap: QuestionWriteSnapshot = {
          question,
          currentVersion,
          versions: currentVersion ? [currentVersion] : [],
          assets: [],
          idem: unwrapDoc(idemSnap) ? asIdem(input.idempotencyId, unwrapDoc(idemSnap)!) : undefined
        };
        const next = input.mutate(snap);
        if (next.question) {
          writes += 1;
          await tx.collection(MW10_COLLECTIONS.questions).doc(next.question.questionId).set(questionWrite(next.question));
        }
        if (next.version) {
          const existing = unwrapDoc(await tx.collection(MW10_COLLECTIONS.questionVersions).doc(next.version.versionId).get());
          reads += 1;
          if (existing) throw new Error("QUESTION_VERSION_IMMUTABLE");
          writes += 1;
          await tx.collection(MW10_COLLECTIONS.questionVersions).doc(next.version.versionId).set(versionWrite(next.version));
        }
        if (next.idem) {
          writes += 1;
          await tx.collection(MW10_COLLECTIONS.idempotency).doc(input.idempotencyId).set(idemWrite(next.idem));
        }
        if (next.audit) {
          writes += 1;
          await tx.collection(MW10_COLLECTIONS.auditLogs).doc(auditDocId(next.audit)).set(auditWrite(next.audit));
        }
        return next;
      });
      const budget: TxBudget = { reads, writes, total: reads + writes, elapsedMs: Date.now() - started };
      return { mutation, budget };
    }
  };
}
