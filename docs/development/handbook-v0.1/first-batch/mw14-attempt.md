# MW14 答题草稿与继续练习

开发手册 v0.1｜任务状态：已完成（结果见 [results/mw14-result.md](results/mw14-result.md)）
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)

本任务分多段。**本对话只做第 B 段：小程序答题页**。不重写 A 段领域逻辑，不写 leftover 云脚本，不部署，不提交，不启动 MW15。手点与 leftover=0 未闭合前，整项不得标已完成。结果文件待后续段闭合后再写。

> 2026-10-10 补记：上一轮执行中断（模型重复响应）后，本轮接手先修复阻断点，再补全第 C 段的 leftover 云脚本、集合索引与负向断言；**仍未部署、未提交**。第 D 段用户手点与 leftover=0 仍须用户本人完成。详见文末「本轮实际执行记录」。

## 分段

| 分段 | 名称 | 本对话 |
| --- | --- | --- |
| MW14-A | 领域逻辑：`mw-member` 接通 6 个 attempt action，`member.me` 返回真实草稿摘要 | 已接线（上一段，本段不重写） |
| MW14-B | 小程序答题页、答题卡、保存状态、首页继续练习 | 已接线 |
| MW14-C | leftover 云脚本、集合索引、部署与负向核验 | 已完成（仅 mw-test）：脚本 / 索引 / 部署 / 负向核验均通过 |
| MW14-D | 用户手点 1–8 与 leftover=0 | 已完成：用户手点 1–8 自报通过；本轮哈希精确解析 3=3、删除 10 条、leftover=0 |

## 目标与可见结果

小程序接通答题页、答题卡、保存状态（保存中 / 已保存 / 保存失败）和首页继续练习。会员入口实现 `attempt.start` / `startReplacing` / `get` / `questionPage` / `save` / `abandon`，`member.me` 返回真实草稿摘要。一账号同时只有一份 `inProgress`。不实现交卷评分。

完成后应交付：

1. 本执行说明与 [results/mw14-result.md](results/mw14-result.md)，并回写 [07-progress.md](../07-progress.md)。
2. 试卷详情「开始」不再写「MW14 未接通」；免费卷可开局，已保存答案可恢复，首页登录后出现继续练习。
3. 已有活动草稿时 `start` 返回 `ACTIVE_ATTEMPT_EXISTS`，不自动丢弃；`startReplacing`（`confirmed=true`）同一事务放弃旧稿并开新稿。
4. `attempt.save` 提交当前完整已选答案集（最多 100 项）；`expectedRevision` + `requestId` 同键重放、旧 revision 返回 `DRAFT_CONFLICT`；`submitted` / `abandoned` 后拒改。
5. `questionPage` / 未交卷 `get` 不含正确答案、解析、`paper_answers`、`correctOptionIds`。客户端直连 `attempts` / `paper_answers` 拒绝。
6. 本地五项检查退出码 0。用户手点 1–8 与 leftover=0 闭合前整项最多部分完成。

## 输入

MW13 浏览页与 leftover 门禁、MW08 注册/资料、MW11 发布快照、MW06 事务/幂等、产品 8.1 / A07 / A08、接口契约 attempt.*、一致性第 2 节、数据模型 `attempts` / `active_attempts`。只操作 mw-test。不开启超额，不真实扣款。正式 VIP 判权是 MW20；本轮只接统一权益接口的隔离测试替身。

## 本任务工作范围

1. 一账号同时只有一份 `inProgress`。开始另一卷必须用户明确继续或放弃；放弃不计分，保留 `abandoned` 记录。
2. 断网可留当前页未同步选择并提示；恢复后对版本再保存，未确认不得显示已保存。不支持离线完成/离线交卷。
3. 返回、重登、换设备只恢复服务端已确认答案。
4. 免费会员看 VIP 卷仍 `VIP_REQUIRED`，不能 start。游客开始仍先注册。
5. 答题页「交卷」只说明 MW15 未接通。不实现 `attempt.submit` / `result` / `analysis` / `history`，不写 `paper_bests` / `score_events` / `score_metrics`。可用夹具构造 `submitted` 记录，只测「已提交拒改」。
6. 可新建 mw-test 集合 `attempts`、`active_attempts`，以及 `attempts` 本人历史索引（`memberId/state/submittedAt/_id`）。P08 其余未来索引继续 PARTIAL。不复制 `mw-validation-*`。不改生产，不改公开读契约，不恢复排行榜费用筛选。

