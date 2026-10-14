# MW15 实际结果

日期：2026-10-10（D 段手点与 leftover 收口：2026-10-14）
任务：交卷评分与成绩解析
状态：**已完成**（A/B 已接线；C 段部署与负向核验已通过；D 段用户手点 1–8 已闭合；leftover 经两轮精确清理 + 独立按 paper/member 核查为 0，见第 5 节；限制与发现见第 6 节）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码只存在于被 Git 忽略的本地 `.env`。本文未写入、未提交这些值。未写入明文 `_id` / paperId（只写 SHA-256 前缀）。

未把 A01—A31、T01—T30 标为通过。尤其未标 A04 / A05 / A06 / A07 / A08 / A11 / T08 / T09 / T10 / T11 / T15。未改写 MW12 为已完成。未改写 MW14（已完成）。未重开 MW13。未启动 MW16—MW20。未创建 orders / vip_*。未开启超额。未创建生产环境。等级仍返回当前配置下的 `L1`（成长门槛是 MW16）。

## 1 交付与可见结果

| 项 | 结果 |
| --- | --- |
| A 段：三题型判分与 `mw-member` 四条 action | 已接线（`attempt.submit` / `result` / `analysis` / `history`；事务内幂等结算） |
| B 段：结果页 / 解析 / 历史；已交卷改为查看结果 | 已接线 |
| C 段：集合与索引 | PASS（`paper_bests` / `score_events` / `score_metrics` 及指定索引；未重复建 attempts 历史索引） |
| C 段：部署与负向核验 | PASS（见第 3 节；未代用户手点） |
| D 段：用户手点 1–8 | 已闭合（用户手点并自报符合预期；见第 4 节） |
| 本地五项检查 | PASS（见第 2 节） |
| leftover=0 | 已闭合（两轮精确清理 + 独立按 paper/member 核查为 0；见第 5 节） |

## 2 本地检查

2026-10-10 与 2026-10-14 各跑一轮，退出码均为 0：

| 检查 | 退出码 |
| --- | --- |
| `npm run check:prototypes` | 0 |
| `npm run typecheck` | 0 |
| `npm run test` | 0（103 项通过） |
| `npm run build` | 0 |
| `git diff --check` | 0 |

跑检查前已确认 4174 / 5173 无后台 Vite（2026-10-14 收口时先停掉 4174 上的 Vite，再跑检查）。密钥扫描通过 387 个已跟踪文件；`apps/miniprogram/project.config.json` 仍为 `wx_placeholder_appid`。

已覆盖机制（本地 / 单元测试，不等于验收通过）：单选 / 多选 / 判断判分，多选全对才得分；拒绝多余题号、重复选项、非本卷答案；`UNANSWERED_CONFIRM_REQUIRED`；`newBest=max(oldBest,score)`、`delta=newBest-oldBest`，例 5/10/5 对应 delta 5/5/0；同键重放返回旧结果；不同最终答案 `ALREADY_SUBMITTED`；VIP 到期仍可查过去成功结果；`analysis` 仅限本人已提交；未交卷不含 answer / analysis / correctOptionIds；维护窗口 / 已撤回拒交卷。机制证据**不等于** A04 / A05 / A06 / A07 / A08 / A11 / T08 / T09 / T10 / T11 / T15 通过。

## 3 C 段部署与负向核验（仅 mw-test）

部署 `npm run mw15:deploy` 退出码 0：部署 `mw-member`；新建集合 `paper_bests`、`score_events`、`score_metrics`；建立索引 `idx_paper_bests_member_paper`（`memberId/paperId`）、`idx_score_events_member_paper_seq`（`memberId/paperId/scoreSeq`）、`idx_score_metrics_board_source`（`metricGeneration/scope/periodKey/categoryId/value/reachedAt/memberId`）；跳过 `idx_attempts_member_state_submitted_id`；`enableOverrun=false`。

