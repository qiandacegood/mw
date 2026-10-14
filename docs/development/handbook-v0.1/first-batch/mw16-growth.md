# MW16 成长等级与勋章

开发手册 v0.1｜任务状态：已完成（2026-10-15 手点与 leftover 收口闭合；A/B/C 已接线，D 段部署与负向核验已通过，E 段手点 1–9 完成，步骤 10 为 NOT_RUN）
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)｜[结果](results/mw16-result.md)

本任务分多段。手点与 leftover=0 未闭合前，整项不得标已完成。只操作 mw-test。没有生产环境、没有真实支付。不创建 orders / vip_*。不开启超额。不把 VIP 购买或到期当作加减分。不启动 MW17。上线门槛在 MW28 才冻结，本轮只落可配置门槛 + 预览发布。不标 A01—A31、T01—T30 通过（尤其未标 A09、T29）。

## 分段

| 分段 | 名称 | 本对话 |
| --- | --- | --- |
| MW16-A | `@mw/shared` 等级门槛与勋章纯逻辑；`member.growth`；结算/注册接线（跨级补齐、不重复授予） | 已接线 |
| MW16-B | 后台等级配置 `growth.config` / `growth.preview` / `growth.publish` / `growth.recompute` | 已接线 |
| MW16-C | 小程序个人成长展示（我的 · 成长区块；首页等级） | 已接线 |
| MW16-D | leftover 云脚本、集合索引、部署与负向核验 | 已通过（仅 mw-test；`mw16:deploy` / `mw16:verify` 退出码 0） |
| MW16-E | 用户手点 1–10 与 leftover=0（含不依赖 knownIds 的独立核查） | 已闭合（2026-10-15：手点 1–9 完成、步骤 10 NOT_RUN，门禁 `ok:true`） |

## 目标与可见结果

1. 等级由总分落入的区间决定，VIP 不参与计算。门槛配置存于 `app_config/growth`（单键一文档、带 `configVersion`），未发布时回落到产品说明书 V1.1 的初始建议配置。
2. 每个等级关联一枚勋章，`_id = H(memberId, medalId)`：首次达到门槛自动授予；一次跨多级时**补齐经过等级的勋章**；同一勋章不会重复授予（确定 id + 事务内比对既有授予）。
3. 注册即得第一级勋章；勋章永久保留，门槛提高只重算等级、**不删除既得勋章**。
4. 后台门槛校验：必须从 0 起严格递增、名称与勋章不可缺失、levelId / medalId 不可重复；不满足则整批拒绝。
5. 门槛变动先预览影响（受影响人数、升降级、待补发勋章数、是否截断），确认后才发布新配置版本；发布后按现有总分重算等级、补发新达到的勋章。
6. 当前等级可重算（`growth.recompute`，可指定单个会员或按上限批量）；重复执行不产生额外写入。
7. `member.growth` 返回本人当前等级、总分、升级进度（百分比 / 还差多少分）与已得勋章（含授予时间）；未注册返回 `MEMBER_REQUIRED`。
8. 可新建 mw-test 集合 `medal_grants` 及索引 `idx_medal_grants_member_awarded`（`memberId` / `awardedAt`）。
9. 权限：读配置与预览任意已启用后台角色；发布门槛与重算等级需要 `super`（发布必须带 `idempotencyKey` 与 `reason`）。

## 不把 VIP 当加减分

VIP 状态、购买与到期都不进入总分、等级或勋章判断；`member.growth` 只读总分与勋章授予。到期不清空成长（VIP 账本属 MW20）。

## leftover 门禁（沿用 MW13—MW15，并补一条独立核查）

