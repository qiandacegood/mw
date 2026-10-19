# MW25 后台运营统计与使用说明

开发手册 v0.1｜任务状态：已完成（A—D 已接线并核验；E 段用户手点 1–8 全过，leftover=0 已核验。未标 A21 / A23 / A25 / A27。MW12 仍部分完成）  
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)｜[结果](results/mw25-result.md)

本任务分多段。只操作 mw-test。没有生产环境、没有真实扣款、没有真实退款、没有 iOS / Apple 现网。`VIRTUAL_PAY_ENV` 保持沙箱，不切现网 AppKey。不开启超额。不启动 MW26—MW30。不实现安全容量专项、备份演练、正式售价、生产开放注册。不把 A01—A31、T01—T30 标通过（尤其未标 A21 / A23 / A25 / A27，也不回标 A14 / A19 / A20 / A12）。不改写 MW01—MW24 与 MW-UI01 的历史完成记录。不把 MW12 从部分完成改成已完成。本轮做真实口径的基础统计 + 逐步操作教程入口，不重写 VIP / 订单 / 退款账本，不重做导入 / 纠错 / 迁类 / 赠送实现。不自动提交、推送或发布。E 段手点与 leftover=0 已闭合。

## 分段

| 分段 | 名称 | 本对话 |
| --- | --- | --- |
| MW25-A | `@mw/shared` 统计口径（含重复练习计入、流水≠利润）、角色可见字段、教程步骤契约（每步对应真实 action，禁止占位） | 本对话实现 |
| MW25-B | 服务端 `ops.stats` / 异常摘要（只读聚合）；教程只返回可执行步骤与已有 action 名称；金额与订单明细不对 content 暴露 | 本对话实现 |
| MW25-C | 后台 admin-ops：基础统计、口径说明、异常入口、逐步教程（导入→上架→纠错→迁类→赠送→订单核对→退款），点进去走现有页 / 现有命令 | 本对话实现 |
| MW25-D | leftover 云脚本、mw-test 部署与负向核验；content 看不到收款明细；operations 不能执行退款 / 改分 | 本对话部署到 mw-test |
| MW25-E | 用户手点与 leftover=0 | 已闭合（手点 1–8 全过；第 8 步未写夹具；leftover=0 已核验） |

## 目标与可见结果

1. 后台 `admin-ops` 展示真实口径的基础统计，界面写清：注册会员数；当日及累计完成记录数；独立答题人数；每卷完成次数和平均得分（平均分按全部有效已交卷记录；注明重复练习计入次数）；有效 VIP 数（与 MW20 账本同一判权：`now < expiresAt`）；付款订单数、已确认收款金额、退款金额、异常开通订单数；流水不当利润。金额用分、时间用 ISO。
2. operations 可看统计与教程。content 仍无订单明细 / 收款金额。退款执行与改分仍仅 super。A25 不在本轮标通过。
3. 异常处理入口接到已有能力（对账差异、异常开通、待处理退款、开放反馈），不另造一套假工单。
4. 逐步教程走现有 `import.*` / 上架 / `correction.*` / `category.change.*` / `vip.grant` / 订单核对 / `refund.*`，不能用假按钮或未实现命令代替。MW12 仍是部分完成，不借本轮标完成。
5. CloudBase 写入不把文档自带 `_id` 再 set 回去。聚合快照若落库须确定性 `_id` + 版本，不能当 leftover 去删 `members` / `orders` / `refunds` / `vip_*` / 审计。
6. leftover 沿用 MW15 起独立核查：空清单或 `wroteDocs=false` 不得报 leftover=0。只删本轮为核验新建的统计快照（若有）或教程夹具文档。

## 已裁定（本轮不重开）

1. 本轮做真实口径的基础统计 + 逐步操作教程入口，不重写 VIP / 订单 / 退款账本，不重做导入 / 纠错 / 迁类 / 赠送实现。
2. MW12 仍是部分完成：教程应走现有命令，不能用假按钮或未实现命令代替，也不借本轮把 MW12 标完成。
3. 统计口径必须与产品第 15 节一致；流水不当利润；金额用分、时间用 ISO。
4. 有效 VIP 与 MW20 账本同一判权：`now < expiresAt`。
5. operations 可看统计与教程；content 仍无订单明细 / 收款金额；退款执行与改分仍仅 super。
6. 异常入口接到已有能力，不另造假工单。
7. leftover 独立核查已闭合：用户未写夹具，空清单入册后 leftover=0。
8. 执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。

## 统计口径

| 指标 | 口径 |
| --- | --- |
| 注册会员数 | `members` 中 `status` 为 `active` / `disabled` / `deleting` 的文档数；不含 `deleted` |
| 当日完成记录数 | `attempts.state=submitted` 且 `submittedAt` 落在北京时间当日（`dayKeyShanghai`） |
| 累计完成记录数 | 全部有效已交卷记录（`state=submitted` 且 `score` 为整数） |
| 独立答题人数 | 上述有效已交卷记录的去重 `memberId` 数 |
| 每卷完成次数 | 该卷有效已交卷记录条数；**同一会员重复练习计入次数** |
| 每卷平均得分 | 该卷全部有效已交卷记录得分的算术平均；不是最高分平均 |
| 有效 VIP 数 | `vip_accounts` 中 `now < expiresAt`（与 `isVipActive` 同一判权） |
| 付款订单数 | `orders.payState=paid` |
| 已确认收款金额 | 付款订单 `amountFen` 合计（分） |
| 退款金额 | `refunds.state=succeeded` 的 `confirmedFen` 合计；未确认不计入 |
| 异常开通订单数 | `payState=paid` 且 `grantState` 为 `error` / `pending` / `processing` |
| 流水 ≠ 利润 | 已确认收款是流水，不是净利润；界面与响应都不得把流水标成利润 |

