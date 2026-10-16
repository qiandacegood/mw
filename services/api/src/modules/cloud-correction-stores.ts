import {
  CATALOG_DOC_ID,
  CORRECTION_PREVIEW_COLLECTION,
  CORRECTION_WORK_COLLECTION,
  auditDocId,
  defaultMaintenanceConfig,
  emptyCatalog,
  paperBestId,
  type AttemptRecord,
  type CatalogRecord,
  type CategoryRecord,
  type CorrectionPreviewRecord,
  type GrowthConfigRecord,
  type IdempotencyRecord,
  type JobRecord,
  type MaintenanceConfig,
  type MedalGrantRecord,
  type PaperAnswerRecord,
  type PaperBestRecord,
  type PaperChunkRecord,
  type PaperRecord,
  type PaperVersionRecord,
  type ScoreEventRecord,
  type ScoreMetricRecord
} from "@mw/shared";
import type {
  CorrectionCommitMutation,
  CorrectionCommitSnapshot,
  CorrectionStore,
  CorrectionWorkRecord,
  MemberRegradeWrite
} from "./correction-stores.js";
import type { TxBudget } from "./job-stores.js";
import type { MemberStatsRecord } from "./member-stores.js";
import { asGrant } from "./cloud-growth-stores.js";

function cloudApp() {
  const cloudbase = require("@cloudbase/node-sdk") as {
    init: (opts: { env: unknown }) => { database: () => CloudDb };
    SYMBOL_CURRENT_ENV: unknown;
  };
  return cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
}

type CloudDb = {
  collection: (name: string) => {
    doc: (id: string) => {
      get: () => Promise<unknown>;
      set: (data: Record<string, unknown>) => Promise<unknown>;
      update: (data: Record<string, unknown>) => Promise<unknown>;
    };
    where?: (query: Record<string, unknown>) => {
      orderBy?: (field: string, dir: string) => { limit: (n: number) => { get: () => Promise<unknown> } };
      limit: (n: number) => { get: () => Promise<unknown> };
      get?: () => Promise<unknown>;
    };
    limit?: (n: number) => { get: () => Promise<unknown> };
    get?: () => Promise<unknown>;
  };
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

function plain(value: unknown): Record<string, unknown> {
  const rec = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete rec._id;
  return rec;
}

async function txGet(db: CloudDb, collection: string, id: string): Promise<Record<string, unknown> | undefined> {
  try {
    return unwrapDoc(await db.collection(collection).doc(id).get());
  } catch {
    return undefined;
  }
}

async function writeDoc(db: CloudDb, label: string, collection: string, id: string, data: Record<string, unknown>): Promise<void> {
  try {
    await db.collection(collection).doc(id).set(plain(data));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`correction_write_${label}: ${msg.replace(/[A-Za-z0-9+/]{24,}/g, "[redacted]").slice(0, 160)}`);
  }
}

async function listCollection(db: CloudDb, name: string): Promise<Record<string, unknown>[]> {
  const coll = db.collection(name);
  const snap = coll.limit ? await coll.limit(200).get() : coll.get ? await coll.get() : { data: [] };
  return unwrapList(snap);
}

async function queryWhere(db: CloudDb, name: string, query: Record<string, unknown>, limit = 80): Promise<Record<string, unknown>[]> {
  const coll = db.collection(name);
  if (!coll.where) return [];
  const snap = await coll.where(query).limit(limit).get();
  return unwrapList(snap);
}

function asAttempt(id: string, data: Record<string, unknown>): AttemptRecord {
  const answers = Array.isArray(data.answers)
    ? data.answers
        .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
        .map((row) => ({
          questionId: String(row.questionId || ""),
          optionIds: Array.isArray(row.optionIds) ? row.optionIds.map((item) => String(item)) : []
        }))
    : [];
  return {
    attemptId: typeof data.attemptId === "string" ? data.attemptId : id,
    memberId: String(data.memberId || ""),
    paperId: String(data.paperId || ""),
    paperVersionId: String(data.paperVersionId || ""),
    paperTitle: String(data.paperTitle || ""),
    access: data.access === "vip" ? "vip" : "free",
    questionCount: typeof data.questionCount === "number" ? data.questionCount : 0,
    maxScore: typeof data.maxScore === "number" ? data.maxScore : 0,
    chunkCount: typeof data.chunkCount === "number" ? data.chunkCount : 0,
    answers,
    draftRevision: typeof data.draftRevision === "number" ? data.draftRevision : 1,
    state: data.state === "submitted" || data.state === "abandoned" ? data.state : "inProgress",
    submittedAt: typeof data.submittedAt === "string" ? data.submittedAt : "",
    abandonedAt: typeof data.abandonedAt === "string" ? data.abandonedAt : "",
    lastSaveRequestId: typeof data.lastSaveRequestId === "string" ? data.lastSaveRequestId : "",
    score: typeof data.score === "number" ? data.score : null,
    gradeRevision: typeof data.gradeRevision === "number" ? data.gradeRevision : null,
    submitHash: typeof data.submitHash === "string" ? data.submitHash : null,
    gradingVersionId: typeof data.gradingVersionId === "string" ? data.gradingVersionId : null,
    correctionId: typeof data.correctionId === "string" ? data.correctionId : null,
    correctedAt: typeof data.correctedAt === "string" ? data.correctedAt : null,
    schemaVersion: 1,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : ""
  };
}

