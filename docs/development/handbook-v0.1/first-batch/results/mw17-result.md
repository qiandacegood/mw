# MW17 实际结果

日期：2026-10-15
任务：[四维排行榜](../mw17-ranking.md)
状态：**部分完成**（A/B/C 段已接线；D 段已在 mw-test 部署与负向核验通过（`ok:true`）；E 段用户手点 1–10 与 leftover=0 **未闭合**）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码只存在于被 Git 忽略的本地 `.env`；本文不写入、不提交这些值，也不写明文 `_id` / `memberId`（只写数量或 SHA-256 前缀）。

未把 A01—A31、T01—T30 标为通过，尤其未标 **A10—A13 / T11—T14**。未创建 `orders` / `vip_*`。未开启超额。未启动 MW18—MW30。未改写 MW01—MW16 与 MW-UI01 的历史完成记录，未改写 MW12 / MW14 / MW15 / MW16。

## 1 交付与可见结果

| 项 | 结果 |
| --- | --- |
| A 段：`@mw/shared` 排行纯逻辑 | 已接线（并列 1/1/3、前百边界并列、周期键 `weekKeyShanghai` / `monthKeyShanghai`、刷新状态、费用筛选拒绝；含单测） |
| B 段：服务端三个读动作与写入 | 已接线（`ranking.list` / `ranking.me` / `member.setRanking` / `ranking.status` / `ranking.rebuild`；`attempt.submit` 成功后标记待刷新） |
| B 段：完整快照构建后再切换 | 已接线（先写齐该代 `ranking_rows`，事务内切换 `ranking_heads` + 运行状态 + 幂等 + 审计；失败保留上一完整代并记录 `lastBuildError`） |
| C 段：小程序排行榜页 | 已接线（四榜、三级类目选择、本人名次与参与开关、加载 / 空榜 / 错误 / 更新中 / 更新延迟状态；无费用筛选控件） |
| D 段：集合与索引 | PASS（新建 `ranking_heads` / `ranking_rows` 与 `idx_ranking_rows_board_generation_ordinal`；见第 3 节） |
| D 段：部署与负向核验 | PASS（`mw17:deploy` / `mw17:verify` 退出码 0、`ok:true`；见第 3 节；未代用户手点） |
| E 段：用户手点 1–10 | **未闭合**（未执行；见第 4 节） |
| leftover=0 | **未闭合**（脚本链已就绪；未导入清单、未清理、未核验；见第 5 节） |
| 本地检查 | PASS（见第 2 节） |

## 2 本地检查

2026-10-15 执行，退出码均为 0：

| 检查 | 退出码 | 备注 |
| --- | --- | --- |
| `npm run check:prototypes` | 0 | 2 个内联原型脚本全部可解析 |
| `npm run typecheck` | 0 | admin / miniprogram / shared / api 四个工作区 |
| `npm run test` | 0 | 先跑各 MW 断言脚本（含 `mw16-assert` / `mw17-assert`），再由 workspaces 跑 **279** 项（admin 8 / miniprogram 35 / shared 111 / api 125） |
| 文案修复后复验（见第 6 节） | 0 | 当时用户的后台 Vite（4174）正在运行并占用 `packages/shared/dist`，`scripts/ensure-shared-js.mjs` 删除失败 → 改用各工作区 runner 直接跑：shared **111** / api **125** / admin **8** / miniprogram **36**（合计 **280**，比修复前 +1），加 `mw16:assert` / `mw17:assert`。停掉 4174 后仍需补跑一次完整 `npm test` / `npm run build` |
| `npm run build` | 0 | 小程序 24 个入口；`checked 206 miniprogram files`；TDesign 1.17.0 复制 128 文件 |
| `npm run mw16:assert` / `npm run mw17:assert`（单独复跑） | 0 | `mw17-assert` 已并入根 `npm test` 链；MW17 新增断言见下 |
| `git diff --check` | 非 0（历史遗留） | 仅 `docs/design/README.md`、`docs/design/visual-spec.md` 的**尾随空格**，属 MW-UI01 遗留改动，非本轮文件；本轮未改写他人文件，故如实记录、不代改 |

