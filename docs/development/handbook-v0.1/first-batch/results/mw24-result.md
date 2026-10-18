# MW24 实际结果

日期：2026-10-19
任务：[正式协议与账号注销](../mw24-policies-deletion.md)
状态：**已完成**（A/B/C 已接线；D 段 mw-test 部署与负向核验通过；E 段手点用户确认全过；leftover=0 已核验。未标 A01 / A12 / A26 / T01 / T14）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码、AppKey 只存在于被 Git 忽略的本地 `.env`；本文不写入、不提交这些值，也不写明文 `_id` / `memberId` / `session_key`。

未把 A01—A31、T01—T30 标为通过，尤其未标 **A01 / A12 / A26 / T01 / T14**，也不回标 A14 / A19 / A20 / A25。未改写 MW01—MW23 与 MW-UI01 的历史完成记录。本轮接入协议版本与账号注销，不重写 `vip_accounts` / `vip_grants` / `orders` / `refunds` 账本。MW21 已付履约与 MW22 真退款现网仍留 MW29。未开启超额。`VIRTUAL_PAY_ENV` 保持沙箱 `1`，未切现网 AppKey。未真实扣款、未真实退款、未做 iOS / Apple 现网。未启动 MW25—MW30。未自动提交、推送或发布。执行者未 automator / CLI / 浏览器冒充 super 或微信身份。E 段手点用户确认全过；leftover=0 **已核验**。

## 1 五块实际状态

| 块 | 状态 | 说明 |
| --- | --- | --- |
| A 共享契约 | 已接线 | 协议测试稿带版本号；注销须 `reauthProof` + `acknowledgementVersion`；未完成订单阻断；资料最小保留；反馈 `submitterDeleted`；公开榜 `status==="active"` 才合格，读侧二次核对，不半发布快照 |
| B 服务端 | 已接线 | `policies.current` 返回版本+测试稿正文；`register` 校验当前版本且须 `accepted=true`；`member.requestDeletion` / `member.deletionStatus`；已注销写拒绝、再注册 `ACCOUNT_DELETED`；`me` 可见终态且泄漏扫描不含微信开放平台身份标识 |
| C 前台 | 已接线 | 注册页展示当前测试稿、禁止预勾选；「我的」协议入口与注销真流程（确认版本、重新登录、待办订单、状态查询）；后台会员详情只读注销状态，content 仍无订单明细 |
| D mw-test 部署与负向 | 见第 3 节 | 只部署 mw-test；负向 CLI 不手点；leftover 脚本已落地，空清单不得当 0 |
| E 用户手点与 leftover=0 | 已闭合 | 2026-10-19 用户确认手点 1–12 全过；第二微信号补 1 条本轮反馈后 leftover=0 已核验 |

## 2 本地检查

2026-10-19 执行。4174 当时未占用，未停 Vite。

| 检查 | 退出码 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 0 | admin / miniprogram / shared / api |
| `npm test` | 0 | 含 `mw24-assert`；workspaces **359** 项（admin 8 / miniprogram 40 / shared 152 / api 159） |
| `npm run build` | 0 | 小程序 31 入口；`checked 231 miniprogram files`；TDesign 1.17.0；`runtime.sha256` 前缀 `5f20282c1487` |
| `git diff --check` | 0 | 仅 CRLF 工作副本提示，无尾随空格失败 |
| `npm run mw24:assert` | 0 | leftover 门禁：空清单 / `wroteDocs=false` 不得当 0 |

本地机制覆盖（不等于验收通过）：未勾选 / 旧版本注册 `INVALID_ARGUMENT`；注销缺重新认证或版本不匹配拒绝；待支付订单返回 `pendingItems` 不改 status；无阻塞订单同一事务落到 `deleted`（opt-out、脱敏昵称、反馈标记已注销）；已注销再 register `ACCOUNT_DELETED`；`me` / 注销状态泄漏扫描通过；停用走 `disable` 不是注销；公开榜 `deleting`/`deleted` 不合格且不半发布 `ranking_heads`。

## 3 D 段部署与负向核验（仅 mw-test）

`npm run mw24:deploy` 退出码 0。`runtime.sha256` 前缀 `5f20282c1487`。`app_config.policies` 以 `$set` 更新，载荷不含 `_id`。未提交、未推送。未切现网 AppKey。

| 项 | 结果 |
| --- | --- |
| 部署入口 | `mw-admin` / `mw-member` / `mw-public` |
| 协议文档 | `app_config/policies` 更新为 `mw24-test-agreement-v1` / `mw24-test-privacy-v1`（`wroteIdField=false`）；共享生产键，不另建、不删 |
| 新集合 / 新索引 | 无（本轮不新建集合） |
| `EnableOverrun` | false |
| 其它环境计数 | 2（未触碰） |
| 沙箱环境 | 部署时只合并沙箱键；未写入现网 `VIRTUAL_PAY_APP_KEY_LIVE` |