负向核验 `npm run mw15:verify` 退出码 0，汇总 `ok: true`（证据 `tmp/mw15/mw15-verify-evidence.json`）：

| 项 | 结果 |
| --- | --- |
| 未授权 `attempt.submit` | `AUTH_REQUIRED`（`NO_FROM_APPID`） |
| 未授权 `attempt.result` | `AUTH_REQUIRED` |
| 伪造 `role` / `uid` | `FORBIDDEN` / `CLIENT_IDENTITY_IGNORED` |
| 公开入口 `mw-public` 调 submit | `FORBIDDEN` / `ACTION_DENIED` |
| 匿名 Web SDK 直写 `attempts` / `paper_answers` / `paper_bests` / `score_events` / `score_metrics` | 拒绝 |
| 集合 / 索引 | 在（`indexesOk=true`） |
| 未来集合 `orders` / `vip_*` | 未出现（`futurePresent=false`） |
| 种子十类计数 | 10 |
| `EnableOverrun` | false |

## 4 D 段用户手点（2026-10-14，执行者未代点）

由用户在微信开发者工具手点（环境 mw-test），后台先发含单选 / 多选 / 判断的虚构测试卷。执行者未用 CLI / automator / 服务端口冒充 FROM 或 admin。

| 步骤 | 结果 |
| --- | --- |
| 1. 游客先注册 | 通过（用户自报） |
| 2. 交卷得到分数 | 通过（用户自报） |
| 3. 未答确认 | 通过（用户自报） |
| 4. 逐题解析 | 通过（用户自报） |
| 5. 重复练习只计最高分 | 通过（用户自报；分数链见下） |
| 6. 已交卷入口改为查看结果 | 通过（用户自报） |
| 7. 历史成绩 | 通过（用户自报） |
| 8. VIP / 撤回 / 下架 / 停用 / 维护门禁 | 通过（用户自报） |

第 5 步分数链（用户观察）：满分 9 分卷，练习前总分 6；第 1 次对 1 题（3 分）总分仍 6；第 2 次全对（9 分）总分变 9；第 3 次全错（0 分）总分仍 9。**与云端记录一致**：该会员该卷共 6 条 `score_events`（scoreSeq 1–6，score 依次 3 / 6 / 3 / 9 / 0 / 9，delta 依次 3 / 3 / 0 / 3 / 0 / 0），累计 delta 9 = `member_stats.totalScore`。可见「只计最高分、只加增量、delta=0 不刷新达到时间」按设计工作。

期间出现 1 次 `DRAFT_CONFLICT`（草稿版本冲突）。触发原因：题目选完但草稿尚未保存完成即点「交卷」，本地 `expectedRevision` 落后于服务端。属 MW14 起的既有乐观并发门禁（`applySaveFail` → `conflictOpen`，用户可选「用服务端 / 用页面」），**不是缺陷**；正确姿势是等底部显示「已保存」再交卷。本项按预期门禁记录，不影响第 5 步结论。

## 5 leftover 收口（2026-10-14）

门禁与 MW13/MW14 同构：浏览 / 自动进页不记 leftover，只有用户主动点「记入本轮 leftover」的对象才进清单；导入只接受 SHA-256；空清单 / `wroteDocs=false` 判不干净；不得扫整表猜删。

收口经过（两轮，均有真实退出码）：

| 轮次 | 动作 | 结果 |
| --- | --- | --- |
| 1 | 用户记入 1 份卷 + 1 个 attempt 并复制 knownIds；`mw15:import-known-ids` → `mw15:resolve-known-ids` → `mw15:cleanup` → `mw15:verify-leftovers` | 导入 2 个哈希、解析出 1 卷 1 attempt、删 11 份对象；`verify-leftovers` 退出码 0、`ok:true`、`leftoverDocs=0`。**但这是"入册范围内"的 0，范围不完备（见下）** |
| 2 | 按已确认的本轮测试卷（用户确认 4 份 MW15 卷为本轮所建）做定点补齐，再 `mw15:cleanup` → `mw15:verify-leftovers` → 独立核查 | 补齐并删除 37 份对象（`failed=0`）；其后补删 1 条事件；`verify-leftovers` 退出码 0、`ok:true`；独立按 paper/member 核查本轮对象为 0 |

