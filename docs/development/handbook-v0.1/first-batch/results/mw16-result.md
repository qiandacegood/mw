# MW16 实际结果

日期：2026-10-14
任务：成长等级与勋章
状态：**已完成**（2026-10-15 收口：A/B/C 段已接线；D 段部署与负向核验已通过；E 段用户手点 1–9 完成，leftover=0 由两条独立路径门禁 `ok:true` 闭合；步骤 10 为 NOT_RUN）

提交：`a7a4612`（含 MW16 全部源码、脚本、本文件与进度入口；已推送 `origin/main`）。本文件的哈希回写（本行）在其后的文档提交中入库。

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码只存在于被 Git 忽略的本地 `.env`。本文未写入、未提交这些值。未写入明文 `_id` / `memberId`（只写 SHA-256 前缀或数量）。

未把 A01—A31、T01—T30 标为通过。尤其未标 **A09 / T29**。未启动 MW17—MW20。未创建 orders / vip_* 集合。未开启超额。未把 VIP 购买或到期当加减分。未冻结上线门槛（MW28）。未改写 MW12 / MW14 / MW15，未重开 MW13。

## 1 交付与可见结果

| 项 | 结果 |
| --- | --- |
| A 段：`@mw/shared` 门槛映射与勋章补齐纯逻辑 | 已接线（`packages/shared/src/growth.ts` + 单测） |
| A 段：结算/注册接线 | 已接线（`attempt.submit` 事务内按现行门槛定级并跨级补授；`member.register` 授予首枚勋章） |
| A 段：`member.growth` | 已接线（当前等级、总分、升级进度、已得勋章） |
| B 段：后台等级配置四个 action | 已接线（`growth.config` / `growth.preview` / `growth.publish` / `growth.recompute`） |
| C 段：小程序个人成长展示 | 已接线（「我的」成长区块 + 首页等级；不再显示「等级占位，MW16 未做」） |
| D 段：集合与索引 | PASS（新建 `medal_grants` 与 `idx_medal_grants_member_awarded`） |
| D 段：部署与负向核验 | PASS（见第 3 节；未代用户手点） |
| E 段：用户手点 1–9 | PASS（2026-10-14/15 用户手点；第 7 步附云端回读证据，第 8/9 步为用户手点报告；步骤 10 为 NOT_RUN，见第 4 节） |
| 本地五项检查 | PASS（见第 2 节） |
| leftover=0 | PASS（`mw16:verify-leftovers` `ok:true`、退出码 0；两条独立路径同时为 0，见第 5 节） |

## 2 本地检查

2026-10-14 跑一轮，退出码均为 0；2026-10-15 收口后复跑一轮，仍全部为 0。跑前必须先停 4174 后台 Vite：它占用 `packages/shared/dist`，会让 `scripts/ensure-shared-js.mjs` 的删除失败（本轮首次复跑即因此失败，停掉 Vite 后通过）。

| 检查 | 退出码 | 备注 |
| --- | --- | --- |
| `npm run check:prototypes` | 0 | 2 个内联原型脚本全部可解析 |
| `npm run typecheck` | 0 | admin / miniprogram / shared / api 四个工作区 |
| `npm run test` | 0 | 含 `mw16-assert.test.mjs`；workspaces 共 226 项通过（shared 89 / api 109 / admin 8 / miniprogram 20） |
| `npm run build` | 0 | 小程序 22 个入口、26 个 runtime import 全部解析 |
| `git diff --check` | 0 | 仅 CRLF 提示，无空白错误 |

已覆盖机制（本地 / 单元测试，不等于验收通过）：
- 等级由总分落入区间决定（0/100/300/800/1500/3000 → L1—L6；99→L1、100→L2、3000→L6、超大值仍 L6、负分不回落）；
- 一次跨级补齐经过等级的勋章（350 分补 L1+L2+L3 三枚）；
- 已授予的勋章不重复授予；门槛提高只重算等级、不撤销既得勋章；
- 门槛合法性（必须 0 起严格递增、levelId/medalId 不重复、名称与勋章缺一不可）；
- 门槛预览不改库（`wroteDocs=false`）、发布产生新 `configVersion` 并触发有界重算；
- `growth.publish` 非 super 拒绝 `SUPER_REQUIRED`、版本不匹配拒绝 `VERSION_CONFLICT`、非法门槛拒绝 `INVALID_ARGUMENT`；
- `growth.recompute` 重复执行不再产生等级变化与补发；
- `member.growth` 未注册返回 `MEMBER_REQUIRED`、经 `mw-public` 返回 `FORBIDDEN`；
- `memberId` 属不可信客户端字段：重算目标改用 `targetMemberId`，伪造 `memberId` 被拒；
- 小程序 leftover 载荷新增 `members` 后，MW13 的 `known-ids.test.ts` 已同步扩展（仍断言"浏览/自动进页不记入 leftover""只给哈希不给明文"），并新增"只有用户主动标记才含本人身份"一条。

