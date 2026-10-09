import {
  auditDocId,
  type AuditEntry,
  type IdempotencyRecord,
  type PaperAnswerRecord,
  type PaperChunkRecord,
  type PaperRecord,
  type PaperVersionRecord
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { QuestionUsageStore } from "./question-stores.js";
import type { PaperWorkStore, PaperWriteSnapshot } from "./paper-stores.js";

export const MW11_COLLECTIONS = {
  papers: "papers",
  paperVersions: "paper_versions",
  paperChunks: "paper_chunks",
  paperAnswers: "paper_answers",
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

function asPaper(id: string, data: Record<string, unknown>): PaperRecord {
  const now = new Date().toISOString();
  const items = Array.isArray(data.draftItems) ? data.draftItems : [];
  return {
    paperId: typeof data.paperId === "string" ? data.paperId : id,
    title: typeof data.title === "string" ? data.title : "",
    summary: typeof data.summary === "string" ? data.summary : "",
    goal: typeof data.goal === "string" ? data.goal : "",
    categoryId: typeof data.categoryId === "string" ? data.categoryId : "",
    access: data.access === "vip" ? "vip" : "free",
    difficulty:
      data.difficulty === "intermediate" || data.difficulty === "challenge" ? data.difficulty : "beginner",
    sort: typeof data.sort === "number" ? data.sort : 10,
    suggestedMinutes: typeof data.suggestedMinutes === "number" ? data.suggestedMinutes : 20,
    publishedAt: typeof data.publishedAt === "string" ? data.publishedAt : null,
    status:
      data.status === "published" || data.status === "unpublished" || data.status === "withdrawn"
        ? data.status
        : "draft",
    activeVersionId: typeof data.activeVersionId === "string" ? data.activeVersionId : null,
    revision: typeof data.revision === "number" ? data.revision : 0,
    draftItems: items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item, index) => ({
        questionId: typeof item.questionId === "string" ? item.questionId : "",
        versionId: typeof item.versionId === "string" ? item.versionId : "",
        points: typeof item.points === "number" ? item.points : 1,
        ord: typeof item.ord === "number" ? item.ord : index + 1
      })),
    draftQuestionCount: typeof data.draftQuestionCount === "number" ? data.draftQuestionCount : items.length,
    draftMaxScore: typeof data.draftMaxScore === "number" ? data.draftMaxScore : 0,
    accessLocked: data.accessLocked === true,
    withdrawReason: typeof data.withdrawReason === "string" ? data.withdrawReason : null,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now),
    updatedAt: asIso(data.updatedAt, now),
    ...(typeof data.importBatchId === "string" ? { importBatchId: data.importBatchId } : {}),
    ...(typeof data.sourceKey === "string" ? { sourceKey: data.sourceKey } : {})
  };
}

function asVersion(id: string, data: Record<string, unknown>): PaperVersionRecord {
  const now = new Date().toISOString();
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    versionId: typeof data.versionId === "string" ? data.versionId : id,
    paperId: typeof data.paperId === "string" ? data.paperId : "",
    questionCount: typeof data.questionCount === "number" ? data.questionCount : 0,
    maxScore: typeof data.maxScore === "number" ? data.maxScore : 0,
    chunkIds: strings(data.chunkIds),
    answerChunkIds: strings(data.answerChunkIds),
    chunkDigests: strings(data.chunkDigests),
    answerDigests: strings(data.answerDigests),
    categoryPathSnapshot: strings(data.categoryPathSnapshot),
    manifestHash: typeof data.manifestHash === "string" ? data.manifestHash : "",
    questionIds: strings(data.questionIds),
    questionVersionIds: strings(data.questionVersionIds),
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : ""
  };
}

function asChunk(id: string, data: Record<string, unknown>): PaperChunkRecord {
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    chunkId: typeof data.chunkId === "string" ? data.chunkId : id,
    versionId: typeof data.versionId === "string" ? data.versionId : "",
    chunkNo: typeof data.chunkNo === "number" ? data.chunkNo : 0,
    items: items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => {
        const stem = item.stem && typeof item.stem === "object" ? (item.stem as Record<string, unknown>) : {};
        const options = Array.isArray(item.options) ? item.options : [];
        return {
          ord: typeof item.ord === "number" ? item.ord : 0,
          questionId: typeof item.questionId === "string" ? item.questionId : "",
          questionVersionId: typeof item.questionVersionId === "string" ? item.questionVersionId : "",
          type: item.type === "multiple" || item.type === "trueFalse" ? item.type : "single",
          stem: {
            text: typeof stem.text === "string" ? stem.text : "",
            assetIds: Array.isArray(stem.assetIds) ? stem.assetIds.filter((entry): entry is string => typeof entry === "string") : []
          },
          options: options
            .filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === "object")
            .map((option) => ({
              optionId: typeof option.optionId === "string" ? option.optionId : "",
              text: typeof option.text === "string" ? option.text : "",
              assetIds: Array.isArray(option.assetIds)
                ? option.assetIds.filter((entry): entry is string => typeof entry === "string")
                : []
            })),
          points: typeof item.points === "number" ? item.points : 1
        };
      }),
    digest: typeof data.digest === "string" ? data.digest : "",
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1
  };
}

