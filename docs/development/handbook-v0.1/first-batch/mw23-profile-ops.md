# MW23 个人中心与反馈运营

开发手册 v0.1｜任务状态：已完成（A—D 接线与 mw-test 核验通过；E 段用户手点与 leftover=0 已闭合。未标 A12 / A25 / A26 / T02 / T14）  
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)｜[结果](results/mw23-result.md)

本任务分多段。只操作 mw-test。没有生产环境、没有真实扣款、没有真实退款、没有 iOS / Apple 现网。`VIRTUAL_PAY_ENV` 保持沙箱，不切现网 AppKey。不开启超额。不启动 MW24—MW30。不把 A01—A31、T01—T30 标通过（尤其未标 A12 / A25 / A26 / T02 / T14，也不回标 A14 / A19 / A20）。不改写 MW01—MW22 与 MW-UI01 的历史完成记录。不重写 `vip_accounts` / `vip_grants` / `orders` / `refunds` 账本。MW21 已付履约与 MW22 真退款现网仍留 MW29，不借本任务补做。不自动提交、推送或发布。E 段手点与 leftover=0 已闭合。不把 A12 / A25 / A26 / T02 / T14 标通过。

## 分段

| 分段 | 名称 | 本对话 |
| --- | --- | --- |
| MW23-A | `@mw/shared` 反馈结构（绑版本、拒外链）、停用/禁榜状态机（分记、原因必填）、`rankingOptIn` 与公开行脱敏、昵称变更同步规则 | 本对话实现 |
| MW23-B | 服务端 `feedback.create` / `list` / `resolve`；`member.list` / `get`（operations，无过度订单/无 OPENID）；`member.disable` / `ranking.ban` 及恢复（super）；停用后写拒绝、`me` 仍可读；公开榜不出现已退出/已停用/未 opt-in/已禁榜 | 本对话实现 |
| MW23-C | 小程序「我的」补齐入口（资料/成长/勋章/历史/订单/VIP/排行开关/客服/反馈/注销占位）；解析或结果页可反馈本版题目；后台会员详情、反馈处理、禁榜（content 看不见订单明细） | 本对话实现 |
| MW23-D | leftover 云脚本、集合、部署与负向核验；不切现网；不真实扣款/退款 | 本对话部署到 mw-test |
| MW23-E | 用户手点与 leftover=0 | 2026-10-19 用户确认手点通过；leftover=0 已核验 |

## 目标与可见结果

1. 整合已有模块做成完整个人中心，不重写权益账本、订单状态机或退款。本人可达：资料、成长、分类分、勋章、历史成绩、订单、VIP 中心、排行开关、客服、题目反馈。
2. 注销入口只接 MW24 占位：可进页、可读说明，不执行注销、不删账号、不退款、不落库 `member.requestDeletion`。
3. `feedback.create` 绑定试卷与题目版本（`paperId` / `questionId` / `versionId`），类型至少覆盖题目错误或解析错误；不接受任意外链抓取；会员不能借反馈改答案库。
4. operations 做 `feedback.list` / `resolve`；content 不得处理反馈、不得看过度订单明细。客服入口与题目反馈是两类问题，不要混成订单售后。
5. `member.disable` 与 `ranking.ban` 分开记录，原因必填，仅 super。停用：禁止新业务写（`updateProfile` / 开新卷 / 下单等），仍可 `member.me` 看自身状态；移出公开榜。禁榜：只影响公开展示，不等于停用账号、不等于退款或改 VIP。恢复同样要原因。
6. 昵称变更后公开展示（榜单行）用新昵称，不含 OPENID / 手机号。`rankingOptIn` 默认 false；关闭后不出现在公开榜，快照不得半发布。
7. 免费卷与 VIP 卷仍统一计入四维榜，没有费用筛选。题库角色无订单明细；运营不能执行退款或改分（退款执行仍是 super，走 MW22，本轮不重做）。
8. `policies.current` 可返回公开客服入口；正式协议文案仍 MW24，本轮可用测试稿。
9. CloudBase 写入不把文档自带 `_id` 再 set 回去；新文档不依赖多集合事务里直接插入。
10. leftover 沿用 MW15 起独立核查：空清单或 `wroteDocs=false` 不得报 leftover=0。只删本轮入册反馈、本轮为手点新建的测试题/卷/答题、本轮停用/禁榜若误伤须可恢复且不删会员账号。永不删种子十类、jobs / 审计 / 幂等、共享 `ranking_*` / `app_config`、历史成绩、会员账号、非本轮 gift / order 账本、MW21 套餐、MW22 非本轮退款。

