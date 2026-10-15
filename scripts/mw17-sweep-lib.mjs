import { hashId, countQuery } from "./mw16-sweep-lib.mjs";

/**
 * MW17 独立核查复用 MW16 的「按 memberId / paperId 关系精确查询」实现：
 * MW17 的残留范围（attempts / active_attempts / paper_bests / score_events / score_metrics /
 * medal_grants + 用户标记的 papers / questions / assets）与 MW16 完全一致，
 * 且同样不做任何 id 推导、不扫整表猜删、不按 memberId 全量删除。
 */
export {
  countQuery,
  deleteExact,
  docIdOf,
  findAll,
  findByHash,
  findPage,
  hashId,
  resolveScopes,
  sweepDelete,
  sweepDocs
} from "./mw16-sweep-lib.mjs";

/**
 * 榜单快照残留核查：本轮标记的测试身份是否还留在 ranking_rows 里。
 *
 * - `ranking_heads` 只存板块（scope / periodKey / categoryId / generation / 计数），**不含任何成员身份**，
 *   因此按成员核查只需要看 `ranking_rows`；
 * - 快照是派生共享数据，**不删除**：收口时由用户在后台「重建并发布榜单快照」，
 *   本轮身份的可追溯指标已被 cleanup 删除，重建后其名次行自然消失；
 * - 输出只用 memberId 的 SHA-256 前缀，不落明文身份。
 */
export async function countSnapshotResidual(memberIds) {
  const unique = [...new Set((memberIds || []).filter((id) => typeof id === "string" && id))];
  const counts = {};
  let total = 0;
  for (const memberId of unique) {
    const found = await countQuery("ranking_rows", { memberId });
    if (found === null) return { counts, total: -1, confirmed: false };
    counts[hashId(memberId).slice(0, 12)] = found;
    total += found;
  }
  return { counts, total, confirmed: true };
}
