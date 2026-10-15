import {
  METRIC_GENERATION_BASE,
  RANKING_RUNTIME_DOC_ID,
  auditDocId,
  rankingRowId,
  scoreMetricId,
  type AuditEntry,
  type IdempotencyRecord,
  type RankingHeadRecord,
  type RankingRowRecord,
  type RankingRuntimeRecord,
  type RankingScope
} from "@mw/shared";
import {
  RANKING_COLLECTIONS,
  type RankingCategoryRow,
  type RankingMemberRow,
  type RankingMetricRow,
  type RankingRebuildMutation,
  type RankingRebuildSnapshot,
  type RankingStatsRow,
  type RankingWorkStore
} from "./ranking-stores.js";
import type { TxBudget } from "./job-stores.js";

const WRITE_CHUNK = 10;
const SCAN_PAGE = 500;

type CloudDocRef = {
  get: () => Promise<unknown>;
  set: (data: Record<string, unknown>) => Promise<unknown>;
  remove?: () => Promise<unknown>;
};

type CloudQuery = {
  where?: (query: Record<string, unknown>) => CloudQuery;
  orderBy?: (field: string, direction: "asc" | "desc") => CloudQuery;
  skip?: (count: number) => CloudQuery;
  limit: (count: number) => CloudQuery;
  get: () => Promise<unknown>;
};

type CloudColl = CloudQuery & {
  doc: (id: string) => CloudDocRef;
};

type CloudDb = {
  collection: (name: string) => CloudColl;
  runTransaction: <T>(fn: (tx: CloudDb) => Promise<T>) => Promise<T>;
};

function cloudApp() {
  const cloudbase = require("@cloudbase/node-sdk") as {
    init: (opts: { env: unknown }) => { database: () => CloudDb };
    SYMBOL_CURRENT_ENV: unknown;
  };
  return cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
}

function db(): CloudDb {
  return cloudApp().database();
}

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

function docsFromGet(snap: unknown): Record<string, unknown>[] {
  if (!snap || typeof snap !== "object") return [];
  const rec = snap as Record<string, unknown>;
  if (Array.isArray(rec.data)) {
    return rec.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  const inner = rec.data;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const nested = (inner as Record<string, unknown>).data;
    if (Array.isArray(nested)) {
      return nested.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    }
  }
  return [];
}

async function queryRows(
  collection: string,
  query: Record<string, unknown> | undefined,
  order: { field: string; direction: "asc" | "desc" } | undefined,
  limit: number,
  skip = 0
): Promise<Record<string, unknown>[]> {
  const base = db().collection(collection);
  let cursor: CloudQuery = base;
  if (query && Object.keys(query).length > 0) {
    if (!base.where) return [];
    cursor = base.where(query);
  }
  if (order) {
    if (!cursor.orderBy) return [];
    cursor = cursor.orderBy(order.field, order.direction);
  }
  if (skip > 0) {
    if (!cursor.skip) return [];
    cursor = cursor.skip(skip);
  }
  const snap = await cursor.limit(limit).get();
  return docsFromGet(snap);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * 尽力回收某一批行所属的 (boardId, generation)。
 *
 * `rankingGenerationId` 每次重建都不同，所以"失败那一代"的行不会被下一次重建的 `obsolete`
 * 清理覆盖到，会留下无人引用的脏行（读不到、也永远清不掉，收口的"身份快照残留"核查还会命中）。
 * 因此行写失败时要按 (boardId, generation) 直接把本次已落库的行删掉。
 */
async function purgeRowsOf(rows: readonly RankingRowRecord[]): Promise<void> {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.boardId}\u0000${row.generation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const stale = await queryRows(
      RANKING_COLLECTIONS.rankingRows,
      { boardId: row.boardId, generation: row.generation },
      undefined,
      SCAN_PAGE
    );
    for (const doc of stale) {
      const id = String(doc._id || "");
      if (!id) continue;
      await db().collection(RANKING_COLLECTIONS.rankingRows).doc(id).remove?.();
    }
  }
}

function scopeOf(value: unknown): RankingScope {
  return value === "category" || value === "week" || value === "month" ? value : "total";
}