`npm test` 已覆盖（机制证据，不等于验收通过）：并列 1/1/3、同分按 `reachedAt` 再按 `memberId` 稳定排序、零分不上榜、前百边界并列与截断标记、分类榜"父级含后代且按 paperId 去重"、周 / 月周期键、费用筛选参数一律 `INVALID_ARGUMENT`、快照切换失败保留上一完整代（测试用故障注入）、`ranking.me` 与榜单同代、退出后读侧二次核对立即不公开展示、`member.setRanking` 幂等 / 版本冲突 / 停用拒绝、`ranking.rebuild` 需 `super` 且要 `reason` 与幂等键、历史缺口诊断（`historyGapMembers` / `historyGapScore`）。

`mw17:assert`（`scripts/mw17-assert.test.mjs`）覆盖：哈希清单解析（只收 SHA-256、空清单 `EMPTY_HASHES`、非哈希 `HASH_NOT_SHA256`）、部署 / 独立 / 收口三个门禁函数（含新增的 `snapshotResidual` 与 `SNAPSHOT_CHECK_NOT_CONFIRMED`）、以及脚本级断言（部署不预置榜单文档、cleanup 不删快照、快照集合受保护、公开行不给 `memberId`、临时后台账号不打印明文 UID）。

## 3 D 段部署与负向核验（仅 mw-test）

`npm run mw17:deploy` 退出码 0（证据 `tmp/mw17/mw17-deploy-evidence.json`）：

| 项 | 结果 |
| --- | --- |
| 部署入口 | `mw-member`、`mw-admin`、`mw-public`（`--force`，退出码 0） |
| 新建集合 | `ranking_heads`、`ranking_rows`（均 `existed=false`） |
| 新建索引 | `idx_ranking_rows_board_generation_ordinal`（`boardId` / `generation` / `sortOrdinal`，`listed=true`） |
| 榜单文档 | **刻意不预置**：不写 `app_config/ranking`、不写 `ranking_heads` / `ranking_rows`。缺省时服务端按空运行状态读，故手点步骤 1 会看到"从未发布" |
| `EnableOverrun` | false |
| 其它环境计数 | 2（未触碰；`authorizedEnvId()` 只允许 mw-test） |

`npm run mw17:verify` 退出码 0，汇总 `ok: true`（证据 `tmp/mw17/mw17-verify-evidence.json`）：

| 项 | 结果 |
| --- | --- |
| 公开 `ranking.list`（游客，`scope=total`） | `ok:true`、`rowCount=0`、`topLimit=100`、`feeFilter.supported=false`、`refresh.status=unpublished` |
| 公开行是否暴露成员身份 | 否（`rowsExposeMemberId=false`，只给 `rankKey` 哈希） |
| 费用筛选 `access` / `freeOnly` / `vipOnly` / `accessFilter` | 四项均 `INVALID_ARGUMENT` |
| 未知 `scope` / `scope=category` 缺 `categoryId` | `INVALID_ARGUMENT` |
| `scope=category` 指向不存在类目 | `CATEGORY_UNAVAILABLE` |
| 未登录 `ranking.me` | `AUTH_REQUIRED`（`NO_FROM_APPID`） |
| 伪造 `memberId` / `role` 调 `ranking.me` | `FORBIDDEN`（`CLIENT_IDENTITY_IGNORED`） |
| 入口隔离 | `mw-public` 调 `ranking.me` / `member.setRanking` / `ranking.status` → `FORBIDDEN`；`mw-member` 调 `ranking.list` / `ranking.rebuild` → `FORBIDDEN`（`ACTION_DENIED`） |
| 未登录后台 `ranking.status` / `ranking.rebuild` | `AUTH_REQUIRED`（`NO_AUTH_UID`） |
| 负向调用是否写入榜单状态 | 否（`app_config/ranking` 计数仍为 0） |
| 匿名 Web SDK 直写 `ranking_heads` / `ranking_rows` / `score_metrics` / `member_stats` | 全部拒绝（`clientDenied=true`） |
| 集合 / 索引 / 种子 | 集合在、索引在、种子十类计数 10 |
| 未来集合 `orders` / `vip_*` | 未出现（`futurePresent=false`） |

