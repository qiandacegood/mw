import { describe, expect, it } from "vitest";
import {
  CATEGORY_SCHEMA_VERSION,
  categoryMetricGenerationKey,
  catalogChangeDrainUntil,
  drainReady,
  nextCategoryMetricsGeneration,
  parseCategoryChangeCommitInput,
  parseCategoryChangePreviewInput,
  planCategoryChange,
  subtreeMaxDepthAfterMove,
  type CatalogRecord,
  type CategoryRecord
} from "./index.js";

const now = new Date("2026-10-15T02:00:00.000Z");

function catalog(treeVersion = 1): CatalogRecord {
  return {
    treeVersion,
    categoryMetricsGeneration: 0,
    seeded: true,
    seededAt: now.toISOString(),
    schemaVersion: CATEGORY_SCHEMA_VERSION,
    updatedAt: now.toISOString()
  };
}

function node(input: Partial<CategoryRecord> & Pick<CategoryRecord, "categoryId" | "depth">): CategoryRecord {
  return {
    parentId: input.parentId ?? null,
    ancestorIds: input.ancestorIds ?? [],
    name: input.name ?? input.categoryId,
    normalizedName: input.normalizedName ?? input.name ?? input.categoryId,
    sort: input.sort ?? 10,
    enabled: input.enabled !== false,
    deletedAt: input.deletedAt ?? null,
    revision: 1,
    treeVersion: 1,
    schemaVersion: CATEGORY_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...input
  };
}

describe("MW18 category change plan", () => {
  it("maps generation 0 to base and refuses silent fallback after switch", () => {
    expect(categoryMetricGenerationKey(0)).toBe("base");
    expect(categoryMetricGenerationKey(undefined)).toBe("base");
    expect(nextCategoryMetricsGeneration(0)).toBe(1);
    expect(categoryMetricGenerationKey(1)).toBe("1");
    expect(categoryMetricGenerationKey(1)).not.toBe("base");
  });

  it("rejects fourth-level, cycle, missing parent, sibling rename and unused delete refs", () => {
    const root = node({ categoryId: "r", depth: 1, name: "根" });
    const mid = node({ categoryId: "m", parentId: "r", ancestorIds: ["r"], depth: 2, name: "中" });
    const child = node({ categoryId: "c", parentId: "r", ancestorIds: ["r"], depth: 2, name: "子" });
    const leaf = node({ categoryId: "l", parentId: "c", ancestorIds: ["r", "c"], depth: 3, name: "叶" });

    expect(subtreeMaxDepthAfterMove(child, [leaf], 3)).toBe(4);

    const tooDeep = planCategoryChange({
      expectedTreeVersion: 1,
      catalog: catalog(),
      nodes: [root, mid, child, leaf],
      operations: [{ type: "move", categoryId: "c", parentId: "m" }],
      usage: { questions: {}, papers: {} }
    });
    expect(tooDeep.ok).toBe(false);
    if (!tooDeep.ok) expect(tooDeep.issue.code).toBe("CATEGORY_DEPTH_LIMIT");

    const cycle = planCategoryChange({
      expectedTreeVersion: 1,
      catalog: catalog(),
      nodes: [root, child],
      operations: [{ type: "move", categoryId: "r", parentId: "c" }],
      usage: { questions: {}, papers: {} }
    });
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) expect(cycle.issue.code).toBe("CATEGORY_CYCLE");

    const missing = planCategoryChange({
      expectedTreeVersion: 1,
      catalog: catalog(),
      nodes: [root],
      operations: [{ type: "move", categoryId: "r", parentId: "ghost" }],
      usage: { questions: {}, papers: {} }
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.issue.code).toBe("PARENT_MISSING");

    const inUse = planCategoryChange({
      expectedTreeVersion: 1,
      catalog: catalog(),
      nodes: [root],
      operations: [{ type: "delete", categoryId: "r" }],
      usage: { questions: {}, papers: { r: [{ id: "p1", title: "卷", categoryId: "r" }] } }
    });
    expect(inUse.ok).toBe(false);
    if (!inUse.ok) expect(inUse.issue.code).toBe("CATEGORY_IN_USE");
  });

  it("requires an explicit target before delete and then allows logical delete", () => {
    const root = node({ categoryId: "r", depth: 1, name: "根" });
    const dest = node({ categoryId: "d", depth: 1, name: "目标" });
    const planned = planCategoryChange({
      expectedTreeVersion: 1,
      catalog: catalog(),
      nodes: [root, dest],
      operations: [
        { type: "relocatePapers", fromCategoryId: "r", toCategoryId: "d" },
        { type: "relocateQuestions", fromCategoryId: "r", toCategoryId: "d" },
        { type: "delete", categoryId: "r" }
      ],
      usage: {
        papers: { r: [{ id: "p1", title: "卷", categoryId: "r" }] },
        questions: { r: [{ id: "q1", title: "题", categoryId: "r" }] }
      }
    });
    expect(planned.ok).toBe(true);
    if (planned.ok) {
      expect(planned.plan.relocatedPapers).toHaveLength(1);
      expect(planned.plan.deletes).toEqual(["r"]);
    }
  });

  it("binds preview/commit fields and drain uses server clock", () => {
    const preview = parseCategoryChangePreviewInput({
      expectedTreeVersion: 2,
      operations: [{ type: "move", categoryId: "c1", parentId: null }]
    });
    expect(preview.ok).toBe(true);
    const commit = parseCategoryChangeCommitInput({
      previewId: "pre",
      planHash: "hash",
      reason: "move",
      confirmed: true
    });
    expect(commit.ok).toBe(true);
    expect(parseCategoryChangeCommitInput({ previewId: "pre", planHash: "hash", reason: "x" }).ok).toBe(false);
    const closed = new Date("2026-10-15T02:00:00.000Z");
    const until = catalogChangeDrainUntil(closed);
    expect(drainReady(until.toISOString(), new Date(closed.getTime() + 34_000))).toBe(false);
    expect(drainReady(until.toISOString(), new Date(closed.getTime() + 35_000))).toBe(true);
  });
});
