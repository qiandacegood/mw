# MW26 实际结果

日期：2026-10-19
任务：[权限安全与容量专项验证](../mw26-security-capacity.md)
状态：**已完成**（A/B/C/D 已接线并核验；E 段用户手点 1–7 全过，leftover=0 已核验。未标 A06 / A08 / A25 / A27 / A31 / T09 / T15 / T20 / T27 / T30。MW04 / MW12 仍部分完成）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码、AppKey 只存在于被 Git 忽略的本地 `.env`；本文不写入、不提交这些值，也不写明文 `_id` / `memberId` / `session_key`。

未把 A01—A31、T01—T30 标为通过，尤其未标 **A06 / A08 / A25 / A27 / A31 / T09 / T15 / T20 / T27 / T30**，也不回标 A14 / A19 / A20 / A21。未改写 MW01—MW25 与 MW-UI01 的历史完成记录。未把 MW04 / MW12 从部分完成改成已完成。本轮是安全矩阵 + 容量/并发报告 + 针对缺陷的必要修复与复验，不重写 `vip_accounts` / `vip_grants` / `orders` / `refunds` 账本，不重做导入 / 纠错 / 迁类 / 赠送 / 注销。未开启超额。`VIRTUAL_PAY_ENV` 保持沙箱 `1`，未切现网 AppKey。未真实扣款、未真实退款、未做 iOS / Apple 现网。未启动 MW27—MW30。未自动提交、推送或发布。执行者未 automator / CLI / 浏览器冒充 super 或微信身份。E 段手点用户确认 1–7 全过；leftover=0 **已核验**。

## 1 五块实际状态

| 块 | 状态 | 说明 |
| --- | --- | --- |
| A 契约 | 已接线 | 安全矩阵 S01—S17；夹具 `fixtureRound=MW26` + 确定性 SHA-256；读 P95 / 交卷 P95 / 全量名次口径 |
| B 负向 | 已核验 | 云端负向 + E 手点。S03 解析图 NOT_RUN（无 `analysis/`）。S06/S07 已登录由用户确认 PASS |
| C 容量 | 已测量 | 夹具降级 200 会员 / 20 卷 / 2000 答题；50 并发读；1 万全量名次 101ms |
| D mw-test | 见第 3 节 | 部署 `mw-admin` / `mw-public` / `mw-jobs`；`EnableOverrun=false` |
| E 用户手点与 leftover=0 | 已闭合 | 用户确认 1–7 全过；`leftoverDocs=0` / `remain=0` / 种子十类 10；收口后再重建公开榜 |

## 2 本地检查

2026-10-19 执行。4174 当时未占用，未停 Vite。leftover/核验口径整改后补跑：`typecheck` 0；`mw26-capacity` + `ops-stats` 15 项通过（夹具测试 9）；`mw26:assert` 0。未重跑 1 万写入。E 已跑 `mw26:cleanup`。

| 检查 | 退出码 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 0 | admin / miniprogram / shared / api |
| `npm test` | 0 | 含 `mw26-assert`；workspaces **379** 项（admin 8 / miniprogram 40 / shared 165 / api 166） |
| `npm run build` | 0 | 小程序 31 入口；`checked 231 miniprogram files`；TDesign 1.17.0；`runtime.sha256` 前缀 `1666aa2b8984` |
| `git diff --check` | 0 | 仅 CRLF 工作副本提示，无尾随空格失败 |
| `npm run mw26:assert` | 0 | leftover 门禁：空清单 / `wroteDocs=false` 不得当 0 |
| `npm run mw26:ranking-cost` | 0 | 1 万参与者全量名次 101ms，`lastRank=9899`，无 OPENID |

本轮代码修复（只复验缺陷本身，未反复全量压测）：