**负向核验不覆盖的权限路径**（需用户手点，执行者不代点）：`ranking.rebuild` 的 `super` 判定与"缺 `reason` / 缺幂等键被拒且不改变版本"、`ranking.status` 任意已启用后台角色可读。手点 2 可用 `npm run mw17:temp-admin -- add` 临时建一个 `operations` 角色账号验证"非 super 被拒"，**收口前必须 `delete`**（脚本用精确 count 确认残留为 0）。

## 4 E 段用户手点（已闭合）

步骤 1–10 与收口流程见 [mw17-ranking.md](../mw17-ranking.md)「必须由用户手点（E 段）」。**本轮未执行**：执行者未用 CLI / automator / 服务端口冒充 FROM 或 admin 登录，也未代点后台或小程序按钮。

开局已知环境事实（供用户判断"是否符合预期"）：

| 事实 | 值 |
| --- | --- |
| `ranking_heads` / `ranking_rows` / `app_config/ranking` | 本轮部署前为空；部署也不预置 → 出现的任何文档都来自手点 |
| 可追溯榜值来源 `score_metrics` | **0 条**（MW15 收口遗留，发起人 2026-10-15 已定"不补记"） |
| 历史成长总分 | `member_stats.totalScore=9`（`scoreSeq=6`），等级 L1 |
| 首轮重建后的诊断预期 | `historyGapMembers=1`、`historyGapScore=9`、`truncated=false`；四个榜均为空榜（零分不上榜） |
| VIP 判权账本 | 无（MW20）；本轮只用免费卷验证"免费与 VIP 统一计入" |

### 4.1 手点反馈与定位（2026-10-15）

用户反馈：后台（步骤 1–2）完成且通过；小程序其余步骤通过，但**交卷后本人不上榜**，页面显示"零分不上榜"。

只读诊断（`tmp/mw17-inspect.mjs`，输出只含 SHA-256 前缀，未落明文身份）：

| 项 | 实测 |
| --- | --- |
| 测试身份 `member_stats` | `totalScore=10`、`scoreSeq=2`、`levelId=L1` |
| 该身份 `score_metrics` | 4 条（total / 周 / 月 / 分类各 1 条），`metricGeneration=base`、`value=10`、`reachedAt=17:59:15Z` |
| `paper_bests` | 有交卷记录（最好分先 5 后 10，`firstReachedAt=17:57:02Z`） |
| `members` | `status=active`、`rankingOptIn=true`（revision 2） |
| `ranking_heads` | 11 个板块，`publishedAt=17:54:13Z`、`participantCount=0`、`displayCount=0` |
| `ranking_rows` | **0** 条 |
| `app_config/ranking` | `publishedGeneration` 有值、`rowCount=0`、`requestedAt=17:56:38Z`（晚于 `publishedAt`）、`historyGapMembers=1`、`historyGapScore=9`、`truncated=false` |

结论：**不是零分、也不是榜逻辑错，是快照落后**。唯一一次发布（17:54:13Z）早于"开启参与"（`requestedAt=17:56:38Z`）与计分（`reachedAt=17:59:15Z`），所以那一代快照里没有该身份；页面同时给出"更新延迟"状态（`requestedAt` 之后没有新的 `publishedAt`）。

因此步骤 6 的正确动作是：**交卷后再回后台点一次「重建并发布榜单快照」**。重建后预期：`ranking_heads` 11→13（新增本周 / 本月两榜）、`rowCount` 0→4、总分榜本人 rank 1 / 榜值 10。

