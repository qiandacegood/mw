# MW22 实际结果

日期：2026-10-18
任务：[退款与账务对账](../mw22-refund.md)
状态：**已完成**（A/B/C 已接线；D 段 mw-test 部署与负向核验通过；E 段手点 1–12 用户确认全过；第 13 步 leftover=0 已核验。未标 A19 / A20 / A27 / T23 / T24 / T26）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码、AppKey 只存在于被 Git 忽略的本地 `.env`；本文不写入、不提交这些值，也不写明文 `_id` / `memberId` / `session_key`。

未把 A01—A31、T01—T30 标为通过，尤其未标 **A19 / A20 / A27 / T23 / T24 / T26**，也不回标 A14 / A15 / A16 / A17 / T20 / T21 / T22。未改写 MW01—MW21 与 MW-UI01 的历史完成记录。MW21 未闭合的已付履约（重复通知只发一次、两笔已付并发续期、已付未开通同单补偿、购买不加分）留 MW29，本轮不回标、不借退款任务补做真付。未开启超额。`VIRTUAL_PAY_ENV` 保持沙箱 `1`，未切现网 AppKey。未真实扣款、未真实退款、未做 iOS / Apple 现网（A20 / T26 现网留 MW29）。未启动 MW23—MW30。未自动提交、推送或发布。执行者未 automator / CLI / 浏览器冒充 super 或微信身份。

## 1 五块实际状态

| 块 | 状态 | 说明 |
| --- | --- | --- |
| 退款状态机与按来源撤销 | 已接线 | `@mw/shared`：整笔/部分、与发放乱序、最终成功才撤 `sourceType=order` 未用时长、退 A 不扣 B、已用完不追扣、日账差异项；账户摘要派生，不直接改 `expiresAt` |
| 服务端售后 | 已接线 | `refund.request` / `review` / `execute` / `recordChannelResult`；通知/查单最终成功才撤；Apple 拒绝商户 execute；`order.reconcile` 只列差异不改金额 |
| 后台与小程序 | 已接线 | 小程序订单售后（商户申请 vs Apple 指引）；后台「退款审核与执行」+ 日账差异列表 |
| mw-test 部署与负向 | 见第 3 节 | 只部署 mw-test；负向 CLI 不手点 |
| 用户手点与 leftover=0 | 已闭合 | 2026-10-18 用户确认手点 1–12 全过；leftover=0 已核验 |

## 2 本地检查

2026-10-18 执行。跑前占用 4174 的 Vite（pid 11428）已先停。

| 检查 | 退出码 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 0 | admin / miniprogram / shared / api |
| `npm test` | 0 | 含 `mw22-assert`；workspaces **336** 项（admin 8 / miniprogram 38 / shared 143 / api 147） |
| `npm run build` | 0 | 小程序 27 入口；`checked 215 miniprogram files`；TDesign 1.17.0；`runtime.sha256` 前缀 `a045fde49636` |
| `git diff --check` | 0 | 仅 CRLF 工作副本提示，无尾随空格失败 |
| `npm run mw22:assert` | 0 | leftover 门禁：空清单 / `wroteDocs=false` 不得当 0 |

本地机制覆盖（不等于验收通过）：content 不能 review/execute；operations 只能 review 不能 execute；Apple / iOS 无商户 execute；测试夹具非正式售价、不伪造渠道成功骗发放；退 A 余 10 天留 B 30 天；A 已用完再退 `revokedSeconds=0` 且不扣 B；重复渠道最终成功幂等 `replayed=true` 不二次扣；已退款订单晚到支付回调 `SOURCE_CONFLICT_REFUND_FIRST` 不发放；部分退款 `needsReview` 不自动削天数；未知结果重复 execute 不新建退款单；无事先申请的渠道通知不新建退款单（`notify-without-prior-request`）；`order.reconcile` `amountFenUnchanged=true`。夹具入参用 `targetMemberId`，不传客户端 `memberId`。订单 leftover 仅主动记入。

## 3 D 段部署与负向核验（仅 mw-test）

`npm run mw22:deploy` 退出码 0。`runtime.sha256` 前缀 `a045fde49636`。

| 项 | 结果 |
| --- | --- |
| 部署入口 | `mw-admin` / `mw-member` / `mw-pay-hook` |
| 集合 | `refunds`、`reconcile_diffs`（本次新建，`existed=false`，创建码 0） |
| 索引 | `idx_refunds_order_updated`、`idx_reconcile_diffs_status_updated`（`listed=true`） |
| `EnableOverrun` | false |
| 其它环境计数 | 2（未触碰） |
| 沙箱环境 | 部署时只合并沙箱键；未写入现网 `VIRTUAL_PAY_APP_KEY_LIVE` |

`npm run mw22:verify` 退出码 0，`ok:true`：

| 项 | 结果 |
| --- | --- |
| 未登录 `refund.execute` | `AUTH_REQUIRED` |
| 未登录 `refund.request` | `AUTH_REQUIRED` |
| 本轮集合 | `refunds` / `reconcile_diffs` 文档计数均为 0（部署当时，尚未手点） |
| 种子十类 | 10 |
| 沙箱 `VIRTUAL_PAY_ENV` | `1`；无 `VIRTUAL_PAY_APP_KEY_LIVE` |
| `EnableOverrun` | false |

