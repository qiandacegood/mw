# MW21 实际结果

日期：2026-10-17 / 18
任务：[VIP 套餐与在线购买](../mw21-vip-purchase.md)
状态：**已完成**（A/B/C 已接线；D 段 mw-test 部署与负向核验通过；E 段手点 1–7 通过，入册订单 2 + 套餐 3 已精确清理。已付履约 8–10 与现网路径按任务总览明确留到 **MW29**。未标 A14 / A15 / A16 / A17 / A20 / T20 / T21 / T22 / T26）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码、AppKey 只存在于被 Git 忽略的本地 `.env`；本文不写入、不提交这些值，也不写明文 `_id` / `memberId` / `session_key`。

未把 A01—A31、T01—T30 标为通过，尤其未标 **A14 / A15 / A16 / A17 / A20 / T20 / T21 / T22 / T26**，也不回标 A02 / A09 / A18 / T25。未创建 `refunds`，未实现 `refund.*` / 对账日账。未开启超额。`VIRTUAL_PAY_ENV` 保持沙箱 `1`，未切现网 AppKey。未真实扣款，未做 iOS / Apple 现网付款（记到 MW29）。未启动 MW22—MW30。未改写 MW01—MW20 与 MW-UI01 的历史完成记录。未自动提交、推送或发布。执行者未 automator / CLI / 浏览器冒充 super 或微信身份。

## 1 五块实际状态

| 块 | 状态 | 说明 |
| --- | --- | --- |
| 套餐 / 订单 / 发放 | 已接线 | `@mw/shared`：套餐版本、冻结快照、支付会话校验、通知/查单状态机；`applyVipGrant` 接受 `order`；一订单一 grant，`_id=H(sourceType,sourceId)`，`sourceId` 为订单业务号 |
| 服务端购买 | 已接线 | `vip.plans` / `order.create` / `payment.prepare` / `order.get` / `list` / `refresh` / `close`；`mw-pay-hook` 验签后按已付发放；已付未开通可同单补偿 |
| 后台与小程序 | 已接线 | 后台「VIP 套餐发布」「订单核对」；小程序 VIP 中心 / 收银台参数 / 订单列表（沿用 MW-UI01 / MW02） |
| mw-test 部署与负向 | 见第 3 节 | 只部署 mw-test；负向 CLI 不手点 |
| 用户手点与 leftover=0 | **已闭合（未做现网已付路径移交 MW29）** | 1–7 已手点；入册对象已清。8–10 NOT_RUN，按总览留到 MW29 |

## 2 本地检查

2026-10-17 执行。当时 4174 无占用进程，`ensure-shared-js` 可原样跑。

| 检查 | 退出码 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 0 | admin / miniprogram / shared / api |
| `npm test` | 0 | 含 `mw21-assert`；workspaces **327** 项（admin 8 / miniprogram 38 / shared 137 / api 144） |
| `npm run build` | 0 | 小程序 27 入口；`checked 215 miniprogram files`；TDesign 1.17.0；`runtime.sha256` 前缀 `30ab2754eaec` |
| `git diff --check` | 0 | 仅 CRLF 工作副本提示，无尾随空格失败 |
| `npm run mw21:assert` | 0 | leftover 门禁：空清单 / `wroteDocs=false` 不得当 0 |

本地机制覆盖（不等于验收通过）：content 角色拒绝发布套餐；客户端价格/env/`clientSuccess` 拒绝；iOS 沙箱 `PAYMENT_CHANNEL_UNAVAILABLE`；`payment.prepare` 换会话核对 openId，不返回 `session_key`；伪造成功不发放；重复通知只履约一次；两笔已付并发续期串行叠加不覆盖；关单前查原单，已付不得关闭；`purchaseCreate` 关维护时支付通知仍可发放；购买路径不写成长分。

## 3 D 段部署与负向核验（仅 mw-test）

`npm run mw21:deploy` 最终退出码 0。`runtime.sha256` 前缀 `30ab2754eaec`。

第一次部署后 `parseFunctionEnv` 未展开 CloudBase `Environment.Variables` 数组，曾把字面 `Variables` 写回函数环境。随即修正解析、从本地 `.env` **只合并沙箱键**（`VIRTUAL_PAY_ENV` 必须为 `1`，明确拒绝现网 AppKey），第二次部署恢复。现网 `VIRTUAL_PAY_APP_KEY_LIVE` 未写入任一入口。

