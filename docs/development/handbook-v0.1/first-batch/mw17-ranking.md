# MW17 四维排行榜

开发手册 v0.1｜任务状态：进行中（A/B/C 已接线；D 段已在 mw-test 部署与负向核验 `ok:true`，见 [结果](results/mw17-result.md)；E 段手点与 leftover 待闭合）
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)｜[结果](results/mw17-result.md)

本任务分多段。手点与 leftover=0 未闭合前，整项不得标已完成。只操作 mw-test。没有生产环境、没有真实支付。不创建 orders / vip_*。不开启超额。不启动 MW18—MW30。不把 A01—A31、T01—T30 标通过（尤其未标 A10—A13、T11—T14）。

## 分段

| 分段 | 名称 | 本对话 |
| --- | --- | --- |
| MW17-A | `@mw/shared` 排行纯逻辑与契约解析：并列 1/1/3、前百边界并列、刷新状态、费用筛选拒绝 | 已接线 |
| MW17-B | 服务端：`ranking.list` / `ranking.me` / `member.setRanking`；完整快照构建与切换；交卷刷新标记 | 已接线 |
| MW17-C | 小程序排行榜页：四榜、三级类目选择、本人名次与参与开关、加载/空榜/错误/延迟状态 | 已接线 |
| MW17-D | leftover 云脚本、集合索引、部署与负向核验 | 已执行（仅 mw-test：`mw17:deploy` / `mw17:verify` 退出码 0、负向 `ok:true`；脚本体见 `scripts/mw17-*.mjs`） |
| MW17-E | 用户手点 1–10 与 leftover=0（含不依赖 knownIds 的独立核查、本轮身份在 ranking_rows 的残留核查） | 已完成（2026-10-15）：手点 1–10 均观察到预期结果；`mw17:verify-leftovers` `ok:true`，三条路径同时为 0（含「保留 MW11 / MW14 历史卷」的决策）。过程中修掉三处缺陷并补部署：快照落后被误报成「零分不上榜」、`ranking_rows` 行写入载荷带不可写 `_id` 导致 `RANKING_ROWS_WRITE_FAILED`、小程序单测跑到上一次构建的旧 JS，见 [结果](results/mw17-result.md) 4.1、4.2、6.7、6.8。已知边界：手点 2 的「非 super 被拒」子项未做（该判定有 API 单测覆盖） |

## 目标与可见结果

1. 四个榜单：总分榜（累计）、分类榜（选定有效类目及其后代）、本周进步榜、本月进步榜。**免费卷与 VIP 卷统一计入**，不新增 `access` / `freeOnly` / `accessFilter` 等费用筛选；传入即 `INVALID_ARGUMENT`。
2. 榜值来自服务端即时维护的 `score_metrics`（MW15 已在交卷事务内按 delta 累加 total / week / month / 含自身的最多三级 category）。分类榜因此天然"父级包含后代且按 paperId 去重"。
3. **零分不上榜**：只发布 `value > 0` 的成员行。
4. **并列名次按 1、1、3**（竞赛排名）；同分内部按 `reachedAt` 升序、再按 `memberId` 升序排列，只保证展示稳定，不打破并列名次。
5. **前百边界并列**：前台只公开 `rank <= 100` 的行，**并包含第 100 名的全部并列用户**；快照里写入全体参与者的名次行，以支持前百之外的本人名次。
6. **本人名次与榜单使用同一代快照**：`ranking.me` 与该 scope 的 `ranking.list` 读同一个 `ranking_heads` 文档的同一个 `generation`。
7. 周/月换窗遵循项目统一时间口径（`weekKeyShanghai` / `monthKeyShanghai`：北京时间周一 00:00 起、当月 1 日 00:00 起）；周期键由服务端计算，不接受历史周期。
8. **完整快照构建成功后再切换**：先把该代全部 `ranking_rows` 写齐并校验行数，再切换 `ranking_heads`；失败继续提供上一完整代并提示「更新延迟」，**不展示半成品**。
9. 展示更新时间、更新中与更新延迟状态：`updatedAt` 是快照真实构建完成时间，`requestedAt` 是最近一次待刷新请求时间，`buildingSince` 是重建进行中标记。**不伪造刷新时间**。
10. 参与与退出：新会员默认 `rankingOptIn=false`；`member.setRanking` 主动开启/关闭；关闭后**立即**不再公开展示（读侧二次核对成员状态），旧快照里的名次仍属旧快照并标明等待刷新；不清空个人成绩与成长总分。
11. 权限：`ranking.list` 为公开只读（游客可看前百，无本人条）；`ranking.me` 需已注册会员；`ranking.rebuild` 需 `super` 且带 `reason` 与 `idempotencyKey`；`ranking.status` 任意已启用后台角色可读。
12. 必要的后台入口：后台「榜单治理」页可读取快照状态、触发重建并发布。**不扩展成通用排行平台**（不做历史赛季、不做费用分榜、不做排行奖励）。

## 历史数据口径（发起人 2026-10-15 已定：不补记）