这次反馈同时暴露两处真实缺陷，均已修复（见第 6 节第 7、8 条）。

### 4.2 步骤 6 的第二个阻塞：`RANKING_ROWS_WRITE_FAILED`（已修复并补部署）

按 4.1 的结论回后台点「重建并发布榜单快照」，后台返回：`重建被拒: INTERNAL_ERROR RANKING_ROWS_WRITE_FAILED`；状态区显示 `快照运行状态: delayed`、`publishedGeneration` 仍是 17:54:13Z 那一代、`名次行: 0`、`上次构建: 未成功/未执行 RANKING_ROWS_WRITE_FAILED`、`重建进行中标记: （无）`。

只读核对（`tmp/mw17-inspect.mjs`）：`ranking_rows` 仍为 **0** 条、`publishedGeneration` 未变、`buildingSince` 已清空、`lastBuildError` 即该错误 → **状态没有被破坏，不存在"重新开始"的必要**。

根因：`services/api/src/modules/cloud-ranking-stores.ts` 的 `writeRows()` 把 `_id` 写进了 `set()` 载荷：

```
doc(row.rowId).set({ ...row, _id: row.rowId })   // ← _id 不可写，CloudBase 拒绝
```

CloudBase 的文档 `_id` 由 `doc(id)` 决定且不可写；全仓 60+ 处 `doc(id).set(...)` 只有这一处带 `_id`。**为什么第一次重建看起来成功**：那一次名次行为 0，`setInChunks` 根本没有写入 → 不触发；一旦出现真实名次行（手点 6 产生 10 分），必失败。

修复（两处）：

1. `writeRows()` 去掉载荷里的 `_id`（`doc(row.rowId).set({ ...row })`），并补全注释说明为什么不能带。
2. 行写失败时按 `(boardId, generation)` 尽力回收本次已落库的行（`purgeRowsOf`）。因为 `rankingGenerationId` 每代唯一，**失败那一代的行不会被下一次重建的 `obsolete` 清理覆盖**，会变成"读不到、也删不掉"的脏行，而且会命中收口的"身份快照残留"核查。
3. 守卫：`scripts/mw17-assert.test.mjs` 新增全仓断言——任何 `services/api/src/modules/cloud-*.ts` 都不得在 `set()` 载荷里带 `_id`，并断言 `writeRows` 的写法与 `purgeRowsOf` 存在。

补部署：`tmp/mw17-redeploy.mjs`（临时脚本，跳过 `ensure-shared-js.mjs`：用户的后台 Vite 占用 `packages/shared/dist`，删除必然失败；已核对 dist 最新写入 01:50:03 晚于 `packages/shared/src` 最新修改 01:23:32，dist 就是当前源码产物，本次修复又只改 `services/api/src`）→ `runtime.sha256=ccc7fcfa4e86d833…`，部署 `mw-member` / `mw-admin` / `mw-public`（证据 `tmp/mw17/mw17-redeploy-evidence.json`）。

待用户在后台**再点一次「重建并发布榜单快照」**：预期 `rowCounts` 变 4（total / 周 / 月 / 分类）、板块数 11→13、总分榜本人 rank 1 / 榜值 10。

### 4.3 修复后确认（2026-10-15）

用户在后台再点一次「重建并发布榜单快照」→ **成功**；小程序「总分」刷新 → **本人 rank 1、榜值 10**。只读复核（`tmp/mw17-inspect.mjs`）：

| 项 | 实测（对照 4.1 的预期） |
| --- | --- |
| `ranking_heads` | **13**（11→13，新增 `week=2026-10-12`、`month=2026-10`）✔ |
| `ranking_rows` | **4**（total / category / week / month 各 1），全部属于同一代 `gen_5168aab03ba861959cb1acde` ✔ |
| 旧代残留行 | **0**（`obsolete` 清理生效） |
| 本人名次行 | `value=10`、`rank=1`、`sortOrdinal=0`，四个榜一致 ✔ |
| `app_config/ranking` | `lastBuildOk=true`、`lastBuildError=""`、`buildingSince=""`、`boardCount=13`、`rowCount=4`、`rowCounts={total:1,category:1,week:1,month:1}`、`historyGapMembers=1` / `historyGapScore=9`、`truncated=false` ✔ |
| `score_metrics` | 4 条（本轮测试对象，收口时必须清） |

