import {
  ATTEMPT_SCHEMA_VERSION,
  DEFAULT_LEVEL_ID,
  defaultMaintenanceConfig,
  CATALOG_DOC_ID,
  emptyCatalog,
  emptyMaintenanceFlag,
  paperBestId,
  type ActiveAttemptRecord,
  type AttemptRecord,
  type CategoryRecord,
  type IdempotencyRecord,
  type MaintenanceConfig,
  type MedalGrantRecord,
  type PaperBestRecord,
  type PaperChunkRecord,
  type PaperRecord,
  type PaperVersionRecord,
  type ScoreEventRecord,
  type ScoreMetricRecord,
  type ScoreMetricScope
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { MemberRecord, MemberStatsRecord } from "./member-stores.js";
import type { AttemptWorkStore, AttemptWriteSnapshot, SubmitWriteSnapshot } from "./attempt-stores.js";
import { cloudPaperWorkStore } from "./cloud-paper-stores.js";
import { cloudMemberWorkStore } from "./cloud-member-stores.js";
import { cloudCategoryWorkStore } from "./cloud-category-stores.js";
import { asGrant, grantWrite } from "./cloud-growth-stores.js";

export const MW14_COLLECTIONS = {
  attempts: "attempts",
  activeAttempts: "active_attempts",
  papers: "papers",
  paperVersions: "paper_versions",
  paperChunks: "paper_chunks",
  members: "members",
  categories: "categories",
  idempotency: "idempotency"
} as const;

export const MW15_COLLECTIONS = {
  ...MW14_COLLECTIONS,
  memberStats: "member_stats",
  paperBests: "paper_bests",
  scoreEvents: "score_events",
  scoreMetrics: "score_metrics",
  medalGrants: "medal_grants",
  appConfig: "app_config"
} as const;

const MAINTENANCE_DOC_ID = "maintenance";

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

function asIso(value: unknown, fallback: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return fallback;
}

function asAttempt(id: string, data: Record<string, unknown>): AttemptRecord {
  const now = new Date().toISOString();
  const answers = Array.isArray(data.answers) ? data.answers : [];
  return {
    attemptId: typeof data.attemptId === "string" ? data.attemptId : id,
    memberId: typeof data.memberId === "string" ? data.memberId : "",
    paperId: typeof data.paperId === "string" ? data.paperId : "",
    paperVersionId: typeof data.paperVersionId === "string" ? data.paperVersionId : "",
    paperTitle: typeof data.paperTitle === "string" ? data.paperTitle : "",
    access: data.access === "vip" ? "vip" : "free",
    questionCount: typeof data.questionCount === "number" ? data.questionCount : 0,
    maxScore: typeof data.maxScore === "number" ? data.maxScore : 0,
    chunkCount: typeof data.chunkCount === "number" ? data.chunkCount : 0,
    answers: answers
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        questionId: typeof item.questionId === "string" ? item.questionId : "",
        optionIds: Array.isArray(item.optionIds) ? item.optionIds.filter((id): id is string => typeof id === "string") : []
      })),
    draftRevision: typeof data.draftRevision === "number" ? data.draftRevision : 0,
    state:
      data.state === "submitted" || data.state === "abandoned" || data.state === "inProgress" ? data.state : "inProgress",
    submittedAt: typeof data.submittedAt === "string" ? data.submittedAt : "",
    abandonedAt: typeof data.abandonedAt === "string" ? data.abandonedAt : "",
    lastSaveRequestId: typeof data.lastSaveRequestId === "string" ? data.lastSaveRequestId : "",
    score: typeof data.score === "number" ? data.score : null,
    gradeRevision: typeof data.gradeRevision === "number" ? data.gradeRevision : null,
    submitHash: typeof data.submitHash === "string" ? data.submitHash : null,
    gradingVersionId: typeof data.gradingVersionId === "string" && data.gradingVersionId ? data.gradingVersionId : null,
    correctionId: typeof data.correctionId === "string" && data.correctionId ? data.correctionId : null,
    correctedAt: typeof data.correctedAt === "string" && data.correctedAt ? data.correctedAt : null,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : ATTEMPT_SCHEMA_VERSION,
    createdAt: asIso(data.createdAt, now),
    updatedAt: asIso(data.updatedAt, now)
  };
}

