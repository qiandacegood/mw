# MW25 实际结果

日期：2026-10-19
任务：[后台运营统计与使用说明](../mw25-ops-stats.md)
状态：**已完成**（A/B/C 已接线；D 段 mw-test 部署与负向核验通过；E 段手点用户确认 1–8 全过；leftover=0 已核验。未标 A21 / A23 / A25 / A27。MW12 仍部分完成）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码、AppKey 只存在于被 Git 忽略的本地 `.env`；本文不写入、不提交这些值，也不写明文 `_id` / `memberId` / `session_key`。

未把 A01—A31、T01—T30 标为通过，尤其未标 **A21 / A23 / A25 / A27**，也不回标 A14 / A19 / A20 / A12。未改写 MW01—MW24 与 MW-UI01 的历史完成记录。未把 MW12 从部分完成改成已完成。本轮做真实口径的基础统计 + 逐步操作教程入口，不重写 `vip_accounts` / `vip_grants` / `orders` / `refunds` 账本，不重做导入 / 纠错 / 迁类 / 赠送实现。未开启超额。`VIRTUAL_PAY_ENV` 保持沙箱 `1`，未切现网 AppKey。未真实扣款、未真实退款、未做 iOS / Apple 现网。未启动 MW26—MW30。未自动提交或推送。用户要求后发布 mw-test 后台托管（`npm run admin:hosting`）。执行者未 automator / CLI / 浏览器冒充 super 或微信身份。E 段手点用户确认 1–8 全过；第 3 步用 content、第 4 步用 operations、第 8 步未写夹具；leftover=0 **已核验**。

## 1 五块实际状态

| 块 | 状态 | 说明 |
| --- | --- | --- |
| A 共享契约 | 已接线 | `@mw/shared` 统计口径：注册会员不含 deleted；有效已交卷才计入；重复练习计入次数；平均分按全部有效已交卷；有效 VIP = `now < expiresAt`；流水不当利润；金额分、时间 ISO。教程七步对应真实 action，`placeholder=false` |
| B 服务端 | 已接线 | `ops.stats` / `ops.exceptions` / `ops.tutorial`。operations / super 可读统计；content 调统计 `FORBIDDEN` / `CONTENT_STATS_DENIED`，不返回收款金额。教程只返回已有 action。异常摘要接到 `order.reconcile` / `order.list` / `refund.list` / `feedback.list` |
| C 前台 | 已接线 | `admin-ops` 改为「反馈与基础统计」：口径说明、统计数字、每卷次数/平均分、异常入口、逐步教程按钮打开现有页。反馈处理仍在本页 |
| D mw-test 部署与负向 | 见第 3 节 | 只部署 mw-test；负向 CLI 不手点；leftover 脚本已落地，空清单不得当 0 |
| E 用户手点与 leftover=0 | 已闭合 | 2026-10-19 用户确认手点 1–8 全过；第 3 步 content、第 4 步 operations、第 8 步未写夹具；leftover=0 已核验 |

## 2 本地检查

2026-10-19 执行。4174 当时未占用，未停 Vite。

| 检查 | 退出码 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 0 | admin / miniprogram / shared / api |
| `npm test` | 0 | 含 `mw25-assert`；workspaces **370** 项（admin 8 / miniprogram 40 / shared 157 / api 165） |
| `npm run build` | 0 | 小程序 31 入口；`checked 231 miniprogram files`；TDesign 1.17.0；`runtime.sha256` 前缀 `6aa0bc4050dc` |
| `git diff --check` | 0 | 仅 CRLF 工作副本提示，无尾随空格失败 |
| `npm run mw25:assert` | 0 | leftover 门禁：空清单 / `wroteDocs=false` 不得当 0 |

本地机制覆盖（不等于验收通过）：重复练习计入每卷次数且平均分按全部有效已交卷；流水字段是 `confirmedReceiptFen` 且 `turnoverIsNotProfit=true`；content 调 `ops.stats` / `ops.exceptions` 被拒且响应不含金额；content 可读不含订单金额的教程；operations 调 `refund.execute` / `correction.preview` 为 `SUPER_ROLE_REQUIRED`；异常入口指向已有 action；夹具快照写入载荷不含 `_id`。

## 3 D 段部署与负向核验（仅 mw-test）

`npm run mw25:deploy` 退出码 0。`runtime.sha256` 前缀 `6aa0bc4050dc`。新建集合 `ops_stats_snapshots`（日常统计默认不落库；夹具快照确定性 `_id` + 版本，载荷不含 `_id`）。未提交、未推送。未切现网 AppKey。用户要求后已发布 mw-test 后台托管：`npm run admin:hosting` 退出码 0，公开源 https://mw.qianjiaoguan.com/ ，资源 `assets/index-zdeRIp7i.js`。未冒充登录。