function asAnswer(id: string, data: Record<string, unknown>): PaperAnswerRecord {
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    chunkId: typeof data.chunkId === "string" ? data.chunkId : id,
    versionId: typeof data.versionId === "string" ? data.versionId : "",
    chunkNo: typeof data.chunkNo === "number" ? data.chunkNo : 0,
    items: items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => {
        const answer = item.answer && typeof item.answer === "object" ? (item.answer as Record<string, unknown>) : {};
        const analysis = item.analysis && typeof item.analysis === "object" ? (item.analysis as Record<string, unknown>) : {};
        return {
          ord: typeof item.ord === "number" ? item.ord : 0,
          questionId: typeof item.questionId === "string" ? item.questionId : "",
          questionVersionId: typeof item.questionVersionId === "string" ? item.questionVersionId : "",
          answer: {
            optionIds: Array.isArray(answer.optionIds)
              ? answer.optionIds.filter((entry): entry is string => typeof entry === "string")
              : []
          },
          analysis: {
            text: typeof analysis.text === "string" ? analysis.text : "",
            assetIds: Array.isArray(analysis.assetIds)
              ? analysis.assetIds.filter((entry): entry is string => typeof entry === "string")
              : []
          }
        };
      }),
    digest: typeof data.digest === "string" ? data.digest : "",
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1
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

async function listWhere(name: string, query: Record<string, unknown>, limit = 100): Promise<Record<string, unknown>[]> {
  const coll = cloudApp().database().collection(name);
  if (!coll.where) return [];
  const filtered = coll.where(query);
  const snap = filtered.orderBy
    ? await filtered.orderBy("_id", "asc").limit(limit).get()
    : await filtered.limit(limit).get();
  return unwrapList(snap);
}