function asActive(id: string, data: Record<string, unknown>): ActiveAttemptRecord {
  const now = new Date().toISOString();
  return {
    memberId: typeof data.memberId === "string" ? data.memberId : id,
    attemptId: typeof data.attemptId === "string" ? data.attemptId : "",
    paperId: typeof data.paperId === "string" ? data.paperId : "",
    paperTitle: typeof data.paperTitle === "string" ? data.paperTitle : "",
    paperVersionId: typeof data.paperVersionId === "string" ? data.paperVersionId : "",
    revision: typeof data.revision === "number" ? data.revision : 0,
    answeredCount: typeof data.answeredCount === "number" ? data.answeredCount : 0,
    questionCount: typeof data.questionCount === "number" ? data.questionCount : 0,
    updatedAt: asIso(data.updatedAt, now),
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : ATTEMPT_SCHEMA_VERSION
  };
}

function asStats(id: string, data: Record<string, unknown>): MemberStatsRecord {
  const now = new Date().toISOString();
  return {
    memberId: typeof data.memberId === "string" ? data.memberId : id,
    totalScore: typeof data.totalScore === "number" ? data.totalScore : 0,
    scoreSeq: typeof data.scoreSeq === "number" ? data.scoreSeq : 0,
    levelId: typeof data.levelId === "string" ? data.levelId : DEFAULT_LEVEL_ID,
    growthVersion: typeof data.growthVersion === "number" ? data.growthVersion : 0,
    revision: typeof data.revision === "number" ? data.revision : 1,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now),
    updatedAt: asIso(data.updatedAt, now)
  };
}

function asBest(data: Record<string, unknown>, memberId: string, paperId: string): PaperBestRecord {
  const now = new Date().toISOString();
  return {
    memberId: typeof data.memberId === "string" ? data.memberId : memberId,
    paperId: typeof data.paperId === "string" ? data.paperId : paperId,
    bestScore: typeof data.bestScore === "number" ? data.bestScore : 0,
    bestAttemptId: typeof data.bestAttemptId === "string" ? data.bestAttemptId : "",
    firstReachedAt: typeof data.firstReachedAt === "string" ? data.firstReachedAt : now,
    revision: typeof data.revision === "number" ? data.revision : 1,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now),
    updatedAt: asIso(data.updatedAt, now)
  };
}

function asEvent(id: string, data: Record<string, unknown>): ScoreEventRecord {
  const now = new Date().toISOString();
  return {
    eventId: typeof data.eventId === "string" ? data.eventId : id,
    attemptId: typeof data.attemptId === "string" ? data.attemptId : "",
    gradeRevision: typeof data.gradeRevision === "number" ? data.gradeRevision : 1,
    memberId: typeof data.memberId === "string" ? data.memberId : "",
    paperId: typeof data.paperId === "string" ? data.paperId : "",
    scoreSeq: typeof data.scoreSeq === "number" ? data.scoreSeq : 0,
    score: typeof data.score === "number" ? data.score : 0,
    delta: typeof data.delta === "number" ? data.delta : 0,
    submittedAt: typeof data.submittedAt === "string" ? data.submittedAt : now,
    weekKey: typeof data.weekKey === "string" ? data.weekKey : "",
    monthKey: typeof data.monthKey === "string" ? data.monthKey : "",
    kind: "submit",
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now)
  };
}

function asMetric(id: string, data: Record<string, unknown>): ScoreMetricRecord {
  const now = new Date().toISOString();
  const scope = data.scope;
  return {
    metricId: id,
    metricGeneration: typeof data.metricGeneration === "string" ? data.metricGeneration : "base",
    scope:
      scope === "total" || scope === "week" || scope === "month" || scope === "category" ? (scope as ScoreMetricScope) : "total",
    periodKey: typeof data.periodKey === "string" ? data.periodKey : "all",
    categoryId: typeof data.categoryId === "string" ? data.categoryId : "",
    memberId: typeof data.memberId === "string" ? data.memberId : "",
    value: typeof data.value === "number" ? data.value : 0,
    reachedAt: typeof data.reachedAt === "string" ? data.reachedAt : now,
    revision: typeof data.revision === "number" ? data.revision : 1,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    updatedAt: asIso(data.updatedAt, now)
  };
}