function asHead(data: Record<string, unknown>, fallbackId: string): RankingHeadRecord {
  return {
    boardId: typeof data.boardId === "string" ? data.boardId : fallbackId,
    scope: scopeOf(data.scope),
    periodKey: typeof data.periodKey === "string" ? data.periodKey : "all",
    categoryId: typeof data.categoryId === "string" ? data.categoryId : "",
    generation: typeof data.generation === "string" ? data.generation : "",
    publishedAt: typeof data.publishedAt === "string" ? data.publishedAt : "",
    sampleStartedAt: typeof data.sampleStartedAt === "string" ? data.sampleStartedAt : "",
    sampleEndedAt: typeof data.sampleEndedAt === "string" ? data.sampleEndedAt : "",
    catalogVersion: typeof data.catalogVersion === "number" ? data.catalogVersion : 0,
    participantCount: typeof data.participantCount === "number" ? data.participantCount : 0,
    displayCount: typeof data.displayCount === "number" ? data.displayCount : 0,
    boundaryTruncated: data.boundaryTruncated === true,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    revision: typeof data.revision === "number" ? data.revision : 1
  };
}

function asRow(data: Record<string, unknown>, fallbackId: string): RankingRowRecord {
  return {
    rowId: typeof data.rowId === "string" ? data.rowId : fallbackId,
    boardId: typeof data.boardId === "string" ? data.boardId : "",
    generation: typeof data.generation === "string" ? data.generation : "",
    scope: scopeOf(data.scope),
    periodKey: typeof data.periodKey === "string" ? data.periodKey : "all",
    categoryId: typeof data.categoryId === "string" ? data.categoryId : "",
    memberId: typeof data.memberId === "string" ? data.memberId : "",
    nickname: typeof data.nickname === "string" ? data.nickname : "",
    avatarKey: typeof data.avatarKey === "string" ? data.avatarKey : "",
    levelId: typeof data.levelId === "string" ? data.levelId : "",
    value: typeof data.value === "number" ? data.value : 0,
    rank: typeof data.rank === "number" ? data.rank : 0,
    sortOrdinal: typeof data.sortOrdinal === "number" ? data.sortOrdinal : 0,
    reachedAt: typeof data.reachedAt === "string" ? data.reachedAt : "",
    prevValueDiff: typeof data.prevValueDiff === "number" ? data.prevValueDiff : null,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1
  };
}

function asMemberRow(data: Record<string, unknown>, fallbackId: string): RankingMemberRow {
  const status = data.status;
  return {
    memberId: typeof data.memberId === "string" ? data.memberId : fallbackId,
    nickname: typeof data.nickname === "string" ? data.nickname : "",
    avatarKey: typeof data.avatarKey === "string" ? data.avatarKey : "",
    status:
      status === "disabled" || status === "deleting" || status === "deleted" || status === "active" ? status : "active",
    rankingOptIn: data.rankingOptIn === true,
    revision: typeof data.revision === "number" ? data.revision : 1
  };
}