export function cloudPaperWorkStore(): PaperWorkStore {
  return {
    async getPaper(paperId) {
      const snap = await cloudApp().database().collection(MW11_COLLECTIONS.papers).doc(paperId).get();
      const data = unwrapDoc(snap);
      return data ? asPaper(paperId, data) : undefined;
    },
    async getVersion(versionId) {
      const snap = await cloudApp().database().collection(MW11_COLLECTIONS.paperVersions).doc(versionId).get();
      const data = unwrapDoc(snap);
      return data ? asVersion(versionId, data) : undefined;
    },
    async getChunk(chunkId) {
      const snap = await cloudApp().database().collection(MW11_COLLECTIONS.paperChunks).doc(chunkId).get();
      const data = unwrapDoc(snap);
      return data ? asChunk(chunkId, data) : undefined;
    },
    async getAnswer(chunkId) {
      const snap = await cloudApp().database().collection(MW11_COLLECTIONS.paperAnswers).doc(chunkId).get();
      const data = unwrapDoc(snap);
      return data ? asAnswer(chunkId, data) : undefined;
    },
    async listPapers(input) {
      const query: Record<string, unknown> = {};
      if (input.status) query.status = input.status;
      if (!input.categoryIds?.length && input.categoryId) query.categoryId = input.categoryId;
      if (input.difficulty) query.difficulty = input.difficulty;
      if (input.access) query.access = input.access;
      const rows = await listWhere(MW11_COLLECTIONS.papers, query, input.limit);
      return rows
        .map((row) => asPaper(typeof row._id === "string" ? row._id : String(row.paperId || ""), row))
        .filter((row) => !input.status || row.status === input.status)
        .filter((row) => {
          if (input.categoryIds && input.categoryIds.length) return input.categoryIds.includes(row.categoryId);
          if (input.categoryId) return row.categoryId === input.categoryId;
          return true;
        })
        .sort((left, right) => {
          if (input.sort === "recommended") {
            if (left.sort !== right.sort) return left.sort - right.sort;
            return left.paperId.localeCompare(right.paperId);
          }
          const leftAt = left.publishedAt || "";
          const rightAt = right.publishedAt || "";
          if (leftAt !== rightAt) return rightAt.localeCompare(leftAt);
          return left.paperId.localeCompare(right.paperId);
        })
        .slice(0, input.limit);
    },
    async listPublishedVersions() {
      const papers = await listWhere(MW11_COLLECTIONS.papers, {}, 100);
      const ids = papers
        .map((row) => asPaper(typeof row._id === "string" ? row._id : String(row.paperId || ""), row))
        .filter((row) => row.activeVersionId && row.status !== "draft")
        .map((row) => row.activeVersionId as string);
      const versions: PaperVersionRecord[] = [];
      for (const id of ids) {
        const snap = await cloudApp().database().collection(MW11_COLLECTIONS.paperVersions).doc(id).get();
        const data = unwrapDoc(snap);
        if (data) versions.push(asVersion(id, data));
      }
      return versions;
    },
    async listVersionsForPaper(paperId) {
      const rows = await listWhere(MW11_COLLECTIONS.paperVersions, { paperId }, 50);
      return rows.map((row) => asVersion(typeof row._id === "string" ? row._id : String(row.versionId || ""), row));
    },
    async transactWrite(input) {
      const started = Date.now();
      let reads = 0;
      let writes = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        const paperSnap = input.paperId ? await tx.collection(MW11_COLLECTIONS.papers).doc(input.paperId).get() : undefined;
        if (input.paperId) reads += 1;
        const paperData = paperSnap ? unwrapDoc(paperSnap) : undefined;
        const paper = paperData && input.paperId ? asPaper(input.paperId, paperData) : undefined;
        const versionSnap = paper?.activeVersionId
          ? await tx.collection(MW11_COLLECTIONS.paperVersions).doc(paper.activeVersionId).get()
          : undefined;
        if (paper?.activeVersionId) reads += 1;
        const activeVersion =
          versionSnap && paper?.activeVersionId
            ? asVersion(paper.activeVersionId, unwrapDoc(versionSnap) || {})
            : undefined;
        const idemSnap = await tx.collection(MW11_COLLECTIONS.idempotency).doc(input.idempotencyId).get();
        reads += 1;
        const snap: PaperWriteSnapshot = {
          paper,
          activeVersion,
          versions: activeVersion ? [activeVersion] : [],
          chunks: [],
          answers: [],
          idem: unwrapDoc(idemSnap) ? asIdem(input.idempotencyId, unwrapDoc(idemSnap)!) : undefined
        };
        const next = input.mutate(snap);
        if (next.paper) {
          writes += 1;
          await tx.collection(MW11_COLLECTIONS.papers).doc(next.paper.paperId).set({ ...next.paper });
        }
        if (next.version) {
          const existing = unwrapDoc(await tx.collection(MW11_COLLECTIONS.paperVersions).doc(next.version.versionId).get());
          reads += 1;
          if (existing) throw new Error("PAPER_VERSION_IMMUTABLE");
          writes += 1;
          await tx.collection(MW11_COLLECTIONS.paperVersions).doc(next.version.versionId).set({ ...next.version });
        }
        for (const chunk of next.chunks || []) {
          const existing = unwrapDoc(await tx.collection(MW11_COLLECTIONS.paperChunks).doc(chunk.chunkId).get());
          reads += 1;
          if (existing) throw new Error("PAPER_VERSION_IMMUTABLE");
          writes += 1;
          await tx.collection(MW11_COLLECTIONS.paperChunks).doc(chunk.chunkId).set({ ...chunk });
        }
        for (const answer of next.answers || []) {
          const existing = unwrapDoc(await tx.collection(MW11_COLLECTIONS.paperAnswers).doc(answer.chunkId).get());
          reads += 1;
          if (existing) throw new Error("PAPER_VERSION_IMMUTABLE");
          writes += 1;
          await tx.collection(MW11_COLLECTIONS.paperAnswers).doc(answer.chunkId).set({ ...answer });
        }
        if (next.idem) {
          writes += 1;
          await tx.collection(MW11_COLLECTIONS.idempotency).doc(input.idempotencyId).set({ ...next.idem });
        }
        if (next.audit) {
          writes += 1;
          await tx.collection(MW11_COLLECTIONS.auditLogs).doc(auditDocId(next.audit)).set(auditWrite(next.audit));
        }
        return next;
      });
      return { mutation, budget: { reads, writes, total: reads + writes, elapsedMs: Date.now() - started } };
    }
  };
}

export function cloudQuestionUsageStore(): QuestionUsageStore {
  return {
    async paperRefsFor(questionId) {
      const rows = await listWhere(MW11_COLLECTIONS.paperVersions, { questionIds: questionId }, 50);
      return [...new Set(rows.map((row) => (typeof row.paperId === "string" ? row.paperId : "")).filter(Boolean))];
    },
    setPaperRefs() {
      /* derived from published paper_versions */
    }
  };
}