## 第 A 段已接线（上一段，本段不重写）

1. `packages/shared`：答题解析、草稿摘要、隔离 VIP 替身。
2. `services/api`：`mw-member` 接通 `attempt.start` / `startReplacing` / `get` / `questionPage` / `save` / `abandon`；`member.me` 读 `active_attempts` 返回真实草稿摘要。
3. 一账号一份 `inProgress`；`start` 遇活动草稿返回 `ACTIVE_ATTEMPT_EXISTS`；`startReplacing` 必须 `confirmed=true`。
4. `save` 提交完整 `answers` + `expectedRevision`；同 `requestId` 重放；旧 revision 返回 `DRAFT_CONFLICT`；`submitted` / `abandoned` 拒改。
5. `questionPage` 与未交卷 `get` 经 `publicSafe` 拦截 `answer` / `analysis` / `correctOptionIds` / `paper_answers`。
6. 本段只跑 `@mw/shared` 与 `@mw/api` 的 typecheck / test。交卷、VIP 账本、小程序页、leftover 脚本留给后续段。

## 第 B 段已接线（本对话）

1. 试卷详情「开始」不再写「MW14 未接通」。游客先注册。免费会员可 `attempt.start` 免费卷。VIP 卷对免费会员显示 `VIP_REQUIRED`，不能 start。
2. 已有活动草稿时必须确认继续或放弃；未确认不丢草稿。放弃走 `attempt.startReplacing`（`confirmed=true`），使用服务端带回的 `existingRevision`。
3. 答题页 + 答题卡：上一题 / 下一题 / 跳题、已答未答。保存状态为保存中 / 已保存 / 保存失败；只有服务端确认才显示已保存。`save` 发送当前完整 `answers` + `expectedRevision`，串行发送。
4. `DRAFT_CONFLICT` 提示后由用户选服务端或当前页，再显式重发。断网改选不得显示已保存，重连后按版本再存。不支持离线交卷。
5. 首页登录后若 `member.me` 有草稿摘要则出现继续练习，进入已保存草稿。返回 / 重登只恢复服务端已确认答案。
6. 答题页「交卷」只说明 MW15 未接通，不调用 `attempt.submit`。浏览 / 进页不得自动记 leftover。
7. 本段只跑小程序 typecheck / test 以及会碰到的页面检查。不写 leftover 云脚本，不部署，不提交，不启动 MW15，不标已完成。

## leftover 门禁（沿用 MW13，不得回退）

1. 浏览货架/列表/打开详情/自动进页不得写入 leftover。只有用户主动点「记入本轮 leftover」的本轮测试 attempt（如本轮新建测试卷则含其 paper）才能进复制清单。默认复制空清单。
2. 导入只接受 SHA-256。空清单、非哈希、导入哈希数大于匹配真实 `_id` 必须失败退出，不得把未匹配当 leftover=0。禁止 `find({}, 100)` 当全集；扫不全或匹配 0 条就失败，不得猜删。
3. leftover 只准删本轮已解析 `attempts` / `active_attempts`，以及用户明确记入的本轮测试卷及其 version/chunk/answer。不得删种子十类，不得删 MW11/MW12/MW13 非本轮残留。空 `knownIds` / `wroteDocs=false` 继续判不干净（`WROTE_DOCS_FALSE`）。leftover-verify 只查已解析 `knownIds`，不扫整表。`leftoverObjects` 必须由已解析 object id 确认，不得写死 0。
4. 不实现 `attempt.submit`。不创建订单/VIP 账本集合。

