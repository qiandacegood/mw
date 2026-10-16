# MW19 实际结果

日期：2026-10-16
任务：[题目纠错与历史重评分](../mw19-correction.md)
状态：**已完成**（A/B/C 已接线；D 段 mw-test 部署与负向核验通过；E 段用户手点 1–12 与 leftover=0 已闭合。未标 A22 / A23 / T18 / T19）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码只存在于被 Git 忽略的本地 `.env`；本文不写入、不提交这些值，也不写明文 `_id` / `memberId`。

未把 A01—A31、T01—T30 标为通过，尤其未标 **A22 / A23 / T18 / T19**。未创建 `orders` / `vip_*` 文档。未开启超额。未启动 MW20—MW30。未改写 MW01—MW18 与 MW-UI01 的历史完成记录。未自动提交、推送或发布。执行者未 automator / CLI / 浏览器冒充 super 或微信身份。

## 1 五块实际状态

| 块 | 状态 | 说明 |
| --- | --- | --- |
| 纠错计划与补偿 | 已接线 | `@mw/shared`：结构指纹不含答案、按 `scoreSeq` 重放、补偿事件归原 `weekKey`/`monthKey`/`submittedAt`、同任务跳过、缺指标不补记、分类代际禁止回退 `base` |
| 预览 / 确认 / 持久任务 | 已接线 | `correction.preview` / `commit` / `status`；先撤回；`grade.correction`；只关 `attemptSubmit`；`notBefore=+35s`；`job.resume` 只恢复 |
| 后台与小程序提示 | 手点通过 | 试卷页 MW19 预览确认进度；结果页 / 历史「本记录已因题目纠错修正」 |
| mw-test 部署与负向 | 见第 3 节 | 只部署 mw-test；负向 CLI 不手点 |
| 用户手点与 leftover=0 | **已闭合** | 用户确认手点均通过；入册后精确删除 30、失败 0；`leftoverDocs=0`；种子十类仍 10 |

## 2 本地检查

2026-10-16 执行。跑前占用 4174 的后台 Vite（pid 11880）已先停，避免 `ensure-shared-js` 锁 `packages/shared/dist`。

| 检查 | 退出码 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 0 | admin / miniprogram / shared / api |
| `npm test` | 0 | 含 `mw19-assert`；workspaces **300** 项（admin 8 / miniprogram 36 / shared 122 / api 134） |
| `npm run build` | 0 | 小程序 24 入口；`checked 206 miniprogram files`；TDesign 1.17.0；`runtime.sha256` 前缀 `11acd5d763f3` |
| `git diff --check` | 0 | 仅 CRLF 工作副本提示，无尾随空格失败 |
| `npm run mw19:assert` | 0 | leftover 门禁：空清单 / 未写入不得当 0 |

本地机制覆盖（不等于验收通过）：未撤回拒绝、结构变化拒绝、预览过期、content 角色 `FORBIDDEN`、35 秒内 `listDue` 不推进、补偿进入原周不进本周、同 `planHash` 不二次补分、缺分类指标不补记、伪造 Timer `FORGED_TIMER_DENIED`、签名 `jobs.tick` 可推进。

## 3 D 段部署与负向核验（仅 mw-test）

`npm run mw19:deploy` 退出码 0。`runtime.sha256` 前缀 `11acd5d763f3`。

| 项 | 结果 |
| --- | --- |
| 部署入口 | `mw-admin` / `mw-jobs` / `mw-member` / `mw-public` |
| 集合 | `correction_previews`、`correction_jobs`（本次 `existed=true`，创建码 5 视为已存在） |
| 索引 | `idx_correction_previews_expires`、`idx_attempts_paper_state_id`（`listed=true`） |
| `EnableOverrun` | false |
| 其它环境计数 | 2（未触碰） |

`npm run mw19:verify` 退出码 0，`ok:true`：

| 项 | 结果 |
| --- | --- |
| 未登录 `correction.preview` | `AUTH_REQUIRED` |
| 无签名 Timer | `FORGED_TIMER_DENIED` |
| 本轮集合 | 两集合计数 0（部署当时） |
| 种子十类 | 10 |
| `orders` / `vip_*` | **文档计数均为 0**；本轮未创建 |

## 4 E 段用户手点（已闭合）

执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。可做授权范围内的部署、只读核验、签名 `jobs.tick`、本地测试。

用户 2026-10-16 确认手点 1–12 均通过。执行者未代登 super / 微信。35 秒后签名 `jobs.tick` 一次即 `succeeded` / `rankingStatus=ok`，交卷门打开。

