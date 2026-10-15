import {
  CATALOG_CHANGE_JOB_TYPE,
  RANKING_REFRESH_CATEGORY_JOB_TYPE,
  acquireLease,
  assertWritableLease,
  categoryMetricGenerationKey,
  categoryMetricIdsOf,
  categoryNameId,
  drainReady,
  markFailed,
  markSucceeded,
  openCatalogChangeGatesIfOwned,
  saveCursor,
  scoreMetricId,
  validateParentAssignment,
  type CatalogRecord,
  type CategoryRecord,
  type JobRecord,
  type ScoreMetricRecord
} from "@mw/shared";
import type { CategoryWorkStore } from "./category-stores.js";
import type { CatalogChangeStore, CatalogChangeWorkRecord } from "./category-change-stores.js";
import type { JobStore, MaintenanceStore } from "./job-stores.js";
import { rebuildRanking } from "./ranking.js";
import { emptyRankingRuntime, type RankingWorkStore } from "./ranking-stores.js";

export const CATALOG_CHANGE_LEASE_MS = 40_000;
export const CATALOG_CHANGE_BATCH = 8;

export type CatalogTickResult = {
  ok: boolean;
  reason?: string;
  jobId?: string;
  stage?: string;
  pendingUntil?: string;
  fencingToken?: number;
  switched?: boolean;
  rankingStatus?: string;
};

function workCursor(job: JobRecord): { done: number; total: number; stage: string; offset: number } {
  const stage = typeof job.cursor.stage === "string" ? job.cursor.stage : "drain";
  return { done: job.cursor.done, total: job.cursor.total || 6, stage, offset: job.cursor.offset ?? 0 };
}

async function writeJob(store: JobStore, jobId: string, token: number, now: Date, apply: (job: JobRecord) => ReturnType<typeof saveCursor> | ReturnType<typeof markSucceeded> | ReturnType<typeof markFailed>) {
  return store.transact(jobId, (job) => {
    if (!job) return { error: "NOT_FOUND", result: undefined };
    const writable = assertWritableLease(job, token, now);
    if (!writable.ok) return { error: writable.reason, result: undefined, job };
    const next = apply(job);
    if (!next.ok) return { error: next.reason, result: undefined, job };
    return { job: next.job, result: next.job };
  });
}