1. 浏览 / 打开详情 / 自动进页不得写 leftover。只有用户主动点「记入本轮 leftover」的本轮测试对象才进清单，默认空清单。
2. 导入只接受 SHA-256。空清单 / 非哈希 / 导入哈希数大于匹配真实 `_id` 必须失败退出。禁止 `find({},100)` 当全集。
3. 只删已解析的本轮 attempts / active_attempts、用户明确记入的本轮测试卷及其 version/chunk/answer、由这些 attempt 算出的 paper_bests / score_events / score_metrics，以及本轮测试会员的 medal_grants 授予。不得删种子十类，不得删 MW11—MW15 非本轮残留，不得删 `member_stats` / `members` / `identities`。
4. 空 knownIds / `wroteDocs=false` 仍判 `WROTE_DOCS_FALSE`。`leftoverObjects` 不得写死 0。
5. **独立核查（MW16 新增，必须附带）**：MW15 已证明 `resolve` 推导出的 id 与云端真实 `_id` 不一致，且 `db nosql execute` 的 DELETE 对不存在的 id 也返回成功。因此 MW16 的 leftover=0 必须同时满足两条互相独立的路径：
   - knownIds 路径：`mw16:verify-leftovers` 逐个点查已解析 id；
   - 独立路径：`mw16:independent-check` / `mw16:verify-leftovers` 用用户提交的 SHA-256 反查真实 `_id` 与 `(memberId, paperId)` 关系，再按 `memberId` / `paperId` **精确查询**统计残留；不做任何 id 推导，`derivedIdsUsed=false`。
6. 独立路径的范围（避免误删历史残留）：
   - `papers` / `paper_versions` / `paper_chunks` / `paper_answers`：只针对**用户明确标记**的本轮测试卷；
   - 会员名下文档：只收「本轮卷（含由已标记 attempt 反查到的卷）」或「已标记的本轮 attempt」关联的 attempts / active_attempts / score_events / paper_bests；
   - `score_metrics` 没有 paperId 字段，只能按 memberId 精确读（mw-test 上该集合当前为 0 条）；
   - `medal_grants`：只收本轮来源（`sourceType=register` 且 `sourceId=member.register`、`sourceType=recompute` 且 `sourceId=growth@v*`、或 `sourceType=submit` 且 `sourceId` 是已标记的本轮 attemptId）；
   - `members` / `member_stats` / `identities` / `categories` 既不计入 leftover，也永不删除。

## 必须由用户手点（E 段）

执行者不得代点，不得 automator / 服务端口 / CLI 冒充 FROM 或 admin 登录。

### 前置准备

1. 后台：在仓库根目录跑 `npm run dev -w @mw/admin`（Vite 固定在 4174 端口），浏览器打开 `http://localhost:4174`，用 super 账号登录。若后面要跑 `npm run test` / `npm run build`，**先停掉 Vite**（它占用 `packages/shared/dist`，会让 `scripts/ensure-shared-js.mjs` 删除失败）。
2. 小程序：微信开发者工具打开 `apps/miniprogram`，云环境为 mw-test。若刚改过云函数，先在根目录跑一次 `npm run build`（生成 `services/cloud.runtime`）。
3. 已知环境事实（用来判断"是否符合预期"）：
   - 开局门槛：`configVersion=1`，6 级，门槛 0/100/300/800/1500/3000；
   - mw-test 现存 1 条 `member_stats`：总分 9、等级 L1，是 MW16 之前注册的历史会员，**开局 0 枚勋章**；
   - `medal_grants` 集合在本轮部署前不存在，所以本轮之后出现的任何授予都来自本轮（`sourceId` 会写明 `growth@v*`、`member.register` 或某条 attempt）。
4. 后台操作的固定顺序：**读取当前等级配置** →（可选）四个「快速填充」按钮 → **预览影响（不写库）** → **发布门槛并重算**。发布后只有状态行显示「已发布且云端回读一致：configVersion=N」才算真的落库；预览不改版本、不写库。页面会记住上一次的预览结果，被拒时预览框会被清空，避免把旧结果看成当前结果。

### 手点步骤

