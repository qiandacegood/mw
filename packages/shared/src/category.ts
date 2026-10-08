export const MAX_CATEGORY_DEPTH = 3;

export function depthFromAncestors(ancestorIds: string[]): number {
  return ancestorIds.length + 1;
}

export function validateCategoryMove(input: {
  ancestorIds: string[];
  parentId: string | null;
  categoryId?: string;
}): { ok: true; depth: number } | { ok: false; code: "CATEGORY_DEPTH_LIMIT" | "CATEGORY_CYCLE" } {
  if (input.parentId && input.categoryId && input.parentId === input.categoryId) {
    return { ok: false, code: "CATEGORY_CYCLE" };
  }
  if (input.categoryId && input.ancestorIds.includes(input.categoryId)) {
    return { ok: false, code: "CATEGORY_CYCLE" };
  }
  const depth = depthFromAncestors(input.ancestorIds);
  if (depth < 1 || depth > MAX_CATEGORY_DEPTH) {
    return { ok: false, code: "CATEGORY_DEPTH_LIMIT" };
  }
  return { ok: true, depth };
}
