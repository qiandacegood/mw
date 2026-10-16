# MW20 实际结果

日期：2026-10-16 / 17
任务：[VIP 权益账本与判权](../mw20-entitlement.md)
状态：**已完成**（A/B/C 已接线；D 段 mw-test 部署与负向核验通过；E 段用户手点 1–12 与 leftover=0 已闭合。未标 A02 / A09 / A17 / A18 / T25）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码只存在于被 Git 忽略的本地 `.env`；本文不写入、不提交这些值，也不写明文 `_id` / `memberId`。

未把 A01—A31、T01—T30 标为通过，尤其未标 **A02 / A09 / A17 / A18 / T25**。未创建 `orders` / `vip_plans` / `payment_receipts` / `callback_events` / `refunds`。未开启超额。未启动 MW21—MW30。未改写 MW01—MW19 与 MW-UI01 的历史完成记录。未自动提交、推送或发布。执行者未 automator / CLI / 浏览器冒充 super 或微信身份。

## 1 五块实际状态

| 块 | 状态 | 说明 |
| --- | --- | --- |
| 账本与有效期 | 已接线 | `@mw/shared`：一来源一 grant、`H(sourceType,sourceId)`、首次/追加/过期续期、恰好到期无效、按序消耗不产生负数、赠送/撤销、读时推算 |
| 服务端判权 | 已接线 | `vip.status` / `vip.grant` / `vip.revokeGift`；`member.me` 与 `attempt.start` / `startReplacing` / `submit` 读同一账本；`entitlementApply` 独立 |
| 后台与小程序 | 已接线 | 后台「VIP 赠送与撤销」；「我的」/首页展示 VIP；试卷页按账本 `vip.active` 决定是否显示开始 |
| mw-test 部署与负向 | 见第 3 节 | 只部署 mw-test；负向 CLI 不手点 |
| 用户手点与 leftover=0 | **已闭合** | 用户确认手点均通过；入册后精确删除 36、失败 0；`leftoverDocs=0`；种子十类仍 10 |

## 2 本地检查

2026-10-16 执行。跑前占用 4174 的后台 Vite（pid 19892）已先停，避免 `ensure-shared-js` 锁 `packages/shared/dist`。

| 检查 | 退出码 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 0 | admin / miniprogram / shared / api |
| `npm test` | 0 | 含 `mw20-assert`；workspaces **315** 项（admin 8 / miniprogram 37 / shared 131 / api 139） |
| `npm run build` | 0 | 小程序 24 入口；`checked 206 miniprogram files`；TDesign 1.17.0；`runtime.sha256` 前缀 `9b0c388574a9` |
| `git diff --check` | 0 | 仅 CRLF 工作副本提示，无尾随空格失败 |
| `npm run mw20:assert` | 0 | leftover 门禁：空清单 / `wroteDocs=false` 不得当 0 |

本地机制覆盖（不等于验收通过）：content 角色拒绝赠送；缺原因拒绝；伪造 `orderId` 拒绝；首次开通 / 过期后续期 / 有效期追加；恰好到期 `active=false` 且新开 VIP 卷 `VIP_REQUIRED`；两路并发不同来源串行叠加不覆盖；`revokeGift` 只撤未用赠送时长；`entitlementApply` 关维护时交卷仍通；`member.me` 与 `vip.status` 读同一账本。

## 3 D 段部署与负向核验（仅 mw-test）

`npm run mw20:deploy` 退出码 0。`runtime.sha256` 前缀 `9b0c388574a9`。

| 项 | 结果 |
| --- | --- |
| 部署入口 | `mw-admin` / `mw-member` |
| 集合 | `vip_accounts`、`vip_grants`、`vip_events`（本次新建，`existed=false`，创建码 0） |
| 索引 | `idx_vip_grants_member_sequence`（`listed=true`） |
| `EnableOverrun` | false |
| 其它环境计数 | 3（未触碰） |

`npm run mw20:verify` 退出码 0，`ok:true`：

| 项 | 结果 |
| --- | --- |
| 未登录 `vip.grant` | `FORBIDDEN` |
| 本轮集合 | 三集合计数均为 0（部署当时，尚未手点赠送） |
| 种子十类 | 10 |
| `orders` / `vip_plans` / `payment_receipts` / `callback_events` / `refunds` | **文档计数均为 0**；本轮未创建 |

## 4 E 段用户手点（已闭合）

执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。可做授权范围内的部署、只读核验、签名 `jobs.tick`、本地测试。

