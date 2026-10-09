import { describe, expect, it } from "vitest";
import {
  emptyCatalog,
  hasPaperSecrets,
  seedCategoryId,
  type CategoryRecord,
  type PaperRecord,
  type PaperVersionRecord
} from "@mw/shared";
import { handleOfficial, memoryAdminStore } from "./official.js";
import { memoryCategoryStore } from "./modules/category-stores.js";
import { memoryPaperStore } from "./modules/paper-stores.js";

const allowedAppIds = ["wxmwallowedappid0001"];
const now = new Date("2026-10-09T08:00:00.000Z");
const rootId = seedCategoryId("logical");
const childId = "cat_fict_l2";
const leafId = "cat_fict_l3";
const disabledId = "cat_fict_disabled";

function cat(id: string, extra: Partial<CategoryRecord> = {}): CategoryRecord {
  return {
    categoryId: id,
    parentId: extra.parentId ?? null,
    depth: extra.depth ?? 1,
    ancestorIds: extra.ancestorIds ?? [],
    name: extra.name || "逻辑思维",
    normalizedName: extra.name || "逻辑思维",
    sort: extra.sort ?? 10,
    enabled: extra.enabled !== false,
    deletedAt: extra.deletedAt ?? null,
    revision: 1,
    treeVersion: extra.treeVersion ?? 3,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...extra
  };
}

function paper(id: string, extra: Partial<PaperRecord> = {}): PaperRecord {
  const status = extra.status ?? "published";
  return {
    paperId: id,
    title: extra.title || `虚构卷${id}`,
    summary: extra.summary || "虚构简介",
    goal: extra.goal || "虚构目标",
    categoryId: extra.categoryId || rootId,
    access: extra.access || "free",
    difficulty: extra.difficulty || "beginner",
    sort: extra.sort ?? 10,
    suggestedMinutes: extra.suggestedMinutes ?? 20,
    publishedAt: extra.publishedAt ?? "2026-10-09T06:00:00.000Z",
    status,
    activeVersionId: extra.activeVersionId === undefined ? `${id}_v` : extra.activeVersionId,
    revision: extra.revision ?? 2,
    draftItems: [],
    draftQuestionCount: extra.draftQuestionCount ?? 1,
    draftMaxScore: extra.draftMaxScore ?? 5,
    accessLocked: extra.accessLocked === true,
    withdrawReason: extra.withdrawReason ?? null,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...extra
  };
}

function version(paperId: string, extra: Partial<PaperVersionRecord> = {}): PaperVersionRecord {
  return {
    versionId: extra.versionId || `${paperId}_v`,
    paperId,
    questionCount: extra.questionCount ?? 1,
    maxScore: extra.maxScore ?? 5,
    chunkIds: extra.chunkIds ?? [`${paperId}_c1`],
    answerChunkIds: extra.answerChunkIds ?? [`${paperId}_a1`],
    chunkDigests: extra.chunkDigests ?? ["d1"],
    answerDigests: extra.answerDigests ?? ["d2"],
    categoryPathSnapshot: extra.categoryPathSnapshot ?? ["逻辑思维"],
    manifestHash: extra.manifestHash || "m1",
    questionIds: extra.questionIds ?? ["q1"],
    questionVersionIds: extra.questionVersionIds ?? ["qv1"],
    schemaVersion: 1,
    createdAt: now.toISOString(),
    createdBy: "uid_content_1"
  };
}

function seeded() {
  const categories = [
    cat(rootId, { name: "逻辑思维", sort: 10, treeVersion: 3 }),
    cat(childId, {
      name: "演绎推理",
      parentId: rootId,
      depth: 2,
      ancestorIds: [rootId],
      sort: 10,
      treeVersion: 3
    }),
    cat(leafId, {
      name: "条件判断",
      parentId: childId,
      depth: 3,
      ancestorIds: [rootId, childId],
      sort: 10,
      treeVersion: 3
    }),
    cat(disabledId, { name: "停用类目", sort: 90, enabled: false, treeVersion: 3 })
  ];
  const papers = [
    paper("p_root_free", {
      title: "一级免费虚构卷",
      categoryId: rootId,
      access: "free",
      difficulty: "beginner",
      sort: 20,
      publishedAt: "2026-10-08T00:00:00.000Z"
    }),
    paper("p_leaf_vip", {
      title: "三级 VIP 虚构卷",
      categoryId: leafId,
      access: "vip",
      difficulty: "challenge",
      sort: 5,
      publishedAt: "2026-10-09T07:00:00.000Z"
    }),
    paper("p_draft", { title: "草稿不可见", status: "draft", activeVersionId: null }),
    paper("p_unpub", { title: "已下架虚构卷", status: "unpublished" }),
    paper("p_withdrawn", { title: "已撤回虚构卷", status: "withdrawn", withdrawReason: "测试撤回" }),
    paper("p_disabled_cat", { title: "停用类目卷", categoryId: disabledId, sort: 1 })
  ];
  const versions = papers
    .filter((row) => row.activeVersionId)
    .map((row) =>
      version(row.paperId, {
        versionId: row.activeVersionId || `${row.paperId}_v`,
        categoryPathSnapshot: row.categoryId === leafId ? ["逻辑思维", "演绎推理", "条件判断"] : ["逻辑思维"]
      })
    );
  return {
    categoryStore: memoryCategoryStore(categories, { ...emptyCatalog(now), treeVersion: 3, seeded: true }),
    paperStore: memoryPaperStore({ papers, versions })
  };
}

