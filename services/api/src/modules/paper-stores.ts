import type {
  AuditEntry,
  IdempotencyRecord,
  MediaAssetRecord,
  PaperAnswerRecord,
  PaperChunkRecord,
  PaperRecord,
  PaperStatus,
  PaperVersionRecord,
  QuestionRecord,
  QuestionVersionRecord
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";

export type PaperWriteSnapshot = {
  paper?: PaperRecord;
  activeVersion?: PaperVersionRecord;
  versions: PaperVersionRecord[];
  chunks: PaperChunkRecord[];
  answers: PaperAnswerRecord[];
  idem?: IdempotencyRecord;
};

export type PaperWriteMutation<T> = {
  paper?: PaperRecord;
  version?: PaperVersionRecord;
  chunks?: PaperChunkRecord[];
  answers?: PaperAnswerRecord[];
  idem?: IdempotencyRecord;
  audit?: AuditEntry;
  result: T;
  error?: { code: string; reason: string; issues?: string[]; details?: Record<string, unknown> };
};

export interface PaperReadStore {
  getPaper(paperId: string): Promise<PaperRecord | undefined>;
  getVersion(versionId: string): Promise<PaperVersionRecord | undefined>;
  getChunk(chunkId: string): Promise<PaperChunkRecord | undefined>;
  getAnswer(chunkId: string): Promise<PaperAnswerRecord | undefined>;
  listPapers(input: {
    categoryId?: string;
    categoryIds?: string[];
    status?: PaperStatus;
    difficulty?: string;
    access?: string;
    sort: "latest" | "recommended";
    limit: number;
  }): Promise<PaperRecord[]>;
  listPublishedVersions(): Promise<PaperVersionRecord[]>;
  listVersionsForPaper(paperId: string): Promise<PaperVersionRecord[]>;
}

export interface PaperQuestionLookup {
  getQuestion(questionId: string): Promise<QuestionRecord | undefined>;
  getQuestionVersion(versionId: string): Promise<QuestionVersionRecord | undefined>;
  getAsset(assetId: string): Promise<MediaAssetRecord | undefined>;
}

export interface PaperWorkStore extends PaperReadStore {
  transactWrite<T>(input: {
    paperId?: string;
    versionId?: string;
    idempotencyId: string;
    mutate: (snap: PaperWriteSnapshot) => PaperWriteMutation<T>;
  }): Promise<{ mutation: PaperWriteMutation<T>; budget: TxBudget }>;
}

function clonePaper(row: PaperRecord): PaperRecord {
  return {
    ...row,
    draftItems: row.draftItems.map((item) => ({ ...item }))
  };
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

export function memoryPaperStore(seed: {
  papers?: PaperRecord[];
  versions?: PaperVersionRecord[];
  chunks?: PaperChunkRecord[];
  answers?: PaperAnswerRecord[];
} = {}): PaperWorkStore & {
  papers: Map<string, PaperRecord>;
  versions: Map<string, PaperVersionRecord>;
  chunks: Map<string, PaperChunkRecord>;
  answers: Map<string, PaperAnswerRecord>;
  idem: Map<string, IdempotencyRecord>;
  audits: AuditEntry[];
} {
  const papers = new Map((seed.papers || []).map((row) => [row.paperId, clonePaper(row)]));
  const versions = new Map((seed.versions || []).map((row) => [row.versionId, cloneVersion(row)]));
  const chunks = new Map((seed.chunks || []).map((row) => [row.chunkId, cloneChunk(row)]));
  const answers = new Map((seed.answers || []).map((row) => [row.chunkId, cloneAnswer(row)]));
  const idem = new Map<string, IdempotencyRecord>();
  const audits: AuditEntry[] = [];
  let queue: Promise<unknown> = Promise.resolve();

  const store: PaperWorkStore & {
    papers: Map<string, PaperRecord>;
    versions: Map<string, PaperVersionRecord>;
    chunks: Map<string, PaperChunkRecord>;
    answers: Map<string, PaperAnswerRecord>;
    idem: Map<string, IdempotencyRecord>;
    audits: AuditEntry[];
  } = {
    papers,
    versions,
    chunks,
    answers,
    idem,
    audits,
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
    async listPapers(input) {
      return [...papers.values()]
        .filter((row) => {
          if (input.categoryIds && input.categoryIds.length) return input.categoryIds.includes(row.categoryId);
          if (input.categoryId) return row.categoryId === input.categoryId;
          return true;
        })
        .filter((row) => !input.status || row.status === input.status)
        .filter((row) => !input.difficulty || row.difficulty === input.difficulty)
        .filter((row) => !input.access || row.access === input.access)
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
        .slice(0, input.limit)
        .map(clonePaper);
    },
    async listPublishedVersions() {
      const publishedIds = new Set(
        [...papers.values()]
          .filter((row) => row.activeVersionId && row.status !== "draft")
          .map((row) => row.activeVersionId as string)
      );
      return [...versions.values()].filter((row) => publishedIds.has(row.versionId)).map(cloneVersion);
    },
    async listVersionsForPaper(paperId) {
      return [...versions.values()].filter((row) => row.paperId === paperId).map(cloneVersion);
    },
    transactWrite(input) {
      const run = queue.then(() => {
        const started = Date.now();
        const paper = input.paperId ? papers.get(input.paperId) : undefined;
        const activeVersion = paper?.activeVersionId ? versions.get(paper.activeVersionId) : undefined;
        const mutation = input.mutate({
          paper: paper ? clonePaper(paper) : undefined,
          activeVersion: activeVersion ? cloneVersion(activeVersion) : undefined,
          versions: [...versions.values()]
            .filter((row) => !input.paperId || row.paperId === input.paperId)
            .map(cloneVersion),
          chunks: [...chunks.values()].map(cloneChunk),
          answers: [...answers.values()].map(cloneAnswer),
          idem: input.idempotencyId && idem.has(input.idempotencyId) ? { ...idem.get(input.idempotencyId)! } : undefined
        });
        let writes = 0;
        if (mutation.paper) {
          papers.set(mutation.paper.paperId, clonePaper(mutation.paper));
          writes += 1;
        }
        if (mutation.version) {
          if (versions.has(mutation.version.versionId)) {
            throw new Error("PAPER_VERSION_IMMUTABLE");
          }
          versions.set(mutation.version.versionId, cloneVersion(mutation.version));
          writes += 1;
        }
        for (const chunk of mutation.chunks || []) {
          if (chunks.has(chunk.chunkId)) throw new Error("PAPER_VERSION_IMMUTABLE");
          chunks.set(chunk.chunkId, cloneChunk(chunk));
          writes += 1;
        }
        for (const answer of mutation.answers || []) {
          if (answers.has(answer.chunkId)) throw new Error("PAPER_VERSION_IMMUTABLE");
          answers.set(answer.chunkId, cloneAnswer(answer));
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
  return store;
}