1. 后台用 **super** 登录。content 角色点「预览重评影响」应 `FORBIDDEN` / `SUPER_ROLE_REQUIRED`。
2. 新建专用测试题与测试卷并发布。微信侧用本轮会员交卷三次，分数按 **60 / 80 / 70**（或等价：先错后对，使该卷最高分为 80、后两次不刷新最高分）。记下原交卷所在周。不要用历史会员。
3. 未撤回时 super 预览：应 `PAPER_NOT_WITHDRAWN`。
4. 紧急撤回（MW11）。再把同一题结构修订正确答案并发布新版本。`fromVersionId` = 撤回前版本，`toVersionId` = 修订后版本。
5. 故意改分值或题数再预览：应 `STRUCTURAL_CHANGE`，当作新卷，不换算旧卷。改回同结构后重新预览。
6. 预览后等超过 10 分钟再确认：应 `PREVIEW_EXPIRED`。重新预览。
7. 确认提交重评。应只关闭 `attemptSubmit`，不关开始答题、不关内容写、不关支付。立即交卷应维护拒绝。35 秒内读进度应为排空中；不要用「恢复失败任务」代替正常调度。
8. 35 秒后由已部署的签名 `jobs.tick`（或仅当 `MW_JOBS_PLATFORM_TICK=1` 的平台 tick）推进。任务成功后交卷门应打开。该卷最高分、总分、分类分按重放更新；**分差记入原交卷周/月**，不得出现在本周/本月新增进步。60/80/70 纠成 90 时，原周应 +30、后一周 −20，本周无新增。
9. 同一预览/同一 `planHash` 再确认：不得再写一套补偿事件。中断后 `job.resume` 只恢复，不跳过校验。
10. 小程序该次历史结果与结果页须出现「本记录已因题目纠错修正」，不能静默改分。既得勋章仍在；当前等级按新总分。解析按修订后答案，题干仍来自原快照版本。
11. 若该会员该分类指标行本来就不存在：重评后仍无该行，只留补偿事件，不补记。
12. 收口：只把**本轮新建**的题 / 卷 / 版本块 / preview / job 哈希复制出来（试卷页「复制试卷 knownIds」；不要种子十类、不要 `jobs` / 审计 / 幂等 / 共享 `ranking_*` / `app_config` / 历史成绩 / 会员账号）。然后：

```text
npm run mw19:import-known-ids -- "<json>"
npm run mw19:resolve-known-ids
npm run mw19:cleanup
npm run mw19:independent-check
npm run mw19:verify-leftovers
```

第 12 步收口（2026-10-16）：用户粘贴试卷页 knownIds 后 `mw19:import-known-ids` `knownIdCount=9`；`mw19:resolve-known-ids` 9 条哈希全部命中，按 `paperId` 补齐 attempt/event/best 等到 25；再按入册卷题面关系补入未进剪贴板的另一题及题版本后共 30。`mw19:cleanup` `targetCount=30` `deleted=30` `failed=0`。`mw19:independent-check` `remain=0`。`mw19:verify-leftovers` **`ok:true`**、`leftoverDocs=0`、`independentRemain=0`、`seedPresent=10`、`reason=LEFTOVER_CLEARED`。未删 jobs / 审计 / 幂等 / 共享榜 / `app_config` / 种子十类 / 历史会员账号。

## 5 leftover 规则（重申）

| 类别 | leftover | 规则 |
| --- | --- | --- |
| 本轮专用测试题 / 卷 / 答题 / 纠错预览与工作文档 | 是 | 按入册哈希精确删；resolve 后按 paperId 关系补齐 attempt/event/best |
| 由本轮 attempt 算出的 `paper_bests` / `score_events` | 是 | 只清本轮对象 |
| 种子十类与既有业务数据 | 否 | 永不删除 |
| `jobs` / `audit_logs` / 幂等 | 否（恢复证据） | 不把审计和任务恢复证据一律删除 |
| `ranking_heads` / `ranking_rows` / `app_config` | 否 | 共享聚合 |
| 历史成绩、会员账号、`member_stats` | 否 | 不删账号与既有成长态 |
| `orders` / `vip_*` | 禁止出现 | 本轮不得创建 |

## 6 契约与兼容

- 原试卷版本、原交卷事件、旧结果保留；只追加 `gradeRevision`、当前结果与 `kind=correction` 补偿事件。
- 补偿 `submittedAt` / `weekKey` / `monthKey` 沿用原交卷，禁止记入确认当日的周/月。
- 分类投影继续方案 A。重评先读当前 `categoryMetricsGeneration`；`generation>0` 时不得回退 `base`。
- 历史缺失指标不补记（MW16/MW17 已定）。
- CloudBase 写入不把文档自带 `_id` 再 set 回去；新文档不依赖多集合事务里直接插入。
- 首版全站短时交卷维护，不分片锁。

## 7 剩余缺口

- 未把 A22 / A23 / T18 标正式通过。
- T19（答案纠错跨两个自然周）本轮收尾：分差归原周期、本周不凭空加分已有手点与本地机制覆盖；跨周完整样例用手点等价路径，正式验收仍不标 PASS。
- 中断后 `job.resume` 只恢复、过期工作器拒写，本轮未遇到失败，仍只靠本地机制与任务书口径。
- 发起人已确认提交推送收口。
