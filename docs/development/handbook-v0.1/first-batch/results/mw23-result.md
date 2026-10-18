# MW23 实际结果

日期：2026-10-18 / 2026-10-19
任务：[个人中心与反馈运营](../mw23-profile-ops.md)
状态：**已完成**（A/B/C 已接线；D 段 mw-test 部署与负向核验通过；E 段手点用户确认全过；leftover=0 已核验。未标 A12 / A25 / A26 / T02 / T14）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码、AppKey 只存在于被 Git 忽略的本地 `.env`；本文不写入、不提交这些值，也不写明文 `_id` / `memberId` / `session_key`。

未把 A01—A31、T01—T30 标为通过，尤其未标 **A12 / A25 / A26 / T02 / T14**，也不回标 A14 / A19 / A20。未改写 MW01—MW22 与 MW-UI01 的历史完成记录。不重写 `vip_accounts` / `vip_grants` / `orders` / `refunds` 账本。MW21 已付履约与 MW22 真退款现网仍留 MW29。未开启超额。`VIRTUAL_PAY_ENV` 保持沙箱 `1`，未切现网 AppKey。未真实扣款、未真实退款、未做 iOS / Apple 现网。未启动 MW24—MW30。未自动提交、推送。E 段前按用户要求发布 mw-test 后台托管。执行者未 automator / CLI / 浏览器冒充 super 或微信身份。

## 1 五块实际状态

| 块 | 状态 | 说明 |
| --- | --- | --- |
| A 共享契约 | 已接线 | 反馈绑 `paperId`/`questionId`/`versionId`、拒外链、不能改答案库；停用/禁榜分记、原因必填；`rankingPublicEligible` 与公开行昵称覆盖、不含 OPENID |
| B 服务端 | 已接线 | `feedback.create` / `list` / `resolve`；`member.list` / `get`（operations，无 OPENID / 无订单明细）；`member.disable` / `ranking.ban` 仅 super；停用后写拒绝、`me` 仍可读；公开榜二次核对该资格并覆盖现昵称 |
| C 前台 | 已接线 | 小程序「我的」入口（资料/成长/分类分/勋章/历史/订单/VIP/排行开关/客服/反馈/注销占位）；解析页可反馈本版题目；后台会员详情与禁榜、题目反馈处理 |
| D mw-test 部署与负向 | 见第 3 节 | 只部署 mw-test；负向 CLI 不手点 |
| E 用户手点与 leftover=0 | 已闭合 | 2026-10-19 用户确认手点全过；leftover=0 已核验 |

## 2 本地检查

2026-10-18 执行。4174 当时未占用，未停 Vite。后台 disable/ban/get 入参用 `targetMemberId`（客户端 `memberId` 会被身份守卫丢弃）。禁榜会抬 `revision`，之后改资料须用新修订号。

| 检查 | 退出码 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 0 | admin / miniprogram / shared / api |
| `npm test` | 0 | 含 `mw23-assert`；workspaces **351** 项（admin 8 / miniprogram 40 / shared 149 / api 154） |
| `npm run build` | 0 | 小程序 30 入口；`checked 227 miniprogram files`；TDesign 1.17.0；`runtime.sha256` 前缀 `d5d85adabdca` |
| `git diff --check` | 0 | 仅 CRLF 工作副本提示，无尾随空格失败 |
| `npm run mw23:assert` | 0 | leftover 门禁：空清单 / `wroteDocs=false` 不得当 0；会员哈希不计入可删 leftover |

本地机制覆盖（不等于验收通过）：content 不能 `member.list` / `feedback.resolve`；operations 可处理反馈、不能 disable/ban；super 停用后 `updateProfile` 拒绝、`member.me` 仍可读；禁榜不改 `status`；反馈缺版本或外链或答案字段被拒；公开行覆盖新昵称且不含 memberId/OPENID；注销页不落库。

## 3 D 段部署与负向核验（仅 mw-test）

`npm run mw23:deploy` 退出码 0。`runtime.sha256` 前缀 `d5d85adabdca`。E 段前按用户要求发布 mw-test 后台托管至 `https://mw.qianjiaoguan.com/`（`npm run admin:hosting` 退出码 0）。未提交、未推送。未切现网 AppKey。