1. 榜单扫描：`RANKING_BUILD_SCAN_LIMIT` 从 5000 提到 80000，云端按 `_id` 游标分页；`set()` 载荷 `omitDocId`。
2. `ops.stats`：200 从「假全集」改为分页 page，单次预算 2000，`scanTruncated=true` 时不得静默少计。不是新大盘。admin-ops **数字旁**醒目显示 `scanTruncated`（true 时标明「未扫全，数字不是全集」），禁止只藏在 JSON。
3. leftover 收口：`mw26:seed` 写入 `seededAt` / `weekKeyShanghai` / `monthKeyShanghai`；`mw26:cleanup` 用状态键再生 `score_metrics` `_id`，禁止 `new Date()`。E 已 cleanup。
4. 集合 ACL：E 发现 `paper_answers` / `attempts` / `score_metrics` / `paper_bests` 为 PRIVATE（客户端可 add/remove）。已改为 `ADMINONLY`，用户复验 get/add 均为 `-502003`。

## 3 D 段部署与负向核验（仅 mw-test）

`npm run mw26:deploy` 退出码 0。`runtime.sha256` 前缀 `1666aa2b8984`。未新建集合。未提交、未推送。未切现网 AppKey。未冒充登录。

| 项 | 结果 |
| --- | --- |
| 部署入口 | `mw-admin` / `mw-public` / `mw-jobs` |
| `EnableOverrun` | false |
| 其它环境计数 | 2（未触碰） |
| 沙箱环境 | `VIRTUAL_PAY_ENV=1`；无 `VIRTUAL_PAY_APP_KEY_LIVE` |
| 运行时 / 地域 | Nodejs20.19；ap-shanghai；个人版 |

`npm run mw26:verify` `ok:true`，`leftoverClaimedZero=false`。安全矩阵：

| 编号 | 结果 | 说明 |
| --- | --- | --- |
| S01 直读 `paper_answers` | PASS | E 复验：`wx.cloud.Cloud` 对 `paper_answers` get `-502003 Permission denied`。先前 PRIVATE 下 `get:ok n=0` 不作通过 |
| S02 直改成绩 | PASS | E 复验：`paper_answers` / `attempts` / `score_metrics` 的 get/add 均为 `-502003 Permission denied`，无 `add:ok`。先前 PRIVATE 探针 3 条已删；四集合现为 `ADMINONLY` |
| S03 直读解析图 | NOT_RUN | 控制台 `mw-test/media` 仅有 `import/`，无 `analysis/` 目录与解析对象。无解析图 URL，不得 PASS。集合直连已按 ADMINONLY 复验通过 |
| S04 未知入口 | PASS | E 控制台测 `mw-public` + `refund.execute`：`FORBIDDEN` / `ACTION_DENIED`。若控制台提示「历史测试结果」须再点一次「运行测试」确认是本次 |
| S05 伪造 FROM | PASS | `CLIENT_IDENTITY_IGNORED` |
| S06 content 无订单明细 | PASS | E：用户确认 content 查订单被拒、看不到金额。未登录负向不得单独写成产品 PASS |
| S07 operations 不能退款/改分 | PASS | E：用户确认 operations 不能退款/改分。未登录负向不得单独写成产品 PASS |
| S08 上传无票 / 重放 | PASS | CLI 无票 `TICKET_REQUIRED`。E 题库上传后证据 `mw-upload.replay` `ok=false` / `TICKET_REPLAY`（prompt、analysis 各一次）。保存题目后状态行会被覆盖，以证据 JSON 为准 |
| S09 上传超限 | PASS | `PAYLOAD_TOO_LARGE` |
| S10 CSV 注入 | PASS | 未登录 `import.validate=AUTH_REQUIRED` |
| S11 昵称注入 | PASS | 未登录 `AUTH_REQUIRED` |
| S12 查询构造 | PASS | 客户端 where 注入拒绝 |
| S13 伪造支付通知 | PASS | E 控制台测 `mw-pay-hook` 伪造 notify：`ok=false`，`vipGranted=false`，`NOTIFY_TOKEN_MISSING`。未开通 |
| S14 jobs token | PASS | `CLIENT_INVOKE_DENIED`；token 仅 `mw-jobs` |
| S15 idempotency | PASS | 未登录 `ranking.rebuild=AUTH_REQUIRED` |
| S16 mw-test 隔离 | PASS | 超额关、沙箱、无现网 AppKey、其它环境 2 |
| S17 日志脱敏 | PASS | 公开榜响应无 OPENID / AppKey；审计 sanitizer 单测覆盖 |

模拟成功不得写成平台验收通过。上表是 mw-test 负向/机制核验，不是 A/T 正式验收。