async function applyStructureBatch(input: {
  category: CategoryWorkStore;
  change: CatalogChangeStore;
  work: CatalogChangeWorkRecord;
  jobId: string;
  token: number;
  now: Date;
}): Promise<{ done: boolean; offset: number }> {
  const preview = await input.change.getPreview(input.work.previewId);
  if (!preview) return { done: true, offset: 0 };
  const plan = preview.plan;
  const items: Array<{ kind: "move" | "question" | "paper" | "delete"; index: number }> = [];
  plan.moves.forEach((_, index) => items.push({ kind: "move", index }));
  plan.relocatedQuestions.forEach((_, index) => items.push({ kind: "question", index }));
  plan.relocatedPapers.forEach((_, index) => items.push({ kind: "paper", index }));
  plan.deletes.forEach((_, index) => items.push({ kind: "delete", index }));
  let offset = 0;
  // offset is stored on job cursor; caller passes via work.afterSummary.applyOffset
  offset = typeof input.work.afterSummary.applyOffset === "number" ? input.work.afterSummary.applyOffset : 0;
  const slice = items.slice(offset, offset + CATALOG_CHANGE_BATCH);
  const nodes = await input.category.listActive();
  const byId = new Map(nodes.map((row) => [row.categoryId, row]));
  for (const item of slice) {
    if (item.kind === "move") {
      const move = plan.moves[item.index];
      if (!move) continue;
      const node = byId.get(move.categoryId);
      if (!node) continue;
      const parent = move.toParentId ? byId.get(move.toParentId) : undefined;
      const assigned = validateParentAssignment({ categoryId: move.categoryId, parentId: move.toParentId, parent });
      if (!assigned.ok) throw new Error(`STRUCTURE_MOVE_${assigned.code}`);
      const descendants = nodes.filter((row) => row.ancestorIds.includes(move.categoryId) || row.parentId === move.categoryId);
      const extras: CategoryRecord[] = [];
      const nextNode: CategoryRecord = {
        ...node,
        parentId: move.toParentId,
        depth: assigned.depth,
        ancestorIds: assigned.ancestorIds,
        revision: node.revision + 1,
        updatedAt: input.now.toISOString()
      };
      byId.set(nextNode.categoryId, nextNode);
      for (const child of descendants) {
        const idx = child.ancestorIds.indexOf(move.categoryId);
        const tail = idx >= 0 ? child.ancestorIds.slice(idx) : [move.categoryId];
        const ancestorIds = [...assigned.ancestorIds, ...tail.filter((id, i) => tail.indexOf(id) === i)];
        const updated: CategoryRecord = {
          ...child,
          ancestorIds,
          depth: ancestorIds.length + 1,
          revision: child.revision + 1,
          updatedAt: input.now.toISOString()
        };
        extras.push(updated);
        byId.set(updated.categoryId, updated);
      }
      await input.category.transactWrite({
        categoryId: move.categoryId,
        parentId: move.toParentId,
        nameId: categoryNameId(move.toParentId, nextNode.normalizedName),
        idempotencyId: `${input.jobId}:move:${move.categoryId}:${input.token}`,
        mutate: () => ({
          category: nextNode,
          extraCategories: extras,
          removeNameId: categoryNameId(move.fromParentId, node.normalizedName),
          nameSlot: {
            nameId: categoryNameId(move.toParentId, nextNode.normalizedName),
            parentId: move.toParentId || "",
            normalizedName: nextNode.normalizedName,
            categoryId: nextNode.categoryId
          },
          result: { ok: true }
        })
      });
    } else if (item.kind === "question") {
      const row = plan.relocatedQuestions[item.index];
      if (row) await input.change.relocateQuestion(row.id, row.categoryId);
    } else if (item.kind === "paper") {
      const row = plan.relocatedPapers[item.index];
      if (row) await input.change.relocatePaper(row.id, row.categoryId);
    } else {
      const categoryId = plan.deletes[item.index];
      if (!categoryId) continue;
      const node = byId.get(categoryId);
      if (!node) continue;
      const tomb: CategoryRecord = {
        ...node,
        deletedAt: input.now.toISOString(),
        revision: node.revision + 1,
        updatedAt: input.now.toISOString()
      };
      await input.category.transactWrite({
        categoryId,
        idempotencyId: `${input.jobId}:delete:${categoryId}:${input.token}`,
        mutate: () => ({
          category: tomb,
          removeNameId: categoryNameId(node.parentId, node.normalizedName),
          result: { ok: true }
        })
      });
      byId.delete(categoryId);
    }
  }
  const nextOffset = offset + slice.length;
  return { done: nextOffset >= items.length, offset: nextOffset };
}

