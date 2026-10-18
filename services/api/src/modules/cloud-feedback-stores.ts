import { FEEDBACK_SCHEMA_VERSION, type FeedbackRecord, type FeedbackStatus, type FeedbackType } from "@mw/shared";
import { FEEDBACK_COLLECTION, type FeedbackStore } from "./feedback-stores.js";

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
    orderBy: (field: string, direction: "asc" | "desc") => {
      limit: (n: number) => { get: () => Promise<unknown> };
    };
  };
  orderBy?: (field: string, direction: "asc" | "desc") => {
    limit: (n: number) => { get: () => Promise<unknown> };
  };
};

type CloudDb = {
  collection: (name: string) => CloudColl;
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
    return inner;
  }
  if (Array.isArray(rec.data)) {
    const first = rec.data[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : undefined;
  }
  return undefined;
}

function docsFromGet(snap: unknown): Record<string, unknown>[] {
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

function asFeedback(id: string, data: Record<string, unknown>): FeedbackRecord {
  const now = new Date().toISOString();
  const type = data.type === "analysis_error" ? "analysis_error" : "question_error";
  const status: FeedbackStatus = data.status === "resolved" ? "resolved" : "open";
  return {
    feedbackId: typeof data.feedbackId === "string" ? data.feedbackId : id,
    memberId: typeof data.memberId === "string" ? data.memberId : "",
    type: type as FeedbackType,
    paperId: typeof data.paperId === "string" ? data.paperId : "",
    questionId: typeof data.questionId === "string" ? data.questionId : "",
    versionId: typeof data.versionId === "string" ? data.versionId : "",
    text: typeof data.text === "string" ? data.text : "",
    status,
    resolveNote: typeof data.resolveNote === "string" ? data.resolveNote : "",
    resolvedBy: typeof data.resolvedBy === "string" ? data.resolvedBy : "",
    resolvedAt: typeof data.resolvedAt === "string" ? data.resolvedAt : "",
    submitterDeleted: data.submitterDeleted === true,
    submitterDeletedAt: typeof data.submitterDeletedAt === "string" ? data.submitterDeletedAt : "",
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : FEEDBACK_SCHEMA_VERSION,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : now,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : now
  };
}

function feedbackWrite(row: FeedbackRecord): Record<string, unknown> {
  return {
    feedbackId: row.feedbackId,
    memberId: row.memberId,
    type: row.type,
    paperId: row.paperId,
    questionId: row.questionId,
    versionId: row.versionId,
    text: row.text,
    status: row.status,
    resolveNote: row.resolveNote,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt,
    submitterDeleted: row.submitterDeleted === true,
    submitterDeletedAt: row.submitterDeletedAt || "",
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function cloudFeedbackStore(): FeedbackStore {
  return {
    async get(feedbackId) {
      const snap = await cloudApp().database().collection(FEEDBACK_COLLECTION).doc(feedbackId).get();
      const data = unwrapDoc(snap);
      return data ? asFeedback(feedbackId, data) : undefined;
    },
    async save(record) {
      const coll = cloudApp().database().collection(FEEDBACK_COLLECTION);
      const existing = unwrapDoc(await coll.doc(record.feedbackId).get());
      const body = feedbackWrite(record);
      if (existing) {
        await coll.doc(record.feedbackId).update(body);
        return;
      }
      await coll.doc(record.feedbackId).set(body);
    },
    async list(input) {
      const coll = cloudApp().database().collection(FEEDBACK_COLLECTION);
      const query = input.status ? { status: input.status } : {};
      let snap: unknown;
      if (input.status && coll.where) {
        snap = await coll.where(query).orderBy("createdAt", "desc").limit(input.limit).get();
      } else if (coll.orderBy) {
        snap = await coll.orderBy("createdAt", "desc").limit(input.limit).get();
      } else {
        snap = await coll.doc("_missing").get();
      }
      return docsFromGet(snap)
        .map((row) => asFeedback(String(row._id || row.feedbackId || ""), row))
        .filter((row) => (input.status ? row.status === input.status : true))
        .slice(0, input.limit);
    },
    async listByMember(memberId) {
      const coll = cloudApp().database().collection(FEEDBACK_COLLECTION);
      if (!coll.where) return [];
      const snap = await coll.where({ memberId }).orderBy("createdAt", "desc").limit(100).get();
      return docsFromGet(snap)
        .map((row) => asFeedback(String(row._id || row.feedbackId || ""), row))
        .filter((row) => row.memberId === memberId);
    }
  };
}