机制证据**不等于** A09 / T29 通过。

## 3 D 段部署与负向核验（仅 mw-test）

`npm run mw16:deploy` 退出码 0：

| 项 | 结果 |
| --- | --- |
| 部署入口 | `mw-member`、`mw-admin`（`--force`，退出码 0） |
| 新建集合 | `medal_grants`（`existed=false`） |
| 新建索引 | `idx_medal_grants_member_awarded`（`memberId` / `awardedAt`；`listed=true`） |
| 门槛种子 | `app_config/growth` 写入成功（`$setOnInsert`，不覆盖已发布版本） |
| `EnableOverrun` | false |
| 其它环境计数 | 2（未触碰；`authorizedEnvId()` 只允许 mw-test） |

已种子门槛（只读核对）：`configVersion=1`、6 级、门槛 0/100/300/800/1500/3000、勋章 `medal.L1`—`medal.L6`、`placeholder=true`、`schemaVersion=1`。

`npm run mw16:verify` 退出码 0，汇总 `ok: true`（证据 `tmp/mw16/mw16-verify-evidence.json`）：

| 项 | 结果 |
| --- | --- |
| 未授权 `member.growth` | `AUTH_REQUIRED`（`NO_FROM_APPID`） |
| 伪造 `memberId` / `role` 调 `member.growth` | `FORBIDDEN`（`CLIENT_IDENTITY_IGNORED`） |
| 公开入口 `mw-public` 调 `member.growth` | `FORBIDDEN`（`ACTION_DENIED`） |
| 公开入口 `mw-public` 调 `growth.preview` | `FORBIDDEN` |
| 未登录后台调 `growth.config` | `AUTH_REQUIRED`（`NO_AUTH_UID`） |
| 匿名 Web SDK 直写 `medal_grants` / `member_stats` / `attempts` / `score_events` | 全部拒绝（`clientDenied=true`） |
| 集合 / 索引 | `medal_grants` 在、索引在（`indexesOk=true`） |
| 未来集合 `orders` / `vip_*` | 未出现（`futurePresent=false`） |
| 种子十类计数 | 10 |

## 4 E 段用户手点（已闭合）

步骤 1–10 与收口流程见 [mw16-growth.md](../mw16-growth.md)「必须由用户手点（E 段）」。**全部由用户手点**：执行者未用 CLI / automator / 服务端口冒充 FROM 或 admin 登录，也未代点后台按钮。

**首轮手点（2026-10-14）**：用户反馈步骤 1/2/3/6 通过；步骤 4 不知如何操作；步骤 5 报"`configVersion` 变 2 但等级没升到 L3"；步骤 7/8/9 当轮未做。执行者随后做的**只读**核查（不代点）：

| 核查项 | 结果 |
| --- | --- |
| `app_config/growth` | `configVersion=1`、`placeholder=true`、`reason=初始建议门槛` —— 文档从未被发布改写过 |
| `audit_logs` / `idempotency` 里的 `growth.*` 记录 | **0 条**（`growth.publish` 从未落库；`growth.recompute` 本身不写审计，故那里本来也不会出现） |
| `member_stats` | 2 条：总分 9 / L1（scoreSeq 6）与总分 0 / L1 —— 用户本轮确实注册了一个新身份 |
| `medal_grants` | 2 枚：`recompute/growth@v1`（总分 9 那位，来自手点步骤 3）与 `register/member.register`（新身份，注册即得） |
| `attempts` | 3 条，全部属于 MW14 旧残留（含 `176cd400df` 那 1 条），**本轮没有交卷** |

结论：步骤 5 当时的"`configVersion` 变 2"不是发布结果——那次发布没有落库（很可能只点了「预览影响（不写库）」或发布被拒）。为消除这类误读，后台前端已改（前端改动，无需重新部署云函数）：