| 项 | 结果 |
| --- | --- |
| 部署入口 | `mw-admin` / `mw-member` / `mw-pay-hook` |
| 集合 | `vip_plans`、`orders`、`payment_receipts`、`callback_events`（本次新建；第二次部署 `existed=true`） |
| 索引 | `idx_orders_member_created`、`idx_orders_paystate_nextcheck`（`listed=true`） |
| `EnableOverrun` | false |
| 其它环境计数 | 3（未触碰） |
| 沙箱环境 | 三入口 `VIRTUAL_PAY_ENV=1`；无 `VIRTUAL_PAY_APP_KEY_LIVE` |
| `refunds` | 未创建 |

`npm run mw21:verify` 退出码 0，`ok:true`：

| 项 | 结果 |
| --- | --- |
| 未登录 `plan.publish` | `AUTH_REQUIRED` |
| 未登录 `order.create` | `AUTH_REQUIRED` |
| 本轮集合 | 四集合计数均为 0（部署当时，尚未手点下单） |
| 种子十类 | 10 |
| `refunds` | 文档计数 0 |
| 沙箱 `VIRTUAL_PAY_ENV` | `1` |

本地 `.env` 中 `VIRTUAL_PAY_NOTIFY_TOKEN` / `VIRTUAL_PAY_ENCODING_AES_KEY` 仍为缺失（MW07-B 已记录）。E 段若要走真实消息推送通知，需用户按 MW07-B 自行配齐；本轮未写入、未打印这些值。

## 4 E 段用户手点（2026-10-18，部分闭合）

执行者未 automator / CLI / 浏览器冒充 super 或微信身份。未真实扣款、未切现网 AppKey。

用户确认 1–7 通过。拉起收银台参数后订单进入 **确认中 / confirming**，查单未已付，未开通 VIP。365 天测试价 ¥899，明确不要求也不允许为此单现网付款。8–10 记 **NOT_RUN**。

1. content 不能发布套餐：**通过**。
2. super 发布 30 / 90 / 365 测试套餐：**通过**。
3. `vip.plans` 可见可售与能力提示，`channel=android`，`deviceDoesNotGrant=true`：**通过**。
4. 下单冻结服务端价格：**通过**。
5. 客户端改价 / 非法字段不能便宜买：**通过**（「伪造成功」路径）。
6. 伪造成功不发放：**通过**。
7. 未支付关单先查原单：**通过**。
8. 重复通知只发一次：**NOT_RUN**（沙箱收银台未完成，未已付）。
9. 两笔已付并发续期不覆盖：**NOT_RUN**。
10. 已付未开通同单补偿：**NOT_RUN**。
11. 购买不加分：无已付开通，未形成购买加分对照；负向未开通，记 **NOT_RUN**。
12. 订单列表本人可见：随 1–7 下单路径一并观察。
13. **收口**（分两次入册，只含哈希）：
    - 订单 2 个哈希：resolve 命中 2，cleanup 精确删 2，失败 0；`independent-check` `remain=0`；`verify-leftovers` `ok:true` `leftoverDocs=0` `seedPresent=10`。
    - 套餐 3 个哈希：resolve 命中 3，cleanup 精确删 3，失败 0；`independent-check` `remain=0`；`verify-leftovers` `ok:true` `leftoverDocs=0` `seedPresent=10`。
    - 未删 members / vip_accounts / gift / jobs / 审计 / 幂等 / ranking_* / app_config / 种子十类。

Apple 现网与 iOS 真机付款不在本轮。2026-10-18 用户确认：已付履约（重复通知只发一次、两笔已付并发续期不覆盖、已付未开通同单补偿、购买后成长分对照）一并留到 **MW29**。任务总览完成条件允许「两端接线完成，未做的现网路径明确留到 MW29」，故整项标完成，不把未做真付当成已验收。

## 5 未做 / 已知边界

- 8–10（已付履约、并发续期、同单补偿）及购买后成长分对照未手点；移交 MW29，不回标当时已通过。
- 不实现退款、对账日账、正式售价上架（MW22）。
- 不把 A14 / A15 / A16 / A17 / A20 / T20 / T21 / T22 / T26 标通过。
- 通知验签仍走 MW07-B 虚拟支付协议，不改 APIv3。
