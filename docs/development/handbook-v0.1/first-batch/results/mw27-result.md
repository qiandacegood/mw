# MW27 实际结果

日期：2026-10-19
任务：[备份恢复与发布回退演练](../mw27-backup-restore.md)
状态：**已完成**（A/B/C/D 已接线并核验；E 段用户手点 1–8 全过，leftover=0 已核验。未标 A27 / T07 / T28。MW04 / MW12 仍部分完成）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码、AppKey 只存在于被 Git 忽略的本地 `.env`；本文不写入、不提交这些值，也不写明文 `_id` / `memberId` / `session_key`。

未把 A01—A31、T01—T30 标为通过，尤其未标 **A27 / T07 / T28**，也不回标 A06 / A14 / A19 / A20 / A21。未改写 MW01—MW26 与 MW-UI01 的历史完成记录。未把 MW04 / MW12 从部分完成改成已完成。本轮只积累机制与演练证据，不把 A27 / T07 / T28 标正式通过。不重写 `vip_accounts` / `vip_grants` / `orders` / `refunds` 账本，不重做导入 / 纠错 / 迁类 / 赠送 / 注销。未开启超额。`VIRTUAL_PAY_ENV` 保持沙箱 `1`，未切现网 AppKey。未真实扣款、未真实退款、未做 iOS / Apple 现网。未启动 MW28—MW30。未创建 mw-prod。未触碰其它 CloudBase 环境。未自动提交、推送或发布。执行者未 automator / CLI / 浏览器冒充 super 或微信身份。E 段手点用户确认 1–8 全过；leftover=0 **已核验**。

## 1 五块实际状态

| 块 | 状态 | 说明 |
| --- | --- | --- |
| A 清点契约 | 已接线 | 集合 / 指定索引 / ACL / 存储前缀 / `runtime.sha256` / `app_config` 版本 / 维护开关；回档≠文件/代码/渠道 |
| B 隔离恢复 | 已核验 | 官方回档到新集合 **BLOCKED**（个人版只能覆盖现库，未执行覆盖）。夹具模拟 + `mw27_rst_*` 闭包 PASS |
| C 查单/重放/回退 | 已核验 | 原业务号重放不延长；伪造通知 `vipGranted=false`；未决仍在；jobs 中断/旧 token 本地机制 PASS。super `job.resume` / 榜单重建已由 E 手点 |
| D mw-test | 见第 3 节 | 部署 `mw-admin` / `mw-public` / `mw-jobs` / `mw-pay-hook`；`EnableOverrun=false` |
| E 用户手点与 leftover=0 | 已闭合 | 用户确认 1–8 全过；`leftoverDocs=0` / `remain=0` / 种子十类 10；`mw27_rst_*` 已空 |

## 2 本地检查

2026-10-19 执行。4174 当时未占用，未停 Vite。

| 检查 | 退出码 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 0 | admin / miniprogram / shared / api |
| 相关单测 | 0 | `mw27-restore` 13 项；`jobs` / `jobs-invoke` 5 项 |
| `npm run mw27:assert` | 0 | leftover 门禁：空清单 / `wroteDocs=false` / 隔离集合残留不得当 0 |

未跑全量 `npm test` / `npm run build`（本轮相关检查已过）。未自动提交、推送或发布。

## 3 D 段部署与负向核验（仅 mw-test）

`npm run mw27:deploy` 退出码 0。`runtime.sha256` 前缀 `7a630e78ac95`（部署前清点为 `1666aa2b8984`，本轮保留当前包哈希，未滚到更旧损坏包）。未提交、未推送。未切现网 AppKey。未冒充登录。

| 项 | 结果 |
| --- | --- |
| 部署入口 | `mw-admin` / `mw-public` / `mw-jobs` / `mw-pay-hook` |
| `EnableOverrun` | false |
| 其它环境计数 | 2（未触碰） |
| 沙箱环境 | `VIRTUAL_PAY_ENV=1`；无 `VIRTUAL_PAY_APP_KEY_LIVE` |
| 运行时 / 地域 | Nodejs20.19；ap-shanghai；个人版 |
| 隔离集合 | `mw27_rst_orders` / `payment_receipts` / `callback_events` / `refunds` / `vip_grants` / `jobs`，ACL `ADMINONLY` |

`npm run mw27:verify` `ok:true`，`leftoverClaimedZero=false`。负向：

| 覆盖 | 结果 | 说明 |
| --- | --- | --- |
| 未登录查单 | PASS | `order.get=AUTH_REQUIRED` |
| 未登录 `job.resume` | PASS | `AUTH_REQUIRED` |
| 未登录 `ranking.rebuild` | PASS | `AUTH_REQUIRED` |
| 伪造 FROM | PASS | `CLIENT_IDENTITY_IGNORED` |
| 伪造支付通知 | PASS | `vipGranted=false` |
| 未签名 jobs | PASS | `CLIENT_INVOKE_DENIED` |
| 种子十类 | PASS | 10 |
| mw-test 隔离 | PASS | 超额关、沙箱、无现网 AppKey、其它环境 2 |

模拟成功不得写成平台验收通过。上表是 mw-test 负向/机制核验，不是 A/T 正式验收。

## 4 恢复演练数字

目标：官方回档到新集合；RPO≤24h / RTO≤4h 以实测确认。读 P95 不是本轮目标。