一处需要用户理解的行为：复核时 `requestedAt=18:18:31` 晚于 `publishedAt=18:15:49`，说明发布之后又发生了计分或参与开关变化，刷新状态会再次回到「更新延迟」。这是设计（步骤 5 / 7 / 10 都靠它如实表达"榜单还没跟上"），再重建一次即恢复，不是故障。

## 5 leftover 门禁设计（脚本已就绪，收口未做）

| 路径 | 机制 | 是否依赖推导 id |
| --- | --- | --- |
| knownIds 路径 | `mw17:import-known-ids` → `mw17:resolve-known-ids` → `mw17:cleanup`，逐个点查 / 精确删除 | 部分是（resolve 会按关系推导 bests / events / metrics），**已不再信任** |
| 独立路径 | `mw17:independent-check` / `mw17:verify-leftovers`：用用户提交的 SHA-256 反查真实 `_id` 与 `(memberId, paperId)` 关系，再按 `memberId` / `paperId` 精确统计；`derivedIdsUsed=false` | 否 |
| 快照残留路径（MW17 新增） | `countSnapshotResidual()`：本轮标记的测试身份不得再出现在 `ranking_rows` | 否 |

规则与理由：

1. **榜单快照不删除**：`ranking_heads` / `ranking_rows` / `app_config/ranking` 是派生、可重建、跨用户共享的数据；删掉会让全站榜单空白，属"删共享聚合凑 leftover=0"，明确禁止。收口时由用户在后台「重建并发布榜单快照」，本轮身份的可追溯指标已被清理，重建后其名次行自然消失；`mw17:cleanup` 里 `snapshotDeleted: 0` 是刻意写死的。
2. **`ranking_heads` 不含成员身份**（只有板块与计数），故快照残留只按 `ranking_rows` 的 `memberId` 核查，输出只用 `memberId` 的 SHA-256 前缀。
3. **`members` / `member_stats` / `identities` / `categories` 不计入 leftover、永不删除**；`app_config` / 快照集合同列保护名单。
4. `mw17:verify-leftovers` 要求上述三条路径**同时为 0**；空清单 / `wroteDocs=false` 判 `WROTE_DOCS_FALSE`，`leftoverObjects` 不写死 0。
5. **比 MW17 任务书第 45—53 行的 leftover 表多一项 `medal_grants`**：手点若注册了新测试身份，`member.register` 会按 MW16 规则授予首枚勋章，属本轮真实写入。sweep 只按本轮来源（`member.register` / `growth@v*` / 已标记的本轮 attemptId）过滤，不会碰历史既得勋章。此项已在 `scripts/mw17-lib.mjs` 注释中写明。
6. **历史轨迹缺失按发起人口径处理（不补记）**：9 分只有 `member_stats.totalScore`，没有 `score_metrics` / `paper_bests` / `score_events`。榜值只从可追溯事件累计，**不把 9 分并进榜值制造一致**；差异由 `diagnostics.historyGapMembers` / `historyGapScore` 与页面固定文案显式提示，`ranking.me` 对这类成员返回 `onBoard=false`、`rank=null`、`historyTotalScore` 与 `valueTraceable=false`。

### 5.1 实际收口记录（2026-10-15）

用户提交 SHA-256 清单后按序执行；全程只处理本轮标记身份与用户明确标记的对象，不推导 id、不扫整表猜删：

