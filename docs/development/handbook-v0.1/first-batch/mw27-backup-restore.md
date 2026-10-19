# MW27 备份恢复与发布回退演练

开发手册 v0.1｜任务状态：已完成（A—D 已接线并核验；E 段用户手点 1–8 全过，leftover=0 已核验。未标 A27 / T07 / T28。MW04 / MW12 仍部分完成）  
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)｜[结果](results/mw27-result.md)

本任务分多段。只操作 mw-test。没有生产环境、没有真实扣款、没有真实退款、没有 iOS / Apple 现网。`VIRTUAL_PAY_ENV` 保持沙箱，不切现网 AppKey。不开启超额。不启动 MW28—MW30。不实现正式售价、生产开放注册、现网支付验收。不把 A01—A31、T01—T30 标通过（尤其未标 **A27 / T07 / T28**，也不回标 A06 / A14 / A19 / A20 / A21）。不改写 MW01—MW26 与 MW-UI01 的历史完成记录。不把 MW04 / MW12 从部分完成改成已完成。本轮只积累机制与演练证据，不把 A27 / T07 / T28 标正式通过。不重写 VIP / 订单 / 退款账本，不重做导入 / 纠错 / 迁类 / 赠送 / 注销。不自动提交、推送或发布。执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。

## 分段

| 分段 | 名称 | 本对话 |
| --- | --- | --- |
| MW27-A | 清点契约（集合、指定索引、ACL、存储前缀与 sha256、函数 runtime.sha256、app_config 版本、维护开关）；RPO/RTO 测量口径；回档≠文件/代码/渠道；leftover 夹具契约 | 本对话实现 |
| MW27-B | 隔离恢复脚本。优先官方「回档到新集合」；否则夹具模拟。恢复后核：集合闭包、索引、ACL、媒体对象摘要、种子十类仍 10 | 本对话实现 |
| MW27-C | 恢复后查单 + 伪造/重放支付通知 + 退款回调：不开第二笔权益、不丢未决。jobs 中断/旧 token。代码回退手册（保留当前包哈希，说明不可回数据） | 本对话实现 |
| MW27-D | leftover 云脚本、mw-test 部署与负向核验；EnableOverrun=false；leftoverClaimedZero 在 E 前必须为 false | 本对话部署到 mw-test |
| MW27-E | 用户手点与 leftover=0 | 用户确认 1–8 全过；leftover=0 已核验 |

## 目标与可见结果

1. 数据/文件/配置清单、隔离恢复报告与回退手册。同基线集合 / 图片 / 索引 / 权限闭合。
2. 恢复后查单与回调重放不重复发权益、不遗漏未决状态。权益只按原业务号（`orderId` / `grantId=H(sourceType,sourceId)` / callback `stableEventKey`）重放；已发放不得再延长。
3. 实测 RPO / RTO 及局限。代码回滚不等于数据回滚。只在隔离目标演练，不故意覆盖生产，也不覆盖现有 mw-test 业务集合。
4. T07 用本轮夹具复验：中断按 cursor 接续；过期租约后旧 `fencingToken` 拒写；`job.resume` 只恢复，不跳过校验。不重写 jobs 平台。
5. 榜单：恢复后由 E 重建完整快照，不得半发布；`ranking_*` 不计入 leftover 删除清单。
6. 结果只能写 PASS / FAIL / BLOCKED / NOT_RUN。模拟成功不得写成平台验收通过。
7. CloudBase 写入不把文档自带 `_id` 再 set 回去。空清单或 `wroteDocs=false` 不得 leftover=0。

## 已裁定（本轮不重开）

1. 隔离目标 = mw-test 上的「回档新集合 / 本轮夹具」。禁止原地覆盖现有 mw-test 业务集合（种子十类、历史会员、非本轮订单/退款/vip、审计）。禁止对另外两个环境做回档。
2. 若个人版控制台不能「回档到新集合」而只能覆盖现库：记 BLOCKED，改为本轮夹具模拟恢复闭包 + 回调重放，不得强行覆盖。
3. 恢复后权益只按原业务号重放；已发放不得再延长；未决退款 / 未决回调不得丢。
4. 代码回滚手册必须写清：回滚函数包不回滚数据；schema 先扩展再收缩；旧代码读不了新 schema 时不得回退。本轮不要真的把函数滚到更旧的损坏包。
5. T07 用本轮夹具复验，不重写 jobs 平台。
6. 榜单恢复后由 E 重建完整快照，不得半发布；`ranking_*` 不计入 leftover 删除清单。
7. 执行者可做：只读清点、部署、未登录负向、签名 `jobs.tick`、本轮夹具写入/精确删除、本地机制单测。已登录 super 的回档确认、`job.resume`、榜单重建留给 E。
8. 不启动 MW28—MW30。不实现正式售价、生产开放注册、现网支付验收。不创建 mw-prod。不触碰其它 CloudBase 环境。
9. 未开启超额，不擅自加套餐掩盖备份能力缺口。沙箱 `VIRTUAL_PAY_ENV=1`。
10. 不把 A27 / T07 / T28 标正式通过。不改写 MW01—MW26 与 MW-UI01 的历史完成记录。不把 MW04 / MW12 标完成。

