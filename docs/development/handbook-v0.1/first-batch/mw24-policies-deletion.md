# MW24 正式协议与账号注销

开发手册 v0.1｜任务状态：已完成（A—D 已接线并核验；E 段用户手点 1–12 与 leftover=0 已闭合。未标 A01 / A12 / A26 / T01 / T14）  
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)｜[结果](results/mw24-result.md)

本任务分多段。只操作 mw-test。没有生产环境、没有真实扣款、没有真实退款、没有 iOS / Apple 现网。`VIRTUAL_PAY_ENV` 保持沙箱，不切现网 AppKey。不开启超额。不启动 MW25—MW30。不实现运营统计大盘、备份演练、正式售价、生产开放注册。不把 A01—A31、T01—T30 标通过（尤其未标 A01 / A12 / A26 / T01 / T14，也不回标 A14 / A19 / A20 / A25）。不改写 MW01—MW23 与 MW-UI01 的历史完成记录。本轮接入协议版本与账号注销，不重写 VIP / 订单 / 退款账本。不自动提交、推送或发布。E 段手点与 leftover=0 已闭合。

## 分段

| 分段 | 名称 | 本对话 |
| --- | --- | --- |
| MW24-A | `@mw/shared` 协议版本同意、注销状态机、待处理订单门禁、资料最小保留、反馈关联处置、公开榜退出（不半发布） | 本对话实现 |
| MW24-B | 服务端 `policies.current`（版本+测试稿文本）；`register` 仍校验当前版本；`member.requestDeletion` / 查询注销状态；未完成订单拒绝直接删号；审计；已注销写拒绝、`me` 可见终态不含 OPENID | 本对话实现 |
| MW24-C | 注册页展示当前协议/隐私、禁止预勾选；「我的」协议入口与注销页从占位改为真流程；后台必要时只读注销状态（content 仍无订单明细） | 本对话实现 |
| MW24-D | leftover 云脚本、mw-test 部署与负向核验；不删交易证据集合 | 本对话部署到 mw-test |
| MW24-E | 用户手点与 leftover=0 | 用户确认 1–12 全过；leftover=0 已核验 |

## 目标与可见结果

1. `app_config.policies` 仍是唯一协议文档：`agreementVersion` / `privacyVersion`，以及可见测试稿文本。负责人未确认正式文案，本轮用测试稿，必须带版本号。不开放生产真实注册/收款。
2. `member.register` 必须主动勾选当前版本；禁止预勾选。版本缺失或不匹配 `INVALID_ARGUMENT`。旧版本同意不能当新版本。
3. `member.requestDeletion` 必须重新认证（`reauthProof.kind=wx_login_code`，服务端 `code2Session` 核对 openId 与 FROM 身份一致）并确认 `acknowledgementVersion` 等于当前协议版本。
4. 涉及未完成订单（待支付、确认中、已支付未关闭、退款处理中等）返回需处理事项，不得直接删号。支付记录、退款与交易证据按最小必要保留，不承诺立即删除全部交易记录，不得假定 `refunds` / `orders` / `payment_receipts` / `vip_grants(order)` 可整单当 leftover 删掉。
5. 注销成功路径：账号退出公开榜（`rankingOptIn=false` + 公开行二次核对立即不可见，不改写半代 `ranking_heads`）；status 走 `deleting` → `deleted`（本轮同一事务落到终态 `deleted`，中间态不对外半发布）；展示资料删除或最小保留（昵称/头像脱敏）；反馈关联处置（标记已注销，不把反馈当答案库）；写审计。
6. 停用（MW23 `disable`）≠ 注销。禁榜 ≠ 注销。已注销禁止新业务写；本人/客服可按隐私口径查必要订单；响应不含 OPENID。
7. 同一身份注销后不得用同一 FROM 再 `register` 出第二个有效会员。本轮默认：已 `deleted` 的身份再注册拒绝（`ACCOUNT_DELETED`），不 silently 新建，也不做自动复活。
8. CloudBase 写入不把文档自带 `_id` 再 set 回去；新文档不依赖多集合事务里直接插入。
9. leftover 沿用 MW15 起独立核查：空清单或 `wroteDocs=false` 不得报 leftover=0。

## 已裁定（本轮不重开）

1. 本轮接入协议版本与账号注销，不重写 VIP / 订单 / 退款账本。
2. policies 仍放 `app_config.policies`。测试稿必须带版本号。注册仍须主动勾选当前版本，禁止预勾选。
3. 注销必须重新认证 + 当前协议版本确认。
4. 未完成订单列出待办，不得直接删号。交易证据最小必要保留。
5. 公开榜退出立即不可见，快照不得半发布。
6. 停用 ≠ 注销。禁榜 ≠ 注销。
7. 已 `deleted` 身份再注册：拒绝。明确复活规则如下，本轮不实现复活入口。
8. leftover 独立核查；E 未闭合前不得 leftover=0。
9. 执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。