## 已裁定（本轮不重开）

1. 本轮整合已有模块，不重写 VIP 账本、订单状态机或退款。
2. 注销只占位，接 MW24；不执行注销、不删号、不退款。
3. 反馈必须绑题目版本；拒外链；不能改答案库。
4. 客服与题目反馈两类问题；订单售后仍走订单页。
5. 停用与禁榜分记，原因必填，仅 super；恢复同样要原因。
6. 停用后仍可 `member.me`；禁榜不等于停用、不等于退款或改 VIP。
7. `rankingOptIn` 默认 false；公开行脱敏；昵称变更后公开行用新昵称。
8. 免费卷与 VIP 卷统一计入四维榜，无费用筛选。
9. content 无订单明细、不能 resolve 反馈；operations 不能 disable/ban/退款执行。
10. leftover 独立核查；空清单或 `wroteDocs=false` 不得 leftover=0。E 未闭合前不得报 leftover=0。

## leftover 门禁

| 类别 | 是否计入 leftover | 规则 |
| --- | --- | --- |
| 本轮入册反馈 | 是 | `feedbacks`，按入册哈希精确删 |
| 本轮为手点新建的测试题 / 卷 / 答题 | 是 | 按入册哈希精确删 |
| 本轮停用 / 禁榜误伤 | 否（恢复） | 可恢复且不删会员账号 |
| 种子十类与既有业务数据 | 否 | 永不删除 |
| `jobs` / `audit_logs` / 幂等 | 否（恢复证据） | 不把审计和任务恢复证据一律删除 |
| `ranking_heads` / `ranking_rows` / `app_config` | 否 | 共享聚合 |
| 历史成绩、会员账号、`member_stats` | 否 | 不删账号与既有成长态 |
| 非本轮 gift / order 账本 | 否 | 不删历史赠送与订单 |
| MW21 套餐 | 否 | 不删历史测试套餐以外的已清对象 |
| MW22 非本轮退款 | 否 | 不删非本轮 `refunds` |

空清单或 `wroteDocs=false` 不得报 leftover=0。沿用 MW15 起的独立核查，不能只靠 DELETE 成功计数。

## 必须由用户手点（E 段）

执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。可做授权范围内的部署、只读核验、签名 `jobs.tick`、本地测试。

手点清单见结果文件。至少覆盖：我的页上述入口都可达且不露 OPENID；未 opt-in 不在公开榜，开启后可上榜（无费用筛选）；改昵称后公开行更新；content 打不开订单明细、不能 resolve 反馈；operations 可处理反馈、不能 disable/ban/退款执行；super 停用后该会员不能改资料/开新卷，仍能看 me，公开榜消失；禁榜不等于停用；恢复后可写；反馈必须带题目版本，不能改答案库；注销入口只占位不删号；收口只入册本轮反馈与本轮测试对象。

## 不包含的工作

不启动 MW24—MW30。不实现账号注销落库、不实现 `metrics.summary` 运营大盘、不实现备份演练。不把 A12 / A25 / A26 / T02 / T14 标为正式验收通过。MW21 已付履约与 MW22 真退款现网仍留 MW29。不自动提交、推送或发布。