1. **后台读门槛**：「成长等级与勋章配置」→ 点「读取当前等级配置」。预期：门槛 JSON 回填 6 行，状态行显示 `configVersion=1`、来源为 `app_config`。
2. **成长展示首屏**：小程序「我的」→ 看「个人成长展示」区块。预期：当前等级 `L1 思维新芽`、总分 `9`、已得勋章 `0 / 6`、进度指向 L2 并显示还差多少分。
3. **补发首枚勋章（历史会员路径）**：回后台点「按当前门槛重算等级」（目标会员输入留空）。预期：状态显示按 `configVersion=1` 重算 1 人、等级变化 0、补发勋章 ≥1。再回小程序「我的」刷新 → 已得勋章 `1 / 6`，第一枚「新芽」标为已获得。
   - 同一开发者工具账号的 openid 不变，**重复注册不会新建会员**（`member.register` 对已存在身份只返回既有会员，不补勋章）。所以"注册即得首枚勋章"要用**另一个微信号扫码真机预览**（新的 openid）。
4. **门槛预览（不写库）**：点「填入跨级门槛 L2=5/L3=8」（或手改第 2 行 `minScore=5`、第 3 行 `minScore=8`，数字不加引号），再点「预览影响（不写库）」。预期：状态行写「预览完成（未写库，configVersion 仍是 1）」，扫描 2 人、影响 1、升级 1、待补发勋章 2、迁移 `L1→L3:1`；`growth-impact` 框里有 `affected/upgraded/downgraded/medalsToGrant/byTransition`。预览**不改**任何文档。
5. **发布 → 跨级补齐**：点「发布门槛并重算」。只有状态行出现「已发布且云端回读一致：configVersion=N」才算真的落库（页面会用云端回读版本校验响应版本，不一致会明确提示不一致）。预期：重算后有等级变化与补发。回小程序「我的」→ 等级升到 `L3 思维探索者`，勋章**一次出现 3 枚**（L1 新芽 + L2 启程 + L3 探索），证明是"补齐经过等级"而不是只给最后一枚。
6. **重复不重复授予**：再点一次「按当前门槛重算等级」。预期：补发勋章 `0`、等级变化 `0`；小程序勋章数不变。另外对同一份卷重复练习、分数不超过最高分时，总分不重复加。
7. **既得勋章保留**（必须在第 5 步真正发布成功之后做，否则等级还没升过，看不到回落）：点「填入提高门槛（建议 100 起）」→「预览影响（不写库）」应显示降级 ≥1、待补发 0、迁移 `L3→L1:1` →「发布门槛并重算」。预期：等级回落到 L1，但**勋章一枚都不少**（不撤销）。
   - 注意：门槛必须**严格递增**。只把 L2 抬到 1000、而 L3 还留在 8，会被服务端拒 `INVALID_ARGUMENT`（`GROWTH_LEVELS_INVALID` + `LEVEL_MIN_NOT_INCREASING`）。按钮已按建议值整体抬到 0/100/300/800/1500/3000。
8. **非法门槛应被拒**：点「填入非法门槛（首级非 0）」→ 页面会先做本地预检并弹确认框；点「确定」仍会发送，服务端应回 `INVALID_ARGUMENT`（`GROWTH_LEVELS_INVALID`）；点「取消」则不发送、只显示本地提示。点「填入缺勋章名」同理（`MEDAL_NAME_MISSING`）；把整段改成非数组 → 界面提示门槛 JSON 无法解析。被拒后顶部 `configVersion` 不得变化，`growth-evidence` 里该步应为 `ok:false` + `errorCode:"INVALID_ARGUMENT"`。做完点「读取当前等级配置」把 JSON 还原为云端当前门槛。
9. **权限与 VIP**，三个子项按能覆盖的程度如实记录：
   - 非 super：用第二个后台账号（`admin_users` 里 `roles=["operations"]` 且 `enabled`）登录后点发布，应被拒 `SUPER_REQUIRED`。环境里只有 super 账号时，这一条记 **NOT_COVERED**，不要假装通过。
   - VIP 不加分：mw-test 当前没有任何 VIP 卷。要做的话在「试卷编排与发布」把权限选 `VIP`、先用「加入上方当前题」组卷再发布，然后在免费会员下打开该卷应显示 `VIP_REQUIRED`，并确认「我的」总分/等级/勋章不变（不真实扣款、不发明账本）。**代价**：这会产生本轮新卷对象，必须同样点「记入本轮 leftover」并在收口时删除。不想新增对象就把这一条记 NOT_COVERED（MW15 已覆盖过 `VIP_REQUIRED`）。
   - 未注册身份：用**另一个没在本环境注册过的微信号**打开「我的」→ 应看到 `MEMBER_REQUIRED` /「注册后可查看成长等级与勋章」。已注册的账号（openid 已有会员）看不到这个提示。
