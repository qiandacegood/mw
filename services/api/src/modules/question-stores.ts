import type { AuditEntry, IdempotencyRecord, MediaAssetRecord, QuestionRecord, QuestionVersionRecord } from "@mw/shared";
import type { TxBudget } from "./job-stores.js";

export type QuestionWriteSnapshot = {
  question?: QuestionRecord;
  currentVersion?: QuestionVersionRecord;
  versions: QuestionVersionRecord[];
  assets: MediaAssetRecord[];
  idem?: IdempotencyRecord;
};

export type QuestionWriteMutation<T> = {
  question?: QuestionRecord;
  version?: QuestionVersionRecord;
  idem?: IdempotencyRecord;
  audit?: AuditEntry;
  result: T;
  error?: { code: string; reason: string; issues?: string[]; details?: Record<string, unknown> };
};

export interface QuestionUsageStore {
  paperRefsFor(questionId: string): string[];
  setPaperRefs(questionId: string, paperIds: string[]): void;
}

export interface QuestionReadStore {
  getQuestion(questionId: string): Promise<QuestionRecord | undefined>;
  getVersion(versionId: string): Promise<QuestionVersionRecord | undefined>;
  listQuestions(input: { categoryId?: string; status?: string; limit: number }): Promise<QuestionRecord[]>;
  getAsset(assetId: string): Promise<MediaAssetRecord | undefined>;
}

export interface QuestionWorkStore extends QuestionReadStore {
  transactWrite<T>(input: {
    questionId?: string;
    versionId?: string;
    idempotencyId: string;
    mutate: (snap: QuestionWriteSnapshot) => QuestionWriteMutation<T>;
  }): Promise<{ mutation: QuestionWriteMutation<T>; budget: TxBudget }>;
}

function cloneQuestion(row: QuestionRecord): QuestionRecord {
  return { ...row };
}

function cloneVersion(row: QuestionVersionRecord): QuestionVersionRecord {
  return {
    ...row,
    stem: { text: row.stem.text, assetIds: [...row.stem.assetIds] },
    options: row.options.map((item) => ({ ...item, assetIds: [...item.assetIds] })),
    answer: { optionIds: [...row.answer.optionIds] },
    analysis: { text: row.analysis.text, assetIds: [...row.analysis.assetIds] },
    assetIds: [...row.assetIds]
  };
}

export function memoryQuestionUsage(seed: Record<string, string[]> = {}): QuestionUsageStore & {
  refs: Map<string, string[]>;
} {
  const refs = new Map<string, string[]>(Object.entries(seed).map(([key, value]) => [key, [...value]]));
  return {
    refs,
    paperRefsFor(questionId) {
      return [...(refs.get(questionId) || [])];
    },
    setPaperRefs(questionId, paperIds) {
      refs.set(questionId, [...paperIds]);
    }
  };
}

export function memoryQuestionStore(seed: {
  questions?: QuestionRecord[];
  versions?: QuestionVersionRecord[];
  assets?: MediaAssetRecord[];
} = {}): QuestionWorkStore & {
  questions: Map<string, QuestionRecord>;
  versions: Map<string, QuestionVersionRecord>;
  assets: Map<string, MediaAssetRecord>;
  idem: Map<string, IdempotencyRecord>;
  audits: AuditEntry[];
} {
  const questions = new Map((seed.questions || []).map((row) => [row.questionId, cloneQuestion(row)]));
  const versions = new Map((seed.versions || []).map((row) => [row.versionId, cloneVersion(row)]));
  const assets = new Map((seed.assets || []).map((row) => [row.assetId, { ...row }]));
  const idem = new Map<string, IdempotencyRecord>();
  const audits: AuditEntry[] = [];
  let queue: Promise<unknown> = Promise.resolve();

  const store: QuestionWorkStore & {
    questions: Map<string, QuestionRecord>;
    versions: Map<string, QuestionVersionRecord>;
    assets: Map<string, MediaAssetRecord>;
    idem: Map<string, IdempotencyRecord>;
    audits: AuditEntry[];
  } = {
    questions,
    versions,
    assets,
    idem,
    audits,
    async getQuestion(questionId) {
      const row = questions.get(questionId);
      return row ? cloneQuestion(row) : undefined;
    },
    async getVersion(versionId) {
      const row = versions.get(versionId);
      return row ? cloneVersion(row) : undefined;
    },
    async listQuestions(input) {
      return [...questions.values()]
        .filter((row) => !input.categoryId || row.categoryId === input.categoryId)
        .filter((row) => !input.status || row.status === input.status)
        .sort((left, right) => {
          if (left.categoryId !== right.categoryId) return left.categoryId.localeCompare(right.categoryId);
          if (left.status !== right.status) return left.status.localeCompare(right.status);
          if (left.updatedAt !== right.updatedAt) return right.updatedAt.localeCompare(left.updatedAt);
          return left.questionId.localeCompare(right.questionId);
        })
        .slice(0, input.limit)
        .map(cloneQuestion);
    },
    async getAsset(assetId) {
      const row = assets.get(assetId);
      return row ? { ...row } : undefined;
    },
    transactWrite(input) {
      const run = queue.then(() => {
        const started = Date.now();
        const question = input.questionId ? questions.get(input.questionId) : undefined;
        const currentVersion = question ? versions.get(question.currentVersionId) : undefined;
        const mutation = input.mutate({
          question: question ? cloneQuestion(question) : undefined,
          currentVersion: currentVersion ? cloneVersion(currentVersion) : undefined,
          versions: [...versions.values()]
            .filter((row) => !input.questionId || row.questionId === input.questionId)
            .map(cloneVersion),
          assets: [...assets.values()].map((row) => ({ ...row })),
          idem: input.idempotencyId && idem.has(input.idempotencyId) ? { ...idem.get(input.idempotencyId)! } : undefined
        });
        let writes = 0;
        if (mutation.question) {
          questions.set(mutation.question.questionId, cloneQuestion(mutation.question));
          writes += 1;
        }
        if (mutation.version) {
          if (versions.has(mutation.version.versionId)) {
            throw new Error("QUESTION_VERSION_IMMUTABLE");
          }
          versions.set(mutation.version.versionId, cloneVersion(mutation.version));
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
          budget: { reads: 4, writes, total: 4 + writes, elapsedMs: Date.now() - started }
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