function asMaintenance(data: Record<string, unknown> | undefined): MaintenanceConfig {
  const now = new Date();
  const base = defaultMaintenanceConfig(now);
  if (!data) return base;
  const flag = (value: unknown, fallback: typeof base.contentWrites) => {
    const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    return {
      enabled: rec.enabled !== false,
      reason: typeof rec.reason === "string" ? rec.reason : fallback.reason,
      jobId: typeof rec.jobId === "string" ? rec.jobId : fallback.jobId,
      revision: typeof rec.revision === "number" ? rec.revision : fallback.revision
    };
  };
  return {
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    revision: typeof data.revision === "number" ? data.revision : 1,
    updatedAt: asIso(data.updatedAt, now.toISOString()),
    contentWrites: flag(data.contentWrites, emptyMaintenanceFlag()),
    attemptStart: flag(data.attemptStart, emptyMaintenanceFlag()),
    attemptSubmit: flag(data.attemptSubmit, emptyMaintenanceFlag()),
    purchaseCreate: flag(data.purchaseCreate, emptyMaintenanceFlag()),
    entitlementApply: flag(data.entitlementApply, emptyMaintenanceFlag())
  };
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

function activeWrite(row: ActiveAttemptRecord): Record<string, unknown> {
  return {
    memberId: row.memberId,
    attemptId: row.attemptId,
    paperId: row.paperId,
    paperTitle: row.paperTitle,
    paperVersionId: row.paperVersionId,
    revision: row.revision,
    answeredCount: row.answeredCount,
    questionCount: row.questionCount,
    updatedAt: row.updatedAt,
    schemaVersion: row.schemaVersion
  };
}

function idemWrite(record: IdempotencyRecord, existing: boolean): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    actorId: record.actorId,
    action: record.action,
    idempotencyKey: record.idempotencyKey,
    payloadHash: record.payloadHash,
    status: record.status,
    resultRef: record.resultRef,
    requestId: record.requestId,
    schemaVersion: 1,
    updatedAt: now,
    ...(existing ? {} : { createdAt: now })
  };
}

async function txGet(tx: CloudDb, collection: string, id: string): Promise<Record<string, unknown> | undefined> {
  if (!id) return undefined;
  const snap = await tx.collection(collection).doc(id).get();
  return unwrapDoc(snap);
}