1. 预览状态行明确写「预览完成（未写库，`configVersion` 仍是 N）」，并列出 `byTransition` 迁移明细；
2. 发布后用**云端回读**版本校验响应版本，只有「已发布且云端回读一致」才算成功，不一致会明确提示不一致；
3. 新增四个「快速填充」按钮（跨级 `L2=5/L3=8`、提高门槛按建议值整体抬高、非法首级非 0、缺勋章名），避免手改 JSON 出错；
4. 被拒时清空上一次的预览结果框，避免把旧结果当成当前结果；非法的门槛默认不发送，需要验证服务端拒绝路径时弹确认框（点确定才发送），这样既不误发、又能保留 `INVALID_ARGUMENT` 的服务端证据。

**用户随后重做，4/5 步已成功落库**（执行者只读核对，2026-10-14）：

| 核查项 | 结果 |
| --- | --- |
| `app_config/growth` | `configVersion=2`、`placeholder=false`、`reason=MW16 调整等级门槛`、门槛 0/5/8/800/1500/3000 |
| `member_stats` | 总分 9 那位已升到 **L3**；新注册身份仍是 L1 |
| `medal_grants` | 4 枚：`medal.L1/recompute/growth@v1`、`medal.L1/register/member.register`、`medal.L2/recompute/growth@v2`、`medal.L3/recompute/growth@v2` —— 9 分会员**一次补齐 L2+L3**，即跨级补齐成立 |

**第 7 步首次被拒的真实原因**（`INVALID_ARGUMENT GROWTH_LEVELS_INVALID`）：当时按钮只把 L2 抬到 1000，L3 仍是 8，而门槛必须**严格递增**，服务端因此报 `LEVEL_MIN_NOT_INCREASING`。按钮已改为按建议值整体抬高（0/100/300/800/1500/3000），保证严格递增。这是 MW16 自查中发现的第 3 个真实缺陷（前两个见第 7 节）。

**用户续做步骤 6–9 的结果**（用户手点；执行者只读核对云端，2026-10-14/15）：

| 步骤 | 结果 | 依据 |
| --- | --- | --- |
| 6 重复不重复授予 | PASS | 用户手点：重复「按当前门槛重算等级」不再产生等级变化与补发 |
| 7 既得勋章保留 | PASS | **云端回读**：`configVersion=3`、门槛 0/100/300/800/1500/3000（即"提高门槛"整批抬高的载荷）、`publishedAt=2026-10-14T15:40:43.970Z`、`reason=MW16 调整等级门槛`；9 分会员等级回落 L3→L1，`medal_grants` 未减少、无撤销 |
| 8 非法门槛应被拒 | PASS（用户手点报告） | 非法门槛 / 缺勋章名 / 非数组分别被本地预检与服务端拒绝；被拒后版本不变（云端仍为第 7 步的 `configVersion=3`）。被拒路径不落库，故只有"版本未被改坏"可作旁证 |
| 9 权限与 VIP | PASS（用户手点报告） | 9a：用 CloudBase 新建的非 super 后台账号（本地名 `mwtwo`；UID 只存本地 `.env`，不入文档）点发布被拒 `SUPER_REQUIRED`；9b：后台新建 VIP 卷「MW16VIP虚构练习卷」（`createdAt=2026-10-14T15:49:10.895Z`，已发布），免费会员打开显示 `VIP_REQUIRED`，总分 / 等级 / 勋章不变，未真实扣款（云端无 `orders` / `vip_*` 集合）；9c：未注册微信号打开「我的」显示 `MEMBER_REQUIRED` |
| 10 版本冲突（可选） | NOT_RUN | 未做，不假装通过 |

文档早前只记到第 4/5 步落库（`configVersion=2`），第 7 步的发布发生在其后（15:40:43Z），本轮以云端回读更正。第 9b 步新建的 VIP 卷属本轮测试对象，已并入第 5 节的同一轮 leftover 清理。历史 9 分会员"由「按当前门槛重算等级」补发 L1「新芽」，且重复点击不再补发"的观测点，已由 15:09:35Z 的 `recompute/growth@v1` 与步骤 6 共同覆盖。

## 5 leftover 收口（已闭合）

门禁与 MW13—MW15 同构，并按 MW15 教训新增一条**不依赖 knownIds 的独立核查**：

