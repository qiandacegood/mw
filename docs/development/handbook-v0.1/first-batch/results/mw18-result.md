# MW18 实际结果

日期：2026-10-15
任务：[类目迁移与安全删除](../mw18-category-change.md)
状态：**已完成**（A/B/C 已接线；D 段 mw-test 部署与负向核验通过；E 段用户手点 1–12 与 leftover=0 已闭合。未标 A28—A30 / T03—T07）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码只存在于被 Git 忽略的本地 `.env`；本文不写入、不提交这些值，也不写明文 `_id` / `memberId`。

未把 A01—A31、T01—T30 标为通过，尤其未标 **A28—A30 / T03—T07**。未创建 `orders` / `vip_*` 文档。未开启超额。未启动 MW19—MW30。未改写 MW01—MW17 与 MW-UI01 的历史完成记录。未自动提交、推送或发布。

## 1 五块实际状态

| 块 | 状态 | 说明 |
| --- | --- | --- |
| 结构迁移 | 手点通过 | 测A 迁到测B 下（depth 3）；`treeVersion` 14→15；维护期公开分类页只显示「结构更新中」 |
| 分类投影 | 手点通过 | 切换后 `categoryMetricsGeneration` 0→1；停用后已开始答题仍可交卷 |
| 排行榜刷新 | 手点通过 | 只重建分类榜后 `publishedGeneration` 仍为 `gen_3183f198…`；total/week/month 行数未被这次重建改掉 |
| 恢复演练 | 本轮未触发失败恢复 | 主任务一次 `jobs.tick` 即 `succeeded` / `rankingStatus=ok`；未点「恢复失败任务」 |
| 测试数据收口 | leftover=0 | 入册 12 条本轮哈希后精确删除 12、失败 0；种子十类仍 10；jobs/审计/榜/成绩未删 |

## 2 本地检查

2026-10-15 执行，当时 4174 后台 Vite **未在运行**：

| 检查 | 退出码 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 0 | admin / miniprogram / shared / api |
| `npm test` | 0 | 含 `mw18-assert`；workspaces **289** 项（admin 8 / miniprogram 36 / shared 115 / api 130） |
| `npm run build` | 0 | 小程序 24 入口；`checked 206 miniprogram files`；TDesign 1.17.0 |
| `git diff --check` | 0 | 仅 CRLF 工作副本提示，无尾随空格失败 |
| `npm run mw18:assert` | 0 | leftover 门禁：空清单 / 未写入不得当 0 |

本地覆盖（机制证据，不等于验收通过）：预览过期、有引用必须先迁移、content 角色不能预览、`update.parentId` 仍拒、35 秒前 `listDue` 不推进、伪造 Timer 仍 `FORGED_TIMER_DENIED`、维护期公开树 `updating` 且 `nodes=[]`、category-only 重建后 total/week/month 仍可读且 `publishedGeneration` 不变、重建期间新 `requestedAt` 保留。

## 3 D 段部署与负向核验（仅 mw-test）

`npm run mw18:deploy` 两次退出码 0（第二次为首页半棵树隐藏补丁后重部署）。`runtime.sha256=fe286a85…`。

| 项 | 结果 |
| --- | --- |
| 部署入口 | `mw-admin` / `mw-jobs` / `mw-public` / `mw-member` |
| 新建集合 | `catalog_change_previews`、`catalog_change_jobs`（首次 `existed=false`） |
| 索引 | `idx_catalog_change_previews_expires`、`idx_jobs_type_state_nextrun` |
| `EnableOverrun` | false |
| 其它环境计数 | 2（未触碰） |

`npm run mw18:verify` 退出码 0，`ok:true`：

| 项 | 结果 |
| --- | --- |
| 未登录 `category.change.preview` | `AUTH_REQUIRED` |
| 无签名 Timer | `FORGED_TIMER_DENIED` |
| 公开 `category.tree` | `ok:true`、`updating=false`、种子十类 10 个节点 |
| 本轮集合 | 两集合计数 0 |
| 种子十类 | 10 |
| `orders` / `vip_*` | 集合名可能历史存在，**文档计数均为 0**；本轮未创建 |

## 4 E 段用户手点（已闭合）

执行者未 automator / CLI 冒充 super 或微信身份。只操作本轮专用测试子树。

用户手点结论：1–4 负向（预览过期、`CATEGORY_CYCLE`、`NAME_CONFLICT`、`PARENT_CHANGE_REQUIRES_MW18`）此前已报符合预期；5–7 提交维护任务、维护中隐藏半棵树、签名 `jobs.tick` 后结构完成且分类榜 ready；8 总/周/月榜与迁移前一致；9 停用有回馈、已开始卷交卷成功后再启用；10 只重建分类榜后已发布代不变；11 未触发（任务已成功）；12 入册清理见下。

