# MW21 VIP 套餐与在线购买

开发手册 v0.1｜任务状态：已完成（A—D 已实现并核验；E 段 1–7 已手点、入册对象已清。已付履约 8–10 与现网路径明确留到 MW29。未标 A14 / A15 / A16 / A17 / A20 / T20 / T21 / T22 / T26）  
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)｜[结果](results/mw21-result.md)

本任务分多段。只操作 mw-test。没有生产环境、没有真实扣款、没有 iOS / Apple 现网付款。`VIRTUAL_PAY_ENV` 保持沙箱，不切现网 AppKey。不开启超额。不创建 `refunds`，不实现 `refund.*` / 对账日账。不启动 MW22—MW30。不把 A01—A31、T01—T30 标通过（尤其未标 A14 / A15 / A16 / A17 / A20 / T20 / T21 / T22 / T26，也不回标 A02 / A09 / A18 / T25）。不改写 MW01—MW20 与 MW-UI01 的历史完成记录。已付现网路径留到 MW29，不把未做真付标成验收通过。

## 分段

| 分段 | 名称 | 本对话 |
| --- | --- | --- |
| MW21-A | `@mw/shared` 套餐版本、订单冻结快照、支付会话校验、通知/查单状态机、order 来源发放接到现有账本 | 本对话实现 |
| MW21-B | 服务端 `vip.plans` / `order.create` / `payment.prepare` / `order.get` / `list` / `refresh` / `close`；`mw-pay-hook` 验签后按已付发放 | 本对话实现 |
| MW21-C | 后台套餐发布（super）；小程序 VIP 中心 / 下单 / 收银台参数 / 订单列表（沿用 MW-UI01 / MW02） | 本对话实现 |
| MW21-D | leftover 云脚本、集合、部署与负向核验；沙箱 `env=1` | 本对话部署到 mw-test |
| MW21-E | 用户手点与 leftover=0 | 1–7 已闭合；8–10 已付路径明确留到 MW29 |

## 目标与可见结果

1. 接通套餐、下单、收银台参数、通知/查单履约。发放必须写入 MW20 同一账本。来源标 `order`，一订单一 `vip_grant`，`_id = H(sourceType, sourceId)`，`sourceId` 为订单业务号。不得冒充 `gift`，不得后台直接改 `expiresAt`。
2. 有效期仍按 MW20 基线：未开通或已到期 `expiresAt = grantedAt + durationSeconds`；仍有效 `expiresAt = max(currentExpiresAt, grantedAt) + durationSeconds`。1 天 = 86400 秒。恰好到期无效（`now < expiresAt`）。发放从实际开通时刻起算。并发不同订单必须串行同一 `vip_accounts`，不得互相覆盖。
3. 客户端「支付成功」不得作为履约依据。只根据校验通过的平台通知或查单真实已付发放；重复通知/重复查单只履约一次。已付未开通可按同一订单补偿，不能重复延长。取消/超时/关单前必须先查原单；已支付不得关闭。
4. 服务端锁定套餐版本、价格（人民币分）、天数、渠道、environment；不信任客户端价格、env、商品。`quantity=1`。开发只用标注测试价的测试商品，不发布正式售价。初始套餐 30 / 90 / 365 天。改价改天必须新 `planVersion`，旧订单按冻结快照履约。
5. `vip.plans` 只返回当前渠道可售套餐与能力提示；设备声明不能授予权限。`payment.prepare` 用 `wxLoginCode` 在服务端换会话并核对 openId 与云身份一致，不返回 `session_key`。AppID / OfferID / 金额 / 商品 / 环境只由服务端配置绑定。测试环境不得被客户端选成现网。
6. `mw-pay-hook` 验签失败直接拒绝，不建单、不发放。金额/用户/商品不匹配进 `needsReview`。沿用 MW07-B 签名、环境门禁、查单与通知验签，不改走普通微信支付 APIv3。
7. 成长分、等级、勋章不因购买而变。过期后新开 VIP 卷仍 `VIP_REQUIRED`；已有草稿与历史解析仍可查。
8. `entitlementApply` / `purchaseCreate` 维护门独立，不得用总开关误挡交卷或支付通知。
9. CloudBase 写入不把文档自带 `_id` 再 set 回去；新文档不依赖多集合事务里直接插入。
10. leftover 沿用 MW15 起独立核查：空清单或 `wroteDocs=false` 不得报 leftover=0。只删本轮入册的测试套餐/订单/回执/本轮付款来源账本、本轮测试卷/题/答题；永不删种子十类、jobs / 审计 / 幂等、共享 `ranking_*` / `app_config`、历史成绩、会员账号、MW20 非本轮 gift 账本。

## 已裁定（本轮不重开）

1. 发放写入 MW20 同一账本，来源 `order`，一订单一 grant。
2. 有效期秒加算；恰好到期无效；并发串行同一账户。
3. 客户端成功不作履约依据；只信校验通过的通知或查单。
4. 服务端冻结价格/天数/渠道/环境；quantity=1；测试价非正式售价。
5. `payment.prepare` 服务端换会话，不返回 session_key。
6. 沿用 MW07-B 虚拟支付协议，不改 APIv3。
7. 购买不加分；`purchaseCreate` 与 `entitlementApply` 独立。
8. Apple 现网路径明确记到 MW29；本轮沙箱 `env=1`。
9. 不实现退款、不创建 `refunds`。
10. leftover 独立核查；E 未闭合不得 leftover=0、不得标完成。

## leftover 门禁

| 类别 | 是否计入 leftover | 规则 |
| --- | --- | --- |
| 本轮入册测试套餐 / 订单 / 回执 / 回调事件 | 是 | `vip_plans` / `orders` / `payment_receipts` / `callback_events`，按入册哈希精确删 |
| 本轮付款来源账本 | 是 | `vip_grants` `sourceType=order` 及对应 `vip_events` / 本轮账户摘要；不删 gift |
| 本轮 VIP 测试卷 / 题 / 答题 | 是 | 按入册哈希精确删 |
| 种子十类与既有业务数据 | 否 | 永不删除 |
| `jobs` / `audit_logs` / 幂等 | 否（恢复证据） | 不把审计和任务恢复证据一律删除 |
| `ranking_heads` / `ranking_rows` / `app_config` | 否 | 共享聚合 |
| 历史成绩、会员账号、`member_stats` | 否 | 不删账号与既有成长态 |
| MW20 非本轮 gift 账本 | 否 | 不删历史赠送 |
| `refunds` | 禁止出现 | 本轮不得创建 |

空清单或 `wroteDocs=false` 不得报 leftover=0。沿用 MW15 起的独立核查，不能只靠 DELETE 成功计数。

## 必须由用户手点（E 段）

执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。可做授权范围内的部署、只读核验、签名 `jobs.tick`、本地测试、沙箱查单（未知单/本轮测试单）。

手点清单见结果文件。至少覆盖：content 不能发布套餐；super 发布测试套餐（30/90/365，测试价）；`vip.plans` 只见可售；下单冻结服务端价格；客户端改价不能便宜买；伪造成功不发放；取消/超时先查原单再关；重复通知只发一次；两笔已付订单并发续期不覆盖；已付未开通可同单补偿不重复延长；购买不加分；订单列表本人可见；收口只入册本轮对象。

## 不包含的工作

不启动 MW22—MW30。不实现退款审核、运营统计、备份演练、正式售价上架。不把 A14 / A15 / A16 / A17 / A20 / T20 / T21 / T22 / T26 标为正式验收通过。Apple 现网与 iOS 真机付款留到 MW29。不自动提交、推送或发布。
