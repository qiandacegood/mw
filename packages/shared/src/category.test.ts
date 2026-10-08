import { describe, expect, it } from "vitest";
import {
  INITIAL_ROOT_NAMES,
  categoryNameId,
  fictionalPapersOnEachLevel,
  paperMayHangOnCategory,
  parseCategoryCreateInput,
  parseCategoryUpdateInput,
  seedCategoryId,
  seedCategoryIds,
  validateCategoryMove,
  validateParentAssignment,
  validateCategoryName
} from "./category.js";

describe("category tree", () => {
  it("accepts depth 3 and rejects a fourth level or cycle", () => {
    expect(
      validateCategoryMove({
        ancestorIds: ["cat_fict_logic", "cat_fict_logic_deduction"],
        parentId: "cat_fict_logic_deduction"
      })
    ).toEqual({ ok: true, depth: 3 });
    expect(
      validateCategoryMove({
        ancestorIds: ["a", "b", "c"],
        parentId: "c"
      })
    ).toEqual({ ok: false, code: "CATEGORY_DEPTH_LIMIT" });
    expect(
      validateCategoryMove({
        ancestorIds: ["cat_fict_logic"],
        parentId: "cat_fict_logic_deduction",
        categoryId: "cat_fict_logic"
      })
    ).toEqual({ ok: false, code: "CATEGORY_CYCLE" });
  });

  it("treats initial ten names as seed config, not a closed enum", () => {
    expect(INITIAL_ROOT_NAMES).toHaveLength(10);
    expect(INITIAL_ROOT_NAMES).toContain("逻辑思维");
    const renamed = validateCategoryName("  逻辑思维·改名  ");
    expect(renamed).toEqual({ ok: true, name: "逻辑思维·改名", normalizedName: "逻辑思维·改名" });
    expect(seedCategoryIds()).toHaveLength(10);
    expect(new Set(seedCategoryIds()).size).toBe(10);
    expect(seedCategoryId("logical")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("allows papers to hang on depth 1, 2 and 3", () => {
    expect(paperMayHangOnCategory({ depth: 1, deletedAt: null })).toBe(true);
    expect(paperMayHangOnCategory({ depth: 2, deletedAt: null })).toBe(true);
    expect(paperMayHangOnCategory({ depth: 3, deletedAt: null })).toBe(true);
    expect(paperMayHangOnCategory({ depth: 4, deletedAt: null })).toBe(false);
    const papers = fictionalPapersOnEachLevel({
      depth1: "cat_fict_logic",
      depth2: "cat_fict_logic_deduction",
      depth3: "cat_fict_logic_condition"
    });
    expect(papers.map((item) => item.categoryId)).toEqual([
      "cat_fict_logic",
      "cat_fict_logic_deduction",
      "cat_fict_logic_condition"
    ]);
  });

  it("rejects self-parent, missing parent and move-into-descendant", () => {
    expect(
      validateParentAssignment({
        categoryId: "self",
        parentId: "self"
      })
    ).toMatchObject({ ok: false, code: "PARENT_MISSING" });
    expect(
      validateParentAssignment({
        categoryId: "self",
        parentId: "self",
        parent: { categoryId: "self", depth: 1, ancestorIds: [], deletedAt: null }
      })
    ).toEqual({ ok: false, code: "CATEGORY_CYCLE" });
    expect(
      validateParentAssignment({
        parentId: "missing"
      })
    ).toEqual({ ok: false, code: "PARENT_MISSING" });
    expect(
      validateParentAssignment({
        categoryId: "root",
        parentId: "child",
        parent: { categoryId: "child", depth: 3, ancestorIds: ["root", "mid"], deletedAt: null }
      })
    ).toEqual({ ok: false, code: "CATEGORY_CYCLE" });
    expect(
      validateParentAssignment({
        parentId: "leaf",
        parent: { categoryId: "leaf", depth: 3, ancestorIds: ["a", "b"], deletedAt: null }
      })
    ).toEqual({ ok: false, code: "CATEGORY_DEPTH_LIMIT" });
  });

  it("uses same-level normalized names for occupancy ids", () => {
    const left = categoryNameId(null, "逻辑思维");
    const right = categoryNameId("", "逻辑思维");
    const child = categoryNameId("parent", "逻辑思维");
    expect(left).toBe(right);
    expect(left).not.toBe(child);
  });

  it("rejects unknown fields and parent changes on update", () => {
    expect(
      parseCategoryCreateInput({
        name: "测试",
        ancestorIds: ["forged"],
        categoryId: "client-id"
      })
    ).toMatchObject({ ok: false });
    expect(
      parseCategoryUpdateInput({
        categoryId: "abc",
        expectedTreeVersion: 1,
        parentId: "other",
        name: "新名"
      })
    ).toMatchObject({ ok: false, reason: "PARENT_CHANGE_REQUIRES_MW18" });
  });
});