function asMetricRow(data: Record<string, unknown>, fallbackId: string): RankingMetricRow {
  return {
    metricId: typeof data.metricId === "string" ? data.metricId : fallbackId,
    metricGeneration: typeof data.metricGeneration === "string" ? data.metricGeneration : METRIC_GENERATION_BASE,
    scope: scopeOf(data.scope),
    periodKey: typeof data.periodKey === "string" ? data.periodKey : "all",
    categoryId: typeof data.categoryId === "string" ? data.categoryId : "",
    memberId: typeof data.memberId === "string" ? data.memberId : "",
    value: typeof data.value === "number" ? data.value : 0,
    reachedAt: typeof data.reachedAt === "string" ? data.reachedAt : ""
  };
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

function asRuntime(data: Record<string, unknown> | undefined): RankingRuntimeRecord | undefined {
  if (!data) return undefined;
  const rawCounts =
    data.rowCounts && typeof data.rowCounts === "object" && !Array.isArray(data.rowCounts)
      ? (data.rowCounts as Record<string, unknown>)
      : {};
  const rowCounts: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawCounts)) {
    rowCounts[key] = typeof value === "number" ? value : 0;
  }
  return {
    publishedGeneration: typeof data.publishedGeneration === "string" ? data.publishedGeneration : "",
    publishedAt: typeof data.publishedAt === "string" ? data.publishedAt : "",
    requestedAt: typeof data.requestedAt === "string" ? data.requestedAt : "",
    buildingSince: typeof data.buildingSince === "string" ? data.buildingSince : "",
    lastBuildStartedAt: typeof data.lastBuildStartedAt === "string" ? data.lastBuildStartedAt : "",
    lastBuildEndedAt: typeof data.lastBuildEndedAt === "string" ? data.lastBuildEndedAt : "",
    lastBuildOk: data.lastBuildOk === true,
    lastBuildError: typeof data.lastBuildError === "string" ? data.lastBuildError : "",
    catalogVersion: typeof data.catalogVersion === "number" ? data.catalogVersion : 0,
    boardCount: typeof data.boardCount === "number" ? data.boardCount : 0,
    rowCount: typeof data.rowCount === "number" ? data.rowCount : 0,
    rowCounts,
    historyGapMembers: typeof data.historyGapMembers === "number" ? data.historyGapMembers : 0,
    historyGapScore: typeof data.historyGapScore === "number" ? data.historyGapScore : 0,
    truncated: data.truncated === true,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    revision: typeof data.revision === "number" ? data.revision : 0
  };
}

function idemWrite(record: IdempotencyRecord): Record<string, unknown> {
  return {
    actorId: record.actorId,
    action: record.action,
    idempotencyKey: record.idempotencyKey,
    payloadHash: record.payloadHash,
    status: record.status,
    resultRef: record.resultRef,
    requestId: record.requestId,
    schemaVersion: 1,
    updatedAt: new Date().toISOString()
  };
}

async function setInChunks<T>(items: readonly T[], write: (item: T) => Promise<unknown>): Promise<number> {
  let written = 0;
  for (let index = 0; index < items.length; index += WRITE_CHUNK) {
    const chunk = items.slice(index, index + WRITE_CHUNK);
    await Promise.all(chunk.map((item) => write(item)));
    written += chunk.length;
  }
  return written;
}

/**
 * CloudBase 实现：按已知 `_id` 精确访问为主，扫描显式有界。
 * 快照切换在事务内完成（板块头 + 运行状态 + 幂等 + 审计），行先写齐再切换。
 */