## 必须由用户手点

执行者不得代点，不得 automator / 服务端口 / CLI 冒充 FROM 或 admin 登录。手点与 leftover=0 未闭合时，MW14 最多部分完成。

## 不包含的工作

不启动 MW15 / MW16 / MW17 / MW20。不把 A01—A31、T01—T30 标通过，尤其不标 A07 / A08 / T10 / T15。不改写 MW12 为已完成。不把 MW13 重开。不创建 `orders` / `vip_accounts` / `vip_plans` / `vip_grants` / `vip_events`。

## 本轮实际执行记录（2026-10-10）

上一轮执行中断（模型重复响应），本轮接手排查并补齐，**未部署、未提交、未标已完成**。

阻断点与修复：

1. **阻断点**：`scripts/mw13-assert.test.mjs` 的扫描门禁仍禁止官方入口与试卷详情出现 `attempt.start`。A 段已合法接通该 action，导致 `npm test` 的 `&&` 串行链在第一个脚本即失败、整条链路中断（表现即“卡住”）。已将 MW14 对该文件的拦截改为由 `scripts/mw14-assert.test.mjs` 正向核验，MW13 leftover 门禁（`freeOnly|accessFilter`、未标通过）保持不回退。
2. **脚本缺口**：`scripts/mw14-lib.mjs` 增加并导出 `leftoverVerifyDecision`（此前 `mw14-leftover-verify-lib.mjs` 引用了不存在的导出）；`scripts/mw14-deploy.mjs` 补齐缺失的 `join` 导入并改用 `createCollectionCommand` / `createIndexCommand`（与 MW11 一致）；`scripts/mw14-leftover-verify.mjs` 改为按 `ATTEMPT_INDEXES` 名称核验索引，去掉重复写文件。
3. **负向核验**：新增 `scripts/mw14-assert.test.mjs`（哈希只接受 SHA-256、解析未匹配不得当 leftover=0、`wroteDocs=false` 判不干净、`leftoverObjects` 不写死 0、答题页无交卷 / 无答案解析泄漏、清理不接受整表清空），并接入 `npm test`；`package.json` 增加 `mw14:deploy` / `mw14:import-known-ids` / `mw14:resolve-known-ids` / `mw14:cleanup` / `mw14:verify-leftovers` / `mw14:assert`。
4. **本地五项检查**均为退出码 0：`check:prototypes` / `typecheck` / `test` / `build` / `git diff --check`。

### 第 C 段部署与负向核验（2026-10-10 已执行，仅 mw-test）

- `npm run mw14:deploy` 退出码 0：部署 `mw-member`；新建集合 `attempts`、`active_attempts`；建立索引 `idx_attempts_member_state_submitted_id`（`memberId/state/submittedAt/_id`）。`enableOverrun=false`。
- `npm run mw14:verify` 负向核验全部通过（证据 `tmp/mw14/mw14-verify-evidence.json`，汇总 `tmp/mw14/verify.log` 为 `ok: true`）：未授权 `attempt.start` / `attempt.save` → `AUTH_REQUIRED`；伪造身份 → `FORBIDDEN / CLIENT_IDENTITY_IGNORED`；公开入口调用 `attempt.start` → `FORBIDDEN / ACTION_DENIED`；匿名客户端直写 `attempts` / `active_attempts` / `paper_answers` 被拒；`attempts` / `active_attempts` 与指定索引在建、未来集合（`orders` / `vip_*` / `paper_bests` / `score_*`）不在、种子十类计数 10。
- 执行缺陷与修复：`scripts/mw14-verify.mjs` 成功分支原先不显式退出，`@cloudbase/js-sdk` 的残留长连接句柄使进程在打印汇总后一直挂住（表现为命令持续无输出）。已改为 `process.exit(ok ? 0 : 1)`。本次证据与日志保留，不重复部署、不重复写入。

### 第 D 段用户手点与 leftover=0（2026-10-10 已闭合）

