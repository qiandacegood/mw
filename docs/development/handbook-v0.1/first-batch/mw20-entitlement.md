# MW20 VIP 权益账本与判权

开发手册 v0.1｜任务状态：已完成（A—D 本对话实现与 mw-test 核验；E 段用户手点与 leftover=0 已闭合。未标 A02 / A09 / A17 / A18 / T25）  
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)｜[结果](results/mw20-result.md)

本任务分多段。只操作 mw-test。没有生产环境、没有真实支付。不创建 `orders` / `vip_plans` / `payment_receipts` / `callback_events` / `refunds`。不开启超额。不启动 MW21—MW30。不把 A01—A31、T01—T30 标通过（尤其未标 A02 / A09 / A17 / A18 / T25）。不改写 MW01—MW19 与 MW-UI01 的历史完成记录。不自动提交、推送或发布。E 段用户手点与 leftover=0 已闭合。

## 分段

| 分段 | 名称 | 本对话 |
| --- | --- | --- |
| MW20-A | `@mw/shared` 账本、有效期、消耗、赠送/撤销、并发串行、秒边界 | 本对话实现 |
| MW20-B | 服务端 `vip.status` / `vip.grant` / `vip.revokeGift`；答题与 `member.me` 接真判权 | 本对话实现 |
| MW20-C | 后台赠送/撤销；小程序 VIP 展示（沿用 MW-UI01，不大改视觉） | 本对话实现 |
| MW20-D | leftover 云脚本、集合、部署与负向核验 | 本对话部署到 mw-test |
| MW20-E | 用户手点与 leftover=0 | 2026-10-17 用户手点与 leftover=0 已闭合 |

## 目标与可见结果

1. 真实权益账本替换 MW14 隔离替身。`attempt.start` / `startReplacing` / `submit` 与 `member.me` / `vip.status` 读同一账本。
2. 集合只建/用 `vip_accounts`、`vip_grants`、`vip_events`。账户摘要是派生值；禁止后台直接改 `expiresAt` 代替账本。
3. 一来源一 `vip_grant`；`_id = H(sourceType, sourceId)`。首次开通、有效期内追加、过期后续期按基线：未开通或已到期 `expiresAt = grantedAt + durationSeconds`；仍有效 `expiresAt = max(currentExpiresAt, grantedAt) + durationSeconds`。1 天 = 86400 秒。恰好到期判无效（`now < expiresAt`）。
4. 并发不同来源必须串行在同一 `vip_accounts`，不得互相覆盖。发放延迟从实际开通时刻起算。
5. 人工赠送必须有原因，来源标 `gift`，不得冒充付款，不得写 `orders`。`vip.revokeGift` 只能撤销该赠送来源的未用时长，不能删付费来源（本轮也还没有付费来源）。
6. 过期后：新开 VIP 卷 `VIP_REQUIRED`；已有草稿保留，续期可继续；已提交历史解析仍可查。成长分、等级、勋章不因赠送或到期而变。
7. 消耗按来源顺序，不产生负数；未用时长可按来源撤销，给 MW22 留基础。持续消费不必每秒写库，读时按已结算时刻推算。
8. `entitlementApply` 维护门独立，不得用总开关误挡交卷或支付通知。本轮无付款，不实现 `order.*` / `payment.*` / `vip.plans`。
9. CloudBase 写入不把文档自带 `_id` 再 set 回去；新文档不依赖多集合事务里直接插入。

## 已裁定（本轮不重开）

1. 本轮做真实权益账本与判权，替换 MW14 隔离替身。
2. 集合只建/用三本账本；账户摘要是派生值。
3. 一来源一 grant；有效期按基线秒加算，不按自然月。
4. 恰好到期无效；并发不同来源串行同一账户。
5. 赠送来源标 `gift`，必须有原因，不写订单。
6. `revokeGift` 只撤该赠送未用时长。
7. 过期保留草稿与历史解析；VIP 不加分、到期不清空成长。
8. 读时推算消耗；写时才结算落账。
9. `entitlementApply` 独立；本轮无付款。
10. leftover 沿用 MW15 起独立核查：空清单或 `wroteDocs=false` 不得报 leftover=0。

## leftover 门禁

| 类别 | 是否计入 leftover | 规则 |
| --- | --- | --- |
| 本轮入册的赠送账本（`vip_accounts` / `vip_grants` / `vip_events`） | 是 | 只清本轮 gift 来源；按入册会员/来源精确删 |
| 本轮 VIP 测试卷 / 题 / 答题 | 是 | 按入册哈希精确删 |
| 种子十类与既有业务数据 | 否 | 永不删除 |
| `jobs` / `audit_logs` / 幂等 | 否（恢复证据） | 不把审计和任务恢复证据一律删除 |
| `ranking_heads` / `ranking_rows` / `app_config` | 否 | 共享聚合 |
| 历史成绩、会员账号、`member_stats` | 否 | 不删账号与既有成长态 |
| `orders` / `vip_plans` / `payment_receipts` / `callback_events` / `refunds` | 禁止出现 | 本轮不得创建 |

空清单或 `wroteDocs=false` 不得报 leftover=0。沿用 MW15 起的独立核查，不能只靠 DELETE 成功计数。

## 必须由用户手点（E 段）

执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。可做授权范围内的部署、只读核验、签名 `jobs.tick`、本地测试。

手点清单见结果文件。至少覆盖：content 角色拒绝赠送；super 赠送有原因；首次 / 有效期追加 / 过期续期；恰好到期秒边界；两路并发赠送不覆盖；免费会员看 VIP 卷仍 `VIP_REQUIRED`；赠送后可开 VIP 卷；到期后草稿与历史解析仍在、新开 VIP 卷拒绝；总分/等级/勋章不变；`revokeGift` 只撤未用赠送；收口只入册本轮对象。

## 不包含的工作

不启动 MW21—MW30。不实现套餐购买、收银台、退款、运营统计、备份演练。不把 A02 / A09 / A17 / A18 / T25 标为正式验收通过。不自动提交、推送或发布。
