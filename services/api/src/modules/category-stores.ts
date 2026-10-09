import {
  emptyCatalog,
  type CatalogRecord,
  type CategoryNameRecord,
  type CategoryRecord
} from "@mw/shared";
import type { AuditEntry, IdempotencyRecord } from "@mw/shared";
import type { TxBudget } from "./job-stores.js";

export type CategoryUsageCounts = {
  questionRefs: number;
  paperRefs: number;
};

export interface CategoryUsageStore {
  refsFor(categoryId: string): CategoryUsageCounts | Promise<CategoryUsageCounts>;
  setPaperRefs(categoryId: string, paperIds: string[]): void;
  setQuestionRefs(categoryId: string, questionIds: string[]): void;
}

export type CategoryWriteSnapshot = {
  catalog: CatalogRecord;
  category?: CategoryRecord;
  parent?: CategoryRecord;
  nameSlot?: CategoryNameRecord;
  nextNameSlot?: CategoryNameRecord;
  children: CategoryRecord[];
  all: CategoryRecord[];
  names: CategoryNameRecord[];
  idem?: IdempotencyRecord;
};

export type CategoryWriteMutation<T> = {
  catalog?: CatalogRecord;
  category?: CategoryRecord;
  nameSlot?: CategoryNameRecord;
  removeNameId?: string;
  extraCategories?: CategoryRecord[];
  extraNameSlots?: CategoryNameRecord[];
  idem?: IdempotencyRecord;
  audit?: AuditEntry;
  result: T;
  error?: { code: string; reason: string; issues?: string[]; details?: Record<string, unknown> };
};

export interface CategoryReadStore {
  getCatalog(): Promise<CatalogRecord>;
  getCategory(categoryId: string): Promise<CategoryRecord | undefined>;
  listActive(): Promise<CategoryRecord[]>;
}

export interface CategoryWorkStore extends CategoryReadStore {
  transactWrite<T>(input: {
    categoryId?: string;
    parentId?: string | null;
    nameId?: string;
    nextNameId?: string;
    idempotencyId: string;
    mutate: (snap: CategoryWriteSnapshot) => CategoryWriteMutation<T>;
  }): Promise<{ mutation: CategoryWriteMutation<T>; budget: TxBudget }>;
}

function cloneCatalog(row: CatalogRecord): CatalogRecord {
  return { ...row };
}

function cloneCategory(row: CategoryRecord): CategoryRecord {
  return { ...row, ancestorIds: [...row.ancestorIds] };
}

function cloneName(row: CategoryNameRecord): CategoryNameRecord {
  return { ...row };
}

export function memoryCategoryUsage(seed: { papers?: Record<string, string[]>; questions?: Record<string, string[]> } = {}): CategoryUsageStore {
  const papers = new Map<string, string[]>(Object.entries(seed.papers || {}).map(([key, value]) => [key, [...value]]));
  const questions = new Map<string, string[]>(
    Object.entries(seed.questions || {}).map(([key, value]) => [key, [...value]])
  );
  return {
    refsFor(categoryId) {
      return {
        paperRefs: papers.get(categoryId)?.length ?? 0,
        questionRefs: questions.get(categoryId)?.length ?? 0
      };
    },
    setPaperRefs(categoryId, paperIds) {
      papers.set(categoryId, [...paperIds]);
    },
    setQuestionRefs(categoryId, questionIds) {
      questions.set(categoryId, [...questionIds]);
    }
  };
}

export function emptyCategoryUsage(): CategoryUsageStore {
  return memoryCategoryUsage();
}

export function memoryCategoryStore(seed: CategoryRecord[] = [], catalog?: CatalogRecord): CategoryWorkStore & {
  categories: Map<string, CategoryRecord>;
  names: Map<string, CategoryNameRecord>;
  idem: Map<string, IdempotencyRecord>;
  audits: AuditEntry[];
} {
  const categories = new Map(seed.map((row) => [row.categoryId, cloneCategory(row)]));
  const names = new Map<string, CategoryNameRecord>();
  const idem = new Map<string, IdempotencyRecord>();
  const audits: AuditEntry[] = [];
  let currentCatalog = catalog ? cloneCatalog(catalog) : emptyCatalog(new Date("2026-10-09T00:00:00.000Z"));
  let queue: Promise<unknown> = Promise.resolve();

  function childrenOf(parentId: string): CategoryRecord[] {
    return [...categories.values()]
      .filter((row) => row.parentId === parentId && !row.deletedAt)
      .map(cloneCategory);
  }

  const store: CategoryWorkStore & {
    categories: Map<string, CategoryRecord>;
    names: Map<string, CategoryNameRecord>;
    idem: Map<string, IdempotencyRecord>;
    audits: AuditEntry[];
  } = {
    categories,
    names,
    idem,
    audits,
    async getCatalog() {
      return cloneCatalog(currentCatalog);
    },
    async getCategory(categoryId) {
      const row = categories.get(categoryId);
      return row ? cloneCategory(row) : undefined;
    },
    async listActive() {
      return [...categories.values()].filter((row) => !row.deletedAt).map(cloneCategory);
    },
    transactWrite(input) {
      const run = queue.then(() => {
        const started = Date.now();
        const category = input.categoryId ? categories.get(input.categoryId) : undefined;
        const parent =
          input.parentId && input.parentId.length > 0 ? categories.get(input.parentId) : undefined;
        const nameSlot = input.nameId ? names.get(input.nameId) : undefined;
        const nextNameSlot = input.nextNameId ? names.get(input.nextNameId) : undefined;
        const mutation = input.mutate({
          catalog: cloneCatalog(currentCatalog),
          category: category ? cloneCategory(category) : undefined,
          parent: parent ? cloneCategory(parent) : undefined,
          nameSlot: nameSlot ? cloneName(nameSlot) : undefined,
          nextNameSlot: nextNameSlot ? cloneName(nextNameSlot) : undefined,
          children: input.categoryId ? childrenOf(input.categoryId) : [],
          all: [...categories.values()].map(cloneCategory),
          names: [...names.values()].map(cloneName),
          idem: input.idempotencyId && idem.has(input.idempotencyId) ? { ...idem.get(input.idempotencyId)! } : undefined
        });
        let writes = 0;
        if (mutation.catalog) {
          currentCatalog = cloneCatalog(mutation.catalog);
          writes += 1;
        }
        if (mutation.category) {
          categories.set(mutation.category.categoryId, cloneCategory(mutation.category));
          writes += 1;
        }
        for (const extra of mutation.extraCategories || []) {
          categories.set(extra.categoryId, cloneCategory(extra));
          writes += 1;
        }
        if (mutation.removeNameId) {
          names.delete(mutation.removeNameId);
          writes += 1;
        }
        if (mutation.nameSlot) {
          names.set(mutation.nameSlot.nameId, cloneName(mutation.nameSlot));
          writes += 1;
        }
        for (const extra of mutation.extraNameSlots || []) {
          names.set(extra.nameId, cloneName(extra));
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
          budget: {
            reads: 6,
            writes,
            total: 6 + writes,
            elapsedMs: Date.now() - started
          }
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