金额一律用分。时间一律 ISO。当日窗口按北京时间，与周 / 月榜同一偏移。

## 角色可见字段

| 角色 | `ops.stats` / `ops.exceptions` | `ops.tutorial` | 订单金额 / 明细 | 退款执行 / 改分 |
| --- | --- | --- | --- | --- |
| content | `FORBIDDEN`（`CONTENT_STATS_DENIED`） | 可读步骤，不含金额 | 仍无 | 无 |
| operations | 可读完整统计与异常摘要 | 可读 | 可读统计合计，仍走现有 `order.*` | 无（`refund.execute` / `correction.*` 仍拒） |
| super | 同 operations | 同 operations | 同 operations | 仅 super |

content 即使误入 admin-ops，服务端也不返回收款金额或订单明细。A25 本轮不标通过。

## 教程步骤契约

每步必须对应已存在的 action 与已存在的后台页。禁止占位按钮、禁止未实现命令。

| 步骤 | 标题 | 真实 action | 打开页面 | 最低执行角色 |
| --- | --- | --- | --- | --- |
| 1 | 导入题库 / 试卷 | `import.validate` / `import.preview` / `import.commit` / `import.status` | `admin-import-questions` / `admin-import-papers` / `admin-import` | content |
| 2 | 上架试卷 | `paper.publish` | `admin-papers` | content |
| 3 | 题目纠错 | `correction.preview` / `correction.commit` / `correction.status` | `admin-papers` | super |
| 4 | 类目迁移 | `category.change.preview` / `category.change.commit` / `category.change.status` | `admin-categories` | super |
| 5 | 人工赠送 VIP | `vip.grant` | `admin-vip` | super |
| 6 | 订单核对 | `order.list` / `order.get` / `order.reconcile` | `admin-orders` | operations |
| 7 | 退款审核 / 执行 | `refund.review` / `refund.execute` | `admin-refunds` | review=operations；execute=super |

教程只返回上述步骤与 action 名称。operations 可看全部步骤并跳到现有页；执行权仍按原角色。MW12 仍部分完成，教程不得假装导入已验收通过。

## 异常入口（接到已有能力）

| 入口 | 摘要来源 | 打开 |
| --- | --- | --- |
| 对账差异 | `reconcile_diffs` 中 `status=open` | `admin-orders` + `order.reconcile` |
| 异常开通 | 付款未开通 / `grantState=error` | `admin-orders` |
| 待处理退款 | `refunds.state` 为 `requested` / `reviewed` / `processing` | `admin-refunds` |
| 开放反馈 | `feedbacks.status=open` | 本页既有 `feedback.list` |

不另建工单集合，不造假按钮。

## leftover 门禁

| 类别 | 是否计入 leftover | 规则 |
| --- | --- | --- |
| 本轮为核验新建的统计快照 | 是（若有） | `ops_stats_snapshots`，确定性 `_id`，按入册哈希精确删 |
| 本轮教程夹具文档 | 是（若有） | 仅本轮新建夹具 |
| 种子十类与既有业务数据 | 否 | 永不删除 |
| `jobs` / `audit_logs` / 幂等 | 否 | 不把审计和任务恢复证据一律删除 |
| `ranking_heads` / `ranking_rows` / `app_config` | 否 | 共享聚合 |
| 历史成绩、非本轮会员 | 否 | 不删 |
| gift / order 账本、套餐、退款证据、`payment_receipts`、`vip_*` | 否 | 永不整单当 leftover 删掉 |

空清单或 `wroteDocs=false` 不得报 leftover=0。沿用 MW15 起的独立核查，不能只靠 DELETE 成功计数。本轮默认不落库日常快照；若核验写入快照，必须确定性 `_id` + `schemaVersion`，写入载荷不含 `_id`。

## 必须由用户手点（E 段）

执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。可做授权范围内的部署、只读核验、签名 `jobs.tick`、本地测试。

E 手点至少覆盖：

1. 统计数字有口径说明，且「重复练习计入次数」写在界面上。
2. 流水未当利润。
3. content 看不到订单金额。
4. operations 能看统计但不能退款 / 改分。
5. 教程每步能打开真实功能而不是假按钮。
6. 导入 / 上架 / 纠错 / 迁类 / 赠送 / 订单核对 / 退款入口可达（用测试数据，不真付）。
7. 异常开通 / 对账 / 反馈入口可达。
8. 收口不删审计 / 订单 / 退款 / 非本轮会员。

## 不包含的工作

不启动 MW26—MW30。不实现安全容量专项、备份演练、正式售价、生产开放注册。不把 A21 / A23 / A25 / A27 标为正式验收通过。不把 MW12 标完成。不重写 VIP / 订单 / 退款账本。MW21 已付履约与 MW22 真退款现网仍留 MW29。不自动提交、推送或发布。