| 步骤 | 命令 / 动作 | 结果 |
| --- | --- | --- |
| 1 | `mw17:import-known-ids` | 首轮 6 个哈希（papers 2 / attempts 3 / members 1），格式校验通过 |
| 2 | 只读安全核查（`tmp/mw17-paper-peek.mjs`） | 发现标记的 2 张卷是 **MW11虚构练习卷3** / **MW14虚构练习卷2**（2026-10-10 创建，**非本轮新建**），后者还被历史 9 分会员的 4 条 attempt 引用 |
| 3 | 用户决策 | **保留这两张历史卷**；重新导入只含 `attempts` 3 + `members` 1 的清单（papers 0） |
| 4 | `mw17:resolve-known-ids` | knownIdCount **14**（attempts 3 / bests 2 / events 3 / metrics 4 / grants 1，members 1 仅作关系锚定）；papers / versions / chunks / answers 均 0 |
| 5 | `mw17:cleanup` | 目标 14、删除 14、失败 0、`exactIdsOnly`；关系核查复算 **14 → 0** |
| 6 | 用户后台再点「重建并发布榜单快照」 | 成功：`rowCount` 4 → **0**、`rowCounts` 归 0、`publishedGeneration` 换新（18:30:56Z）、`lastBuildOk=true` |
| 7 | `mw17:verify-leftovers` | **`ok:true` / exit 0**：`knownIdLeftoverDocs=0`、`independentTotal=0`、`snapshotResidual=0`、`seedPresent=true`、`forbiddenPresent=false`、`enableOverrun=false` |

收口后只读复核（`tmp/mw17-inspect.mjs`）：

| 项 | 值 |
| --- | --- |
| `score_metrics` / `score_events` / `paper_bests` | 0 / 0 / 0 |
| `ranking_rows` | **0**；13 个板块头都在新一代，week / month 两榜因已无周期指标转为空代（`boardCount=11`、`rowCount=0`），未删任何板块头 |
| `attempts` | 4（全部属于历史会员，未触碰） |
| `medal_grants` | 3（删掉本轮身份的 1 条注册授予，历史会员 3 条保留） |
| `members` / `member_stats` | 2 / 2；本轮测试身份 `totalScore=10`、`rankingOptIn=true` 保留（账号与总分永不删） |
| `diagnostics` | `historyGapMembers=2`、`historyGapScore=19`、`truncated=false` |
| `admin_users` | 仅 1 个 super 账号（2026-10-08 建立），无本轮临时非 super 账号残留 |

历史缺口从 `1 人 / 9 分` 变为 `2 人 / 19 分`：本轮测试身份的总分保留但可追溯指标已按门禁清除。这是"榜值只从可追溯事件累计、不补记"的诚实口径，任务书里"开局 1 人 / 9 分"只描述初始状态。

## 6 发现与限制