手点中修过的云写入：commit 避开 CloudBase 多文档事务与 `_id` 回写；交卷在分类代际切换后先读当前 `categoryMetricsGeneration`，避免误报 `SERVICE_BUSY`。

1. 后台用 **super** 登录。content 角色点「预览移动」应 `FORBIDDEN` / `SUPER_ROLE_REQUIRED`。
2. 新建专用二级（或三级）测试节点，再在该节点保存一道虚构题、组一份虚构卷并发布。不要借用历史卷。
3. 只预览删除该节点：应 `CATEGORY_IN_USE`。填目标父级后「预览迁出后删除」应列出迁题迁卷。
4. 预览后等超过 10 分钟再确认：应 `PREVIEW_EXPIRED`。重新预览。
5. 预览把测试节点移到另一合法父级，确认提交。应关闭 `contentWrites` / `attemptStart` / `attemptSubmit`；草稿保存、查询、支付保留不应被误阻断。
6. 提交后立刻读进度：维护中。35 秒内公开分类页 / 首页应显示「结构更新中」，不出现半棵树。不要点「恢复」代替正常调度。
7. 35 秒后由已部署的 `jobs.tick` 或平台 tick（仅当 `MW_JOBS_PLATFORM_TICK=1`）推进。结构完成后分类榜可能仍「更新中」或「结构已完成、榜单待恢复」。
8. 分类榜刷新成功后，总榜 / 周榜 / 月榜名次与分数应与迁移前一致；等级、勋章不变。历史快照保留当时类目路径。
9. 停用测试节点：新开始应拒；已开始的答题应仍可交卷。再启用后分类榜可按保留指标刷新，无需重做。
10. 后台 `ranking.rebuild` 只勾分类范围（或走迁移触发的 category-only）：确认总分 / 周 / 月榜仍能读。
11. 若任务失败：用「恢复失败任务」`job.resume`，不要手改库。租约过期后旧工作器不得再写。
12. 收口：只把**本轮新建**的类目 / 题 / 卷 / preview 哈希复制出来（不要种子十类、不要 jobs/审计）。然后：

```text
npm run mw18:import-known-ids -- "<json>"
npm run mw18:cleanup
npm run mw18:verify-leftovers
```

不得以清理为由删除共享 `ranking_*` / `app_config` / 历史成绩。确需把测试节点移回时走新的反向维护任务，版本只增不减。

## 5 leftover 规则（重申）

| 类别 | leftover | 规则 |
| --- | --- | --- |
| 本轮专用测试类目 / 题 / 卷 / preview | 是 | 只按入册哈希精确删 |
| 种子十类与既有业务树 | 否 | 脚本拒绝删种子 ID |
| `jobs` / `audit_logs` / 幂等 / 墓碑 | 否 | 恢复证据保留 |
| `ranking_heads` / `ranking_rows` / `app_config` | 否 | 共享派生，不删 |
| `score_metrics` / `paper_bests` / 会员总分 | 否 | 不补记、不清历史成绩 |
| `orders` / `vip_*` | 禁止出文档 | 本轮未创建 |

空清单或 `wroteDocs=false` 不得报 leftover=0。

## 6 契约与兼容

- `category.update` 仍拒绝 `parentId`；改父级只走 preview/commit。
- 分类指标代际 ≠ 排名快照代际。`ranking.rebuild` 的 category-only 不得改 `publishedGeneration`。
- 交卷在事务内核对维护、当前试卷归属、树版本、分类指标代际；路径变化则重算并有界重试。
- 分类重建的 `reachedAt` 来自 `paper_bests.firstReachedAt`，不用迁移时间冒充历史达到时间。不补记缺失 best / 事件。
- 支付保留仍用隔离替身，真实支付联查留待 MW21。

第 12 步收口（2026-10-16）：用户确认入册后 `mw18:import-known-ids` `knownIdCount=12`（类目 2 / 题 1 / 卷 1 / 预览 8）；`mw18:cleanup` `targetCount=12` `deleted=12` `failed=0`；`mw18:verify-leftovers` **`ok:true`**、`leftoverDocs=0`、`seedPresent=10`、`reason=LEFTOVER_CLEARED`。未删 jobs / 审计 / 幂等 / 共享榜 / 历史成绩。

## 7 剩余缺口

- 未把 A28—A30 / T03—T07 标正式通过。
- 过期工作器拒写、分类榜失败后 `job.resume` 重试，本轮未遇到失败，仍只靠本地机制与任务书口径。
- 未标 A28—A30 / T03—T07 正式通过。发起人确认后提交推送收口。
