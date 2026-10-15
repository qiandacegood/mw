import { callOfficialAction } from "./shared-cloud";

/**
 * MW17 四维排行榜接口接线。
 *
 * 口径（见 docs/product/product-spec-v1.1.md 第 10 节）：
 * - 免费卷与 VIP 卷统一计入，**不带任何费用筛选参数**；
 * - 分类榜必须传当前有效类目；
 * - ranking.list 为公开只读（游客可看前百），ranking.me 需要已注册会员。
 */
export type RankingScopeName = "total" | "category" | "week" | "month";

export const RANKING_SCOPES: RankingScopeName[] = ["total", "category", "week", "month"];

function offline(): Record<string, unknown> {
  return { ok: false, error: { code: "SERVICE_BUSY", message: "网络失败或服务繁忙", retryable: true } };
}

export async function rankingList(input: {
  scope: RankingScopeName;
  categoryId?: string;
  cursor?: string;
  limit?: number;
}): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = { scope: input.scope };
  if (input.categoryId) data.categoryId = input.categoryId;
  if (input.cursor) data.cursor = input.cursor;
  if (input.limit) data.limit = input.limit;
  try {
    return await callOfficialAction("mw-public", "ranking.list", data, {
      requestId: `req_mp_ranking_list_${Date.now()}`
    });
  } catch {
    return offline();
  }
}

export async function rankingMe(
  scope: RankingScopeName,
  categoryId?: string
): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = { scope };
  if (categoryId) data.categoryId = categoryId;
  try {
    return await callOfficialAction("mw-member", "ranking.me", data, { requestId: `req_mp_ranking_me_${Date.now()}` });
  } catch {
    return offline();
  }
}

/** 主动参与 / 退出公开排行；需要本人当前 revision 做乐观并发。 */
export async function setRanking(enabled: boolean, expectedRevision: number): Promise<Record<string, unknown>> {
  try {
    return await callOfficialAction(
      "mw-member",
      "member.setRanking",
      { enabled, expectedRevision },
      { idempotencyKey: `mw17/mp/setRanking/${Date.now()}`, requestId: `req_mp_set_ranking_${Date.now()}` }
    );
  } catch {
    return offline();
  }
}

/** 公开类目树：分类榜的类目选择器用同一份可见类目。 */
export async function publicCategoryTree(): Promise<Record<string, unknown>> {
  try {
    return await callOfficialAction("mw-public", "category.tree", {}, { requestId: `req_mp_tree_${Date.now()}` });
  } catch {
    return offline();
  }
}