export function cloudAttemptWorkStore(): AttemptWorkStore {
  const papers = cloudPaperWorkStore();
  const members = cloudMemberWorkStore();
  const categories = cloudCategoryWorkStore();
  return {
    async getAttempt(attemptId) {
      const snap = await cloudApp().database().collection(MW14_COLLECTIONS.attempts).doc(attemptId).get();
      const data = unwrapDoc(snap);
      return data ? asAttempt(attemptId, data) : undefined;
    },
    async getActive(memberId) {
      const snap = await cloudApp().database().collection(MW14_COLLECTIONS.activeAttempts).doc(memberId).get();
      const data = unwrapDoc(snap);
      return data && typeof data.attemptId === "string" && data.attemptId ? asActive(memberId, data) : undefined;
    },
    getPaper: (paperId) => papers.getPaper(paperId),
    getVersion: (versionId) => papers.getVersion(versionId),
    getChunk: (chunkId) => papers.getChunk(chunkId),
    getAnswer: (chunkId) => papers.getAnswer(chunkId),
    getMember: (memberId) => members.getMember(memberId),
    getCategory: (categoryId) => categories.getCategory(categoryId),
    getCatalog: () => categories.getCatalog(),
    async getStats(memberId) {
      const snap = await cloudApp().database().collection(MW15_COLLECTIONS.memberStats).doc(memberId).get();
      const data = unwrapDoc(snap);
      return data ? asStats(memberId, data) : undefined;
    },
    async getBest(memberId, paperId) {
      const id = paperBestId(memberId, paperId);
      const snap = await cloudApp().database().collection(MW15_COLLECTIONS.paperBests).doc(id).get();
      const data = unwrapDoc(snap);
      return data ? asBest(data, memberId, paperId) : undefined;
    },
    async listMemberBests(memberId) {
      const db = cloudApp().database();
      const coll = db.collection(MW15_COLLECTIONS.paperBests);
      if (!coll.where) return [];
      const snap = await coll.where({ memberId }).orderBy("updatedAt", "desc").limit(200).get();
      return docsFromGet(snap).map((row) => asBest(row, memberId, String(row.paperId || "")));
    },
    async listSubmittedAttempts(input) {
      const db = cloudApp().database();
      const query: Record<string, unknown> = { memberId: input.memberId, state: "submitted" };
      if (input.paperId) query.paperId = input.paperId;
      const where = db.collection(MW15_COLLECTIONS.attempts).where;
      if (!where) return [];
      const snap = await where.call(db.collection(MW15_COLLECTIONS.attempts), query).orderBy("submittedAt", "desc").limit(input.limit + 8).get();
      return docsFromGet(snap)
        .map((row) => asAttempt(String(row._id || row.attemptId || ""), row))
        .filter((row) => row.memberId === input.memberId && row.state === "submitted")
        .filter((row) => (input.paperId ? row.paperId === input.paperId : true))
        .filter((row) => {
          if (!input.after) return true;
          if (row.submittedAt < input.after.submittedAt) return true;
          if (row.submittedAt > input.after.submittedAt) return false;
          return row.attemptId < input.after.attemptId;
        })
        .sort((left, right) => {
          if (left.submittedAt === right.submittedAt) return right.attemptId.localeCompare(left.attemptId);
          return right.submittedAt.localeCompare(left.submittedAt);
        })
        .slice(0, input.limit);
    },
    async transactWrite<T>(input: {
      memberId: string;
      attemptId?: string;
      oldAttemptId?: string;
      paperId?: string;
      idempotencyId: string;
      mutate: (snap: AttemptWriteSnapshot) => import("./attempt-stores.js").AttemptWriteMutation<T>;
    }) {
      const started = Date.now();
      let reads = 0;
      let writes = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        reads += 8;
        const memberData = await txGet(tx, MW14_COLLECTIONS.members, input.memberId);
        const attemptData = input.attemptId ? await txGet(tx, MW14_COLLECTIONS.attempts, input.attemptId) : undefined;
        const oldData = input.oldAttemptId ? await txGet(tx, MW14_COLLECTIONS.attempts, input.oldAttemptId) : undefined;
        const activeData = await txGet(tx, MW14_COLLECTIONS.activeAttempts, input.memberId);
        const attempt = attemptData && input.attemptId ? asAttempt(input.attemptId, attemptData) : undefined;
        const paperId = input.paperId || attempt?.paperId || "";
        const paperData = paperId ? await txGet(tx, MW14_COLLECTIONS.papers, paperId) : undefined;
        const paper = paperData && paperId
          ? ({
              paperId,
              title: typeof paperData.title === "string" ? paperData.title : "",
              summary: typeof paperData.summary === "string" ? paperData.summary : "",
              goal: typeof paperData.goal === "string" ? paperData.goal : "",
              categoryId: typeof paperData.categoryId === "string" ? paperData.categoryId : "",
              access: paperData.access === "vip" ? "vip" : "free",
              difficulty:
                paperData.difficulty === "intermediate" || paperData.difficulty === "challenge"
                  ? paperData.difficulty
                  : "beginner",
              sort: typeof paperData.sort === "number" ? paperData.sort : 10,
              suggestedMinutes: typeof paperData.suggestedMinutes === "number" ? paperData.suggestedMinutes : 20,
              publishedAt: typeof paperData.publishedAt === "string" ? paperData.publishedAt : null,
              status:
                paperData.status === "published" ||
                paperData.status === "unpublished" ||
                paperData.status === "withdrawn"
                  ? paperData.status
                  : "draft",
              activeVersionId: typeof paperData.activeVersionId === "string" ? paperData.activeVersionId : null,
              revision: typeof paperData.revision === "number" ? paperData.revision : 0,
              draftItems: [],
              draftQuestionCount: 0,
              draftMaxScore: 0,
              accessLocked: paperData.accessLocked === true,
              withdrawReason: typeof paperData.withdrawReason === "string" ? paperData.withdrawReason : null,
              schemaVersion: 1,
              createdAt: asIso(paperData.createdAt, new Date().toISOString()),
              updatedAt: asIso(paperData.updatedAt, new Date().toISOString())
            } as PaperRecord)
          : undefined;
        const versionId = attempt?.paperVersionId || paper?.activeVersionId || "";
        const versionData = versionId ? await txGet(tx, MW14_COLLECTIONS.paperVersions, versionId) : undefined;
        const strings = (value: unknown) =>
          Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
        const version = versionData && versionId
          ? ({
              versionId,
              paperId: typeof versionData.paperId === "string" ? versionData.paperId : paperId,
              questionCount: typeof versionData.questionCount === "number" ? versionData.questionCount : 0,
              maxScore: typeof versionData.maxScore === "number" ? versionData.maxScore : 0,
              chunkIds: strings(versionData.chunkIds),
              answerChunkIds: strings(versionData.answerChunkIds),
              chunkDigests: strings(versionData.chunkDigests),
              answerDigests: strings(versionData.answerDigests),
              categoryPathSnapshot: strings(versionData.categoryPathSnapshot),
              manifestHash: typeof versionData.manifestHash === "string" ? versionData.manifestHash : "",
              questionIds: strings(versionData.questionIds),
              questionVersionIds: strings(versionData.questionVersionIds),
              schemaVersion: 1,
              createdAt: asIso(versionData.createdAt, new Date().toISOString()),
              createdBy: typeof versionData.createdBy === "string" ? versionData.createdBy : ""
            } as PaperVersionRecord)
          : undefined;
        const categoryData = paper?.categoryId ? await txGet(tx, MW14_COLLECTIONS.categories, paper.categoryId) : undefined;
        const category = categoryData && paper
          ? ({
              categoryId: paper.categoryId,
              parentId: typeof categoryData.parentId === "string" ? categoryData.parentId : null,
              depth: typeof categoryData.depth === "number" ? categoryData.depth : 1,
              ancestorIds: strings(categoryData.ancestorIds),
              name: typeof categoryData.name === "string" ? categoryData.name : "",
              normalizedName: typeof categoryData.normalizedName === "string" ? categoryData.normalizedName : "",
              sort: typeof categoryData.sort === "number" ? categoryData.sort : 0,
              enabled: categoryData.enabled === true,
              deletedAt: typeof categoryData.deletedAt === "string" ? categoryData.deletedAt : null,
              revision: typeof categoryData.revision === "number" ? categoryData.revision : 1,
              treeVersion: typeof categoryData.treeVersion === "number" ? categoryData.treeVersion : 1,
              schemaVersion: 1,
              createdAt: asIso(categoryData.createdAt, new Date().toISOString()),
              updatedAt: asIso(categoryData.updatedAt, new Date().toISOString())
            } as CategoryRecord)
          : undefined;
        const idemData = await txGet(tx, MW14_COLLECTIONS.idempotency, input.idempotencyId);
        const next = input.mutate({
          member: memberData
            ? ({
                memberId: input.memberId,
                nickname: typeof memberData.nickname === "string" ? memberData.nickname : "",
                avatarKey: typeof memberData.avatarKey === "string" ? memberData.avatarKey : "",
                status:
                  memberData.status === "disabled" ||
                  memberData.status === "deleting" ||
                  memberData.status === "deleted" ||
                  memberData.status === "active"
                    ? memberData.status
                    : "active",
                rankingOptIn: memberData.rankingOptIn === true,
                consentVersions: {
                  agreementVersion: "",
                  privacyVersion: "",
                  acceptedAt: ""
                },
                revision: typeof memberData.revision === "number" ? memberData.revision : 1,
                schemaVersion: 1,
                createdAt: asIso(memberData.createdAt, new Date().toISOString()),
                updatedAt: asIso(memberData.updatedAt, new Date().toISOString())
              } as MemberRecord)
            : undefined,
          attempt,
          oldAttempt: oldData && input.oldAttemptId ? asAttempt(input.oldAttemptId, oldData) : undefined,
          active: activeData && typeof activeData.attemptId === "string" && activeData.attemptId
            ? asActive(input.memberId, activeData)
            : undefined,
          paper: paper as PaperRecord | undefined,
          version: version as PaperVersionRecord | undefined,
          category: category as CategoryRecord | undefined,
          idem: idemData ? asIdem(input.idempotencyId, idemData) : undefined
        });
        if (next.error) return next;
        if (next.oldAttempt) {
          writes += 1;
          await tx.collection(MW14_COLLECTIONS.attempts).doc(next.oldAttempt.attemptId).set(attemptWrite(next.oldAttempt));
        }
        if (next.attempt) {
          writes += 1;
          await tx.collection(MW14_COLLECTIONS.attempts).doc(next.attempt.attemptId).set(attemptWrite(next.attempt));
        }
        if (next.active === null) {
          writes += 1;
          await tx.collection(MW14_COLLECTIONS.activeAttempts).doc(input.memberId).set({
            memberId: input.memberId,
            attemptId: "",
            updatedAt: new Date().toISOString(),
            schemaVersion: ATTEMPT_SCHEMA_VERSION
          });
        } else if (next.active) {
          writes += 1;
          await tx.collection(MW14_COLLECTIONS.activeAttempts).doc(next.active.memberId).set(activeWrite(next.active));
        }
        if (next.idem) {
          writes += 1;
          const body = idemWrite(next.idem, Boolean(idemData));
          if (idemData) {
            await tx.collection(MW14_COLLECTIONS.idempotency).doc(input.idempotencyId).update(body);
          } else {
            await tx.collection(MW14_COLLECTIONS.idempotency).doc(input.idempotencyId).set(body);
          }
        }
        return next;
      });
      const budget: TxBudget = { reads, writes, total: reads + writes, elapsedMs: Date.now() - started };
      return { mutation, budget };
    },
    async transactSubmit<T>(input: {
      memberId: string;
      attemptId: string;
      paperId?: string;
      idempotencyId: string;
      bestId: string;
      metricIds: string[];
      medalGrantIds: string[];
      mutate: (snap: SubmitWriteSnapshot) => import("./attempt-stores.js").SubmitWriteMutation<T>;
    }) {
      const started = Date.now();
      let reads = 0;
      let writes = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        reads += 16;
        const memberData = await txGet(tx, MW15_COLLECTIONS.members, input.memberId);
        const attemptData = await txGet(tx, MW15_COLLECTIONS.attempts, input.attemptId);
        const activeData = await txGet(tx, MW15_COLLECTIONS.activeAttempts, input.memberId);
        const attempt = attemptData ? asAttempt(input.attemptId, attemptData) : undefined;
        const paperId = input.paperId || attempt?.paperId || "";
        const paperData = paperId ? await txGet(tx, MW15_COLLECTIONS.papers, paperId) : undefined;
        const paper = paperData && paperId
          ? ({
              paperId,
              title: typeof paperData.title === "string" ? paperData.title : "",
              summary: typeof paperData.summary === "string" ? paperData.summary : "",
              goal: typeof paperData.goal === "string" ? paperData.goal : "",
              categoryId: typeof paperData.categoryId === "string" ? paperData.categoryId : "",
              access: paperData.access === "vip" ? "vip" : "free",
              difficulty:
                paperData.difficulty === "intermediate" || paperData.difficulty === "challenge"
                  ? paperData.difficulty
                  : "beginner",
              sort: typeof paperData.sort === "number" ? paperData.sort : 10,
              suggestedMinutes: typeof paperData.suggestedMinutes === "number" ? paperData.suggestedMinutes : 20,
              publishedAt: typeof paperData.publishedAt === "string" ? paperData.publishedAt : null,
              status:
                paperData.status === "published" ||
                paperData.status === "unpublished" ||
                paperData.status === "withdrawn"
                  ? paperData.status
                  : "draft",
              activeVersionId: typeof paperData.activeVersionId === "string" ? paperData.activeVersionId : null,
              revision: typeof paperData.revision === "number" ? paperData.revision : 0,
              draftItems: [],
              draftQuestionCount: 0,
              draftMaxScore: 0,
              accessLocked: paperData.accessLocked === true,
              withdrawReason: typeof paperData.withdrawReason === "string" ? paperData.withdrawReason : null,
              schemaVersion: 1,
              createdAt: asIso(paperData.createdAt, new Date().toISOString()),
              updatedAt: asIso(paperData.updatedAt, new Date().toISOString())
            } as PaperRecord)
          : undefined;
        const versionId = attempt?.paperVersionId || paper?.activeVersionId || "";
        const versionData = versionId ? await txGet(tx, MW15_COLLECTIONS.paperVersions, versionId) : undefined;
        const strings = (value: unknown) =>
          Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
        const version = versionData && versionId
          ? ({
              versionId,
              paperId: typeof versionData.paperId === "string" ? versionData.paperId : paperId,
              questionCount: typeof versionData.questionCount === "number" ? versionData.questionCount : 0,
              maxScore: typeof versionData.maxScore === "number" ? versionData.maxScore : 0,
              chunkIds: strings(versionData.chunkIds),
              answerChunkIds: strings(versionData.answerChunkIds),
              chunkDigests: strings(versionData.chunkDigests),
              answerDigests: strings(versionData.answerDigests),
              categoryPathSnapshot: strings(versionData.categoryPathSnapshot),
              manifestHash: typeof versionData.manifestHash === "string" ? versionData.manifestHash : "",
              questionIds: strings(versionData.questionIds),
              questionVersionIds: strings(versionData.questionVersionIds),
              schemaVersion: 1,
              createdAt: asIso(versionData.createdAt, new Date().toISOString()),
              createdBy: typeof versionData.createdBy === "string" ? versionData.createdBy : ""
            } as PaperVersionRecord)
          : undefined;
        const categoryData = paper?.categoryId ? await txGet(tx, MW15_COLLECTIONS.categories, paper.categoryId) : undefined;
        const category = categoryData && paper
          ? ({
              categoryId: paper.categoryId,
              parentId: typeof categoryData.parentId === "string" ? categoryData.parentId : null,
              depth: typeof categoryData.depth === "number" ? categoryData.depth : 1,
              ancestorIds: strings(categoryData.ancestorIds),
              name: typeof categoryData.name === "string" ? categoryData.name : "",
              normalizedName: typeof categoryData.normalizedName === "string" ? categoryData.normalizedName : "",
              sort: typeof categoryData.sort === "number" ? categoryData.sort : 0,
              enabled: categoryData.enabled === true,
              deletedAt: typeof categoryData.deletedAt === "string" ? categoryData.deletedAt : null,
              revision: typeof categoryData.revision === "number" ? categoryData.revision : 1,
              treeVersion: typeof categoryData.treeVersion === "number" ? categoryData.treeVersion : 1,
              schemaVersion: 1,
              createdAt: asIso(categoryData.createdAt, new Date().toISOString()),
              updatedAt: asIso(categoryData.updatedAt, new Date().toISOString())
            } as CategoryRecord)
          : undefined;
        const idemData = await txGet(tx, MW15_COLLECTIONS.idempotency, input.idempotencyId);
        const maintData = await txGet(tx, MW15_COLLECTIONS.appConfig, MAINTENANCE_DOC_ID);
        const catalogData = await txGet(tx, MW15_COLLECTIONS.appConfig, CATALOG_DOC_ID);
        const statsData = await txGet(tx, MW15_COLLECTIONS.memberStats, input.memberId);
        const bestData = await txGet(tx, MW15_COLLECTIONS.paperBests, input.bestId);
        const metricRows: ScoreMetricRecord[] = [];
        for (const metricId of input.metricIds) {
          const metricData = await txGet(tx, MW15_COLLECTIONS.scoreMetrics, metricId);
          if (metricData) metricRows.push(asMetric(metricId, metricData));
        }
        const grantRows: MedalGrantRecord[] = [];
        for (const grantId of input.medalGrantIds) {
          reads += 1;
          const grantData = await txGet(tx, MW15_COLLECTIONS.medalGrants, grantId);
          if (grantData) grantRows.push(asGrant(grantId, grantData));
        }
        const next = input.mutate({
          member: memberData
            ? ({
                memberId: input.memberId,
                nickname: typeof memberData.nickname === "string" ? memberData.nickname : "",
                avatarKey: typeof memberData.avatarKey === "string" ? memberData.avatarKey : "",
                status:
                  memberData.status === "disabled" ||
                  memberData.status === "deleting" ||
                  memberData.status === "deleted" ||
                  memberData.status === "active"
                    ? memberData.status
                    : "active",
                rankingOptIn: memberData.rankingOptIn === true,
                consentVersions: { agreementVersion: "", privacyVersion: "", acceptedAt: "" },
                revision: typeof memberData.revision === "number" ? memberData.revision : 1,
                schemaVersion: 1,
                createdAt: asIso(memberData.createdAt, new Date().toISOString()),
                updatedAt: asIso(memberData.updatedAt, new Date().toISOString())
              } as MemberRecord)
            : undefined,
          attempt,
          active: activeData && typeof activeData.attemptId === "string" && activeData.attemptId
            ? asActive(input.memberId, activeData)
            : undefined,
          paper: paper as PaperRecord | undefined,
          version: version as PaperVersionRecord | undefined,
          category: category as CategoryRecord | undefined,
          idem: idemData ? asIdem(input.idempotencyId, idemData) : undefined,
          maintenance: asMaintenance(maintData),
          catalog: catalogData
            ? {
                treeVersion: typeof catalogData.treeVersion === "number" ? catalogData.treeVersion : 0,
                categoryMetricsGeneration:
                  typeof catalogData.categoryMetricsGeneration === "number" ? catalogData.categoryMetricsGeneration : 0,
                seeded: catalogData.seeded === true,
                seededAt: typeof catalogData.seededAt === "string" ? catalogData.seededAt : null,
                schemaVersion: typeof catalogData.schemaVersion === "number" ? catalogData.schemaVersion : 1,
                updatedAt: asIso(catalogData.updatedAt, new Date().toISOString()),
                structureUpdating: catalogData.structureUpdating === true,
                structureJobId: typeof catalogData.structureJobId === "string" ? catalogData.structureJobId : "",
                categoryRankingStatus:
                  catalogData.categoryRankingStatus === "updating" || catalogData.categoryRankingStatus === "pending_recovery"
                    ? catalogData.categoryRankingStatus
                    : "ready",
                categoryRankingError: typeof catalogData.categoryRankingError === "string" ? catalogData.categoryRankingError : ""
              }
            : emptyCatalog(new Date()),
          stats: statsData ? asStats(input.memberId, statsData) : undefined,
          best: bestData ? asBest(bestData, input.memberId, paperId) : undefined,
          metrics: metricRows,
          grants: grantRows
        });
        if (next.error) return next;
        if (next.attempt) {
          writes += 1;
          await tx.collection(MW15_COLLECTIONS.attempts).doc(next.attempt.attemptId).set(attemptWrite(next.attempt));
        }
        if (next.active === null) {
          writes += 1;
          await tx.collection(MW15_COLLECTIONS.activeAttempts).doc(input.memberId).set({
            memberId: input.memberId,
            attemptId: "",
            updatedAt: new Date().toISOString(),
            schemaVersion: ATTEMPT_SCHEMA_VERSION
          });
        } else if (next.active) {
          writes += 1;
          await tx.collection(MW15_COLLECTIONS.activeAttempts).doc(next.active.memberId).set(activeWrite(next.active));
        }
        if (next.stats) {
          writes += 1;
          await tx.collection(MW15_COLLECTIONS.memberStats).doc(next.stats.memberId).set({ ...next.stats });
        }
        if (next.best) {
          writes += 1;
          await tx.collection(MW15_COLLECTIONS.paperBests).doc(input.bestId).set({ ...next.best });
        }
        if (next.event) {
          writes += 1;
          await tx.collection(MW15_COLLECTIONS.scoreEvents).doc(next.event.eventId).set({ ...next.event });
        }
        for (const metric of next.metrics || []) {
          writes += 1;
          await tx.collection(MW15_COLLECTIONS.scoreMetrics).doc(metric.metricId).set({ ...metric });
        }
        for (const grant of next.grants || []) {
          writes += 1;
          await tx.collection(MW15_COLLECTIONS.medalGrants).doc(grant.grantId).set(grantWrite(grant));
        }
        if (next.idem) {
          writes += 1;
          const body = idemWrite(next.idem, Boolean(idemData));
          if (idemData) {
            await tx.collection(MW15_COLLECTIONS.idempotency).doc(input.idempotencyId).update(body);
          } else {
            await tx.collection(MW15_COLLECTIONS.idempotency).doc(input.idempotencyId).set(body);
          }
        }
        return next;
      });
      const budget: TxBudget = { reads, writes, total: reads + writes, elapsedMs: Date.now() - started };
      return { mutation, budget };
    }
  };
}

export type { PaperChunkRecord };