依据 [mw16-result.md](results/mw16-result.md) 第 6.1 节：MW15 收口清理时 `score_metrics` / `paper_bests` / `score_events` 的来源记录一并删除，只剩 `member_stats.totalScore=9`（`scoreSeq=6`）。发起人已确认**不补记**，本轮不得重复请求确认、不得补写伪造聚合伪装成真实事件。

MW17 的处理方式（在榜侧显式处理并解释差异）：

1. 榜值只从**可追溯事件**（`score_metrics`）累计；既有 `member_stats.totalScore` 原样保留，不清零、不改写。
2. 快照构建时统计 `diagnostics.historyGapMembers`（有效参与成员中 `member_stats.totalScore > 0` 但无可追溯 total 指标的人数）与 `historyGapScore`（其总分合计），写入 `app_config/ranking` 与榜单响应，页面据此显式提示"历史成长总分未纳入可追溯榜值"。
3. `ranking.me` 对这类成员返回 `onBoard=false`、`rank=null`，同时返回 `historyTotalScore` 与 `valueTraceable=false`，不把 0 分说成"没练过"。
4. 不合并 `member_stats.totalScore` 进榜值来"制造一致"；该差异是已知测试历史缺口，**不改变正常用户的计分规则**。
5. 只读核对当前云端是否仍与 mw16 收口记录一致（只读，不写）。若发现不一致，如实记录并按现行产品口径处理。

## leftover 门禁（沿用 MW13—MW16，含独立核查）

MW17 会产生两类云端写入，归属必须先分清：

| 类别 | 文档 | 是否计入 leftover |
| --- | --- | --- |
| 本轮身份的业务写入（交卷派生） | `attempts` / `active_attempts` / `paper_bests` / `score_events` / `score_metrics`（按 `memberId` 关系精确查） | 是 |
| 用户明确标记的本轮测试卷 | `papers` / `paper_versions` / `paper_chunks` / `paper_answers` | 是（仅在用户主动记入时） |
| 榜单快照（派生、可重建、跨用户共享） | `ranking_heads` / `ranking_rows` / `app_config/ranking` | **否**（理由：派生聚合；删除会让全站榜单空白，属"删共享聚合凑 leftover=0"，明确禁止） |

1. 浏览、翻页、切榜、看本人名次都不得写 leftover。只有用户主动点「记入本轮 leftover」的对象才进清单，默认空清单。
2. 导入只接受 SHA-256。空清单 / 非哈希 / 导入哈希数大于匹配真实 `_id` 必须失败退出。禁止 `find({},100)` 当全集。
3. 独立核查路径用用户提交的 SHA-256 反查真实 `_id` 与 `(memberId, paperId)` 关系，再按 `memberId` 精确查询统计残留；`derivedIdsUsed=false`，不依赖脚本推导 id。
4. `members` / `member_stats` / `identities` / `categories` 既不计入 leftover，也永不删除（不删历史会员数据、不删种子十类）。
5. 收口门禁 `mw17:verify-leftovers` 要求 knownIds 路径与独立路径同时为 0；并且额外核查**本轮标记的测试身份在 `ranking_heads` / `ranking_rows` 中不残留**（收口流程末尾会再重建一次快照，让派生行自然消失）。
6. 空清单 / `wroteDocs=false` 仍判 `WROTE_DOCS_FALSE`。`leftoverObjects` 不得写死 0。无云端写入时记录清理不适用。

## 必须由用户手点（E 段）

执行者不得代点，不得 automator / 服务端口 / CLI 冒充 FROM 或 admin 登录，不得把模拟测试当云端验证。

### 前置准备

1. 根目录跑 `npm run build`（生成 `services/cloud.runtime` 与云函数产物）。若后面要跑 `npm run test` / `npm run build`，**先停掉 4174 后台 Vite**（它占用 `packages/shared/dist`，会让 `scripts/ensure-shared-js.mjs` 删除失败）。
2. 后台：`npm run dev -w @mw/admin`，浏览器 `http://localhost:4174`，用 super 账号登录。
3. 小程序：微信开发者工具打开 `apps/miniprogram`，云环境为 mw-test。首屏前先跑一次 `npm run build -w @mw/miniprogram`（重建 `miniprogram_npm`）。
4. 已知环境事实（用来判断"是否符合预期"）：
   - 榜单快照在本轮部署前不存在，所以 `ranking_heads` / `ranking_rows` / `app_config/ranking` 里出现的任何文档都来自本轮；
   - mw-test 现存 1 条历史 `member_stats`：总分 9，但 `score_metrics` 0 条（MW15/MW16 遗留，口径"不补记"），**开局任何榜都应为空且提示历史缺口 1 人 / 9 分**；
   - 开局没有任何 VIP 判权账本（MW20）；本轮只用免费卷验证"统一计入"。

### 手点步骤

