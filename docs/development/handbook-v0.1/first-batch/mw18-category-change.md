# MW18 类目迁移与安全删除

开发手册 v0.1｜任务状态：已完成（未标 A28—A30 / T03—T07）  
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)｜[结果](results/mw18-result.md)

本任务分多段。手点与 leftover=0 未闭合前，整项不得标已完成。只操作 mw-test。没有生产环境、没有真实支付。不创建 orders / vip_*。不开启超额。不启动 MW19—MW30。不把 A01—A31、T01—T30 标通过（尤其未标 A28—A30、T03—T07）。不改写 MW01—MW17 与 MW-UI01 的历史完成记录。

## 分段

| 分段 | 名称 | 本对话 |
| --- | --- | --- |
| MW18-A | `@mw/shared` 变更计划、子树合法性、分类指标代际映射、category-only 重建范围 | 已接线 |
| MW18-B | 服务端：`category.change.preview` / `commit`、持久 `catalog.change` 任务、交卷方案 A、category-only 榜单重建 | 已接线 |
| MW18-C | 后台迁移确认与进度；小程序结构更新状态（MW-UI01 TDesign 基线） | 已接线 |
| MW18-D | leftover 云脚本、集合、部署与负向核验 | 已部署；负向核验 `ok:true` |
| MW18-E | 用户手点与 leftover=0 | 已闭合（手点 1–12 + leftoverDocs=0） |

## 目标与可见结果

1. 超级管理员预览后确认：父级调整、整棵子树移动、迁题迁卷、引用预览、迁移后逻辑删除。
2. commit 绑定服务端预览、planHash、操作者、原因、树版本与目标；不信任前端自报计划。
3. 原子建立结构任务占用与维护标记，关闭 `contentWrites` / `attemptStart` / `attemptSubmit`；草稿保存、必要查询及支付保留能力不误阻断。
4. `notBefore = 关闭成功时刻 + 35 秒`（`nextRunAt`）；基于服务端时间，重复执行不能提前推进。35 秒是当前排空约定，不是平台自动排空。
5. 通过 `mw-jobs` 真实业务处理器分批推进，记录 cursor、前后摘要和可恢复状态；不把 MW06 demo handler 当作已实现迁移。
6. 分类投影采用方案 A：`total` / `week` / `month` 继续用 `base`；`category` 用 `catalog.categoryMetricsGeneration`。旧代 `0` 兼容读取 `base`；切换新代后不得因缺行悄悄回退旧代。
7. 交卷在事务内核对维护、当前试卷归属、树版本和分类指标代际；预先计算的路径在事务内必须再核对，变化则重算并有界重试。
8. 按可追溯 `paper_bests` 与当前试卷归属、新树重建分类指标；每会员每卷只计一次最高分；题库分类不参与计分。`reachedAt` 取 `paper_bests.firstReachedAt`，不把迁移时间冒充历史达到时间。不补记缺失来源。
9. 保留旧投影，校验完成后原子切换树版本与分类指标指针。分类指标代际与排名快照代际不混用。
10. 总分、周月指标、等级、勋章不因迁移变化，不产生新增计分事件；历史快照保留当时类目路径。
11. 停用保留指标：重建不因 `enabled=false` 丢弃合法成绩；导航/分类榜/本人分类名次/按 ID 查询均核验节点及祖先；总榜周月榜保留合法成绩；重新启用后基于保留指标刷新分类榜。
12. 停用禁止新开始，但不撤回已有答题；仍执行维护、试卷撤回、账号、VIP 等独立规则。
13. `ranking.rebuild` 的 category-only 路径：空榜替换、旧代清理、head 切换及刷新状态更新只作用于分类榜，不得清空 total/week/month。重建期间新产生的刷新请求予以保留。
14. 新树生效后旧分类快照不得继续当有效排名；新快照完成前显示更新中。榜单刷新失败不得伪装整体成功。

## 已裁定（本轮不重开）

1. 分类投影新代方案 A。
2. 使用持久任务推进；`job.resume` 只用于恢复。
3. 停用保留指标，读侧控制展示。
4. 不补记历史缺失来源。
5. 支付保留接口使用隔离替身，真实支付联查留待 MW21。

## 正常自动推进触发链路

1. `category.change.commit` 在同一事务内：校验并绑定服务端预览 → 建立 `catalog.change` 任务占用 → 关闭三项维护开关 → 记录 `closedAt` 与 `nextRunAt=closedAt+35s`。
2. 服务端签发 `jobs.tick`（`MW_JOBS_INVOKE_TOKEN`）作为正常调度入口；每次 tick 只认领 `nextRunAt <= now` 且类型为 `catalog.change` / `ranking.refresh.category` 的到期任务，按当前租约与 `fencingToken` 写一批。
3. 未到 `notBefore` 的 tick 只返回 `pendingUntil`，不推进结构。
4. 同一租约内可继续后续已到期批次，直到租约或事务预算用尽；未完成则保留 cursor，等待下一次 tick。
5. CloudBase 平台定时器若配置 `MW_JOBS_PLATFORM_TICK=1` 且无客户端身份，只合成 `jobs.tick`，不能当作 demo acquire/succeed。未配置时，无签名 Timer 仍为 `FORGED_TIMER_DENIED`（MW06 口径不变）。
6. `job.resume` 只把 `needsReview` / `retryable` 拉回 `queued`，不能跳过校验或提前解除维护。租约过期不自动开放入口。
7. 指针已切换并重新开放写入后，结构回退必须走新的反向维护任务，不能覆盖之后的新业务。

## leftover 门禁

| 类别 | 是否计入 leftover | 规则 |
| --- | --- | --- |
| 本轮专用测试类目 / 题 / 卷 / 答题派生 | 是 | 只清专用测试子树与其派生；不借用种子十类或既有业务树作可删除对象 |
| 种子十类与既有业务数据 | 否 | 永不删除 |
| `jobs` / `audit_logs` / 幂等 / 逻辑删除墓碑 | 否（恢复证据） | 不把审计和任务恢复证据一律删除 |
| `ranking_heads` / `ranking_rows` / `app_config/ranking` | 否 | 派生共享聚合；收口末尾重建分类榜，不删共享快照 |
| `orders` / `vip_*` | 禁止出现 | 本轮不得创建 |

## 必须由用户手点（E 段）

执行者不得代点，不得 automator / CLI 冒充 FROM 或 admin 登录。可执行授权范围内的部署、只读核验和本地测试。

手点清单见结果文件。覆盖：预览过期、层级/循环/重名/引用校验、关闭入口与并发交卷、35 秒前不可推进、中断恢复、重复批次、过期工作器拒写、新代校验及原子切换、父级去重与计分不变、停用/恢复及已有答题继续、分类榜刷新失败与重试、category-only 重建不影响其他榜。

## 不包含的工作

不启动 MW19—MW30。不实现题目纠错重评分、VIP 账本与购买、退款对账。不把 A28—A30 / T03—T07 标为正式验收通过。不自动提交、推送或发布。