function ctx(options: {
  paperStore: ReturnType<typeof memoryPaperStore>;
  categoryStore: ReturnType<typeof memoryCategoryStore>;
  entry?: "mw-public" | "mw-admin" | "mw-member";
  event: unknown;
}) {
  return handleOfficial({
    entry: options.entry || "mw-public",
    event: options.event,
    allowedAppIds,
    adminStore: memoryAdminStore(),
    categoryStore: options.categoryStore,
    paperStore: options.paperStore,
    now
  });
}

function req(action: string, data: Record<string, unknown> = {}) {
  return {
    apiVersion: "1",
    action,
    requestId: `req_${action}_${Math.random().toString(16).slice(2)}`,
    data
  };
}

describe("MW13 public home and paper browse", () => {
  it("home.get returns dynamic roots, shelves and config version instead of MW05 skeleton", async () => {
    const { paperStore, categoryStore } = seeded();
    const res = await ctx({ paperStore, categoryStore, event: req("home.get") });
    expect(res).toMatchObject({ ok: true });
    const data = (res as { data: Record<string, unknown> }).data;
    expect(JSON.stringify(data)).not.toMatch(/MW05 public skeleton|paper browse is MW13/);
    expect(Array.isArray(data.roots)).toBe(true);
    const roots = data.roots as Array<{ id: string; depth: number; name: string }>;
    expect(roots.some((row) => row.id === rootId && row.depth === 1 && row.name === "逻辑思维")).toBe(true);
    expect(roots.some((row) => row.id === disabledId)).toBe(false);
    const recommended = data.recommended as Array<{ paperId: string }>;
    const latest = data.latest as Array<{ paperId: string }>;
    expect(recommended.map((row) => row.paperId)).toEqual(["p_leaf_vip", "p_root_free"]);
    expect(latest.map((row) => row.paperId)).toEqual(["p_leaf_vip", "p_root_free"]);
    expect(data.catalogVersion).toBe(3);
    expect(data.configVersion).toMatchObject({ catalogVersion: 3 });
    expect(hasPaperSecrets(res)).toEqual([]);
  });

  it("rejects unknown home.get fields", async () => {
    const { paperStore, categoryStore } = seeded();
    const res = await ctx({ paperStore, categoryStore, event: req("home.get", { freeOnly: true }) });
    expect(res).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  });

  it("lists only published papers, includes descendants, and dedupes by paperId", async () => {
    const { paperStore, categoryStore } = seeded();
    const res = await ctx({
      paperStore,
      categoryStore,
      event: req("paper.list", { categoryId: rootId })
    });
    expect(res).toMatchObject({ ok: true });
    const items = (res as { data: { items: Array<{ paperId: string }> } }).data.items;
    expect(items.map((row) => row.paperId).sort()).toEqual(["p_leaf_vip", "p_root_free"]);
    expect(new Set(items.map((row) => row.paperId)).size).toBe(items.length);
    expect(items.some((row) => ["p_draft", "p_unpub", "p_withdrawn", "p_disabled_cat"].includes(row.paperId))).toBe(false);
  });

  it("can list only the current category when includeDescendants is false", async () => {
    const { paperStore, categoryStore } = seeded();
    const res = await ctx({
      paperStore,
      categoryStore,
      event: req("paper.list", { categoryId: rootId, includeDescendants: false })
    });
    const items = (res as { data: { items: Array<{ paperId: string }> } }).data.items;
    expect(items.map((row) => row.paperId)).toEqual(["p_root_free"]);
  });

  it("filters difficulty, access and empty done progress, and sorts latest vs recommended", async () => {
    const { paperStore, categoryStore } = seeded();
    const vip = await ctx({
      paperStore,
      categoryStore,
      event: req("paper.list", { categoryId: rootId, access: "vip", difficulty: "challenge" })
    });
    expect((vip as { data: { items: Array<{ paperId: string }> } }).data.items.map((row) => row.paperId)).toEqual([
      "p_leaf_vip"
    ]);
    const done = await ctx({
      paperStore,
      categoryStore,
      event: req("paper.list", { categoryId: rootId, progress: "done" })
    });
    expect((done as { data: { items: unknown[] } }).data.items).toEqual([]);
    const rec = await ctx({
      paperStore,
      categoryStore,
      event: req("paper.list", { categoryId: rootId, sort: "recommended" })
    });
    expect((rec as { data: { items: Array<{ paperId: string }> } }).data.items.map((row) => row.paperId)).toEqual([
      "p_leaf_vip",
      "p_root_free"
    ]);
    const latest = await ctx({
      paperStore,
      categoryStore,
      event: req("paper.list", { categoryId: rootId, sort: "latest" })
    });
    expect((latest as { data: { items: Array<{ paperId: string }> } }).data.items.map((row) => row.paperId)).toEqual([
      "p_leaf_vip",
      "p_root_free"
    ]);
  });

  it("binds opaque cursors to filters and rejects a changed filter", async () => {
    const { paperStore, categoryStore } = seeded();
    const first = await ctx({
      paperStore,
      categoryStore,
      event: req("paper.list", { categoryId: rootId, sort: "recommended", limit: 1 })
    });
    const data = (first as { data: { items: Array<{ paperId: string }>; nextCursor: string | null; complete: boolean } })
      .data;
    expect(data.items).toHaveLength(1);
    expect(data.complete).toBe(false);
    expect(typeof data.nextCursor).toBe("string");
    const second = await ctx({
      paperStore,
      categoryStore,
      event: req("paper.list", { categoryId: rootId, sort: "recommended", limit: 1, cursor: data.nextCursor })
    });
    expect((second as { data: { items: Array<{ paperId: string }>; complete: boolean } }).data.items.map((row) => row.paperId)).toEqual([
      "p_root_free"
    ]);
    const changed = await ctx({
      paperStore,
      categoryStore,
      event: req("paper.list", {
        categoryId: rootId,
        sort: "latest",
        limit: 1,
        cursor: data.nextCursor
      })
    });
    expect(changed).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT", details: { reason: "CURSOR_FILTER_MISMATCH" } }
    });
  });

  it("rejects disabled categories and ranking fee filters, and hides disabled descendants", async () => {
    const { paperStore, categoryStore } = seeded();
    const disabled = await ctx({
      paperStore,
      categoryStore,
      event: req("paper.list", { categoryId: disabledId })
    });
    expect(disabled).toMatchObject({
      ok: false,
      error: { code: "CATEGORY_UNAVAILABLE" }
    });
    const fee = await ctx({
      paperStore,
      categoryStore,
      event: req("paper.list", { freeOnly: true })
    });
    expect(fee).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    const ranking = await ctx({
      paperStore,
      categoryStore,
      event: req("ranking.list", { scope: "total", access: "free" })
    });
    expect(ranking).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("returns public detail without answers and maps unpublished or withdrawn", async () => {
    const { paperStore, categoryStore } = seeded();
    const detail = await ctx({
      paperStore,
      categoryStore,
      event: req("paper.detail", { paperId: "p_leaf_vip" })
    });
    expect(detail).toMatchObject({
      ok: true,
      data: {
        paper: {
          paperId: "p_leaf_vip",
          access: "vip",
          difficulty: "challenge",
          goal: "虚构目标",
          status: "published"
        }
      }
    });
    expect(hasPaperSecrets(detail)).toEqual([]);
    expect(JSON.stringify(detail)).not.toMatch(/"answer"|"analysis"|"paper_answers"|"question_versions"|"correctOptionIds"/);
    const unpublished = await ctx({
      paperStore,
      categoryStore,
      event: req("paper.detail", { paperId: "p_unpub" })
    });
    expect(unpublished).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", details: { reason: "PAPER_UNPUBLISHED" } }
    });
    const withdrawn = await ctx({
      paperStore,
      categoryStore,
      event: req("paper.detail", { paperId: "p_withdrawn" })
    });
    expect(withdrawn).toMatchObject({
      ok: false,
      error: { code: "PAPER_WITHDRAWN" }
    });
    const hidden = await ctx({
      paperStore,
      categoryStore,
      event: req("paper.detail", { paperId: "p_disabled_cat" })
    });
    expect(hidden).toMatchObject({ ok: false, error: { code: "CATEGORY_UNAVAILABLE" } });
  });
});