无真实已付订单：E 段用后台 **super** 的 `refund.fixturePrepare` 构造 order 来源账本与退款状态机（测试价、非渠道成功骗发放）。T24「退 A 留 B」在账本上验证，不要求真机付款。不真实退款；渠道最终结果由 super 录入沙箱 `refund.recordChannelResult`，不调现网退款接口。

## 4 E 段用户手点（已闭合）

执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。可做授权范围内的部署、只读核验、签名 `jobs.tick`、本地测试。

2026-10-18 用户确认下列 1–12 **全过**。无真实已付订单时，用本轮测试夹具（后台 super「构造测试夹具」）验证账本与状态机，不得伪造渠道成功骗发放，不得写正式售价。现网真退款 / Apple 现网仍留 MW29，不把 A19 / A20 / A27 / T23 / T24 / T26 标通过。

1. content 不能审核 / 执行退款：**PASS**。
2. operations 只能 review，不能 execute：**PASS**。
3. super 整笔退成功后只撤该 `order` 未用时长：**PASS**。
4. 退 A 余 10 天 / B 余 30 天，退 A 后仍留 B 30 天：**PASS**。
5. A 已用完再退不扣 B：**PASS**。
6. 重复退款通知不二次扣：**PASS**。
7. 先退款后发放不再开通：**PASS**。
8. 部分退款转人工，不自动削天数：**PASS**。
9. Apple 订单：小程序无商户退款按钮，只给 App Store 指引；后台 execute 对 iOS 拒绝：**PASS**。
10. 未知结果不新建退款单：**PASS**。
11. 日账差异可查看，且 `order.reconcile` 不改金额：**PASS**。
12. 成长分 / 等级 / 勋章不因退款清空：**PASS**。
13. **收口**：浏览/进页不入册。小程序订单页对「本轮测试订单」主动点「记入本轮 leftover」，复制按钮只含主动记入的哈希。只入册本轮退款单 / 本轮测试订单与回执 / 本轮为退款准备的 order 来源账本与测试卷题答题。不要种子十类、不要 `jobs` / 审计 / 幂等、不要共享 `ranking_*` / `app_config`、不要历史成绩、不要会员账号、不要非本轮 gift 账本、不要 MW21 非本轮套餐。后台「复制本轮退款 leftover」；小程序「复制本轮 leftover（仅主动记入）」。然后：

```text
npm run mw22:import-known-ids -- "<json>"
npm run mw22:resolve-known-ids
npm run mw22:cleanup
npm run mw22:independent-check
npm run mw22:verify-leftovers
```

2026-10-18 用户提交两段 leftover 哈希（小程序 6 张订单、后台同一组 6 张订单 + 1 张退款单；会员账号未入册）。合并导入 `knownIdCount=7`，反查 `imported=7` / `matchedCount=7`，展开后精确删除 21 条（不含 `sourceIds` 与永不删除集合）。`mw22:independent-check` `remain=0`。`mw22:verify-leftovers`：`ok:true`，`reason=LEFTOVER_CLEARED`，`leftoverDocs=0`，`independentRemain=0`，`seedPresent=10`。未删种子十类 / jobs / 审计 / 幂等 / `ranking_*` / `app_config` / 会员账号 / gift。未把明文 `_id` 写入本文。

## 5 未做 / 已知边界

- E 段手点 1–12 与 leftover=0 已闭合；整项标完成。
- 不把 A19 / A20 / A27 / T23 / T24 / T26 标通过。
- Apple 现网与真实退款留到 MW29。Apple 不支持沙箱。
- 不实现运营统计大盘、备份演练、正式售价。
- 不借本任务补做 MW21 已付履约。
- 首版只提供整笔退款；部分退款转人工。
- 测试夹具写入 `fixtureLedger` 订单与 order 来源账本，不是渠道已付骗发放。

## 6 审核整改（2026-10-18，不标完成）

对照任务书与本结果，只改两处，状态保持 **部分完成**。未跑 `mw22:cleanup` / `verify-leftovers`，不得报 leftover=0。未标 A19 / A20 / A27 / T23 / T24 / T26。4174 当时未占用。`npm run typecheck` / `npm test` 退出码 0（workspaces **338** 项：admin 8 / miniprogram 39 / shared 143 / api 148，含 `notify-without-prior-request`）。未自动提交、推送或发布。未部署（本轮只整改与单测）。

1. **无事先申请不得建退款单。** `applyRefundChannelOutcome` / `xpay_refund_notify` 在没有 `refund.request` 时不 insert/set `refunds`。未知/受理/处理中只写回调与日账差异（`unknown_refund_result`）。平台最终成功早于本系统申请：记 `channel_refund_before_request`，整笔则撤该 order 未用时长并可将订单标为退款成功；随后 `refund.request` **补单**绑定已发生结果（`state=succeeded`，`unknownResult=false`），不得走未知结果路径另建单。单测：`notify-without-prior-request`。
2. **订单 leftover 仅主动记入。** `pages/orders` 的 `reload` / 列表不再 `markLeftoverOrderId`。用户对「本轮测试订单」点「记入本轮 leftover」；复制按钮只含主动记入的哈希。