用户 2026-10-17 确认手点均通过。执行者未代登 super / 微信。第 11 步赠 80 秒后再撤显示 `已撤销未用 0 秒`：该来源时长已耗尽，撤销只扣未用秒数，属预期，不记失败。

1. 后台用 **content** 角色点「赠送 VIP」：应 `FORBIDDEN` / `SUPER_ROLE_REQUIRED`。
2. 用 **super** 赠送：必须填原因；来源为 `gift`；不得出现订单。记下 `sourceId` 与到期时间。
3. **首次开通**：未开通会员赠送后天数按 86400 秒加算；`member.me` / `vip.status` /「我的」同一到期时间。
4. **有效期内追加**：再赠另一 `sourceId`，到期应在当前有效期上叠加，不得覆盖。
5. **过期后续期**：等到期后再赠，新到期从实际开通时刻起算，不叠在旧墙钟上。
6. **恰好到期秒边界**：可用 durationSeconds 赠极短时长；恰好到期秒 `vip.active=false`，新开 VIP 卷 `VIP_REQUIRED`。
7. **两路并发赠送**：两个不同来源几乎同时赠送，账户只应有一份叠加后的到期，不得互相覆盖。
8. **免费会员看 VIP 卷**：未赠送时详情页 `VIP_REQUIRED`，不能开始。
9. **赠送后可开 VIP 卷**：同一会员开始成功；交卷后总分/等级/勋章不因赠送而变。
10. **到期后草稿与历史**：答题中到期则草稿仍在，续期可继续；已提交历史解析仍可查；新开 VIP 卷拒绝。
11. **revokeGift**：只撤该赠送来源未用时长；其他来源保留。
12. **收口**：只把本轮赠送账本与本轮 VIP 测试卷/题/答题哈希复制出来（后台「复制本轮 VIP leftover」；小程序试卷/答题/本人）。不要种子十类、不要 `jobs` / 审计 / 幂等 / 共享 `ranking_*` / `app_config` / 历史成绩 / 会员账号。然后：

```text
npm run mw20:import-known-ids -- "<json>"
npm run mw20:resolve-known-ids
npm run mw20:cleanup
npm run mw20:independent-check
npm run mw20:verify-leftovers
```

第 12 步收口（2026-10-17）：用户粘贴后台 VIP leftover、小程序 leftover、试卷 knownIds 后合并导入 `knownIdCount=6`；`mw20:resolve-known-ids` 反查命中并按会员/试卷关系补齐到 37（会员账号只锚定，不删）。`mw20:cleanup` `targetCount=36` `deleted=36` `failed=0`。`mw20:independent-check` `remain=0`。`mw20:verify-leftovers` **`ok:true`**、`leftoverDocs=0`、`independentRemain=0`、`seedPresent=10`、`reason=LEFTOVER_CLEARED`。未删 jobs / 审计 / 幂等 / 共享榜 / `app_config` / 种子十类 / 历史会员账号。试卷页 `questions` 哈希为空，本轮测试题若另存题库则不在本轮入册范围内。

## 5 leftover 规则（重申）

| 类别 | leftover | 规则 |
| --- | --- | --- |
| 本轮入册赠送账本 | 是 | `vip_accounts` / `vip_grants` / `vip_events`（gift） |
| 本轮 VIP 测试卷 / 题 / 答题 | 是 | 按入册哈希精确删 |
| 种子十类与既有业务数据 | 否 | 永不删除 |
| `jobs` / `audit_logs` / 幂等 | 否 | 恢复证据 |
| `ranking_*` / `app_config` | 否 | 共享聚合 |
| 历史成绩、会员账号、`member_stats` | 否 | 不删账号与成长态 |
| `orders` / `vip_plans` / `payment_*` / `refunds` | 禁止出现 | 本轮不得创建 |

## 6 契约与兼容

- 账户摘要是派生值；禁止后台直接改 `expiresAt`。
- 一来源一 grant；`_id = H(sourceType, sourceId)`。
- 恰好到期无效（`now < expiresAt`）。
- 赠送来源固定 `gift`，必须有原因，不写订单。
- `revokeGift` 只撤未用赠送。
- CloudBase 写入不把文档自带 `_id` 再 set 回去；新文档用已知 id 的 `doc().set()`。
- `entitlementApply` 独立，不挡交卷或支付通知。

## 7 剩余缺口

- 未把 A02 / A09 / A17 / A18 / T25 标正式通过。
- 本轮无付款，不实现 `order.*` / `payment.*` / `vip.plans`。
- 第 11 步「撤 80 秒得 0」按未用时长口径通过；若要看到非零撤销，须在该来源仍有剩余秒时点撤销。