async function rebuildCategoryMetrics(input: {
  category: CategoryWorkStore;
  change: CatalogChangeStore;
  work: CatalogChangeWorkRecord;
  now: Date;
}): Promise<{ rows: number }> {
  const nodes = await input.category.listActive();
  const all = [...nodes];
  const byId = new Map(all.map((row) => [row.categoryId, row]));
  const bests = await input.change.listPaperBests();
  const totals = new Map<string, { memberId: string; categoryId: string; value: number; reachedAt: string }>();
  for (const best of bests) {
    if (!best.bestScore || best.bestScore <= 0 || !best.firstReachedAt) continue;
    const paper = await input.change.getPaperCategory(best.paperId);
    if (!paper) continue;
    const category = byId.get(paper.categoryId);
    const ancestorIds = category?.ancestorIds || [];
    const ids = categoryMetricIdsOf(paper.categoryId, ancestorIds);
    for (const categoryId of ids) {
      const key = `${best.memberId}:${categoryId}`;
      const prev = totals.get(key);
      const reachedAt = best.firstReachedAt;
      if (!prev) {
        totals.set(key, { memberId: best.memberId, categoryId, value: best.bestScore, reachedAt });
      } else {
        totals.set(key, {
          memberId: best.memberId,
          categoryId,
          value: prev.value + best.bestScore,
          reachedAt: prev.reachedAt <= reachedAt ? prev.reachedAt : reachedAt
        });
      }
    }
  }
  const generation = categoryMetricGenerationKey(input.work.targetCategoryGeneration);
  const rows: ScoreMetricRecord[] = [...totals.values()].map((row) => ({
    metricId: scoreMetricId({
      metricGeneration: generation,
      scope: "category",
      periodKey: "all",
      categoryId: row.categoryId,
      memberId: row.memberId
    }),
    metricGeneration: generation,
    scope: "category",
    periodKey: "all",
    categoryId: row.categoryId,
    memberId: row.memberId,
    value: row.value,
    reachedAt: row.reachedAt,
    revision: 1,
    schemaVersion: 1,
    updatedAt: input.now.toISOString()
  }));
  await input.change.writeCategoryMetrics(rows);
  return { rows: rows.length };
}