function attemptWrite(row: AttemptRecord): Record<string, unknown> {
  return {
    attemptId: row.attemptId,
    memberId: row.memberId,
    paperId: row.paperId,
    paperVersionId: row.paperVersionId,
    paperTitle: row.paperTitle,
    access: row.access,
    questionCount: row.questionCount,
    maxScore: row.maxScore,
    chunkCount: row.chunkCount,
    answers: row.answers,
    draftRevision: row.draftRevision,
    state: row.state,
    submittedAt: row.submittedAt,
    abandonedAt: row.abandonedAt,
    lastSaveRequestId: row.lastSaveRequestId,
    score: row.score,
    gradeRevision: row.gradeRevision,
    submitHash: row.submitHash,
    gradingVersionId: row.gradingVersionId || "",
    correctionId: row.correctionId || "",
    correctedAt: row.correctedAt || "",
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function asEvent(id: string, data: Record<string, unknown>): ScoreEventRecord {
  return {
    eventId: typeof data.eventId === "string" ? data.eventId : id,
    attemptId: String(data.attemptId || ""),
    gradeRevision: typeof data.gradeRevision === "number" ? data.gradeRevision : 1,
    memberId: String(data.memberId || ""),
    paperId: String(data.paperId || ""),
    scoreSeq: typeof data.scoreSeq === "number" ? data.scoreSeq : 0,
    score: typeof data.score === "number" ? data.score : 0,
    delta: typeof data.delta === "number" ? data.delta : 0,
    submittedAt: String(data.submittedAt || ""),
    weekKey: String(data.weekKey || ""),
    monthKey: String(data.monthKey || ""),
    kind: data.kind === "correction" ? "correction" : "submit",
    sourceEventId: typeof data.sourceEventId === "string" ? data.sourceEventId : undefined,
    correctionId: typeof data.correctionId === "string" ? data.correctionId : undefined,
    schemaVersion: 1,
    createdAt: String(data.createdAt || "")
  };
}

function eventWrite(row: ScoreEventRecord): Record<string, unknown> {
  return {
    eventId: row.eventId,
    attemptId: row.attemptId,
    gradeRevision: row.gradeRevision,
    memberId: row.memberId,
    paperId: row.paperId,
    scoreSeq: row.scoreSeq,
    score: row.score,
    delta: row.delta,
    submittedAt: row.submittedAt,
    weekKey: row.weekKey,
    monthKey: row.monthKey,
    kind: row.kind,
    sourceEventId: row.sourceEventId || "",
    correctionId: row.correctionId || "",
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt
  };
}

function metricWrite(row: ScoreMetricRecord): Record<string, unknown> {
  return {
    metricId: row.metricId,
    metricGeneration: row.metricGeneration,
    scope: row.scope,
    periodKey: row.periodKey,
    categoryId: row.categoryId,
    memberId: row.memberId,
    value: row.value,
    reachedAt: row.reachedAt,
    revision: row.revision,
    schemaVersion: row.schemaVersion,
    updatedAt: row.updatedAt
  };
}

async function persistCommitWrites(db: CloudDb, next: CorrectionCommitMutation<unknown>): Promise<void> {
  if (next.maintenance) {
    await writeDoc(db, "maintenance", "app_config", "maintenance", next.maintenance as unknown as Record<string, unknown>);
  }
  if (next.job) {
    await writeDoc(db, "job", "jobs", next.job.jobId, {
      jobId: next.job.jobId,
      type: next.job.type,
      businessKey: next.job.businessKey,
      state: next.job.state,
      cursor: next.job.cursor,
      leaseUntil: next.job.leaseUntil || "",
      fencingToken: next.job.fencingToken,
      attempts: next.job.attempts,
      maxAttempts: next.job.maxAttempts,
      resumeCount: next.job.resumeCount ?? 0,
      totalAttempts: next.job.totalAttempts ?? 0,
      lastResumeHash: next.job.lastResumeHash || "",
      nextRunAt: next.job.nextRunAt,
      ...(next.job.lastError ? { lastError: next.job.lastError } : {}),
      schemaVersion: next.job.schemaVersion,
      createdAt: next.job.createdAt,
      updatedAt: next.job.updatedAt,
      revision: next.job.revision
    });
  }
  if (next.work) {
    await writeDoc(db, "work", CORRECTION_WORK_COLLECTION, next.work.jobId, next.work as unknown as Record<string, unknown>);
  }
  if (next.preview) {
    await writeDoc(db, "preview", CORRECTION_PREVIEW_COLLECTION, next.preview.previewId, next.preview as unknown as Record<string, unknown>);
  }
  if (next.idem) {
    await writeDoc(db, "idem", "idempotency", next.idem.id, {
      actorId: next.idem.actorId,
      action: next.idem.action,
      idempotencyKey: next.idem.idempotencyKey,
      payloadHash: next.idem.payloadHash,
      status: next.idem.status,
      resultRef: next.idem.resultRef,
      requestId: next.idem.requestId,
      schemaVersion: 1,
      updatedAt: new Date().toISOString()
    });
  }
  if (next.audit) {
    await writeDoc(db, "audit", "audit_logs", auditDocId(next.audit), {
      actorType: next.audit.actorType,
      actorId: next.audit.actorId,
      action: next.audit.action,
      target: next.audit.target,
      reason: next.audit.reason,
      requestId: next.audit.requestId,
      beforeHash: next.audit.beforeHash,
      afterHash: next.audit.afterHash,
      createdAt: next.audit.createdAt,
      schemaVersion: next.audit.schemaVersion
    });
  }
}

export function cloudCorrectionStore(): CorrectionStore {
  return {
    async getPreview(previewId) {
      const data = unwrapDoc(await cloudApp().database().collection(CORRECTION_PREVIEW_COLLECTION).doc(previewId).get());
      return data ? (data as unknown as CorrectionPreviewRecord) : undefined;
    },
    async savePreview(row) {
      await cloudApp().database().collection(CORRECTION_PREVIEW_COLLECTION).doc(row.previewId).set(plain(row));
    },
    async getWork(jobId) {
      const data = unwrapDoc(await cloudApp().database().collection(CORRECTION_WORK_COLLECTION).doc(jobId).get());
      return data ? (data as unknown as CorrectionWorkRecord) : undefined;
    },
    async saveWork(row) {
      await cloudApp().database().collection(CORRECTION_WORK_COLLECTION).doc(row.jobId).set(plain(row));
    },
    async getPaper(paperId) {
      const data = unwrapDoc(await cloudApp().database().collection("papers").doc(paperId).get());
      return data ? (data as unknown as PaperRecord) : undefined;
    },
    async getVersion(versionId) {
      const data = unwrapDoc(await cloudApp().database().collection("paper_versions").doc(versionId).get());
      return data ? (data as unknown as PaperVersionRecord) : undefined;
    },
    async getChunks(version) {
      const rows: PaperChunkRecord[] = [];
      for (const id of version.chunkIds) {
        const data = unwrapDoc(await cloudApp().database().collection("paper_chunks").doc(id).get());
        if (data) rows.push(data as unknown as PaperChunkRecord);
      }
      return rows;
    },
    async getAnswers(version) {
      const rows: PaperAnswerRecord[] = [];
      for (const id of version.answerChunkIds) {
        const data = unwrapDoc(await cloudApp().database().collection("paper_answers").doc(id).get());
        if (data) rows.push(data as unknown as PaperAnswerRecord);
      }
      return rows;
    },
    async getCatalog() {
      const data = await txGet(cloudApp().database(), "app_config", CATALOG_DOC_ID);
      if (!data) return emptyCatalog(new Date());
      return {
        ...emptyCatalog(new Date()),
        treeVersion: typeof data.treeVersion === "number" ? data.treeVersion : 0,
        categoryMetricsGeneration: typeof data.categoryMetricsGeneration === "number" ? data.categoryMetricsGeneration : 0,
        structureUpdating: data.structureUpdating === true,
        structureJobId: typeof data.structureJobId === "string" ? data.structureJobId : "",
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString()
      };
    },
    async getCategory(categoryId) {
      const data = unwrapDoc(await cloudApp().database().collection("categories").doc(categoryId).get());
      return data ? (data as unknown as CategoryRecord) : undefined;
    },
    async getStats(memberId) {
      const data = unwrapDoc(await cloudApp().database().collection("member_stats").doc(memberId).get());
      return data ? (data as unknown as MemberStatsRecord) : undefined;
    },
    async getBest(memberId, paperId) {
      const data = unwrapDoc(await cloudApp().database().collection("paper_bests").doc(paperBestId(memberId, paperId)).get());
      return data ? (data as unknown as PaperBestRecord) : undefined;
    },
    async getMetric(metricId) {
      const data = unwrapDoc(await cloudApp().database().collection("score_metrics").doc(metricId).get());
      return data ? (data as unknown as ScoreMetricRecord) : undefined;
    },
    async listGrants(memberId) {
      const rows = await queryWhere(cloudApp().database(), "medal_grants", { memberId }, 40);
      return rows.map((row) => asGrant(String(row._id || row.grantId || ""), row));
    },
    async getGrowth() {
      const data = unwrapDoc(await cloudApp().database().collection("app_config").doc("growth").get());
      return data ? (data as unknown as GrowthConfigRecord) : undefined;
    },
    async listSubmittedAttempts(input) {
      const query: Record<string, unknown> = { paperId: input.paperId, state: "submitted" };
      if (input.memberId) query.memberId = input.memberId;
      const rows = await queryWhere(cloudApp().database(), "attempts", query, input.limit + 20);
      return rows
        .map((row) => asAttempt(String(row._id || row.attemptId || ""), row))
        .filter((row) => row.paperVersionId === input.fromVersionId)
        .filter((row) => !input.afterAttemptId || row.attemptId > input.afterAttemptId)
        .sort((left, right) => left.attemptId.localeCompare(right.attemptId))
        .slice(0, input.limit);
    },
    async listEvents(memberId, paperId) {
      const rows = await queryWhere(cloudApp().database(), "score_events", { memberId, paperId }, 100);
      return rows
        .map((row) => asEvent(String(row._id || row.eventId || ""), row))
        .sort((left, right) => left.scoreSeq - right.scoreSeq || left.gradeRevision - right.gradeRevision);
    },
    async listDueJobIds(input) {
      const rows = await listCollection(cloudApp().database(), "jobs");
      return rows
        .filter((row) => {
          const type = typeof row.type === "string" ? row.type : "";
          const state = typeof row.state === "string" ? row.state : "";
          const nextRunAt = typeof row.nextRunAt === "string" ? Date.parse(row.nextRunAt) : 0;
          const leaseUntil = typeof row.leaseUntil === "string" ? Date.parse(row.leaseUntil) : 0;
          const leaseGone = !row.leaseUntil || leaseUntil <= input.now.getTime();
          return (
            input.types.includes(type) &&
            nextRunAt <= input.now.getTime() &&
            (state === "queued" || state === "retryable" || (state === "running" && leaseGone))
          );
        })
        .map((row) => String(row.jobId || row._id || ""));
    },
    async applyMemberRegrade(write: MemberRegradeWrite) {
      const db = cloudApp().database();
      for (const event of write.events) {
        await writeDoc(db, "event", "score_events", event.eventId, eventWrite(event));
      }
      for (const attempt of write.attempts) {
        await writeDoc(db, "attempt", "attempts", attempt.attemptId, attemptWrite(attempt));
      }
      if (write.stats) {
        await writeDoc(db, "stats", "member_stats", write.stats.memberId, { ...write.stats });
      }
      if (write.best) {
        await writeDoc(db, "best", "paper_bests", paperBestId(write.best.memberId, write.best.paperId), { ...write.best });
      }
      for (const metric of write.metrics) {
        await writeDoc(db, "metric", "score_metrics", metric.metricId, metricWrite(metric));
      }
      for (const grant of write.grants) {
        await writeDoc(db, "grant", "medal_grants", grant.grantId, { ...grant });
      }
    },
    async transactCommit(input) {
      const started = Date.now();
      const db = cloudApp().database();
      const catalogData = await txGet(db, "app_config", CATALOG_DOC_ID);
      const snap: CorrectionCommitSnapshot = {
        preview: (await txGet(db, CORRECTION_PREVIEW_COLLECTION, input.previewId)) as CorrectionPreviewRecord | undefined,
        job: (await txGet(db, "jobs", input.jobId)) as JobRecord | undefined,
        work: (await txGet(db, CORRECTION_WORK_COLLECTION, input.jobId)) as CorrectionWorkRecord | undefined,
        maintenance: ((await txGet(db, "app_config", "maintenance")) as unknown as MaintenanceConfig | undefined) || defaultMaintenanceConfig(new Date()),
        idem: (await txGet(db, "idempotency", input.idempotencyId)) as IdempotencyRecord | undefined,
        catalog: catalogData
          ? {
              ...emptyCatalog(new Date()),
              treeVersion: typeof catalogData.treeVersion === "number" ? catalogData.treeVersion : 0,
              categoryMetricsGeneration: typeof catalogData.categoryMetricsGeneration === "number" ? catalogData.categoryMetricsGeneration : 0
            }
          : emptyCatalog(new Date())
      };
      const mutation = input.mutate(snap);
      if (!mutation.error) {
        await persistCommitWrites(db, mutation);
      }
      return {
        mutation,
        budget: { reads: 6, writes: mutation.error ? 0 : 6, total: mutation.error ? 6 : 12, elapsedMs: Date.now() - started } satisfies TxBudget
      };
    }
  };
}