## 清点契约（A）

| 项 | 口径 |
| --- | --- |
| 集合 | 现行基线业务集合清单；隔离回档新集合 `mw27_rst_*` 整集计入 leftover |
| 指定索引 | 数据模型第 7 节已落地的组合索引（含 jobs / audit / categories / questions / papers / attempts / paper_bests / score_* / ranking_rows / orders / vip_grants / import_rows / refunds） |
| ACL | 业务集合客户端默认拒绝；核验 `ADMINONLY` |
| 存储 | 前缀 `mw-test/media/import/`、`mw-test/media/analysis/`、`mw-test/media/prompt/`；记录对象摘要，不导出秘密 |
| 函数 | 正式六入口 + `cloudbase_auth` 的 `runtime.sha256`；本轮保留当前包哈希 |
| 配置 | `app_config` 各键版本（maintenance / catalog / growth / policies / ranking）；支付密钥不进普通资料包 |
| 维护开关 | 可关 `contentWrites` / `attemptStart` / `attemptSubmit` / `purchaseCreate` / `entitlementApply`；**支付通知入口必须保持可接收**；演练结束必须恢复开关 |
| 回档≠ | 数据库回档不等于云存储、函数代码、部署配置、支付渠道状态一起恢复 |
| 代码回滚≠ | 回滚函数包不回滚数据 |

## RPO / RTO 测量口径

| 指标 | 口径 |
| --- | --- |
| 最近可恢复点 | 清点完成时刻（官方回档能力确认前的基线快照）或本轮夹具写入前的隔离快照时刻 |
| 业务可读写且闭包核对完成 | 隔离目标可点读、指定索引/ACL/种子十类/媒体摘要核对完成、支付通知入口仍可接收 |
| RPO | 最近可恢复点 → 演练开始；目标 ≤ 24h，必须以实测确认 |
| RTO | 演练开始 → 闭包核对完成；目标 ≤ 4h，必须以实测确认 |
| 读 P95 | **不是本轮目标** |
| 达不到 | 记 BLOCKED 与套餐局限，不加资源、不自动升级、不开启超额 |
| 官方回档 | 不能「回档到新集合」只能覆盖现库时，官方路径 BLOCKED，改夹具模拟；夹具 RTO 可另报，不得写成官方回档通过 |

## leftover 夹具契约

| 项 | 规则 |
| --- | --- |
| 标记 | 每条演练文档 `fixtureRound="MW27"`、`fixtureMarker="mw27-restore"` |
| `_id` | 确定性 SHA-256：可由 `(round, kind, index)` 再生；业务号仍按原规则：`grantId=H(sourceType,sourceId)`、callback `H(provider,stableEventKey)` |
| 写入 | 单集合 upsert；`$set` / `set()` 载荷不含 `_id` |
| 可写 | 少量 `members` / `identities`、`orders` / `payment_receipts` / `callback_events` / `refunds` / `vip_*` 测试行、`jobs` 测试行；隔离集合 `mw27_rst_*` |
| 回档新集合 | 整集计入 leftover，演练结束必须精确删掉或证明已空 |
| 收口 | 只按再生 `_id` 精确删本轮夹具；独立核查按 `fixtureRound=MW27` 及隔离集合计数，不靠 DELETE 成功数 |
| 禁止 | 空清单或 `wroteDocs=false` 报 leftover=0；把历史账本当夹具删掉；删种子十类 / 非本轮会员 / 非本轮 orders/refunds/vip_* / `audit_logs` / `idempotency` / `ranking_*` / `app_config` / 非本轮 media |

`ranking_heads` / `ranking_rows` / `app_config` 是共享派生或配置，不计入 leftover 删除清单。收口后由 E 重建公开榜，避免半发布。

## 必须由用户手点（E 段）

执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。

E 手点至少覆盖：

1. 控制台确认：未对生产/其它环境回档；若做了回档，目标是新集合而非覆盖现库。
2. 恢复后同一订单查单：状态连续，无第二笔 grant。
3. 重放旧付款通知：`vipGranted` 不再增加时长。
4. 未决退款 / 未决回调仍在，不丢。
5. super `job.resume` 只恢复失败任务；旧 `fencingToken` 不能写。
6. 恢复后重建公开榜：完整快照、无半发布、无 OPENID。
7. 回退手册可执行：知道代码回滚不会带回数据；本轮不真滚坏包。
8. leftover=0：独立计数 0，种子十类 10，回档新集合已空。

第 8 步 leftover=0 须同时跑 `mw27:independent-check` 与 `mw27:verify-leftovers`。空清单不得当 0。

## 不包含的工作

不启动 MW28—MW30。不实现正式售价、生产开放注册、现网支付验收。不创建 mw-prod。不触碰其它 CloudBase 环境。不把 A27 / T07 / T28 标为正式验收通过。不把 MW04 / MW12 标完成。不重写 VIP / 订单 / 退款账本。不重做导入 / 纠错 / 迁类 / 赠送 / 注销。不开启超额。不自动提交、推送或发布。本轮不要真的把函数滚到更旧的损坏包。