第 1 轮为何是"假 0"：本轮手点实际产生 **6 条 `score_events`、9 条 `attempts`（6 交卷 + 3 放弃）、1 条 `active_attempts`、以及本轮所建的 5 份测试卷**（其中 4 份仍在库：MW15虚构练习卷免费1 / MW15免费虚构练习卷3 / MW15VIP虚构练习卷 / MW15免费多选虚构练习卷2），而用户只记入 1 卷 + 1 个 attempt。`mw15:verify-leftovers` 只查已入册 knownIds，因此报 0 并不能证明云端干净。

第 2 轮补齐依据（不扫整表、不做模糊匹配）：以用户确认的本轮测试卷为锚点，按 `paperId` 精确关联出该卷下全部 attempt（含 abandoned）、其 version / chunk / answer，以及由这些 attempt 推导的 `score_events` / `paper_bests` / `score_metrics` / `active_attempts`，再交由既有 `mw15:cleanup` 按精确 `_id` 删除。**未触碰**非本轮对象：MW14 虚构练习卷2 下 2 条 abandoned attempt、以及 1 条卷文档已不存在的 abandoned attempt（`176cd400df` 前缀哈希），三者均保留原样，见第 6 节。

独立核查（不依赖 knownIds，按 member / paper 只读查询）结果：本轮 attempt 0、active_attempts 0、score_events 0、paper_bests 0、score_metrics 0、papers 0、versions / chunks / answers 0；种子十类仍在；未出现 `orders` / `vip_*`；索引仍在。

## 6 发现与限制

1. **`mw15:resolve-known-ids` 推导的事件 id 未能命中真实文档**。第 1 轮 `cleanup` 报告 `deleted: 11`，但其中 1 条 `score_events` 实际未被删除；用该事件真实 `_id` 删除才成功。原因是 resolve 依据 `scoreEventId(attemptId, gradeRevision)` 推算 id，而推算值与云端写入值不符（本份未查明差异来源，`attempts` 文档中 `gradeRevision` 字段投影为 `null`，需后续核实）。**同一缺陷还体现在：`db nosql execute` 的 DELETE 对不存在的 `_id` 也返回成功，导致 `failed` 计数无法反映"是否真的删到了"**。因此对 MW15 起，leftover 结论须附一条不依赖 knownIds 的独立核查。
2. **聚合指标被清后与总分不一致**。`score_metrics`（该会员 total / week / month / category 共 4 条）已随本轮清理删除，而 `member_stats.totalScore` 仍为 9（门禁明确不得删 member_stats）。服务端指标更新为 `previous.value + delta`，文档缺失时会从 0 起算，榜侧值将偏低。MW17（四维排行榜）开工前需要处理（重算或重建指标）。
3. **非本轮残留（保留未动，向上报告）**：MW14 虚构练习卷2（`413021bfa7`）下 2 条 abandoned attempt；`176cd400df` 下 1 条 abandoned attempt（该卷文档已不存在，属更早轮"卷已删、attempt 未记入"的同类问题）。
4. 曾出现 1 次 `DRAFT_CONFLICT`，见第 4 节，属预期门禁。
5. MW07 仅为技术样例，未真实扣款、未 iOS 现网、未购买闭环；A14 / A20 / T20 / T26 未标通过。

## 7 建议状态

**已完成**。A/B 已接线，C 段部署与负向核验通过，D 段用户手点 1–8 闭合，两轮精确清理后本轮 leftover 为 0（含独立核查），本地五项检查为 0。不标 A01—A31、T01—T30。不改 MW12，不改 MW14，不重开 MW13，不启动 MW16。发起人审核通过后提交推送收口；第 6 节第 2 项建议在 MW17 之前处理。