## 4 容量数字

目标：1 万会员 / 1000 卷 / 10 万答题 / 50 并发。读 P95 1 秒、交卷 P95 2 秒、榜单刷新 60 秒。

| 项 | 实际 | 结果 |
| --- | --- | --- |
| 夹具规模 | 会员 200 / 卷 20 / 答题 2000 / 指标 600 / 身份 200 / 试卷版本 20 | **BLOCKED** `SCALE_DEGRADED`。原因：无本地 CloudBase secret，只能走 tcb nosql；写满本档 553s。未开超额、未加套餐。 |
| 写入方式 | 单集合 upsert，`$set` 不含 `_id`，`fixtureRound=MW26` | PASS |
| 读 50 并发（tcb `fn invoke`） | ping P95 15109ms；home 16299ms；tree 10271ms；ranking.list 10949ms | **FAIL** 相对 1 秒目标。测量含 CLI 进程开销与本地排队，未加函数内存/超时来冲 P95 |
| 冷启动（各接口第一次） | ping 4340 / home 3788 / tree 2404 / ranking 2860 ms | 记录；热样本仍被 50 路 CLI 放大 |
| 交卷 50 路微信 | — | **NOT_RUN** 执行者不得冒充微信 |
| 交卷未登录 50/20 并发 | 云端 20 路全 `AUTH_REQUIRED`，P95 9950ms（含 CLI）；本地 50 路 AUTH_REQUIRED 且总耗时 < 2s | 机制 PASS；云端真人交卷 P95 **NOT_RUN** |
| 支付外部等待 | — | **NOT_RUN** 不真实扣款 |
| 全量名次（本地 1 万） | 101ms；participantCount=10000；displayCount=101；lastRank=9899；truncated=false；无 OPENID | 相对 60 秒目标 **PASS**（算法/内存路径）。云端 super `ranking.rebuild` 已由 E 手点 |
| 数据体积 | 夹具曾 3240 文档；收口后独立计数 0；种子十类仍 10 | 已清 |
| leftover | `cleanup` 3240/`failed=0`；`independent-check` `remain=0`；`verify-leftovers` `ok=true` / `LEFTOVER_CLEARED` / `leftoverDocs=0` / `seedPresent=10` | **leftover=0**。空清单路径未使用 |

`mw26:resolve-known-ids` 当时 imported=3240，matchedTotal=3240。收口后独立路径 `remain=0`。

## 5 E 段用户手点（已闭合）

2026-10-19 用户确认 1–7 **全过**。第 2 步 content、第 3 步 operations、收口后 super 再重建快照。未标 A06 / A08 / A25 / A27 / A31 / T09 / T15 / T20 / T27 / T30。

1. 未登录不能直读答案集合：**PASS**（ADMINONLY 复验 `-502003`）。解析图 **NOT_RUN**（无 `analysis/` 目录）。
2. content 看不到订单明细：**PASS**（用户确认）。
3. operations 不能退款/改分：**PASS**（用户确认）。
4. 伪造支付通知/未知入口被拒：**PASS**（`vipGranted=false` / `ACTION_DENIED`）。
5. 上传票据不能重放：**PASS**（`TICKET_REPLAY`）。
6. 压测后公开榜不半发布且无 OPENID：**PASS**（总分 200 名次；小程序昵称无 OPENID）。收口后用户确认已再重建。
7. 收口只删本轮夹具：**PASS**。`cleanup` 3240/`failed=0`；`remain=0`；`LEFTOVER_CLEARED`；种子十类 10。未删审计/订单/退款/VIP/非本轮会员。

## 6 已知限制

- 容量目标 1 万/1000/10 万未达到，已记 BLOCKED，未开超额。
- 读 P95 用 tcb CLI 50 路未达到 1 秒；未加资源掩盖。
- 云端真人 50 路交卷 NOT_RUN。支付外部等待 NOT_RUN。解析图 NOT_RUN。
- A06 / A08 / A25 / A27 / A31 / T09 / T15 / T20 / T27 / T30 不标通过。
- MW04 P08/P10/P11 仍 PARTIAL。MW12 仍部分完成。

## 7 下一项可用

- MW26 已完成。不自动启动 MW27—MW30。
