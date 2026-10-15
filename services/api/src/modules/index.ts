export const plannedModules = [
  "identity",
  "catalog",
  "quiz",
  "scoring",
  "ranking",
  "billing",
  "imports",
  "audit"
] as const;

/** MW16 已落地的成长模块（等级门槛、勋章授予、后台配置预览发布）。 */
export const implementedGrowthModule = "growth" as const;

/**
 * MW17 已落地的排行模块（四维榜单快照、公开榜与本人名次、会员参与/退出、后台重建发布）。
 * 归属 `plannedModules` 中的 `ranking`。
 */
export const implementedRankingModule = "ranking" as const;
