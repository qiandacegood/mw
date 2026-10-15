import {
  emptyCatalog,
  type AuditEntry,
  type CatalogRecord,
  type CategoryChangePreviewRecord,
  type CategoryChangeRef,
  type CategoryRecord,
  type CategoryUsageMap,
  type IdempotencyRecord,
  type JobRecord,
  type MaintenanceConfig,
  type PaperBestRecord,
  type ScoreMetricRecord
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";

export type CatalogChangeWorkRecord = {
  jobId: string;
  previewId: string;
  planHash: string;
  actorId: string;
  reason: string;
  closedAt: string;
  notBefore: string;
  sourceTreeVersion: number;
  targetTreeVersion: number;
  sourceCategoryGeneration: number;
  targetCategoryGeneration: number;
  switched: boolean;
  opened: boolean;
  rankingRegistered: boolean;
  rankingStatus: "pending" | "ok" | "failed";
  rankingError: string;
  beforeSummary: Record<string, unknown>;
  afterSummary: Record<string, unknown>;
  schemaVersion: number;
  updatedAt: string;
};

export type CatalogChangeCommitSnapshot = {
  catalog: CatalogRecord;
  preview?: CategoryChangePreviewRecord;
  job?: JobRecord;
  work?: CatalogChangeWorkRecord;
  maintenance: MaintenanceConfig;
  idem?: IdempotencyRecord;
};

export type CatalogChangeCommitMutation<T> = {
  catalog?: CatalogRecord;
  preview?: CategoryChangePreviewRecord;
  job?: JobRecord;
  work?: CatalogChangeWorkRecord;
  maintenance?: MaintenanceConfig;
  idem?: IdempotencyRecord;
  audit?: AuditEntry;
  result: T;
  error?: { code: string; reason: string; issues?: string[]; details?: Record<string, unknown> };
};

export interface CatalogChangeStore {
  setCatalog?(row: CatalogRecord): void;
  getPreview(previewId: string): Promise<CategoryChangePreviewRecord | undefined>;
  savePreview(row: CategoryChangePreviewRecord): Promise<void>;
  getWork(jobId: string): Promise<CatalogChangeWorkRecord | undefined>;
  saveWork(row: CatalogChangeWorkRecord): Promise<void>;
  listUsage(): Promise<CategoryUsageMap>;
  listPaperBests(): Promise<PaperBestRecord[]>;
  getPaperCategory(paperId: string): Promise<{ paperId: string; categoryId: string } | undefined>;
  relocateQuestion(questionId: string, categoryId: string): Promise<void>;
  relocatePaper(paperId: string, categoryId: string): Promise<void>;
  writeCategoryMetrics(rows: ScoreMetricRecord[]): Promise<void>;
  listDueJobIds(input: { now: Date; types: string[] }): Promise<string[]>;
  transactCommit<T>(input: {
    previewId: string;
    jobId: string;
    idempotencyId: string;
    mutate: (snap: CatalogChangeCommitSnapshot) => CatalogChangeCommitMutation<T>;
  }): Promise<{ mutation: CatalogChangeCommitMutation<T>; budget: TxBudget }>;
}

export type MemoryCatalogChangeBundle = CatalogChangeStore & {
  previews: Map<string, CategoryChangePreviewRecord>;
  work: Map<string, CatalogChangeWorkRecord>;
  questions: Map<string, CategoryChangeRef>;
  papers: Map<string, CategoryChangeRef>;
  bests: Map<string, PaperBestRecord>;
  metrics: Map<string, ScoreMetricRecord>;
  jobs: Map<string, JobRecord>;
  catalog: CatalogRecord;
  maintenance: MaintenanceConfig;
  idem: Map<string, IdempotencyRecord>;
  audits: AuditEntry[];
  seedQuestion(row: CategoryChangeRef): void;
  seedPaper(row: CategoryChangeRef): void;
  seedBest(row: PaperBestRecord): void;
  setCatalog(row: CatalogRecord): void;
  setMaintenance(row: MaintenanceConfig): void;
  putJob(job: JobRecord): void;
};

function clonePreview(row: CategoryChangePreviewRecord): CategoryChangePreviewRecord {
  return { ...row, operations: row.operations.map((op) => ({ ...op })), plan: { ...row.plan, operations: [...row.plan.operations] } };
}

function cloneWork(row: CatalogChangeWorkRecord): CatalogChangeWorkRecord {
  return { ...row, beforeSummary: { ...row.beforeSummary }, afterSummary: { ...row.afterSummary } };
}

export function memoryCatalogChangeStore(seed: {
  catalog?: CatalogRecord;
  maintenance: MaintenanceConfig;
}): MemoryCatalogChangeBundle {
  const previews = new Map<string, CategoryChangePreviewRecord>();
  const work = new Map<string, CatalogChangeWorkRecord>();
  const questions = new Map<string, CategoryChangeRef>();
  const papers = new Map<string, CategoryChangeRef>();
  const bests = new Map<string, PaperBestRecord>();
  const metrics = new Map<string, ScoreMetricRecord>();
  const jobs = new Map<string, JobRecord>();
  const idem = new Map<string, IdempotencyRecord>();
  const audits: AuditEntry[] = [];
  let catalog = seed.catalog ? { ...seed.catalog } : emptyCatalog(new Date("2026-10-15T00:00:00.000Z"));
  let maintenance = { ...seed.maintenance };
  let queue: Promise<unknown> = Promise.resolve();

  const bundle: MemoryCatalogChangeBundle = {
    previews,
    work,
    questions,
    papers,
    bests,
    metrics,
    jobs,
    idem,
    audits,
    get catalog() {
      return { ...catalog };
    },
    set catalog(next) {
      catalog = { ...next };
    },
    get maintenance() {
      return { ...maintenance };
    },
    set maintenance(next) {
      maintenance = { ...next };
    },
    seedQuestion(row) {
      questions.set(row.id, { ...row });
    },
    seedPaper(row) {
      papers.set(row.id, { ...row });
    },
    seedBest(row) {
      bests.set(`${row.memberId}:${row.paperId}`, { ...row });
    },
    setCatalog(row) {
      catalog = { ...row };
    },
    setMaintenance(row) {
      maintenance = { ...row };
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
    async listUsage() {
      const q: CategoryUsageMap["questions"] = {};
      const p: CategoryUsageMap["papers"] = {};
      for (const row of questions.values()) {
        q[row.categoryId] = [...(q[row.categoryId] || []), { ...row }];
      }
      for (const row of papers.values()) {
        p[row.categoryId] = [...(p[row.categoryId] || []), { ...row }];
      }
      return { questions: q, papers: p };
    },
    async listPaperBests() {
      return [...bests.values()].map((row) => ({ ...row }));
    },
    async getPaperCategory(paperId) {
      const row = papers.get(paperId);
      return row ? { paperId: row.id, categoryId: row.categoryId } : undefined;
    },
    async relocateQuestion(questionId, categoryId) {
      const row = questions.get(questionId);
      if (row) questions.set(questionId, { ...row, categoryId });
    },
    async relocatePaper(paperId, categoryId) {
      const row = papers.get(paperId);
      if (row) papers.set(paperId, { ...row, categoryId });
    },
    async writeCategoryMetrics(rows) {
      for (const row of rows) metrics.set(row.metricId, { ...row });
    },
    async listDueJobIds(input) {
      return [...jobs.values()]
        .filter(
          (job) =>
            input.types.includes(job.type) &&
            Date.parse(job.nextRunAt) <= input.now.getTime() &&
            (job.state === "queued" || job.state === "retryable" || (job.state === "running" && job.leaseUntil && Date.parse(job.leaseUntil) <= input.now.getTime()))
        )
        .map((job) => job.jobId);
    },
    transactCommit(input) {
      const run = queue.then(() => {
        const started = Date.now();
        const mutation = input.mutate({
          catalog: { ...catalog },
          preview: previews.get(input.previewId) ? clonePreview(previews.get(input.previewId)!) : undefined,
          job: jobs.get(input.jobId) ? { ...jobs.get(input.jobId)!, cursor: { ...jobs.get(input.jobId)!.cursor } } : undefined,
          work: work.get(input.jobId) ? cloneWork(work.get(input.jobId)!) : undefined,
          maintenance: { ...maintenance },
          idem: input.idempotencyId && idem.has(input.idempotencyId) ? { ...idem.get(input.idempotencyId)! } : undefined
        });
        let writes = 0;
        if (mutation.catalog) {
          catalog = { ...mutation.catalog };
          writes += 1;
        }
        if (mutation.preview) {
          previews.set(mutation.preview.previewId, clonePreview(mutation.preview));
          writes += 1;
        }
        if (mutation.job) {
          jobs.set(mutation.job.jobId, { ...mutation.job, cursor: { ...mutation.job.cursor } });
          writes += 1;
        }
        if (mutation.work) {
          work.set(mutation.work.jobId, cloneWork(mutation.work));
          writes += 1;
        }
        if (mutation.maintenance) {
          maintenance = { ...mutation.maintenance };
          writes += 1;
        }
        if (mutation.idem) {
          idem.set(mutation.idem.id, { ...mutation.idem });
          writes += 1;
        }
        if (mutation.audit) {
          audits.push(mutation.audit);
          writes += 1;
        }
        return {
          mutation,
          budget: { reads: 6, writes, total: 6 + writes, elapsedMs: Date.now() - started }
        };
      });
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  };
  return bundle;
}