| 路径 | 机制 | 是否依赖推导 id |
| --- | --- | --- |
| knownIds 路径 | `mw16-import-known-ids` → `mw16-resolve-known-ids` → `mw16-cleanup`，逐个点查 / 精确删除 | 部分是（resolve 会推导 bests/events/metrics），**已不再信任** |
| 独立路径（MW16 新增） | `mw16-independent-check` / `mw16-verify-leftovers`：用用户提交的 SHA-256 反查真实 `_id` 与 `(memberId, paperId)` 关系，再按 `memberId` / `paperId` 精确查询统计残留；`derivedIdsUsed=false` | 否 |

- 独立路径同时被 `mw16-cleanup` 使用：删除目标 = 已解析 knownIds ∪ 关系查询读到的**真实** `_id`，去重后按真实 id 精确删除；仍不扫整表猜删，且保护 `members` / `member_stats` / `identities` / `categories`。
- 独立路径范围（刻意收窄，避免误删 MW14 / MW15 非本轮残留）：`papers` / `paper_versions` / `paper_chunks` / `paper_answers` 只针对**用户明确标记**的本轮测试卷；会员名下只收「本轮卷（含由已标记 attempt 反查到的卷）」或「已标记的本轮 attempt」关联的 attempts / active_attempts / score_events / paper_bests；`medal_grants` 只收本轮来源（`member.register`、`growth@v*`、或已标记的本轮 attemptId）；`score_metrics` 无 paperId 字段，只能按 memberId 精确读（mw-test 上该集合当前 0 条）。
- `members` / `member_stats` / `identities` 既不计入 leftover，也永不删除：本人身份只用来锚定关系核查（否则标记本人就会让 leftover 永远不等于 0，或误删合法账号数据）。
- 收口门禁 `mw16:verify-leftovers` 要求两条路径**同时**为 0：`knownIdLeftoverDocs=0` 且 `independentTotal=0`，否则 `ok:false`。

### 5.1 空清单下的历史记录（2026-10-14，未被手点前）

未手点、未导入清单时：

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run mw16:verify-leftovers` | **1** | `knownIdLeftoverDocs=0`、`independentTotal=0`，但 `wroteDocs=false`、`cloudWriteClaimed=false` → `reasons=[WROTE_DOCS_FALSE, CLOUD_WRITE_NOT_CLAIMED]`。**这是"空范围下的 0"，不得当 leftover=0** |
| `npm run mw16:independent-check` | **1** | 扫描范围为 0（无哈希可锚定）→ `reasons=[WROTE_DOCS_FALSE, KNOWN_IDS_NOT_RESOLVED]`，`derivedIdsUsed=false` |

两条门禁在空清单下都正确判"不干净"，说明门禁没有被写死成 0。

### 5.2 用户手点与收口（2026-10-15，已闭合）

用户手点入册：**1 卷**（第 9b 步新建的「MW16VIP虚构练习卷」）+ **1 会员**（本轮新注册身份，`totalScore=0`）+ **0 attempt**（本轮无交卷）。历史 9 分会员未入册，故其 3 枚勋章保留在云端（取"保留成长态"路径；代价是新注册身份的 `register` 授予被清掉，但 `members` / `member_stats` 永不删，该身份仍可用）。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run mw16:import-known-ids` | 0 | `wroteDocs=true`、`importedHashCount=2`（papers 1 / members 1 / attempts 0） |
| `npm run mw16:resolve-known-ids` | 0 | `matchedPaperCount=1`、`matchedMemberCount=1`、`knownIdCount=6`（papers 1 / versions 1 / chunks 1 / answers 1 / grants 1 / members 1） |
| `npm run mw16:independent-check`（只读） | 1 | 清理前残留 `total=3`（`papers` 1 / `paper_versions` 1 / `medal_grants` 1）、`derivedIdsUsed=false`、`reasons=[INDEPENDENT_SWEEP_LEFT]` |
| `npm run mw16:cleanup` | 0 | `targetCount=5`、`deleted=5`、`failed=0`；`independentBeforeTotal=3` → `independentAfterTotal=0` |
| `npm run mw16:verify-leftovers` | **0** | **`ok:true`**：`knownIdLeftoverDocs=0`、`independentTotal=0`、`wroteDocs=true`、`cloudWriteClaimed=true`、`exactIdSweepOnly=true`、`seedPresent=true`、`medalIndexPresent=true`、`forbiddenPresent=false`、`enableOverrun=false` |

