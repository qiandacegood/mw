# MW14 实际结果

日期：2026-10-10
任务：答题草稿与继续练习
状态：**已完成**（本地五项检查为 0；C 段部署与负向核验通过；用户手点 1–8 自报全部通过；本轮 2 卷 + 1 attempt 的 SHA-256 导入后精确解析 3=3，删除 10 条，leftover=0）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码只存在于被 Git 忽略的本地 `.env`。本文未写入、未提交这些值。未写入明文 `_id` / paperId。

未把 A01—A31、T01—T30 标为通过。尤其未标 A07 / A08 / T10 / T15。未改写 MW12 为已完成，未重开 MW13。未实现 `attempt.submit` / `result` / `analysis` / `history`。未创建 `paper_bests` / `score_events` / `score_metrics` / `orders` / `vip_*`。未开启超额，未创建生产环境。

## 1 交付与可见结果

| 项 | 结果 |
| --- | --- |
| A 段：`mw-member` 六个 attempt action | PASS（`attempt.start` / `startReplacing` / `get` / `questionPage` / `save` / `abandon` 已接通；`member.me` 返回真实草稿摘要） |
| B 段：试卷详情开始、答题页 / 答题卡 / 保存状态、首页继续练习 | PASS（用户手点 1–8） |
| 交卷 | 只提示 MW15 未接通，不调用 `attempt.submit` |
| C 段：集合与索引 | PASS（`attempts` / `active_attempts`；索引 `idx_attempts_member_state_submitted_id`） |
| C 段：负向核验 | PASS（见第 3 节） |
| 本地五项检查 | PASS（见第 2 节） |
| leftover=0 | PASS（见第 5 节） |

## 2 本地检查

| 检查 | 退出码 |
| --- | --- |
| `npm run check:prototypes` | 0 |
| `npm run typecheck` | 0 |
| `npm run test` | 0 |
| `npm run build` | 0 |
| `git diff --check` | 0 |

已覆盖机制：一账号一份 `inProgress`；`ACTIVE_ATTEMPT_EXISTS` 不自动丢弃；`startReplacing` 需 `confirmed=true`；`save` 同 `requestId` 重放、旧 revision `DRAFT_CONFLICT`；`submitted` / `abandoned` 拒改；`questionPage` 与未交卷 `get` 不含答案 / 解析 / `correctOptionIds` / `paper_answers`；`VIP_REQUIRED`；断网未确认不得显示已保存；leftover 不自动收 attempt / 卷。机制证据**不等于** A07 / A08 / T10 / T15 通过。

## 3 C 段部署与负向核验（仅 mw-test）

部署 `npm run mw14:deploy` 退出码 0：部署 `mw-member`；新建集合 `attempts`、`active_attempts`；建立索引 `idx_attempts_member_state_submitted_id`（`memberId/state/submittedAt/_id`）；`enableOverrun=false`。

负向核验 `npm run mw14:verify` 汇总 `ok: true`（证据 `tmp/mw14/mw14-verify-evidence.json`）：

| 项 | 结果 |
| --- | --- |
| 未授权 `attempt.start` / `attempt.save` | `AUTH_REQUIRED`（`NO_FROM_APPID`） |
| 伪造 `role` / `uid` | `FORBIDDEN` / `CLIENT_IDENTITY_IGNORED` |
| 公开入口 `mw-public` 调 `attempt.start` | `FORBIDDEN` / `ACTION_DENIED` |
| 匿名 Web SDK 直写 `attempts` / `active_attempts` / `paper_answers` | 拒绝 |
| 集合 / 索引 | 在（`indexesPresent=true`） |
| 未来集合 `orders` / `vip_*` / `paper_bests` / `score_*` | 未出现 |
| 种子十类计数 | 10 |
| `EnableOverrun` | false |

## 4 必须由用户点（执行者未代点）

后台新发 3 份虚构测试卷（2 免费 + 1 VIP），其后按需新发一份 3 题免费卷用于答题卡与上一题 / 下一题。全程在微信开发者工具手点，执行者未用 CLI / automator / 服务端口冒充 FROM 或 admin。