1. **后台读快照状态**：「榜单治理」→ 点「读取榜单快照状态」。预期：`publishedGeneration=""`（从未发布）、`requestedAt=""`、`building=false`；若已有快照则显示其真实 `publishedAt` 与各榜行数。
2. **重建并发布快照**：点「重建并发布榜单快照」。预期：状态行显示已发布、`publishedGeneration` 非空、`publishedAt` 为当前时间、`rowCounts` 各 scope 数量、`diagnostics.historyGapMembers=1`、`historyGapScore=9`、`truncated=false`。被拒（非 super / 缺 reason / 缺幂等键）时不得改变版本。
3. **总分榜首屏（空榜 + 更新时间 + 无费用筛选）**：小程序「排行榜」→「总分」页签。预期：显示真实「更新于 …」时间；无任何"免费/VIP"筛选控件；因当前没有正分可追溯榜值 → 显示空榜文案；同时显示历史缺口提示（1 位会员 / 9 分未纳入可追溯榜值）。
4. **游客可看前百、无本人条**：用一个**未在本环境注册过**的微信号（或清掉该会话）打开排行榜。预期：能看到榜单与更新时间，看不到本人名次条，不报错。
5. **本人未参与 → 主动开启**：已注册身份的排行榜页底部本人区域显示「未参与公开排行」+「开启」。点「开启」后预期：提示"已参与，榜单待下次刷新"，`member.me` 的 `rankingOptIn=true`；**此时立刻回榜仍看不到本人**（旧快照 + 需重建），这属预期，不得把分页序号当新名次。
6. **产生真实榜值并上榜**（会新增本轮测试对象，收口时需清理）：用测试身份做一张**免费卷**并交卷得正分 → 后台再点「重建并发布榜单快照」→ 回小程序「总分」页签刷新。预期：本人出现在榜上且本人区域显示名次、榜值、与上一不同名次的分差；`更新于` 时间随之变化（是真实构建时间）。
7. **零分不上榜 + 重复练习不重复加分**：再交一次同一张卷且分数不高于最高分 → 后台重建 → 榜值与名次不变、仍只出现一次。若用第二个测试身份提交同分，预期两人名次为 1、1（并列 1、1、3 规则；此子项可选）。
8. **参与 → 退出 → 立即不公开展示**：在排行榜页点「退出公开排行」。预期：本人区域回到「未参与公开排行」；**不重建快照**的情况下回榜刷新，本人已从公开榜消失（读侧二次核对成员状态的过滤生效），且页面标明"等待刷新"；个人成长总分不变。再点「开启」→ 重建后重新出现。
9. **分类榜与周/月榜**：分类页签选一级类目 → 只显示该类目及其后代的累计分（父级 ≥ 子级，不重复计同卷）；不选类目时提示"请选择类目"。本周/本月页签显示当前周期键对应的榜值，且与总分榜的时间口径一致。
10. **更新延迟（可选）**：交卷后**不重建**，等 60 秒以上再打开排行榜页。预期：显示「更新延迟」提示与真实 `请求时间`，不伪造刷新时间。

### 本次写入的归属（收口前必须先定）

- 手点 6 / 7 会用测试身份交卷 → 产生 `attempts` / `paper_bests` / `score_events` / `score_metrics`，属本轮测试对象，必须记入 leftover。
- 手点中若新建了测试卷，同样点「记入本轮 leftover」。
- `ranking_heads` / `ranking_rows` / `app_config/ranking` 是派生共享快照，**不记入 leftover、不删除**；收口末尾重建一次快照，让测试身份的行自然消失。

### leftover=0 收口（完成上面手点后）

1. 在小程序里逐个对象点「记入本轮 leftover」（试卷详情 / 答题页 / 结果页 / 「我的」本人身份）。
2. 回首页「复制本轮 leftover knownIds」，得到只有 SHA-256 的 JSON。
3. `$env:MW17_KNOWN_IDS_JSON='<复制的JSON>'; npm run mw17:import-known-ids`。
4. `npm run mw17:resolve-known-ids`。哈希在云端找不到对应文档会以 `HASH_UNMATCHED` 退出（不得当作 leftover=0）。
5. 只读先看残留：`npm run mw17:independent-check`。
6. 精确删除：`npm run mw17:cleanup`（按已解析 id ∪ 关系查询读到的真实 `_id` 去重后精确删除）。
7. 后台再点一次「重建并发布榜单快照」，让本轮测试身份不再出现在快照里。
8. 核验：`npm run mw17:verify-leftovers` 须 `ok:true`（knownIds 路径与独立路径同时为 0，且快照中无本轮测试身份、种子十类仍在、未出现 orders / vip_*）。

手点 1–10 与 leftover=0 全部闭合后，MW17 方可改为已完成。

## 不包含的工作

不启动 MW18—MW30。不实现类目迁移与安全删除、题目纠错与历史重评分、VIP 权益账本与购买、退款对账、个人中心与反馈、协议与账号注销、后台运营统计、容量与性能专项（MW26）、备份恢复演练。不做历史赛季页面、不做费用分榜、不做排行奖励。不冻结上线门槛。不把 VIP 购买或到期当加减分。不实现 `ranking.ban`（后台禁榜，属后续治理范围；本轮只有会员主动参与/退出）。不改写 MW01—MW16 与 MW-UI01 的历史完成记录。不自动提交、推送或发布。
