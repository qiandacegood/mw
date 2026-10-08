import { describe, expect, it } from "vitest";
import { validateCategoryMove } from "./category.js";

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
});