## 复活规则（写明，本轮不实现）

- **本轮默认**：`members.status=deleted` 的同一 `identities` 再走 `member.register` → `ACCOUNT_DELETED`。不新建第二个内部号，不把旧号悄悄改回 `active`。
- **若未来允许重新注册**：必须是新内部号，且旧交易证据（`orders` / `refunds` / `payment_receipts` / `vip_grants(order)`）仍挂旧号；不得把旧证据迁到新号。
- **若未来允许复活**：必须是明确的 super 动作（原因必填），复用同一内部号，不得 silently 在 `register` 里复活。
- 本轮两者都不做。

## 协议测试稿

| 字段 | 本轮值 |
| --- | --- |
| `agreementVersion` | `mw24-test-agreement-v1` |
| `privacyVersion` | `mw24-test-privacy-v1` |
| 标题 | 用户协议（测试稿）/ 隐私政策（测试稿） |
| 文本 | 可见测试稿正文，文首带版本号；非正式运营条款 |
| `placeholder` | `true` |
| 客服 | 测试稿入口；正式方式仍待负责人确认 |

MW08 的 `mw08-test-agreement-v1` / `mw08-test-privacy-v1` 不再是当前有效版本。用旧版本注册 = `POLICY_VERSION_MISMATCH`。已有会员的历史 `consentVersions` 保留，不强制重签；新注册必须勾选当前稿。

## 注销状态机与门禁

| 当前 status | 可做 | 不可做 |
| --- | --- | --- |
| `active` | 正常业务；可申请注销 | — |
| `disabled` | `member.me`；查询必要订单 | 新业务写；申请注销前须先理解停用≠注销（停用账号走 disable，不是本页删号） |
| `deleting` | 本人查注销状态与必要订单 | 新业务写；再 register |
| `deleted` | 本人 `me` 可见终态（脱敏资料，无 OPENID）；必要订单按隐私口径可查 | 新业务写；再 register 出第二号；disable 恢复；上公开榜 |

未完成订单（任一即阻断，返回 `pendingItems`，status 不变）：

- `payState=pending`（待支付）
- `payState=confirming`（确认中）
- `payState=paid` 且发放未完成（`grantState` 为 pending / processing / error）
- `refundState` 为 requested / processing（退款处理中）

不阻断、必须保留的证据：已完成付款发放、已关闭未付、退款终态（succeeded / failed）、`payment_receipts`、`vip_grants(order)`。

停用账号若走注销页：与 active 一样检查订单与重新认证；成功则进入 `deleted`，不再停留在 `disabled`。停用本身不是注销。

## leftover 门禁

| 类别 | 是否计入 leftover | 规则 |
| --- | --- | --- |
| 本轮入册反馈 | 是 | `feedbacks`，按入册哈希精确删 |
| 本轮为手点新建的测试会员 | 是（任务书允许） | 优先恢复；若用户入册本轮新建号，cleanup 才物理删该号的 `identities` / `members` / `member_stats` / 注册勋章。不删其订单/退款/receipts/vip_grants |
| 本轮测试协议版本若单独成文档 | 是 | 本轮不另建文档，只更新 `app_config.policies` |
| `app_config.policies` | 否 | 共享生产键，更新后保留 MW24 测试稿，不删、不回滚到空 |
| 种子十类与既有业务数据 | 否 | 永不删除 |
| `jobs` / `audit_logs` / 幂等 | 否 | 不把审计和任务恢复证据一律删除 |
| `ranking_heads` / `ranking_rows` | 否 | 共享聚合 |
| 历史成绩、非本轮会员 | 否 | 不删 |
| gift / order 账本、套餐、退款证据、`payment_receipts`、`vip_grants(order)` | 否 | 永不整单当 leftover 删掉 |

空清单或 `wroteDocs=false` 不得报 leftover=0。沿用 MW15 起的独立核查，不能只靠 DELETE 成功计数。

## 必须由用户手点（E 段）

执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。可做授权范围内的部署、只读核验、签名 `jobs.tick`、本地测试。

E 手点至少覆盖：

1. 未勾选不能注册。
2. 勾选当前测试稿版本可注册。
3. 旧版本同意不能当新版本。
4. 注销缺重新认证拒绝。
5. 有待支付/处理中订单列出待办不得删号。
6. 无阻塞订单时注销成功，公开榜立即不可见且快照不半发布。
7. 资料脱敏或最小保留。
8. 订单/退款记录仍可按隐私口径保留查询。
9. 反馈不指向可改答案库。
10. 同一微信身份不能再开第二个有效号。
11. 停用账号走 disable 不是注销。
12. 收口不删审计/订单/退款/非本轮会员。

## 不包含的工作

不启动 MW25—MW30。不实现运营统计大盘、备份演练、正式售价、生产开放注册。不把 A01 / A12 / A26 / T01 / T14 标为正式验收通过。MW21 已付履约与 MW22 真退款现网仍留 MW29。不自动提交、推送或发布。