10. **版本冲突（可选）**：开两个后台标签页都先「读取当前等级配置」，在 A 页发布成功后再在 B 页点发布。预期 B 页被拒 `VERSION_CONFLICT`（提示重新读取后再发）。

### 本次写入的归属（收口前必须先定）

MW16 会有两类本轮写入：测试 attempt 派生文档（若有交卷）与 `medal_grants` 授予。独立核查只把**你主动记入清单的对象**纳入范围：

- 记入「本人身份」（「我的」→「记入本轮 leftover（本人）」）：该会员名下与本轮卷/attempt 关联的文档，以及本轮来源（`member.register` / `growth@v*` / 已标记 attempt）的勋章授予都会被纳入并清理；
- 不记入本人身份、只记入测试卷/attempt：只清卷与 attempt 派生文档，该会员保留本轮补发的勋章。

推荐做法（严格门禁）：本人身份 + 测试卷 + attempt 都记入，收口后 mw-test 回到无本轮痕迹；代价是该历史会员的 L1 勋章也被清掉（"既得勋章保留"是过程观察，不要求最终留存）。若要长期保留成长态，需发起人明确说"这次补发不算本轮测试对象"，并在结果文档中写明。

### leftover=0 收口（完成上面手点后）

1. 在小程序里逐个对象点「记入本轮 leftover」：测试卷详情页 / 答题页 / 结果页各有一个按钮；本人身份在「我的」页点「记入本轮 leftover（本人）」。**浏览、打开详情、自动进页都不写清单**（默认空清单）。
2. 回首页点「复制本轮 leftover knownIds」，得到 `{"papers":[…],"attempts":[…],"members":[…]}`（只有 SHA-256，无明文）。
3. 导入（PowerShell 用单引号包住 JSON 即可，无需转义双引号）：`$env:MW16_KNOWN_IDS_JSON='<复制的JSON>'; npm run mw16:import-known-ids`。全空载荷会被拒 `EMPTY_HASHES`，非 64 位十六进制会被拒 `HASH_NOT_SHA256`。
4. 解析：`npm run mw16:resolve-known-ids`。若某个哈希在云端找不到对应文档会以 `HASH_UNMATCHED` 退出（不得当作 leftover=0）。
5. 独立核查（只读，先看残留）：`npm run mw16:independent-check`。输出 `counts`（各集合命中数）、`total`、`scope`、`derivedIdsUsed=false`。
6. 精确删除：`npm run mw16:cleanup`。它按"已解析 id ∪ 关系查询读到的真实 `_id`"去重后精确删除，并打印 `independentBefore/After`。
7. 核验：`npm run mw16:verify-leftovers` 须 `ok:true`，即 `knownIdLeftoverDocs=0`、`independentTotal=0`、`wroteDocs=true`、`cloudWriteClaimed=true`、`exactIdSweepOnly=true`、`seedPresent=true`、`medalIndexPresent=true`、种子十类仍在、未出现 orders / vip_*。

手点 1–10 与 leftover=0 全部闭合后，MW16 方可改为已完成。本轮 1–9 已完成（第 7 步附云端回读证据，第 8/9 步为用户手点报告），步骤 10 为可选、记 NOT_RUN；leftover=0 于 2026-10-15 由两条独立路径门禁闭合，故 MW16 已标已完成。

## 不包含的工作

不启动 MW17 / MW18 / MW19 / MW20。不实现四维排行榜、类目迁移、题目纠错重评分、VIP 账本与购买、勋章撤销界面（`revokedAt` 字段保留但本轮不开放撤销入口）。不创建 orders / vip_*。不把 VIP 购买或到期当加减分。不冻结上线门槛（MW28 才冻结）。不把 A01—A31、T01—T30 标通过，尤其不标 A09 / T29。不改写 MW12 / MW14 / MW15，不重开 MW13。
