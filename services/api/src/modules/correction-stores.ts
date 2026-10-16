import {
  defaultMaintenanceConfig,
  emptyCatalog,
  type AuditEntry,
  type CatalogRecord,
  type CategoryRecord,
  type CorrectionPlan,
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
  type ScoreMetricRecord,
  type AttemptRecord
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { MemberStatsRecord } from "./member-stores.js";

export type CorrectionWorkRecord = {
  jobId: string;
  previewId: string;
  planHash: string;
  actorId: string;
  reason: string;
  paperId: string;
  fromVersionId: string;
  toVersionId: string;
  closedAt: string;
  notBefore: string;
  processedMemberIds: string[];
  opened: boolean;
  rankingStatus: "pending" | "ok" | "failed";
  rankingError: string;
  sourceCategoryGeneration: number;
  schemaVersion: number;
  updatedAt: string;
};

export type CorrectionCommitSnapshot = {
  preview?: CorrectionPreviewRecord;
  job?: JobRecord;
  work?: CorrectionWorkRecord;
  maintenance: MaintenanceConfig;
  idem?: IdempotencyRecord;
  catalog: CatalogRecord;
};

export type CorrectionCommitMutation<T> = {
  preview?: CorrectionPreviewRecord;
  job?: JobRecord;
  work?: CorrectionWorkRecord;
  maintenance?: MaintenanceConfig;
  idem?: IdempotencyRecord;
  audit?: AuditEntry;
  result: T;
  error?: { code: string; reason: string; issues?: string[]; details?: Record<string, unknown> };
};

export type MemberRegradeWrite = {
  attempts: AttemptRecord[];
  events: ScoreEventRecord[];
  stats?: MemberStatsRecord;
  best?: PaperBestRecord;
  metrics: ScoreMetricRecord[];
  grants: MedalGrantRecord[];
};

export interface CorrectionStore {
  getPreview(previewId: string): Promise<CorrectionPreviewRecord | undefined>;
  savePreview(row: CorrectionPreviewRecord): Promise<void>;
  getWork(jobId: string): Promise<CorrectionWorkRecord | undefined>;
  saveWork(row: CorrectionWorkRecord): Promise<void>;
  getPaper(paperId: string): Promise<PaperRecord | undefined>;
  getVersion(versionId: string): Promise<PaperVersionRecord | undefined>;
  getChunks(version: PaperVersionRecord): Promise<PaperChunkRecord[]>;
  getAnswers(version: PaperVersionRecord): Promise<PaperAnswerRecord[]>;
  getCatalog(): Promise<CatalogRecord>;
  getCategory(categoryId: string): Promise<CategoryRecord | undefined>;
  getStats(memberId: string): Promise<MemberStatsRecord | undefined>;
  getBest(memberId: string, paperId: string): Promise<PaperBestRecord | undefined>;
  getMetric(metricId: string): Promise<ScoreMetricRecord | undefined>;
  listGrants(memberId: string): Promise<MedalGrantRecord[]>;
  getGrowth(): Promise<GrowthConfigRecord | undefined>;
  listSubmittedAttempts(input: {
    paperId: string;
    fromVersionId: string;
    memberId?: string;
    afterAttemptId?: string;
    limit: number;
  }): Promise<AttemptRecord[]>;
  listEvents(memberId: string, paperId: string): Promise<ScoreEventRecord[]>;
  listDueJobIds(input: { now: Date; types: string[] }): Promise<string[]>;
  applyMemberRegrade(write: MemberRegradeWrite): Promise<void>;
  transactCommit<T>(input: {
    previewId: string;
    jobId: string;
    idempotencyId: string;
    mutate: (snap: CorrectionCommitSnapshot) => CorrectionCommitMutation<T>;
  }): Promise<{ mutation: CorrectionCommitMutation<T>; budget: TxBudget }>;
}

export type MemoryCorrectionBundle = CorrectionStore & {
  previews: Map<string, CorrectionPreviewRecord>;
  work: Map<string, CorrectionWorkRecord>;
  papers: Map<string, PaperRecord>;
  versions: Map<string, PaperVersionRecord>;
  chunks: Map<string, PaperChunkRecord>;
  answers: Map<string, PaperAnswerRecord>;
  attempts: Map<string, AttemptRecord>;
  events: Map<string, ScoreEventRecord>;
  stats: Map<string, MemberStatsRecord>;
  bests: Map<string, PaperBestRecord>;
  metrics: Map<string, ScoreMetricRecord>;
  grants: Map<string, MedalGrantRecord>;
  jobs: Map<string, JobRecord>;
  catalog: CatalogRecord;
  maintenance: MaintenanceConfig;
  categories: Map<string, CategoryRecord>;
  growth?: GrowthConfigRecord;
  seedPaper(row: PaperRecord): void;
  seedVersion(row: PaperVersionRecord, chunks: PaperChunkRecord[], answers: PaperAnswerRecord[]): void;
  seedAttempt(row: AttemptRecord): void;
  seedEvent(row: ScoreEventRecord): void;
  seedStats(row: MemberStatsRecord): void;
  seedBest(row: PaperBestRecord): void;
  seedMetric(row: ScoreMetricRecord): void;
  seedGrant(row: MedalGrantRecord): void;
  seedCategory(row: CategoryRecord): void;
  setCatalog(row: CatalogRecord): void;
  setMaintenance(row: MaintenanceConfig): void;
  putJob(job: JobRecord): void;
};

function clonePreview(row: CorrectionPreviewRecord): CorrectionPreviewRecord {
  return { ...row, plan: { ...row.plan, warnings: [...row.plan.warnings] } };
}

function cloneWork(row: CorrectionWorkRecord): CorrectionWorkRecord {
  return { ...row, processedMemberIds: [...row.processedMemberIds] };
}

function cloneAttempt(row: AttemptRecord): AttemptRecord {
  return {
    ...row,
    answers: row.answers.map((item) => ({ questionId: item.questionId, optionIds: [...item.optionIds] }))
  };
}

export function memoryCorrectionStore(seed: {
  catalog?: CatalogRecord;
  maintenance: MaintenanceConfig;
}): MemoryCorrectionBundle {
  const previews = new Map<string, CorrectionPreviewRecord>();
  const work = new Map<string, CorrectionWorkRecord>();
  const papers = new Map<string, PaperRecord>();
  const versions = new Map<string, PaperVersionRecord>();
  const chunks = new Map<string, PaperChunkRecord>();
  const answers = new Map<string, PaperAnswerRecord>();
  const attempts = new Map<string, AttemptRecord>();
  const events = new Map<string, ScoreEventRecord>();
  const stats = new Map<string, MemberStatsRecord>();
  const bests = new Map<string, PaperBestRecord>();
  const metrics = new Map<string, ScoreMetricRecord>();
  const grants = new Map<string, MedalGrantRecord>();
  const jobs = new Map<string, JobRecord>();
  const categories = new Map<string, CategoryRecord>();
  const idem = new Map<string, IdempotencyRecord>();
  let catalog = seed.catalog ? { ...seed.catalog } : emptyCatalog(new Date());
  let maintenance = seed.maintenance;
  let growth: GrowthConfigRecord | undefined;
  const store: MemoryCorrectionBundle = {
    previews,
    work,
    papers,
    versions,
    chunks,
    answers,
    attempts,
    events,
    stats,
    bests,
    metrics,
    grants,
    jobs,
    get catalog() {
      return catalog;
    },
    set catalog(row) {
      catalog = row;
    },
    get maintenance() {
      return maintenance;
    },
    set maintenance(row) {
      maintenance = row;
    },
    categories,
    get growth() {
      return growth;
    },
    set growth(row) {
      growth = row;
    },
    seedPaper(row) {
      papers.set(row.paperId, { ...row, draftItems: row.draftItems.map((item) => ({ ...item })) });
    },
    seedVersion(row, versionChunks, versionAnswers) {
      versions.set(row.versionId, { ...row, questionIds: [...row.questionIds], questionVersionIds: [...row.questionVersionIds] });
      for (const chunk of versionChunks) chunks.set(chunk.chunkId, chunk);
      for (const answer of versionAnswers) answers.set(answer.chunkId, answer);
    },
    seedAttempt(row) {
      attempts.set(row.attemptId, cloneAttempt(row));
    },
    seedEvent(row) {
      events.set(row.eventId, { ...row });
    },
    seedStats(row) {
      stats.set(row.memberId, { ...row });
    },
    seedBest(row) {
      bests.set(`${row.memberId}:${row.paperId}`, { ...row });
    },
    seedMetric(row) {
      metrics.set(row.metricId, { ...row });
    },
    seedGrant(row) {
      grants.set(row.grantId, { ...row });
    },
    seedCategory(row) {
      categories.set(row.categoryId, { ...row, ancestorIds: [...row.ancestorIds] });
    },
    setCatalog(row) {
      catalog = { ...row };
    },
    setMaintenance(row) {
      maintenance = row;
    },
    putJob(job) {
      jobs.set(job.jobId, { ...job, cursor: { ...job.cursor } });
    },
    async getPreview(previewId) {
      const row = previews.get(previewId);
      return row ? clonePreview(row) : undefined;
    },
    async savePreview(row) {
      previews.set(row.previewId, clonePreview(row));
    },
    async getWork(jobId) {
      const row = work.get(jobId);
      return row ? cloneWork(row) : undefined;
    },
    async saveWork(row) {
      work.set(row.jobId, cloneWork(row));
    },
    async getPaper(paperId) {
      const row = papers.get(paperId);
      return row ? { ...row, draftItems: row.draftItems.map((item) => ({ ...item })) } : undefined;
    },
    async getVersion(versionId) {
      const row = versions.get(versionId);
      return row ? { ...row, questionIds: [...row.questionIds], questionVersionIds: [...row.questionVersionIds] } : undefined;
    },
    async getChunks(version) {
      return version.chunkIds.map((id) => chunks.get(id)).filter((row): row is PaperChunkRecord => Boolean(row));
    },
    async getAnswers(version) {
      return version.answerChunkIds.map((id) => answers.get(id)).filter((row): row is PaperAnswerRecord => Boolean(row));
    },
    async getCatalog() {
      return { ...catalog };
    },
    async getCategory(categoryId) {
      const row = categories.get(categoryId);
      return row ? { ...row, ancestorIds: [...row.ancestorIds] } : undefined;
    },
    async getStats(memberId) {
      const row = stats.get(memberId);
      return row ? { ...row } : undefined;
    },
    async getBest(memberId, paperId) {
      const row = bests.get(`${memberId}:${paperId}`);
      return row ? { ...row } : undefined;
    },
    async getMetric(metricId) {
      const row = metrics.get(metricId);
      return row ? { ...row } : undefined;
    },
    async listGrants(memberId) {
      return [...grants.values()].filter((row) => row.memberId === memberId).map((row) => ({ ...row }));
    },
    async getGrowth() {
      return growth;
    },
    async listSubmittedAttempts(input) {
      return [...attempts.values()]
        .filter(
          (row) =>
            row.paperId === input.paperId &&
            row.state === "submitted" &&
            row.paperVersionId === input.fromVersionId &&
            (!input.memberId || row.memberId === input.memberId) &&
            (!input.afterAttemptId || row.attemptId > input.afterAttemptId)
        )
        .sort((left, right) => left.attemptId.localeCompare(right.attemptId))
        .slice(0, input.limit)
        .map(cloneAttempt);
    },
    async listEvents(memberId, paperId) {
      return [...events.values()]
        .filter((row) => row.memberId === memberId && row.paperId === paperId)
        .sort((left, right) => left.scoreSeq - right.scoreSeq || left.gradeRevision - right.gradeRevision);
    },
    async listDueJobIds(input) {
      return [...jobs.values()]
        .filter((job) => {
          const due = Date.parse(job.nextRunAt) <= input.now.getTime();
          const leaseGone = !job.leaseUntil || Date.parse(job.leaseUntil) <= input.now.getTime();
          return (
            input.types.includes(job.type) &&
            due &&
            (job.state === "queued" || job.state === "retryable" || (job.state === "running" && leaseGone))
          );
        })
        .map((job) => job.jobId);
    },
    async applyMemberRegrade(write) {
      for (const attempt of write.attempts) attempts.set(attempt.attemptId, cloneAttempt(attempt));
      for (const event of write.events) events.set(event.eventId, { ...event });
      if (write.stats) stats.set(write.stats.memberId, { ...write.stats });
      if (write.best) bests.set(`${write.best.memberId}:${write.best.paperId}`, { ...write.best });
      for (const metric of write.metrics) metrics.set(metric.metricId, { ...metric });
      for (const grant of write.grants) grants.set(grant.grantId, { ...grant });
    },
    async transactCommit(input) {
      const started = Date.now();
      const snap: CorrectionCommitSnapshot = {
        preview: previews.get(input.previewId) ? clonePreview(previews.get(input.previewId)!) : undefined,
        job: jobs.get(input.jobId) ? { ...jobs.get(input.jobId)!, cursor: { ...jobs.get(input.jobId)!.cursor } } : undefined,
        work: work.get(input.jobId) ? cloneWork(work.get(input.jobId)!) : undefined,
        maintenance,
        idem: idem.get(input.idempotencyId),
        catalog: { ...catalog }
      };
      const mutation = input.mutate(snap);
      if (!mutation.error) {
        if (mutation.preview) previews.set(mutation.preview.previewId, clonePreview(mutation.preview));
        if (mutation.job) jobs.set(mutation.job.jobId, { ...mutation.job, cursor: { ...mutation.job.cursor } });
        if (mutation.work) work.set(mutation.work.jobId, cloneWork(mutation.work));
        if (mutation.maintenance) maintenance = mutation.maintenance;
        if (mutation.idem) idem.set(mutation.idem.id, mutation.idem);
      }
      return {
        mutation,
        budget: { reads: 6, writes: mutation.error ? 0 : 5, total: mutation.error ? 6 : 11, elapsedMs: Date.now() - started }
      };
    }
  };
  return store;
}

export function emptyCorrectionPlan(partial: Partial<CorrectionPlan> & Pick<CorrectionPlan, "paperId" | "fromVersionId" | "toVersionId">): CorrectionPlan {
  return {
    fromStructureHash: "",
    toStructureHash: "",
    affectedAttemptCount: 0,
    affectedMemberCount: 0,
    warnings: [],
    ...partial
  };
}