**第三条独立旁证**（不依赖 knownIds 推导，也不依赖上表任一步）；收口前后各读一次全集计数：

| 集合 | 收口前 | 收口后 | 说明 |
| --- | --- | --- | --- |
| `papers` | 7 | 6 | 本轮 VIP 卷已删；余 6 条为 MW11—MW14 历史卷，未动 |
| `medal_grants` | 4 | 3 | 删除新注册身份的 `register` 授予；历史 9 分会员的 3 枚保留 |
| `score_metrics` | 0 | 0 | MW15 遗留，仍未重建（MW17 前置，见第 6 节） |
| `categories` | 11 | 11 | 10 条种子 + 1 条 MW13 遗留子类目「逻辑二」（`createdAt=2026-10-09T16:14:44.613Z`），均未删 |
| `orders` / `vip_*` | 无 | 无 | 本轮未创建 |

按 MW15 教训（`resolve` 推导 id 与云端真实 `_id` 不一致、DELETE 对不存在的 id 也返回成功），本次 leftover 结论不与 `failed=0` 绑定，而是以上面三条互不依赖的路径同时为 0 为准。

## 6 MW15 遗留评估（本轮一并评估）

MW15 收口时 `score_metrics` 的 4 条聚合文档随清理被删、`member_stats.totalScore` 仍为 9。本轮开头只读核查（2026-10-14）：

| 集合 | 现状 |
| --- | --- |
| `score_metrics` | 0 条（未重建） |
| `member_stats` | 1 条，`totalScore=9`、`levelId=L1` |
| `medal_grants` | 0 条（该只读核查发生在手点之前；收口后为 3 条，见第 5.2 节） |

结论：**MW16 的等级与勋章不依赖 `score_metrics`**。等级只由 `member_stats.totalScore` 与 `app_config/growth` 门槛决定，勋章只由 `medal_grants` 决定。该会员 9 分在初始门槛下仍是 L1，因此等级判断不受指标缺失影响。但 `score_metrics` 缺失会让**周/月/分类榜值偏低**，属 MW17 四维排行榜的前置问题，MW16 内不重建（不在本轮范围）。该项仍为未处理的遗留，须在 MW17 开工前处理。收口（第 5.2 节）后 `medal_grants` 为 3 条，全部属于该历史 9 分会员，未被清理。

### 6.1 收口后复核与可重建性（2026-10-15，只读）

收口（第 5.2 节）之后再把相关集合的全集计数读一遍：

| 集合 | 条数 | 说明 |
| --- | --- | --- |
| `member_stats` | 2 | 9 分 / L1 / `scoreSeq=6`；0 分 / L1 / `scoreSeq=0` |
| `paper_bests` | **0** | 单卷最高分记录全部不存在 |
| `score_events` | **0** | 分数事件全部不存在 |
| `score_metrics` | **0** | 四维聚合全部不存在 |
| `medal_grants` | 3 | 均属历史 9 分会员（见第 5.2 节） |

结论：**缺失的不只是 `score_metrics`**——产生聚合的源头 `paper_bests` / `score_events` 也已在 MW15 收口清理中一并删除，9 分只剩 `member_stats.totalScore=9`（`scoreSeq=6` 说明历史上确实结算过 6 次）。因此**"重建 score_metrics"无法忠实完成**：周 / 月 / 分类三榜所需的周期与分类来源已不存在，凭空补写聚合文档等于伪造榜值。

留给 MW17 开工前必须由发起人定的口径（本轮不擅自选择，也不写任何补记文档）：

1. **不补记**（推荐）：承认历史轨迹缺失，MW17 对该会员的榜值从新事件起算；`member_stats.totalScore`（9）与 `score_metrics`（0 条）的不一致由 MW17 在榜侧显式处理并如实提示。
2. **补记一条 `scope=total`**：以 `member_stats.totalScore=9` 生成总榜用聚合并标 `metricGeneration=backfill`，周 / 月 / 分类仍为空。这属"人工补写聚合"，必须由发起人明确同意后才做，且须在结果文档写明来源与影响。

两个选项都不构成本轮代码改动；本轮只如实记录核查结果。

## 7 发现与限制