| 项 | 实际 | 结果 |
| --- | --- | --- |
| 官方回档到新集合 | 个人版帮助/能力只能覆盖现库。未调用覆盖 API，未触碰另外两环境 | **BLOCKED** `RESTORE_WOULD_OVERWRITE` |
| 夹具模拟隔离目标 | live 夹具 13 + `mw27_rst_*` 9；`$set` 不含 `_id`；`fixtureRound=MW27` | PASS |
| 集合闭包 | 隔离 6 集合在；指定索引无缺失；种子十类 10；`paper_answers` 仍 ADMINONLY | PASS |
| 现有业务集合 ACL | `orders` / `vip_grants` / `jobs` / `categories` / `members` 仍为 PRIVATE，本轮未改 | 记录局限，未加套餐 |
| 存储前缀摘要 | `tcb storage list` 不可用 | **BLOCKED** `LIST_UNAVAILABLE`。未导出秘密 |
| 维护演练 | 关闭 contentWrites / attemptStart / attemptSubmit / purchaseCreate / entitlementApply；支付通知仍可接收（伪造通知 `vipGranted=false`）；结束后已恢复开关 | PASS |
| 维护原因 | `MW27 restore drill; payment notify kept open` | 已写入结果 |
| 夹具 RTO | 133240 ms（约 2.2 分钟）从演练开始到闭包核对完成 | PASS（相对 4h） |
| 夹具 RPO | 143495 ms（约 2.4 分钟）从清点完成到演练开始 | 夹具窗口记录；官方 RPO **BLOCKED** |
| 官方 RPO/RTO | 个人版不能回档到新集合，未加资源、未开超额 | **BLOCKED** |
| 查单 / 重放 | 未登录查单 `AUTH_REQUIRED`；同一 `orderId`/`grantId` 重放 `replayed=true`、时长不增加；伪造通知不开通 | PASS（机制） |
| 未决 | 未决退款 1、未决回调 1 仍在 | PASS |
| T07 机制 | 中断按 cursor 接续；旧 `fencingToken` 拒写；`job.resume` 只恢复不标成功。未重写 jobs 平台 | PASS（本地/夹具）。已登录 super 留给 E |
| 代码回退 | 当前包哈希前缀 `7a630e78ac95`；手册 R1—R4；未真滚坏包 | PASS（手册）。E 手点确认 |
| leftover | `cleanup` 22/`failed=0`；`independent-check` `remain=0`；`verify-leftovers` `ok=true` / `LEFTOVER_CLEARED` / `leftoverDocs=0` / `seedPresent=10` | **leftover=0**。空清单路径未使用 |

`mw27:resolve-known-ids` imported=22，matchedTotal=22。E 已跑 `mw27:cleanup`。独立路径 `remain=0`。

## 5 E 段用户手点（已闭合）

2026-10-19 用户确认 1–8 **全过**。未标 A27 / T07 / T28。

1. 控制台确认未对生产/其它环境回档、未覆盖现库：**PASS**。官方回档到新集合仍 BLOCKED，本轮用夹具 + `mw27_rst_*`。
2. 同一订单查单无第二笔 grant：**PASS**。后台「同订单核对」两次 `ok=true`。按会员「查询订单」被身份门禁 `FORBIDDEN` / `CLIENT_IDENTITY_IGNORED`（请求带 `memberId`），记 **BLOCKED**，不作为第 2 步失败。
3. 重放旧付款通知不再增加时长：**PASS**。
4. 未决退款 / 未决回调仍在：**PASS**。
5. super `job.resume` 只恢复失败任务；旧 token 不能写：**PASS**。
6. 重建公开榜完整快照、无半发布、无 OPENID：**PASS**。后台 `ranking.rebuild` `ok=true`，`publishedAt=2026-10-19 16:17:50`，名次行 0。小程序同一时间完整空快照「本期暂无正分记录」；本人未参与公开排行，无 OPENID。空榜不是半发布。
7. 回退手册可执行、本轮不真滚坏包：**PASS**。
8. leftover=0：**PASS**。`cleanup` 22/`ok`；`independent-check` `remain=0` / `isolatedRemain=0`；`verify-leftovers` `LEFTOVER_CLEARED` / `leftoverDocs=0` / `seedPresent=10`。未删审计/订单历史/`ranking_*`/种子十类。

## 6 代码回退手册（本轮不真滚）

| 编号 | 规则 |
| --- | --- |
| R1 | 回滚函数包不回滚数据 |
| R2 | schema 先扩展再收缩 |
| R3 | 旧代码读不了新 schema 时不得回退 |
| R4 | 本轮不把函数滚到更旧的损坏包 |

当前保留包哈希前缀 `7a630e78ac95`。数据库回档不等于云存储、函数代码、部署配置、支付渠道状态一起恢复。秘密不进普通资料包。

## 7 已知限制

- 官方「回档到新集合」BLOCKED。个人版只能覆盖现库，未执行覆盖，未加套餐。
- 存储对象摘要 LIST_UNAVAILABLE。
- 部分现有业务集合 ACL 仍为 PRIVATE；本轮只把隔离回档集合设为 ADMINONLY，未改历史集合。
- A27 / T07 / T28 不标通过。
- MW04 P08/P10/P11 仍 PARTIAL。MW12 仍部分完成。
- leftover=0 已核验。

## 8 下一项可用

- MW27 已完成。不自动启动 MW28—MW30。