- 用户手点 1–8 自报全部通过（含第 4 步答题与答题卡）。1 题卷不渲染「上一题 / 下一题」属设计（条件渲染），另发 3 题免费卷后通过。
- leftover：用户复制 2 张本轮测试卷 + 1 个本轮 attempt 的 SHA-256（导入数 3）；`importedHashCount=3`，`matchedPaperCount=2`、`matchedAttemptCount=1`，`knownIdCount=10`；精确删除 10 条 `failed=0`；`npm run mw14:verify-leftovers` 真实退出码 0：`leftoverDocs=0`、`leftoverObjects=0`（confirmed）、`wroteDocs=true`、`cloudWriteClaimed=true`、`exactIdSweepOnly=true`、`seedPresent=true`、`forbiddenPresent=false`、`indexesPresent=true`、`reasons=[]`。
- 本地五项检查复跑均为 0。结果见 [results/mw14-result.md](results/mw14-result.md)。

## 第 D 段：用户手点步骤（1–8）与 leftover=0

前置：微信开发者工具打开本项目，环境为 mw-test。以下 1–8 必须由你在开发者工具里真实点击完成，执行者不得代点或冒充登录。

1. **游客先注册**：退出登录态 → 进「试卷」打开一份**免费测试卷**详情 → 点「开始」。预期：提示先注册并跳注册页，注册后回到详情。
2. **开启免费卷生成草稿**：在免费卷详情点「开始」。预期：进入答题页；刷新首页后出现该卷草稿摘要与「继续练习」。
3. **免费会员看 VIP 卷**：打开一份 **VIP 测试卷**详情。预期：显示 `VIP_REQUIRED`，无可用「开始」；不真实扣款。
4. **答题与答题卡**：做单选 / 多选 / 判断题，用「上一题 / 下一题」「答题卡」跳题。预期：已答 / 未答可区分；保存状态依次为「保存中 → 已保存」，只有服务端确认才显示「已保存」。
5. **重登 / 换设备恢复**：退出再进入（或换设备登同一账号）继续该卷。预期：只恢复服务端已确认答案。
6. **已有活动草稿再开新卷**：带第 2 步草稿再开另一份免费卷并点「开始」。预期：弹「继续原卷 / 放弃原卷」；未确认不丢原草稿；点「放弃原卷」走 `attempt.startReplacing`（`confirmed=true`）开新卷，旧稿变 `abandoned` 不计分。
7. **版本冲突 `DRAFT_CONFLICT`**：在两处同时改同一草稿并保存，制造旧 revision。预期：提示版本冲突并让你选「用服务器 / 用本页」，选择后才显式重发，不自动覆盖。
8. **断网与交卷**：断网点选项再恢复网络。预期：断网显示「尚未同步」而非「已保存」，恢复后按版本再保存；点「交卷」只提示 MW15 未接通，不发生 `attempt.submit`。

leftover=0 收口（完成上面手点后执行）：

1. 只在答题页对本轮**测试** attempt 点「记入本轮 leftover」（浏览 / 自动进页不记）。
2. 回首页点「复制本轮 leftover knownIds」，复制到 JSON。
3. 导入（只接受 SHA-256）：`$env:MW14_KNOWN_IDS_JSON='<复制的JSON>'; npm run mw14:import-known-ids`（或 `npm run mw14:import-known-ids -- '<JSON>'`）。空清单 / 非哈希会失败退出。
4. 解析到真实 `_id`：`npm run mw14:resolve-known-ids`（写 `configs/mw14-verify-state.json`）。
5. 精确删除本轮已解析 id：`npm run mw14:cleanup`。
6. 核验：`npm run mw14:verify-leftovers` 须 `leftoverDocs=0`、`wroteDocs=true`、`cloudWriteClaimed=true`、`exactIdSweepOnly=true`、种子十类仍在、未出现 `orders` / `vip_*`。

1–8 与 leftover=0 全部闭合后，MW14 方可从「进行中」改为「已完成」，并写 `results/mw14-result.md`。