export async function processCatalogChangeJob(input: {
  jobStore: JobStore;
  category: CategoryWorkStore;
  change: CatalogChangeStore;
  maintenance: MaintenanceStore;
  ranking?: RankingWorkStore;
  actorId: string;
  job: JobRecord;
  now: Date;
  requestId: string;
}): Promise<CatalogTickResult> {
  if (input.job.type !== CATALOG_CHANGE_JOB_TYPE) {
    return { ok: false, reason: "NOT_CATALOG_CHANGE" };
  }
  const acquired = await input.jobStore.transact(input.job.jobId, (job) => {
    if (!job) return { error: "NOT_FOUND", result: undefined };
    const next = acquireLease(job, input.now, CATALOG_CHANGE_LEASE_MS);
    if (!next.ok) return { error: next.reason, result: undefined, job };
    return { job: next.job, result: next.job };
  });
  if (acquired.mutation.error || !acquired.mutation.result) {
    return { ok: false, reason: acquired.mutation.error || "ACQUIRE_FAILED", jobId: input.job.jobId };
  }
  const token = acquired.mutation.result.fencingToken;
  const work = await input.change.getWork(input.job.jobId);
  if (!work) {
    await writeJob(input.jobStore, input.job.jobId, token, input.now, (job) =>
      markFailed(job, token, input.now, { code: "WORK_MISSING", message: "catalog change work missing" })
    );
    return { ok: false, reason: "WORK_MISSING", jobId: input.job.jobId, fencingToken: token };
  }
  if (!drainReady(work.notBefore, input.now)) {
    await writeJob(input.jobStore, input.job.jobId, token, input.now, (job) =>
      saveCursor(job, token, { ...workCursor(job), stage: "drain" }, input.now)
    );
    return {
      ok: true,
      reason: "DRAIN_PENDING",
      jobId: input.job.jobId,
      stage: "drain",
      pendingUntil: work.notBefore,
      fencingToken: token
    };
  }
  try {
    let cursor = workCursor(acquired.mutation.result);
    if (cursor.stage === "drain") cursor = { ...cursor, stage: "apply", done: 1 };
    if (cursor.stage === "apply") {
      const applied = await applyStructureBatch({
        category: input.category,
        change: input.change,
        work: { ...work, afterSummary: { ...work.afterSummary, applyOffset: cursor.offset } },
        jobId: input.job.jobId,
        token,
        now: input.now
      });
      await input.change.saveWork({
        ...work,
        afterSummary: { ...work.afterSummary, applyOffset: applied.offset },
        updatedAt: input.now.toISOString()
      });
      if (!applied.done) {
        await writeJob(input.jobStore, input.job.jobId, token, input.now, (job) =>
          saveCursor(job, token, { done: 1, total: 6, stage: "apply", offset: applied.offset }, input.now)
        );
        return { ok: true, jobId: input.job.jobId, stage: "apply", fencingToken: token };
      }
      cursor = { done: 2, total: 6, stage: "metrics", offset: 0 };
    }
    if (cursor.stage === "metrics") {
      const rebuilt = await rebuildCategoryMetrics({
        category: input.category,
        change: input.change,
        work,
        now: input.now
      });
      await input.change.saveWork({
        ...work,
        afterSummary: { ...work.afterSummary, metricRows: rebuilt.rows },
        updatedAt: input.now.toISOString()
      });
      cursor = { done: 3, total: 6, stage: "switch", offset: 0 };
    }
    if (cursor.stage === "switch") {
      const catalog = await input.category.getCatalog();
      if (catalog.structureJobId !== input.job.jobId) {
        throw new Error("STALE_STRUCTURE_JOB");
      }
      const switched: CatalogRecord = {
        ...catalog,
        treeVersion: work.targetTreeVersion,
        categoryMetricsGeneration: work.targetCategoryGeneration,
        structureUpdating: false,
        structureJobId: input.job.jobId,
        categoryRankingStatus: "updating",
        categoryRankingError: "",
        updatedAt: input.now.toISOString()
      };
      await input.change.transactCommit({
        previewId: work.previewId,
        jobId: input.job.jobId,
        idempotencyId: `${input.job.jobId}:switch`,
        mutate: (snap) => ({
          catalog: switched,
          work: {
            ...work,
            switched: true,
            rankingRegistered: true,
            afterSummary: {
              ...work.afterSummary,
              treeVersion: switched.treeVersion,
              categoryMetricsGeneration: switched.categoryMetricsGeneration
            },
            updatedAt: input.now.toISOString()
          },
          result: { ok: true }
        })
      });
      try {
        await input.category.transactWrite({
          idempotencyId: `${input.job.jobId}:sync-catalog-switch`,
          mutate: () => ({ catalog: switched, result: true })
        });
      } catch {
        /* catalog already persisted by transactCommit */
      }
      if (input.ranking) {
        const runtime = (await input.ranking.getRuntime()) ?? emptyRankingRuntime();
        await input.ranking.saveRuntime({
          ...runtime,
          categoryCatalogVersion: work.targetTreeVersion,
          categoryMetricsGeneration: work.targetCategoryGeneration,
          categoryBuildingSince: input.now.toISOString(),
          categoryLastBuildOk: false,
          categoryLastBuildError: "",
          revision: runtime.revision + 1
        });
      }
      cursor = { done: 4, total: 6, stage: "open", offset: 0 };
    }
    if (cursor.stage === "open") {
      const current = await input.maintenance.get();
      await input.maintenance.save(openCatalogChangeGatesIfOwned(current, input.job.jobId, input.now));
      const opened = (await input.change.getWork(input.job.jobId)) || work;
      await input.change.saveWork({ ...opened, opened: true, updatedAt: input.now.toISOString() });
      cursor = { done: 5, total: 6, stage: "ranking", offset: 0 };
    }
    if (cursor.stage === "ranking") {
      if (!input.ranking) {
        const latest = (await input.change.getWork(input.job.jobId)) || work;
        await input.change.saveWork({
          ...latest,
          rankingStatus: "failed",
          rankingError: "RANKING_STORE_UNAVAILABLE",
          updatedAt: input.now.toISOString()
        });
        const catalog = await input.category.getCatalog();
        await input.change.transactCommit({
          previewId: work.previewId,
          jobId: input.job.jobId,
          idempotencyId: `${input.job.jobId}:rankfail`,
          mutate: (snap) => ({
            catalog: { ...snap.catalog, categoryRankingStatus: "pending_recovery", categoryRankingError: "RANKING_STORE_UNAVAILABLE" },
            result: { ok: true }
          })
        });
        await writeJob(input.jobStore, input.job.jobId, token, input.now, (job) => markSucceeded(job, token, input.now));
        return {
          ok: true,
          jobId: input.job.jobId,
          stage: "done",
          switched: true,
          rankingStatus: "failed",
          fencingToken: token,
          reason: "STRUCTURE_DONE_RANKING_PENDING"
        };
      }
      const catalog = await input.category.getCatalog();
      const rebuilt = await rebuildRanking({
        store: input.ranking,
        actorId: input.actorId,
        data: { reason: `catalog.change ${input.job.jobId}`, scopes: ["category"] },
        requestId: input.requestId,
        idempotencyKey: `${input.job.jobId}/ranking`,
        now: input.now,
        pin: {
          treeVersion: catalog.treeVersion,
          categoryMetricsGeneration: catalog.categoryMetricsGeneration
        }
      });
      const latest = (await input.change.getWork(input.job.jobId)) || work;
      if (!rebuilt.ok) {
        await input.change.saveWork({
          ...latest,
          rankingStatus: "failed",
          rankingError: rebuilt.reason,
          updatedAt: input.now.toISOString()
        });
        await input.change.transactCommit({
          previewId: work.previewId,
          jobId: input.job.jobId,
          idempotencyId: `${input.job.jobId}:rankfail2`,
          mutate: (snap) => ({
            catalog: { ...snap.catalog, categoryRankingStatus: "pending_recovery", categoryRankingError: rebuilt.reason },
            result: { ok: true }
          })
        });
        await writeJob(input.jobStore, input.job.jobId, token, input.now, (job) => markSucceeded(job, token, input.now));
        return {
          ok: true,
          jobId: input.job.jobId,
          stage: "done",
          switched: true,
          rankingStatus: "failed",
          fencingToken: token,
          reason: "STRUCTURE_DONE_RANKING_PENDING"
        };
      }
      await input.change.saveWork({ ...latest, rankingStatus: "ok", rankingError: "", updatedAt: input.now.toISOString() });
      await input.change.transactCommit({
        previewId: work.previewId,
        jobId: input.job.jobId,
        idempotencyId: `${input.job.jobId}:rankok`,
        mutate: (snap) => ({
          catalog: { ...snap.catalog, categoryRankingStatus: "ready", categoryRankingError: "", structureJobId: "" },
          result: { ok: true }
        })
      });
    }
    await writeJob(input.jobStore, input.job.jobId, token, input.now, (job) => markSucceeded(job, token, input.now));
    return { ok: true, jobId: input.job.jobId, stage: "done", switched: true, rankingStatus: "ok", fencingToken: token };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJob(input.jobStore, input.job.jobId, token, input.now, (job) =>
      markFailed(job, token, input.now, { code: "CATALOG_CHANGE_BATCH_FAILED", message })
    );
    return { ok: false, reason: message, jobId: input.job.jobId, fencingToken: token };
  }
}

export async function processDueCatalogJobs(input: {
  jobStore: JobStore;
  change: CatalogChangeStore;
  category: CategoryWorkStore;
  maintenance: MaintenanceStore;
  ranking?: RankingWorkStore;
  now: Date;
  requestId: string;
}): Promise<{ ok: true; processed: CatalogTickResult[] }> {
  const ids = await input.change.listDueJobIds({
    now: input.now,
    types: [CATALOG_CHANGE_JOB_TYPE, RANKING_REFRESH_CATEGORY_JOB_TYPE]
  });
  const processed: CatalogTickResult[] = [];
  for (const jobId of ids.slice(0, 3)) {
    const job = await input.jobStore.get(jobId);
    if (!job) continue;
    if (job.state === "succeeded" || job.state === "cancelled") continue;
    if (job.type === CATALOG_CHANGE_JOB_TYPE) {
      processed.push(
        await processCatalogChangeJob({
          jobStore: input.jobStore,
          category: input.category,
          change: input.change,
          maintenance: input.maintenance,
          ranking: input.ranking,
          actorId: "mw-jobs",
          job,
          now: input.now,
          requestId: input.requestId
        })
      );
    }
  }
  return { ok: true, processed };
}