| 步骤 | 状态 |
| --- | --- |
| 1. 游客先注册 | PASS（用户自报） |
| 2. 开启免费卷生成草稿；首页出现草稿摘要与继续练习 | PASS（用户自报） |
| 3. 免费会员看 VIP 卷 `VIP_REQUIRED` | PASS（用户自报） |
| 4. 答题与答题卡：上一题 / 下一题 / 跳题；已答未答；保存中 → 已保存 | PASS（用户自报；1 题卷不渲染上一题 / 下一题属设计，另发 3 题卷后通过） |
| 5. 重登 / 换设备只恢复服务端已确认答案 | PASS（用户自报） |
| 6. 已有活动草稿 → 继续 / 放弃；放弃走 `startReplacing`，旧稿 `abandoned` | PASS（用户自报） |
| 7. `DRAFT_CONFLICT` 选服务端 / 本页后显式重发 | PASS（用户自报） |
| 8. 断网未同步提示；交卷只提示 MW15 未接通 | PASS（用户自报） |

## 5 leftover

用户点「复制本轮 leftover knownIds」，贴回 2 张本轮测试卷 + 1 个本轮 attempt 的 SHA-256（导入数 3）。导入 `importedHashCount=3`；解析 `matchedPaperCount=2`、`matchedAttemptCount=1`，导入数 = 匹配数；`knownIdCount=10`：papers 2、versions 2、chunks 2、answers 2、attempts 1、activeAttempts 1、objects 0。未扫整表猜删。精确删除 10 条，`failed=0`，`exactIdsOnly=true`。随后 `npm run mw14:verify-leftovers`（真实退出码 0）：

| 项 | 值 |
| --- | --- |
| `wroteDocs` | true |
| `cloudWriteClaimed` | true |
| `exactIdSweepOnly` | true |
| `leftoverDocs` | 0 |
| `leftoverObjects` | 0（`leftoverObjectsConfirmed=true`，由已知 object id 空集确认，不是写死 0） |
| `seedPresent` | true（种子十类在） |
| `forbiddenPresent` | false |
| `indexesPresent` | true |
| `EnableOverrun` | false |
| `reasons` / `exitCode` | `[]` / 0 |

本轮被“放弃”的旧 attempt 保留 `abandoned` 记录（设计如此，不算 leftover）。空 `knownIds` / `wroteDocs=false` 仍判 `WROTE_DOCS_FALSE`；未清理非本轮 MW11 / MW12 / MW13 残留。

## 6 本轮修复与已知环境限制

修复：

1. `scripts/mw13-assert.test.mjs` 的 `attempt.start` 拦截改为由 `mw14-assert` 正向核验（MW13 leftover 门禁不回退）。
2. `scripts/mw14-lib.mjs` 补 `leftoverVerifyDecision`；`mw14-deploy.mjs` 补 `join` 导入并改用 `createCollectionCommand` / `createIndexCommand`。
3. `scripts/mw14-verify.mjs` 成功分支显式退出（避免 `@cloudbase/js-sdk` 残留句柄使进程在打印汇总后挂住）。
4. `scripts/mw14-leftover-verify.mjs` 与 `mw14-leftover-verify-lib.mjs`：种子判定改用 `seedCategoryId(seedKey)` 与真实集合（`sessions` / `rate_limits` / `maintenance_windows` 并不存在）；索引判定与 `mw14:verify` 一致。
5. 新增 `scripts/mw14-assert.test.mjs`、`scripts/mw14-verify.mjs`；`package.json` 增加 `mw14:*` 命令并接入 `npm test`。

已知环境限制（本机，非代码缺陷）：

- 运行后台 Vite 开发服务（`npm run dev --workspace @mw/admin`，端口 4174）会占用 `packages/shared/dist`，使 `scripts/ensure-shared-js.mjs` 的删除失败，连带 `npm test` / `npm run build` 失败。跑本地检查前先停后台。
- 微信开发者工具会把真实 AppID 写入**已跟踪**的 `apps/miniprogram/project.config.json`，触发 MW05 密钥扫描。真实号只应留在被忽略的 `apps/miniprogram/project.private.config.json`，跟踪文件保持 `wx_placeholder_appid`。

## 7 建议状态

**已完成**。本地五项检查 0、C 段部署与负向核验通过、用户手点 1–8 通过、leftover=0 闭合。不标 A01—A31、T01—T30，尤其不标 A07 / A08 / T10 / T15。不改 MW12，不重开 MW13，不启动 MW15。发起人审核通过后提交推送收口。
