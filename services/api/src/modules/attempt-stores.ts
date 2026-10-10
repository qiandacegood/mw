import type {
  ActiveAttemptRecord,
  AttemptRecord,
  CategoryRecord,
  IdempotencyRecord,
  PaperChunkRecord,
  PaperRecord,
  PaperVersionRecord
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { MemberRecord } from "./member-stores.js";

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

export interface AttemptReadStore {
  getAttempt(attemptId: string): Promise<AttemptRecord | undefined>;
  getActive(memberId: string): Promise<ActiveAttemptRecord | undefined>;
  getPaper(paperId: string): Promise<PaperRecord | undefined>;
  getVersion(versionId: string): Promise<PaperVersionRecord | undefined>;
  getChunk(chunkId: string): Promise<PaperChunkRecord | undefined>;
  getMember(memberId: string): Promise<MemberRecord | undefined>;
  getCategory(categoryId: string): Promise<CategoryRecord | undefined>;
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

export type MemoryAttemptBundle = AttemptWorkStore & {
  attempts: Map<string, AttemptRecord>;
  actives: Map<string, ActiveAttemptRecord>;
  papers: Map<string, PaperRecord>;
  versions: Map<string, PaperVersionRecord>;
  chunks: Map<string, PaperChunkRecord>;
  members: Map<string, MemberRecord>;
  categories: Map<string, CategoryRecord>;
  idem: Map<string, IdempotencyRecord>;
  seedSubmitted(row: AttemptRecord): void;
};

export function memoryAttemptStore(seed: {
  papers?: PaperRecord[];
  versions?: PaperVersionRecord[];
  chunks?: PaperChunkRecord[];
  members?: MemberRecord[];
  categories?: CategoryRecord[];
  attempts?: AttemptRecord[];
  actives?: ActiveAttemptRecord[];
} = {}): MemoryAttemptBundle {
  const attempts = new Map((seed.attempts || []).map((row) => [row.attemptId, cloneAttempt(row)]));
  const actives = new Map((seed.actives || []).map((row) => [row.memberId, cloneActive(row)]));
  const papers = new Map((seed.papers || []).map((row) => [row.paperId, clonePaper(row)]));
  const versions = new Map((seed.versions || []).map((row) => [row.versionId, cloneVersion(row)]));
  const chunks = new Map((seed.chunks || []).map((row) => [row.chunkId, cloneChunk(row)]));
  const members = new Map((seed.members || []).map((row) => [row.memberId, { ...row, consentVersions: { ...row.consentVersions } }]));
  const categories = new Map((seed.categories || []).map((row) => [row.categoryId, { ...row, ancestorIds: [...row.ancestorIds] }]));
  const idem = new Map<string, IdempotencyRecord>();
  let queue: Promise<unknown> = Promise.resolve();

  const store: MemoryAttemptBundle = {
    attempts,
    actives,
    papers,
    versions,
    chunks,
    members,
    categories,
    idem,
    seedSubmitted(row) {
      attempts.set(row.attemptId, cloneAttempt(row));
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
    async getMember(memberId) {
      const row = members.get(memberId);
      return row ? { ...row, consentVersions: { ...row.consentVersions } } : undefined;
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
    }
  };
  return store;
}
