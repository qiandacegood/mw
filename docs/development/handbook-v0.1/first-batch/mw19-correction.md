# MW19 题目纠错与历史重评分

开发手册 v0.1｜任务状态：已完成（A—D 接线与 mw-test 核验通过；E 段用户手点 1–12 与 leftover=0 已闭合。未标 A22 / A23 / T18 / T19）  
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)｜[结果](results/mw19-result.md)

本任务分多段。只操作 mw-test。没有生产环境、没有真实支付。不创建 orders / vip_*。不开启超额。不启动 MW20—MW30。不把 A01—A31、T01—T30 标通过（尤其未标 A22 / A23 / T18 / T19）。不改写 MW01—MW18 与 MW-UI01 的历史完成记录。不自动提交、推送或发布。

## 分段

| 分段 | 名称 | 本对话 |
| --- | --- | --- |
| MW19-A | `@mw/shared` 纠错计划、影响预览、重评序列、补偿事件、幂等与任务游标 | 本对话实现 |
| MW19-B | 服务端 `correction.preview` / `commit`、持久重评任务、交卷/成长/分类指标/榜刷新一致性 | 本对话实现 |
| MW19-C | 后台预览确认与进度；小程序历史结果更正提示（沿用 MW-UI01 TDesign，不大改视觉） | 本对话实现 |
| MW19-D | leftover 云脚本、集合、部署与负向核验 | 本对话部署到 mw-test |
| MW19-E | 用户手点与 leftover=0 | 已闭合（手点均通过；leftover=0） |

## 目标与可见结果

1. 正确答案确实错误时：先紧急撤回（沿用 MW11 `paper.withdraw`）→ 修订并生成影响预览 → super 确认后重评。
2. 保留原试卷版本、原交卷事件与旧结果；生成新的 `gradeRevision`、当前结果和补偿事件，不覆盖证据。
3. 按每会员每试卷的 `scoreSeq` 重放全部有效尝试；重算该卷最高分、总分、分类分及**原交卷周期**分差。只改当前最高分、不改周/月事件，算错误实现。
4. 不把旧修复记成本周/本月新增进步。补偿事件沿用原 `weekKey` / `monthKey` / `submittedAt`。
5. 相同纠错任务不得二次补分；中断可按 cursor 接续；既得勋章保留，按新总分算当前等级。
6. 题数/分值/题序/选项结构变化不擅自换算旧卷，当作新卷（`STRUCTURAL_CHANGE`）。
7. 用户历史结果与结果页须标识「本记录已因题目纠错修正」，不能静默改分。
8. 使用 MW06 持久任务推进；`job.resume` 只恢复，不能跳过校验或提前解除维护。确认后关闭交卷并排空；首版全站短时 `attemptSubmit` 维护，不引入复杂分片锁。`notBefore = 关闭成功时刻 + 35 秒`。
9. 历史缺失指标不补记（MW16/MW17 已定）：有行才加减，缺行只留补偿事件。
10. 分类投影继续方案 A；纠错重评必须先读当前 `categoryMetricsGeneration`，不得把分类代际悄悄回退到 `base`。

## 已裁定（本轮不重开）

1. 先撤回，再预览，再 super 确认重评。
2. 原事件只追加补偿，不覆盖。
3. 分差归回原周期；禁止把修复记入当前周/月。
4. 相同 `planHash` 任务幂等，不得二次补分。
5. 结构变化当作新卷。
6. 用户可见更正说明。
7. MW06 jobs + `job.resume` 只恢复。
8. 全站短时交卷维护，35 秒排空。
9. 缺失指标不补记。
10. 分类投影方案 A，禁止代际回退。

## 正常自动推进触发链路

1. `correction.commit` 在同一逻辑提交内：校验并绑定服务端预览 → 建立 `grade.correction` 任务 → 关闭 `attemptSubmit` → 记录 `closedAt` 与 `nextRunAt=closedAt+35s`。
2. 服务端签发 `jobs.tick`（`MW_JOBS_INVOKE_TOKEN`）作为正常调度入口；每次 tick 认领到期的 `grade.correction`（以及既有 `catalog.change`）。
3. 未到 `notBefore` 的 tick 只返回 `pendingUntil`，不重评。
4. 按会员分页重评，保存 cursor；租约与 `fencingToken` 校验，过期工作器拒写。
5. 全量处理后开放本任务占用的交卷门，并触发四维榜刷新（不是 category-only）。
6. `job.resume` 只把 `needsReview` / `retryable` 拉回 `queued`。租约过期不自动开放入口。

## leftover 门禁

| 类别 | 是否计入 leftover | 规则 |
| --- | --- | --- |
| 本轮专用测试题 / 卷 / 答题 / 纠错预览与工作文档 | 是 | 按入册哈希精确删 |
| 由本轮 attempt 算出的 `paper_bests` / `score_events` / 本轮 `score_metrics` | 是 | 只清本轮对象 |
| 种子十类与既有业务数据 | 否 | 永不删除 |
| `jobs` / `audit_logs` / 幂等 | 否（恢复证据） | 不把审计和任务恢复证据一律删除 |
| `ranking_heads` / `ranking_rows` / `app_config` | 否 | 共享聚合；收口末尾可重建榜，不删共享快照 |
| 历史成绩、会员账号、`member_stats` | 否 | 不删账号与既有成长态 |
| `orders` / `vip_*` | 禁止出现 | 本轮不得创建 |

空清单或 `wroteDocs=false` 不得报 leftover=0。沿用 MW15 起的独立核查，不能只靠 DELETE 成功计数。

## 必须由用户手点（E 段）

执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。可做授权范围内的部署、只读核验、签名 `jobs.tick`、本地测试。

手点清单见结果文件。覆盖：未撤回拒绝、结构变化拒绝、预览过期、content 角色拒绝、关闭交卷、35 秒前不推进、60/80/70→90 分差归原周期、不记入本周、重复任务不二次补分、中断可接续、更正提示、既得勋章保留、缺指标不补记。

## 不包含的工作

不启动 MW20—MW30。不实现 VIP 账本、购买、退款、运营统计、备份演练。不把 A22 / A23 / T18 / T19 标为正式验收通过。不自动提交、推送或发布。