1. **`memberId` 是不可信客户端字段**：`growth.recompute` 不能用 `memberId` 指定目标（会被 `forgedClientFields` 直接拒绝 `CLIENT_IDENTITY_IGNORED`），改用 `targetMemberId`；后台页面标签与证据字段同步采用该名字。
2. **`growth.recompute` 不要求幂等键**：其结果由现有总分与当前生效门槛唯一决定，重复执行不再产生等级变化与补发（本地测试覆盖）。`growth.publish` 仍要求 `idempotencyKey` + `reason`，并写 `audit_logs` 与 `idempotency`。
3. **重算是"有界"的**：预览与批量重算的扫描上限为 500，单次重算上限 200；超出必须报告 `truncated=true`，界面提示"数字不是全集"，不得把截断当作全量。mw-test 规模下不会触发。
4. **勋章授予放在交卷事务内**（确定性 `_id` + 事务内读取既有授予），而不是异步任务：这样"不重复授予"和"跨级补齐"与结算同时成立；代价是 `attempt.submit` 事务多 6 次读、最多 6 次写，仍在 `TX_BUDGET_LIMIT=60` 之内。
5. **`revokedAt` 字段保留但本轮不开放撤销入口**：产品只允许"确认作弊等特殊处置由超级管理员说明原因后撤销"，属后续治理范围。
6. 小程序上「等级占位，MW16 未做」的提示已删除；`member.me` 仍只返回 `levelId`，等级名称 / 进度 / 勋章由新 action `member.growth` 提供。
7. 为支持独立核查，小程序 clipboard 载荷新增 `members`（本人 `memberId` 的 SHA-256），并且**只在用户主动点「记入本轮 leftover（本人）」时**才记入。
8. MW07 仅为技术样例，未真实扣款、未 iOS 现网、未购买闭环；A14 / A20 / T20 / T26 未标通过。
9. **门槛必须严格递增**：抬高某一级而不抬高其后各级会被拒 `INVALID_ARGUMENT`（`GROWTH_LEVELS_INVALID` + `LEVEL_MIN_NOT_INCREASING`）。这不是缺陷，而是设计约束；但手工改 JSON 很容易踩，因此后台补了「快速填充」与本地预检提示。
10. **后台"预览"与"发布"必须可区分**：首次手点时把预览结果误当成发布结果。现在预览状态行明确写"未写库、版本不变"，发布后用云端回读校验并显示"已发布且云端回读一致"，被拒时清空上一次预览框。这属于可观测性缺陷，已修。
11. **A09 / T29 本轮不标通过**：两者是产品验收项，按 [验收计划 V1.0](../../../../testing/acceptance-plan-v1.0.md) 只能在后续验收轮次记 PASS / FAIL / BLOCKED / NOT_RUN，任务轮次用机制证据代替不成立。本轮**可覆盖** T29 的"跨级补齐、等级下降、重复任务不重复授予、正常既得勋章不删"四项（第 4 节手点 + 云端证据）；**不可覆盖** A09 的"VIP 购买不加分"付费侧与"到期不清空成长"（依赖 MW20 权益账本、MW21 购买），以及 T29 的定时 / 异步"重复勋章任务"（本轮重算是 `growth.recompute` 同步调用，非任务队列）。故只记录"可覆盖部分已有证据、不可覆盖部分留待 MW20 与验收轮次"，维持"不标通过"。

## 8 建议状态

**已完成**（2026-10-15 收口）。可见结果（小程序个人成长展示 + 后台等级配置预览发布）已交付；本地五项检查为 0（收口后复跑确认）；mw-test 上集合 / 索引 / 种子 / 部署与负向核验通过。E 段用户手点 1–9 由用户完成（第 7 步附云端回读证据，第 8/9 步为用户手点报告），步骤 10（可选）为 NOT_RUN；leftover=0 由两条独立路径门禁 `ok:true`（退出码 0）闭合，并附第三条不依赖 knownIds 的计数旁证。不改 MW12 / MW14 / MW15，不重开 MW13，不启动 MW17—MW20；仍未标 A01—A31 / T01—T30（尤其未标 A09 / T29），未冻结上线门槛（MW28）。遗留：`score_metrics` / `paper_bests` / `score_events` 均为 0 条（源头记录也已缺失，无法忠实重建），口径须在 MW17 开工前由发起人确定（第 6.1 节）。A09 / T29 维持"不标通过"（第 7 节第 11 条）。发起人确认后再提交推送收口。