`npm run mw24:verify` 退出码 0，`ok:true`：

| 项 | 结果 |
| --- | --- |
| `policies.current` | `ok:true`，版本 `mw24-test-agreement-v1` / `mw24-test-privacy-v1`，正文含版本号 |
| 未登录 `member.requestDeletion` | `AUTH_REQUIRED` |
| 未登录 `member.register` | `AUTH_REQUIRED` |
| 种子十类 | 10 |
| 沙箱 `VIRTUAL_PAY_ENV` | `1`；无 `VIRTUAL_PAY_APP_KEY_LIVE` |
| `EnableOverrun` | false |
| `leftoverClaimedZero` | **false** |

D 段当时 leftover 门禁为空清单 `WROTE_DOCS_FALSE`，不得当 leftover=0。E 段收口见第 4 节。

## 4 E 段用户手点（已闭合）

执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。可做授权范围内的部署、只读核验、签名 `jobs.tick`、本地测试。

2026-10-19 用户确认下列 1–12 **全过**。第 5 步当时货架无套餐，由 super 发布测试套餐后下单不付款覆盖；第 9 步在已注销后走历史解析，新建反馈被拒；第 11 步在已注销号上反向验证 disable/恢复均 `ACCOUNT_DELETED`。未标 A01 / A12 / A26 / T01 / T14。

1. 未勾选不能注册：**PASS**。
2. 勾选当前测试稿版本可注册：**PASS**。
3. 旧版本同意不能当新版本：**PASS**。
4. 注销缺重新认证拒绝：**PASS**。
5. 有待支付/处理中订单列出待办不得删号：**PASS**。
6. 无阻塞订单时注销成功，公开榜立即不可见且快照不半发布：**PASS**。
7. 资料脱敏或最小保留：**PASS**。
8. 订单/退款记录仍可按隐私口径保留查询：**PASS**。
9. 反馈不指向可改答案库：**PASS**（注销后解析可读、新建反馈被拒）。
10. 同一微信身份不能再开第二个有效号：**PASS**。
11. 停用账号走 disable 不是注销：**PASS**（已注销号上停用/恢复均拒绝，status 仍为 `deleted`）。
12. 收口不删审计/订单/退款/非本轮会员：**PASS**。

第一轮剪贴板含 1 条套餐哈希 + 1 条反馈哈希：套餐丢弃未删；反馈 `HASH_NOT_MATCHED`（当时 `feedbacks` 全集 0 / 开放反馈 0 条）。空清单不得 leftover=0。第二轮用户用另一微信测试号新建本轮反馈后，后台复制 JSON 仅含 1 条 `feedbacks` 哈希（`plans`/`orders`/`members` 均为空）。然后：

```text
npm run mw24:import-known-ids
npm run mw24:resolve-known-ids
npm run mw24:cleanup
npm run mw24:independent-check
npm run mw24:verify-leftovers
```

`mw24:import-known-ids` `knownIdCount=1`。`mw24:resolve-known-ids` `imported=1` / `matchedCount=1`。`mw24:cleanup` 精确删除 1 条、`failed=0`、未删会员。`mw24:independent-check` `remain=0`。`mw24:verify-leftovers`：`ok:true`，`reason=LEFTOVER_CLEARED`，`leftoverDocs=0`，`independentRemain=0`，`seedPresent=10`。未删种子十类 / jobs / 审计 / 幂等 / `ranking_*` / `app_config` / 套餐 / 订单 / 退款 / 已注销号 / 第二测试号。未把明文 `_id` 写入本文。

## 5 未做 / 已知边界

- E 段手点 1–12 与 leftover=0 已闭合；整项标完成。
- 不把 A01 / A12 / A26 / T01 / T14 标为正式验收通过。
- 协议与隐私仍为带版本号的测试稿；负责人未确认正式文案。不开放生产真实注册/收款。
- 已 `deleted` 身份再注册本轮拒绝（`ACCOUNT_DELETED`）。复活规则已写入任务书，本轮不实现复活入口，也不 silently 新建第二号。
- 支付记录、退款与交易证据按最小必要保留，不承诺立即删除全部交易记录。
- 停用 ≠ 注销。禁榜 ≠ 注销。
- 不实现运营统计大盘、备份演练、正式售价、生产开放注册。
- 不自动提交、推送或发布。
- MW21 已付履约与 MW22 真退款现网仍留 MW29。