| 项 | 结果 |
| --- | --- |
| 部署入口 | `mw-admin` |
| 新集合 | `ops_stats_snapshots`（新建成功，`existed=false`） |
| 新索引 | 无 |
| `EnableOverrun` | false |
| 其它环境计数 | 2（未触碰） |
| 沙箱环境 | 部署时只合并沙箱键；未写入现网 `VIRTUAL_PAY_APP_KEY_LIVE` |

`npm run mw25:verify` 退出码 0，`ok:true`：

| 项 | 结果 |
| --- | --- |
| 未登录 `ops.stats` | `AUTH_REQUIRED` |
| 未登录 `ops.tutorial` | `AUTH_REQUIRED` |
| 未登录 `refund.execute` | `AUTH_REQUIRED` |
| 未登录 `correction.preview` | `AUTH_REQUIRED` |
| 未登录 `order.list` | `AUTH_REQUIRED` |
| 种子十类 | 10 |
| 沙箱 `VIRTUAL_PAY_ENV` | `1`；无 `VIRTUAL_PAY_APP_KEY_LIVE` |
| `EnableOverrun` | false |
| `leftoverClaimedZero` | **false** |

D 段当时 leftover 门禁为空清单 `WROTE_DOCS_FALSE`，不得当 leftover=0。E 段收口见第 4 节。content 看不到收款明细、operations 不能退款 / 改分由本地角色单测覆盖；执行者未冒充 content / operations / super 登录后台。

## 4 E 段用户手点（已闭合）

执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。可做授权范围内的部署、只读核验、签名 `jobs.tick`、本地测试。

2026-10-19 用户确认下列 1–8 **全过**。第 3 步用 content；第 4 步用 operations；第 8 步未写本轮统计夹具快照或教程夹具。未标 A21 / A23 / A25 / A27。MW12 仍部分完成。

1. 统计数字有口径说明，且「重复练习计入次数」写在界面上：**PASS**。
2. 流水未当利润：**PASS**。
3. content 看不到订单金额：**PASS**（content）。
4. operations 能看统计但不能退款 / 改分：**PASS**（operations）。
5. 教程每步能打开真实功能而不是假按钮：**PASS**。
6. 导入 / 上架 / 纠错 / 迁类 / 赠送 / 订单核对 / 退款入口可达（用测试数据，不真付）：**PASS**。
7. 异常开通 / 对账 / 反馈入口可达：**PASS**。
8. 收口不删审计 / 订单 / 退款 / 非本轮会员：**PASS**（未写夹具）。

第 8 步未写夹具，故不跑 `mw25:import-known-ids` / `resolve` / `cleanup`（空哈希会被拒 `EMPTY_HASHES` / `EMPTY_IMPORT` / `KNOWN_IDS_MISSING_AFTER_WRITE`）。空清单已写入 `configs/mw25-verify-state.json`（Git 忽略）：`wroteDocs=true`，`resolved=true`，`snapshots` / `tutorialFixtures` 均为空。然后：

```text
npm run mw25:independent-check
npm run mw25:verify-leftovers
```

`mw25:independent-check` `remain=0`。`mw25:verify-leftovers`：`ok:true`，`reason=LEFTOVER_CLEARED`，`leftoverDocs=0`，`independentRemain=0`，`seedPresent=10`。未删种子十类 / jobs / 审计 / 幂等 / `ranking_*` / `app_config` / 会员账号 / gift / order / refund。未把明文 `_id` 写入本文。

用户要求后已发布 mw-test 后台托管 https://mw.qianjiaoguan.com/（资源 `index-zdeRIp7i.js`）。执行者未代登。

## 5 已知限制

- E 段手点 1–8 与 leftover=0 已闭合；整项标完成。
- MW12 仍部分完成。教程走现有 `import.*`，不把导入标验收通过。
- A21 / A23 / A25 / A27 不标通过。A25 的角色边界本轮有机制证据与手点，但正式验收留给后续。
- 统计扫描上限 200 条，属测试环境只读聚合，不是 MW26 容量专项。
- 日常 `ops.stats` 不落库。本轮未写夹具快照。
- 后台托管已按用户要求发布到 https://mw.qianjiaoguan.com/（仅 mw-test）。

## 6 下一项可用

- `ops.stats` / `ops.exceptions` / `ops.tutorial` 已在 mw-test `mw-admin`。
- leftover=0 已核验。不启动 MW26—MW30。