| 项 | 结果 |
| --- | --- |
| 部署入口 | `mw-admin` / `mw-member` / `mw-public` |
| 集合 | `feedbacks`（本次新建，`existed=false`，创建码 0） |
| 索引 | `idx_feedbacks_status_created`、`idx_feedbacks_member_created`（`listed=true`） |
| `EnableOverrun` | false |
| 其它环境计数 | 2（未触碰） |
| 沙箱环境 | 部署时只合并沙箱键；未写入现网 `VIRTUAL_PAY_APP_KEY_LIVE` |

`npm run mw23:verify` 退出码 0，`ok:true`：

| 项 | 结果 |
| --- | --- |
| 未登录 `member.disable` | `AUTH_REQUIRED` |
| 未登录 `feedback.create` | `AUTH_REQUIRED` |
| 本轮集合 | `feedbacks` 文档计数 0（部署当时，尚未手点） |
| 种子十类 | 10 |
| 沙箱 `VIRTUAL_PAY_ENV` | `1`；无 `VIRTUAL_PAY_APP_KEY_LIVE` |
| `EnableOverrun` | false |

## 4 E 段用户手点（已闭合）

执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。可做授权范围内的部署、只读核验、签名 `jobs.tick`、本地测试。

2026-10-19 用户确认下列 1–9 **全过**。成长总分 9 与公开榜 0 分并存属既有「历史缺口不补记」口径：公开榜只收录可追溯正分；用户交卷取得正分并重建后上榜。未标 A12 / A25 / A26 / T02 / T14。

1. 「我的」页入口可达且不露 OPENID：**PASS**。
2. 未 opt-in 不在公开榜；开启后无费用筛选；有可追溯正分后可上榜：**PASS**。
3. 改昵称后公开行更新为新昵称：**PASS**。
4. content 打不开订单明细、不能 resolve 反馈：**PASS**。
5. operations 可处理反馈，不能 disable / ban / 退款执行：**PASS**。
6. super 停用后该会员不能改资料 / 开新卷，仍能看 `me`，公开榜消失：**PASS**。
7. 禁榜不等于停用；恢复后可写：**PASS**。
8. 反馈必须带题目版本，不能改答案库；客服入口与题目反馈不混成订单售后：**PASS**。
9. 注销入口只占位：可进页、可读说明，不删号、不退款、不落库：**PASS**。
10. **收口**：小程序复制为空清单（未主动记入卷/答题/会员）。后台复制本轮 1 条反馈哈希。只入册该反馈；未入册会员账号、历史卷、订单、退款、套餐。然后：

```text
npm run mw23:import-known-ids -- "<json>"
npm run mw23:resolve-known-ids
npm run mw23:cleanup
npm run mw23:independent-check
npm run mw23:verify-leftovers
```

2026-10-19 导入后台 1 条反馈哈希（小程序空清单不用，避免 `EMPTY_HASHES` / `WROTE_DOCS_FALSE`）。`mw23:import-known-ids` `knownIdCount=1`。`mw23:resolve-known-ids` `imported=1` / `matchedCount=1`。`mw23:cleanup` 精确删除 1 条、`failed=0`、未删会员。`mw23:independent-check` `remain=0`。`mw23:verify-leftovers`：`ok:true`，`reason=LEFTOVER_CLEARED`，`leftoverDocs=0`，`independentRemain=0`，`seedPresent=10`。未删种子十类 / jobs / 审计 / 幂等 / `ranking_*` / `app_config` / 会员账号 / gift / order / refund。未把明文 `_id` 写入本文。

## 5 未做 / 已知边界

- E 段手点 1–9 与 leftover=0 已闭合；整项标完成。
- 不把 A12 / A25 / A26 / T02 / T14 标为正式验收通过。
- 正式协议文案仍 MW24，本轮客服入口为测试稿。不实现账号注销落库、不实现 `metrics.summary` 运营大盘、不实现备份演练。
- 不自动提交、推送。后台托管仅 mw-test 自定义域。
- MW21 已付履约与 MW22 真退款现网仍留 MW29。
