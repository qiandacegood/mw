import {
  paperBestId,
  type ActiveAttemptRecord,
  type AttemptRecord,
  type CategoryRecord,
  type IdempotencyRecord,
  type MaintenanceConfig,
  type PaperAnswerRecord,
  type PaperBestRecord,
  type PaperChunkRecord,
  type PaperRecord,
  type PaperVersionRecord,
  type ScoreEventRecord,
  type ScoreMetricRecord
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { MemberRecord, MemberStatsRecord } from "./member-stores.js";

export type AttemptWriteSnapshot = {
  member?: MemberRecord;
  attempt?: AttemptRecord;
  oldAttempt?: AttemptRecord;
  active?: ActiveAttemptRecord;
  paper?: PaperRecord;
  version?: PaperVersionRecord;
  category?: CategoryRecord;
  idem?: IdempotencyRecord;
};

export type AttemptWriteMutation<T> = {
  attempt?: AttemptRecord;
  oldAttempt?: AttemptRecord;
  active?: ActiveAttemptRecord | null;
  idem?: IdempotencyRecord;
  result: T;
  error?: { code: string; reason: string; issues?: string[]; details?: Record<string, unknown> };
  replayed?: boolean;
};

export type SubmitWriteSnapshot = AttemptWriteSnapshot & {
  maintenance?: MaintenanceConfig;
  stats?: MemberStatsRecord;
  best?: PaperBestRecord;
  metrics: ScoreMetricRecord[];
};

export type SubmitWriteMutation<T> = AttemptWriteMutation<T> & {
  stats?: MemberStatsRecord;
  best?: PaperBestRecord;
  event?: ScoreEventRecord;
  metrics?: ScoreMetricRecord[];
};

export interface AttemptReadStore {
  getAttempt(attemptId: string): Promise<AttemptRecord | undefined>;
  getActive(memberId: string): Promise<ActiveAttemptRecord | undefined>;
  getPaper(paperId: string): Promise<PaperRecord | undefined>;
  getVersion(versionId: string): Promise<PaperVersionRecord | undefined>;
  getChunk(chunkId: string): Promise<PaperChunkRecord | undefined>;
  getAnswer(chunkId: string): Promise<PaperAnswerRecord | undefined>;
  getMember(memberId: string): Promise<MemberRecord | undefined>;
  getCategory(categoryId: string): Promise<CategoryRecord | undefined>;
  getStats(memberId: string): Promise<MemberStatsRecord | undefined>;
  getBest(memberId: string, paperId: string): Promise<PaperBestRecord | undefined>;
  listSubmittedAttempts(input: {
    memberId: string;
    paperId?: string;
    after?: { submittedAt: string; attemptId: string };
    limit: number;
  }): Promise<AttemptRecord[]>;
}

export interface AttemptWorkStore extends AttemptReadStore {
  transactWrite<T>(input: {
    memberId: string;
    attemptId?: string;
    oldAttemptId?: string;
    paperId?: string;
    idempotencyId: string;
    mutate: (snap: AttemptWriteSnapshot) => AttemptWriteMutation<T>;
  }): Promise<{ mutation: AttemptWriteMutation<T>; budget: TxBudget }>;
  transactSubmit<T>(input: {
    memberId: string;
    attemptId: string;
    paperId?: string;
    idempotencyId: string;
    bestId: string;
    metricIds: string[];
    mutate: (snap: SubmitWriteSnapshot) => SubmitWriteMutation<T>;
  }): Promise<{ mutation: SubmitWriteMutation<T>; budget: TxBudget }>;
}

function cloneAttempt(row: AttemptRecord): AttemptRecord {
  return {
    ...row,
    answers: row.answers.map((item) => ({ questionId: item.questionId, optionIds: [...item.optionIds] }))
  };
}

function cloneActive(row: ActiveAttemptRecord): ActiveAttemptRecord {
  return { ...row };
}

function clonePaper(row: PaperRecord): PaperRecord {
  return { ...row, draftItems: row.draftItems.map((item) => ({ ...item })) };
}

function cloneVersion(row: PaperVersionRecord): PaperVersionRecord {
  return {
    ...row,
    chunkIds: [...row.chunkIds],
    answerChunkIds: [...row.answerChunkIds],
    chunkDigests: [...row.chunkDigests],
    answerDigests: [...row.answerDigests],
    categoryPathSnapshot: [...row.categoryPathSnapshot],
    questionIds: [...row.questionIds],
    questionVersionIds: [...row.questionVersionIds]
  };
}

function cloneChunk(row: PaperChunkRecord): PaperChunkRecord {
  return {
    ...row,
    items: row.items.map((item) => ({
      ...item,
      stem: { text: item.stem.text, assetIds: [...item.stem.assetIds] },
      options: item.options.map((option) => ({ ...option, assetIds: [...option.assetIds] }))
    }))
  };
}

function cloneAnswer(row: PaperAnswerRecord): PaperAnswerRecord {
  return {
    ...row,
    items: row.items.map((item) => ({
      ...item,
      answer: { optionIds: [...item.answer.optionIds] },
      analysis: { text: item.analysis.text, assetIds: [...item.analysis.assetIds] }
    }))
  };
}

function cloneStats(row: MemberStatsRecord): MemberStatsRecord {
  return { ...row };
}

function cloneBest(row: PaperBestRecord): PaperBestRecord {
  return { ...row };
}

function cloneEvent(row: ScoreEventRecord): ScoreEventRecord {
  return { ...row };
}

function cloneMetric(row: ScoreMetricRecord): ScoreMetricRecord {
  return { ...row };
}

function historyAfter(row: AttemptRecord, after?: { submittedAt: string; attemptId: string }): boolean {
  if (!after) return true;
  if (row.submittedAt < after.submittedAt) return true;
  if (row.submittedAt > after.submittedAt) return false;
  return row.attemptId < after.attemptId;
}

export type MemoryAttemptBundle = AttemptWorkStore & {
  attempts: Map<string, AttemptRecord>;
  actives: Map<string, ActiveAttemptRecord>;
  papers: Map<string, PaperRecord>;
  versions: Map<string, PaperVersionRecord>;
  chunks: Map<string, PaperChunkRecord>;
  answers: Map<string, PaperAnswerRecord>;
  members: Map<string, MemberRecord>;
  categories: Map<string, CategoryRecord>;
  stats: Map<string, MemberStatsRecord>;
  bests: Map<string, PaperBestRecord>;
  events: Map<string, ScoreEventRecord>;
  metrics: Map<string, ScoreMetricRecord>;
  idem: Map<string, IdempotencyRecord>;
  maintenance?: MaintenanceConfig;
  seedSubmitted(row: AttemptRecord): void;
  linkMemberStats(stats: Map<string, MemberStatsRecord>): void;
};

export function memoryAttemptStore(seed: {
  papers?: PaperRecord[];
  versions?: PaperVersionRecord[];
  chunks?: PaperChunkRecord[];
  answers?: PaperAnswerRecord[];
  members?: MemberRecord[];
  categories?: CategoryRecord[];
  attempts?: AttemptRecord[];
  actives?: ActiveAttemptRecord[];
  stats?: MemberStatsRecord[] | Map<string, MemberStatsRecord>;
} = {}): MemoryAttemptBundle {
  const attempts = new Map((seed.attempts || []).map((row) => [row.attemptId, cloneAttempt(row)]));
  const actives = new Map((seed.actives || []).map((row) => [row.memberId, cloneActive(row)]));
  const papers = new Map((seed.papers || []).map((row) => [row.paperId, clonePaper(row)]));
  const versions = new Map((seed.versions || []).map((row) => [row.versionId, cloneVersion(row)]));
  const chunks = new Map((seed.chunks || []).map((row) => [row.chunkId, cloneChunk(row)]));
  const answers = new Map((seed.answers || []).map((row) => [row.chunkId, cloneAnswer(row)]));
  const members = new Map((seed.members || []).map((row) => [row.memberId, { ...row, consentVersions: { ...row.consentVersions } }]));
  const categories = new Map((seed.categories || []).map((row) => [row.categoryId, { ...row, ancestorIds: [...row.ancestorIds] }]));
  const stats =
    seed.stats instanceof Map
      ? seed.stats
      : new Map((seed.stats || []).map((row) => [row.memberId, cloneStats(row)]));
  const bests = new Map<string, PaperBestRecord>();
  const events = new Map<string, ScoreEventRecord>();
  const metrics = new Map<string, ScoreMetricRecord>();
  const idem = new Map<string, IdempotencyRecord>();
  let queue: Promise<unknown> = Promise.resolve();

  const store: MemoryAttemptBundle = {
    attempts,
    actives,
    papers,
    versions,
    chunks,
    answers,
    members,
    categories,
    stats,
    bests,
    events,
    metrics,
    idem,
    seedSubmitted(row) {
      attempts.set(row.attemptId, cloneAttempt(row));
    },
    linkMemberStats(next) {
      store.stats = next;
    },
    async getAttempt(attemptId) {
      const row = attempts.get(attemptId);
      return row ? cloneAttempt(row) : undefined;
    },
    async getActive(memberId) {
      const row = actives.get(memberId);
      return row ? cloneActive(row) : undefined;
    },
    async getPaper(paperId) {
      const row = papers.get(paperId);
      return row ? clonePaper(row) : undefined;
    },
    async getVersion(versionId) {
      const row = versions.get(versionId);
      return row ? cloneVersion(row) : undefined;
    },
    async getChunk(chunkId) {
      const row = chunks.get(chunkId);
      return row ? cloneChunk(row) : undefined;
    },
    async getAnswer(chunkId) {
      const row = answers.get(chunkId);
      return row ? cloneAnswer(row) : undefined;
    },
    async listSubmittedAttempts(input) {
      return [...attempts.values()]
        .filter((row) => row.memberId === input.memberId && row.state === "submitted")
        .filter((row) => (input.paperId ? row.paperId === input.paperId : true))
        .filter((row) => historyAfter(row, input.after))
        .sort((left, right) => {
          if (left.submittedAt === right.submittedAt) return right.attemptId.localeCompare(left.attemptId);
          return right.submittedAt.localeCompare(left.submittedAt);
        })
        .slice(0, input.limit)
        .map(cloneAttempt);
    },
    async getMember(memberId) {
      const row = members.get(memberId);
      return row ? { ...row, consentVersions: { ...row.consentVersions } } : undefined;
    },
    async getStats(memberId) {
      const row = store.stats.get(memberId);
      return row ? cloneStats(row) : undefined;
    },
    async getBest(memberId, paperId) {
      const row = bests.get(paperBestId(memberId, paperId));
      return row ? cloneBest(row) : undefined;
    },
    async getCategory(categoryId) {
      const row = categories.get(categoryId);
      return row ? { ...row, ancestorIds: [...row.ancestorIds] } : undefined;
    },
    transactWrite(input) {
      const run = queue.then(() => {
        const started = Date.now();
        const member = members.get(input.memberId);
        const attempt = input.attemptId ? attempts.get(input.attemptId) : undefined;
        const oldAttempt = input.oldAttemptId ? attempts.get(input.oldAttemptId) : undefined;
        const paper = input.paperId
          ? papers.get(input.paperId)
          : attempt
            ? papers.get(attempt.paperId)
            : undefined;
        const versionId = attempt?.paperVersionId || paper?.activeVersionId;
        const version = versionId ? versions.get(versionId) : undefined;
        const category = paper ? categories.get(paper.categoryId) : undefined;
        const mutation = input.mutate({
          member: member ? { ...member, consentVersions: { ...member.consentVersions } } : undefined,
          attempt: attempt ? cloneAttempt(attempt) : undefined,
          oldAttempt: oldAttempt ? cloneAttempt(oldAttempt) : undefined,
          active: actives.get(input.memberId) ? cloneActive(actives.get(input.memberId)!) : undefined,
          paper: paper ? clonePaper(paper) : undefined,
          version: version ? cloneVersion(version) : undefined,
          category: category ? { ...category, ancestorIds: [...category.ancestorIds] } : undefined,
          idem: input.idempotencyId && idem.has(input.idempotencyId) ? { ...idem.get(input.idempotencyId)! } : undefined
        });
        let writes = 0;
        if (mutation.error) {
          return {
            mutation,
            budget: { reads: 7, writes: 0, total: 7, elapsedMs: Date.now() - started }
          };
        }
        if (mutation.oldAttempt) {
          attempts.set(mutation.oldAttempt.attemptId, cloneAttempt(mutation.oldAttempt));
          writes += 1;
        }
        if (mutation.attempt) {
          attempts.set(mutation.attempt.attemptId, cloneAttempt(mutation.attempt));
          writes += 1;
        }
        if (mutation.active === null) {
          actives.delete(input.memberId);
          writes += 1;
        } else if (mutation.active) {
          actives.set(mutation.active.memberId, cloneActive(mutation.active));
          writes += 1;
        }
        if (mutation.idem) {
          idem.set(mutation.idem.id, { ...mutation.idem });
          writes += 1;
        }
        return {
          mutation,
          budget: { reads: 7, writes, total: 7 + writes, elapsedMs: Date.now() - started }
        };
      });
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
    transactSubmit(input) {
      const run = queue.then(() => {
        const started = Date.now();
        const member = members.get(input.memberId);
        const attempt = attempts.get(input.attemptId);
        const paper = input.paperId
          ? papers.get(input.paperId)
          : attempt
            ? papers.get(attempt.paperId)
            : undefined;
        const versionId = attempt?.paperVersionId || paper?.activeVersionId;
        const version = versionId ? versions.get(versionId) : undefined;
        const category = paper ? categories.get(paper.categoryId) : undefined;
        const mutation = input.mutate({
          member: member ? { ...member, consentVersions: { ...member.consentVersions } } : undefined,
          attempt: attempt ? cloneAttempt(attempt) : undefined,
          active: actives.get(input.memberId) ? cloneActive(actives.get(input.memberId)!) : undefined,
          paper: paper ? clonePaper(paper) : undefined,
          version: version ? cloneVersion(version) : undefined,
          category: category ? { ...category, ancestorIds: [...category.ancestorIds] } : undefined,
          idem: input.idempotencyId && idem.has(input.idempotencyId) ? { ...idem.get(input.idempotencyId)! } : undefined,
          maintenance: store.maintenance,
          stats: store.stats.get(input.memberId) ? cloneStats(store.stats.get(input.memberId)!) : undefined,
          best: bests.get(input.bestId) ? cloneBest(bests.get(input.bestId)!) : undefined,
          metrics: input.metricIds.map((id) => metrics.get(id)).filter((row): row is ScoreMetricRecord => Boolean(row)).map(cloneMetric)
        });
        let writes = 0;
        if (mutation.error) {
          return {
            mutation,
            budget: { reads: 16, writes: 0, total: 16, elapsedMs: Date.now() - started }
          };
        }
        if (mutation.attempt) {
          attempts.set(mutation.attempt.attemptId, cloneAttempt(mutation.attempt));
          writes += 1;
        }
        if (mutation.active === null) {
          actives.delete(input.memberId);
          writes += 1;
        } else if (mutation.active) {
          actives.set(mutation.active.memberId, cloneActive(mutation.active));
          writes += 1;
        }
        if (mutation.stats) {
          store.stats.set(mutation.stats.memberId, cloneStats(mutation.stats));
          writes += 1;
        }
        if (mutation.best) {
          bests.set(input.bestId, cloneBest(mutation.best));
          writes += 1;
        }
        if (mutation.event) {
          events.set(mutation.event.eventId, cloneEvent(mutation.event));
          writes += 1;
        }
        for (const metric of mutation.metrics || []) {
          metrics.set(metric.metricId, cloneMetric(metric));
          writes += 1;
        }
        if (mutation.idem) {
          idem.set(mutation.idem.id, { ...mutation.idem });
          writes += 1;
        }
        return {
          mutation,
          budget: { reads: 16, writes, total: 16 + writes, elapsedMs: Date.now() - started }
        };
      });
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  };
  return store;
}