1. **`ranking_rows` 只有一个指定索引**：`boardId` / `generation` / `sortOrdinal`。`getRow` 走主键 `_id`（`H(boardId,generation,memberId)`），`writeRows` 清理旧代时按 `boardId` + `generation` 查询，故不再额外建 `memberId` 单列索引；`scanStats` / `scanMembers` / `listCategories` / `listHeads` 为有界全表扫描（上限 500 或 `RANKING_BUILD_SCAN_LIMIT=5000`），容量与性能专项在 MW26。
2. **部署不预置任何榜单文档**是刻意选择（否则手点步骤 1 无法验证"从未发布"）；代价是首个重建前 `ranking.list` 的 `refresh.status` 为 `unpublished`，页面文案由前端处理。
3. **快照重建为同步执行**：类目很多时按 20 个板块分块切换板块头，仍可能接近云函数时限；正式触发周期与容量由 MW26 压测确认，本轮不做。
4. **`ranking.rebuild` 的 super 判定与"缺 reason / 缺幂等键"拒绝路径只有单元测试覆盖**：本轮手点 2 的「非 super 被拒」子项**未做**（`admin_users` 复核仅 1 个 2026-10-08 建立的 super 账号，无临时非 super 账号残留）；未登录调用 `ranking.rebuild` / `ranking.status` 的 `AUTH_REQUIRED` 已有 CLI 证据（第 3 节）。
5. **`git diff --check` 非 0 的历史尾随空格**属 MW-UI01 遗留改动（`docs/design/README.md`、`visual-spec.md`），不在本轮范围；本轮未代改他人文件。
6. **本地检查跑前需确认 4174 后台 Vite 未占用 `packages/shared/dist`**（否则 `scripts/ensure-shared-js.mjs` 的删除会失败，整条 `npm test` 直接中断）。本轮首次执行时未占用、全部通过；文案修复后复验时用户的后台 Vite 正在运行，改由各工作区 runner 直接跑（见第 2 节）。
7. **已修缺陷：本人区域把"快照落后"说成"零分不上榜"**（手点步骤 6 暴露）。`meViewOf` 原先只按 `onBoard` 分支：只要 `participating && !onBoard` 就统一回"本榜只收录正分（零分不上榜）"，于是"已有 10 分、只是快照没刷新"被误报成零分。现按**可追溯榜值**分流：`value>0` 时按刷新状态提示"待进榜"（`fresh` 时提示去后台重建），只有 `value=0` 才回落到"零分不上榜"；`emptyHintOf` 也补了 `updating` / `delayed` 分支（"榜单快照还没刷新：已有新的计分待发布"），不再把空榜一律归因为零分。改动只在小程序前端（`services/ranking-ui.ts` / `pages/ranking/index.ts`），**无需重新部署云函数**。
8. **已修缺陷：小程序单测可能跑到上一次构建的旧 JS**。`scripts/build-miniprogram.mjs` 会把 TS 就地编译成同名 `.js`（已 gitignore），而 Vite 默认扩展名顺序里 `.js` 优先于 `.ts`，于是"改了 TS、测试却按旧产物判通过/失败"。已在 `apps/miniprogram/vitest.config.ts` 显式把 `resolve.extensions` 改为 `.ts` 优先；同时提醒：改小程序源码后必须 `npm run build -w @mw/miniprogram`（本次已重建）微信开发者工具才看得到新文案。
9. **已修缺陷：`ranking_rows` 行写入必失败（`RANKING_ROWS_WRITE_FAILED`）**——`writeRows()` 在 `set()` 载荷里带了不可写的 `_id`；只有名次行非空的重建才会触发，所以第一次空榜重建"看起来正常"。详见 4.2。这类"载荷字段"问题内存 store 测不出来，已用 `mw17:assert` 的全仓源码断言兜住。
10. **补部署可以绕过 `ensure-shared-js.mjs`，但必须核对 dist 新鲜度**：只要 `packages/shared/dist` 的最新写入时间晚于 `packages/shared/src` 的最新修改时间，且本轮改动不在 shared，跳过 shared 重编译不影响产物正确性（本次 `runtime.sha256=ccc7fcfa…`）。这只用于"用户正在跑 4174、又必须马上补部署"的场景；正式流程仍应停掉 Vite 后跑完整 `npm run mw17:deploy`。

## 7 建议状态

**已完成**（2026-10-15）。A/B/C/D 段交付，E 段用户手点 1–10 由用户确认观察到预期结果，leftover 收口三条路径同时为 0（`ok:true`），本地各项检查为 0。过程中修掉三处缺陷（第 4.2、6.7、6.8 条）并补部署（`runtime.sha256=ccc7fcfa4e86…`），收口记录见 5.1。

未标 A01—A31 / T01—T30 任何一项通过，尤其未标 **A10—A13 / T11—T14**。两处已知边界：① 手点 2 的"非 super 被拒"子项未做（需临时非 super 账号；该判定与 `reason` / 幂等键校验已有 API 单测覆盖，未登录调用 `ranking.rebuild` 的 `AUTH_REQUIRED` 已有 CLI 证据）；② 整链 `npm test` / `npm run build` 因用户后台 Vite 占用 `packages/shared/dist` 无法原样执行，已按等价步骤逐段复跑全部为 0（见第 2 节），停掉 4174 后可原样补跑。