export function cloudRankingStore(): RankingWorkStore {
  return {
    async getRuntime() {
      const snap = await db().collection(RANKING_COLLECTIONS.appConfig).doc(RANKING_RUNTIME_DOC_ID).get();
      return asRuntime(unwrapDoc(snap));
    },
    async getHead(boardId) {
      const snap = await db().collection(RANKING_COLLECTIONS.rankingHeads).doc(boardId).get();
      const data = unwrapDoc(snap);
      return data ? asHead(data, boardId) : undefined;
    },
    async listHeads() {
      const rows = await queryRows(RANKING_COLLECTIONS.rankingHeads, undefined, undefined, SCAN_PAGE);
      return rows.map((row) => asHead(row, String(row._id || "")));
    },
    async listRows(input) {
      const rows = await queryRows(
        RANKING_COLLECTIONS.rankingRows,
        { boardId: input.boardId, generation: input.generation },
        { field: "sortOrdinal", direction: "asc" },
        input.limit,
        input.offset
      );
      return { rows: rows.map((row) => asRow(row, String(row._id || ""))) };
    },
    async getRow(input) {
      const rowId = rankingRowId(input);
      const snap = await db().collection(RANKING_COLLECTIONS.rankingRows).doc(rowId).get();
      const data = unwrapDoc(snap);
      return data ? asRow(data, rowId) : undefined;
    },
    async getMember(memberId) {
      const snap = await db().collection(RANKING_COLLECTIONS.members).doc(memberId).get();
      const data = unwrapDoc(snap);
      return data ? asMemberRow(data, memberId) : undefined;
    },
    async getStats(memberId) {
      const snap = await db().collection(RANKING_COLLECTIONS.memberStats).doc(memberId).get();
      const data = unwrapDoc(snap);
      if (!data) return undefined;
      return {
        memberId: typeof data.memberId === "string" ? data.memberId : memberId,
        totalScore: typeof data.totalScore === "number" ? data.totalScore : 0,
        levelId: typeof data.levelId === "string" ? data.levelId : ""
      };
    },
    async listMembers(memberIds) {
      const unique = [...new Set(memberIds.filter(Boolean))];
      const out: RankingMemberRow[] = [];
      for (let index = 0; index < unique.length; index += WRITE_CHUNK) {
        const chunk = unique.slice(index, index + WRITE_CHUNK);
        const rows = await Promise.all(
          chunk.map(async (memberId) => {
            const snap = await db().collection(RANKING_COLLECTIONS.members).doc(memberId).get();
            const data = unwrapDoc(snap);
            return data ? asMemberRow(data, memberId) : undefined;
          })
        );
        for (const row of rows) if (row) out.push(row);
      }
      return out;
    },
    async getMetric(input) {
      const metricId = scoreMetricId({
        metricGeneration: input.metricGeneration,
        scope: input.scope,
        periodKey: input.periodKey,
        categoryId: input.categoryId,
        memberId: input.memberId
      });
      const snap = await db().collection(RANKING_COLLECTIONS.scoreMetrics).doc(metricId).get();
      const data = unwrapDoc(snap);
      return data ? asMetricRow(data, metricId) : undefined;
    },
    async scanMetrics(input) {
      const rows = await queryRows(
        RANKING_COLLECTIONS.scoreMetrics,
        { metricGeneration: METRIC_GENERATION_BASE },
        undefined,
        input.limit
      );
      return { rows: rows.map((row) => asMetricRow(row, String(row._id || ""))), truncated: rows.length >= input.limit };
    },
    async scanMembers(input) {
      const rows = await queryRows(RANKING_COLLECTIONS.members, undefined, undefined, input.limit);
      return { rows: rows.map((row) => asMemberRow(row, String(row._id || ""))), truncated: rows.length >= input.limit };
    },
    async scanStats(input) {
      const rows = await queryRows(RANKING_COLLECTIONS.memberStats, undefined, undefined, input.limit);
      const parsed: RankingStatsRow[] = rows.map((row) => ({
        memberId: typeof row.memberId === "string" ? row.memberId : String(row._id || ""),
        totalScore: typeof row.totalScore === "number" ? row.totalScore : 0,
        levelId: typeof row.levelId === "string" ? row.levelId : ""
      }));
      return { rows: parsed, truncated: rows.length >= input.limit };
    },
    async listCategories() {
      const rows = await queryRows(RANKING_COLLECTIONS.categories, undefined, undefined, SCAN_PAGE);
      const parsed: RankingCategoryRow[] = rows.map((row) => ({
        categoryId: typeof row.categoryId === "string" ? row.categoryId : String(row._id || ""),
        parentId: typeof row.parentId === "string" ? row.parentId : null,
        ancestorIds: strings(row.ancestorIds),
        enabled: row.enabled === true,
        deletedAt: typeof row.deletedAt === "string" ? row.deletedAt : null
      }));
      return parsed;
    },
    async writeRows(rows, obsolete) {
      let obsoleteRemoved = 0;
      for (const item of obsolete) {
        const stale = await queryRows(
          RANKING_COLLECTIONS.rankingRows,
          { boardId: item.boardId, generation: item.generation },
          undefined,
          SCAN_PAGE
        );
        for (const row of stale) {
          const id = String(row._id || "");
          if (!id) continue;
          await db().collection(RANKING_COLLECTIONS.rankingRows).doc(id).remove?.();
          obsoleteRemoved += 1;
        }
      }
      /**
       * 只允许在载荷里带业务字段：`_id` 由 `doc(rowId)` 决定。
       * 在 `set()` 载荷里再带 `_id` 会被 CloudBase 拒绝（`_id` 不可写），
       * 表现就是每次重建都 `RANKING_ROWS_WRITE_FAILED`（MW17 手点首次暴露）。
       */
      try {
        const rowsWritten = await setInChunks(rows, (row) =>
          db().collection(RANKING_COLLECTIONS.rankingRows).doc(row.rowId).set({ ...row })
        );
        return { rowsWritten, obsoleteRemoved };
      } catch (error) {
        await purgeRowsOf(rows).catch(() => undefined);
        throw error;
      }
    },
    async saveRuntime(runtime) {
      await db().collection(RANKING_COLLECTIONS.appConfig).doc(RANKING_RUNTIME_DOC_ID).set({ ...runtime });
    },
    async markRequested(requestedAt) {
      const current = asRuntime(
        unwrapDoc(await db().collection(RANKING_COLLECTIONS.appConfig).doc(RANKING_RUNTIME_DOC_ID).get())
      );
      if (current?.requestedAt) return { requestedAt: current.requestedAt, changed: false };
      const next: RankingRuntimeRecord = {
        publishedGeneration: current?.publishedGeneration || "",
        publishedAt: current?.publishedAt || "",
        requestedAt,
        buildingSince: current?.buildingSince || "",
        lastBuildStartedAt: current?.lastBuildStartedAt || "",
        lastBuildEndedAt: current?.lastBuildEndedAt || "",
        lastBuildOk: current?.lastBuildOk === true,
        lastBuildError: current?.lastBuildError || "",
        catalogVersion: current?.catalogVersion || 0,
        boardCount: current?.boardCount || 0,
        rowCount: current?.rowCount || 0,
        rowCounts: current?.rowCounts || {},
        historyGapMembers: current?.historyGapMembers || 0,
        historyGapScore: current?.historyGapScore || 0,
        truncated: current?.truncated === true,
        schemaVersion: current?.schemaVersion || 1,
        revision: (current?.revision || 0) + 1
      };
      await db().collection(RANKING_COLLECTIONS.appConfig).doc(RANKING_RUNTIME_DOC_ID).set({ ...next });
      return { requestedAt, changed: true };
    },
    async transactRebuild<T>(input: {
      idempotencyId: string;
      idempotency: IdempotencyRecord;
      mutate: (snap: RankingRebuildSnapshot) => RankingRebuildMutation<T>;
    }): Promise<{ mutation: RankingRebuildMutation<T>; budget: TxBudget }> {
      const started = Date.now();
      let reads = 0;
      let writes = 0;
      const raw = await db().runTransaction(async (tx) => {
        reads += 2;
        const idemData = unwrapDoc(await tx.collection(RANKING_COLLECTIONS.idempotency).doc(input.idempotencyId).get());
        const runtimeData = unwrapDoc(
          await tx.collection(RANKING_COLLECTIONS.appConfig).doc(RANKING_RUNTIME_DOC_ID).get()
        );
        const snapshot: RankingRebuildSnapshot = {
          idem: idemData ? asIdem(input.idempotencyId, idemData) : undefined,
          runtime: asRuntime(runtimeData)
        };
        const next = input.mutate(snapshot);
        if (next.error) return next;
        for (const head of next.heads || []) {
          reads += 1;
          writes += 1;
          await tx.collection(RANKING_COLLECTIONS.rankingHeads).doc(head.boardId).set({ ...head });
        }
        if (next.runtime) {
          writes += 1;
          await tx.collection(RANKING_COLLECTIONS.appConfig).doc(RANKING_RUNTIME_DOC_ID).set({ ...next.runtime });
        }
        if (next.idem) {
          writes += 1;
          await tx.collection(RANKING_COLLECTIONS.idempotency).doc(input.idempotencyId).set(idemWrite(next.idem));
        }
        if (next.audit) {
          writes += 1;
          await tx
            .collection(RANKING_COLLECTIONS.auditLogs)
            .doc(auditDocId(next.audit))
            .set({ ...next.audit } as unknown as Record<string, unknown>);
        }
        return next;
      });
      const budget: TxBudget = { reads, writes, total: reads + writes, elapsedMs: Date.now() - started };
      return { mutation: raw as RankingRebuildMutation<T>, budget };
    }
  };
}

export type { AuditEntry };
