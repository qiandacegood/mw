# MW15 交卷评分与成绩解析

开发手册 v0.1｜任务状态：已完成（A/B 已接线，C 段部署与负向核验已通过；D 段用户手点 1–8 与 leftover=0 已于 2026-10-14 闭合）
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)｜[结果](results/mw15-result.md)

本任务分多段。手点与 leftover=0 未闭合前，整项不得标已完成。只操作 mw-test。没有生产环境、没有真实支付。不开启超额。不复制 mw-validation-*。不启动 MW16—MW20。不标 A01—A31、T01—T30 通过。

## 分段

| 分段 | 名称 | 本对话 |
| --- | --- | --- |
| MW15-A | `@mw/shared` 三题型判分；`mw-member` 接通 `attempt.submit` / `result` / `analysis` / `history`；事务内幂等结算 | 已接线 |
| MW15-B | 小程序结果页、逐题解析、历史成绩；已交卷后答题页改为查看结果 | 已接线 |
| MW15-C | leftover 云脚本、集合索引、部署与负向核验 | 已通过（仅 mw-test；`mw15:deploy` / `mw15:verify` 退出码 0） |
| MW15-D | 用户手点与 leftover=0 | 已闭合（2026-10-14 用户手点 1–8；两轮精确清理 + 独立按 paper/member 核查为 0） |

## 目标与可见结果

1. 服务端三种判分：单选 / 多选 / 判断；多选题全部选对才得分。题号、选项、分值由试卷版本快照决定，客户端只提交选择。
2. 交卷成功响应含 attemptId / score / maxScore / correctCount / questionCount / bestScore / delta / totalScore / levelId / gradeRevision / submittedAt。
3. 结算按一致性「原子交卷」：`newBest=max(oldBest,score)`，`delta=newBest-oldBest`；`member_stats.totalScore` 只加 delta，`scoreSeq` 加一；写 `score_events`（含 weekKey/monthKey），更新 total / week / month 及含自身的三级类目指标；delta=0 不刷新达到时间。例：60/80/70 只计 80，delta 依次 60/20/0。
4. 同 `idempotencyKey`/`requestId` 重放返回旧结果；已 submitted 先核 `submitHash`，同请求返回旧结果，不同最终答案返回 `ALREADY_SUBMITTED`。不能因 VIP 到期拒绝查询过去成功结果。
5. 未答且 `confirmUnanswered=false` 返回 `UNANSWERED_CONFIRM_REQUIRED`，不静默丢弃。
6. `attempt.result` 处理中返回 `status=inProgress`；`attempt.analysis` 仅限本人已完成记录。
7. 可新建 mw-test 集合 `paper_bests` / `score_events` / `score_metrics` 及指定索引；不重复建 attempts 本人历史索引。

## leftover 门禁（沿用 MW13/MW14，不得回退）

1. 浏览 / 打开详情 / 自动进页不得写 leftover。只有用户主动点「记入本轮 leftover」的本轮测试对象才进清单，默认空清单。
2. 导入只接受 SHA-256。空清单 / 非哈希 / 导入哈希数大于匹配真实 `_id` 必须失败退出，不得把未匹配当 leftover=0。禁止 `find({},100)` 当全集。
3. 只删已解析的本轮 attempts / active_attempts、用户明确记入的本轮测试卷及其 version/chunk/answer，以及由这些 attempt 算出的 paper_bests / score_events / score_metrics。不得删种子十类，不得删 MW11—MW14 非本轮残留，不得删 `member_stats`。
4. 空 knownIds / `wroteDocs=false` 仍判 `WROTE_DOCS_FALSE`。leftover-verify 只查已解析 knownIds。`leftoverObjects` 不得写死 0。

## 必须由用户手点（D 段）

执行者不得代点，不得 automator / 服务端口 / CLI 冒充 FROM 或 admin 登录。

2026-10-14 已由用户手点完成 1–8 并自报符合预期；证据见 [results/mw15-result.md](results/mw15-result.md) 第 4、5 节。以下清单保留为当时执行依据。

前置：微信开发者工具打开本项目，环境为 mw-test。后台可新发含单选 / 多选 / 判断的虚构测试卷。

1. **游客先注册**：退出后打开免费测试卷点开始，先注册再回到详情。
2. **交卷得到分数**：免费卷答题后点「交卷」。有未答时应提示确认，不能静默丢掉。交卷后进入结果页，可见本次分 / 最高分 / 本次新增分 / 总分。
3. **未答确认**：留下至少一题未答再交卷。预期明确提示；确认后才提交，未答计 0。
4. **逐题解析**：结果页点「查看解析」。可见本人选择 vs 正确答案 + 解析。未交卷记录不得看到解析。
5. **重复练习只计最高分**：同一卷再答一次，分数低于或等于上次时，本次新增为 0，总分不重复加。可按 60/80/70 思路自检：只计最高 80。
6. **已交卷入口**：回到该答题记录，交卷按钮变为「查看结果」，不再重复结算。
7. **历史成绩**：从「我的」或试卷详情进入历史成绩，能看到本人已提交记录。
8. **门禁**：VIP 测试卷对免费会员仍 `VIP_REQUIRED`（不真实扣款）。已撤回 / 已下架 / 停用类目 / 维护窗口按既有门禁给明确状态。

leftover=0 收口（完成上面手点后）：

1. 只在本轮测试卷详情 / 答题页 / 结果页点「记入本轮 leftover」（浏览不记）。
2. 回首页点「复制本轮 leftover knownIds」。
3. 导入：`$env:MW15_KNOWN_IDS_JSON='<复制的JSON>'; npm run mw15:import-known-ids`
4. 解析：`npm run mw15:resolve-known-ids`
5. 精确删除：`npm run mw15:cleanup`
6. 核验：`npm run mw15:verify-leftovers` 须 leftoverDocs=0、wroteDocs=true、cloudWriteClaimed=true、exactIdSweepOnly=true、种子十类仍在、未出现 orders / vip_*。

1–8 与 leftover=0 全部闭合后，MW15 方可改为已完成。

## 不包含的工作

不启动 MW16 / MW17 / MW18 / MW19 / MW20。不实现勋章、等级门槛、四维榜单、类目迁移、题目纠错重评分、VIP 账本与购买。不创建 orders / vip_*。不把 A01—A31、T01—T30 标通过，尤其不标 A04 / A05 / A06 / A07 / A08 / A11 / T08 / T09 / T10 / T11 / T15。不改写 MW12 或 MW14，不重开 MW13。
