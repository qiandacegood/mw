# 思维工坊接口契约 V1.0

日期：2026年10月3日  
依据：[产品 V1.1](../product/product-spec-v1.1.md)和[技术架构](../architecture/technical-design-v1.0.md)。本文件定义业务协议；CloudBase SDK 的平台信封由适配器处理。

## 1 调用约定

小程序使用 wx.cloud.callFunction 调用 mw-public 或 mw-member，后台用 CloudBase Web SDK 调用 mw-admin。业务请求统一包含：

```json
{
  "apiVersion": "1",
  "action": "attempt.submit",
  "requestId": "客户端生成的本次调用标识",
  "idempotencyKey": "同一业务操作重放时保持不变",
  "data": {
    "attemptId": "服务端生成的标识",
    "expectedRevision": 7,
    "answers": [
      {"questionId": "题目稳定标识", "optionIds": ["A", "C"]}
    ],
    "confirmUnanswered": false
  }
}
```

requestId 用于诊断，不能作为身份。写操作必须提供 idempotencyKey；创建后重试不得换键。服务端拒绝未知字段、错误枚举、超长字符串和客户端伪造 userId、分数、角色、有效期。读取参数使用白名单，不能接受任意数据库查询表达式。

成功与错误格式：

```json
{"ok":true,"requestId":"...","serverTime":"2026-10-03T02:00:00.000Z","data":{}}
```

```json
{"ok":false,"requestId":"...","error":{"code":"VIP_REQUIRED","message":"本试卷需要有效 VIP","retryable":false,"details":{}}}
```

结果未知不盲信 retryable：先查询原资源，再决定重放相同业务操作。外部支付通知与上传接口使用第 7 节独立 HTTP 协议，不套此信封。

列表默认 limit=20、最大 100，使用不透明 cursor；服务端游标绑定过滤条件、排序和快照 generation 并校验完整性。修改过滤条件须重新分页，不能把任意前端 offset 用于大表深分页。

## 2 公开只读接口

| action | 请求字段 | 主要响应 |
| --- | --- | --- |
| home.get | 无 | 动态根类目、推荐及新卷摘要、公开配置版本 |
| category.tree | 可选 knownVersion | treeVersion、节点 id/parentId/depth/name/sort、可用状态 |
| paper.list | categoryId?、includeDescendants 默认 true、difficulty?（beginner / intermediate / challenge）、access?（free / vip）、sort、cursor、limit | 卷摘要与下一游标；access 仅此处用于选卷 |
| paper.detail | paperId | 标题、简介、目标、权限、题数、满分、难度、建议时长、路径，不含题目答案 |
| ranking.list | scope、categoryId?、cursor、limit | generation、采样时间、rank、昵称、内置头像、等级、value |
| policies.current | 无 | 协议及隐私文本版本、公开客服入口 |

ranking.scope 为 total、category、week、month；category 时必须传有效类目，其他 scope 禁止传 categoryId。周期键由服务端计算，首版不接受历史周期。禁止 access、freeOnly 等排行费用筛选参数，传入即 INVALID_ARGUMENT。

公开接口返回固定白名单，匿名访问不意味着可以查询会员表。disabled/deleted 类目及其后代不出现在可选树；请求停用类目返回 CATEGORY_UNAVAILABLE。

## 3 会员接口

| action | 关键输入 | 响应与权限 |
| --- | --- | --- |
| member.register | agreementVersion、privacyVersion、accepted=true | 当前可信微信身份的 memberId；版本过期要求重新阅读。身份只来自 FROM_APPID/FROM_OPENID。 |
| member.me | 无 | 本人资料、总分、等级、VIP 状态、当前草稿摘要。停用账号仍可查看自身状态。响应不含 OPENID。 |
| member.updateProfile | nickname?、avatarKey?、expectedRevision | 经校验的新资料及 revision。只接受白名单字段和内置头像。停用后拒绝。 |
| member.setRanking | enabled、expectedRevision | 参与状态及榜单待刷新提示 |
| member.categoryScores | categoryId? | 当前结构版本、节点 `directScore`（仅直接挂卷）及 `inclusiveScore`（含后代去重），必须分别命名 |
| member.medals | cursor、limit | 本人授予与特殊撤销记录 |
| member.requestDeletion | reauthProof、acknowledgementVersion | 注销处理状态，涉及未完成订单时返回需处理事项 |
| attempt.start | paperId、expectedPaperVersion? | attemptId、paperVersion、revision、题面块清单 |
| attempt.startReplacing | paperId、abandonAttemptId、expectedRevision、confirmed=true | 原草稿明确放弃后新记录 |
| attempt.get | attemptId | 本人记录、已保存答案、状态及 revision |
| attempt.questionPage | attemptId、chunkNo | 已授权题面块，不含答案解析 |
| attempt.save | attemptId、expectedRevision、answers | 新 revision、savedAt |
| attempt.abandon | attemptId、expectedRevision、confirmed=true | abandoned；重复请求返回原结果 |
| attempt.submit | 见第 1 节 | 结果快照及本次新增分 |
| attempt.result | attemptId | 本人完成结果；处理中返回明确状态 |
| attempt.analysis | attemptId、chunkNo、wrongOnly? | 已完成记录的 `selectedOptionIds`（本人选择）、`correctOptionIds`（正确答案）、逐题分及解析 |
| attempt.history | paperId?、cursor、limit | 本人已提交记录 |
| ranking.me | scope、categoryId? | 同 generation 的本人名次、value、前一不同名次分差 |
| feedback.create | type、paperId?、questionId?、versionId?、text | 反馈标识，不接受任意外链抓取 |

`member.register` 必须主动同意当前 `app_config.policies` 中的协议与隐私版本；缺同意、版本缺失或不匹配一律 `INVALID_ARGUMENT`。同一可信身份并发或重试只产生一个 `identities` / `members` / `member_stats` 文档。默认昵称为系统生成的「思维学员」加内部标识后缀，默认头像为 `avatar.builtin.01`；不抓取微信头像或昵称，不强制手机号。

`member.updateProfile` 只允许 `nickname`、`avatarKey`、`expectedRevision`。昵称 2—16 字，仅汉字、字母、数字和间隔号，禁止空白、URL、保留名。头像只能是 `avatar.builtin.01`—`avatar.builtin.12`。微信内容安全 / msgSecCheck 在 MW08 **未真实验证**（`NOT_RUN`），因此不开放任意昵称。写请求体上限 4096 字节。客户端提交的 `memberId` / `role` / `score` / `openid` 视为伪造身份。

`member.me` 的 VIP 与草稿字段在 MW08 只返回占位：`vip.active=false`、`draft.attemptId=null`。正式 VIP 账本是 MW20，草稿是 MW14。

attempt.save 的 answers 是当前完整已选答案集，最多 100 项；未出现的题号视为未答，不采用“猜测客户端补丁”的合并方式。自动保存请求串行发送，冲突由用户确认取服务端还是当前页面版本，再显式重发。

submit 成功响应至少包含 attemptId、score、maxScore、correctCount、questionCount、bestScore、delta、totalScore、levelId、gradeRevision、submittedAt。返回结果中的总分为本次结算时快照；重新打开个人页可读取最新总分。

多个版本中相同 questionId 仍以 attempt 绑定的试卷题目版本解释。题号、选项标识和分值全部由服务端快照确定，客户端只提交选择。

## 4 VIP 与订单接口

| action | 关键输入 | 主要响应 |
| --- | --- | --- |
| vip.status | 无 | active、expiresAt、reconcileState |
| vip.plans | deviceInfo | 可售套餐、天数、当前渠道价格及能力提示；设备声明不能授予权限 |
| order.create | planId、planVersion、clientChannel | 订单标识、冻结金额及权益、状态、支付截止时间 |
| payment.prepare | orderId、wxLoginCode | 服务端校验身份后的官方支付参数，不返回 session_key |
| order.get | orderId | 本人付款、发放、退款三个状态和可用操作 |
| order.list | cursor、limit | 本人订单摘要 |
| order.refresh | orderId | 限流查单，更新真实状态，结果未知仍显示确认中 |
| order.close | orderId、confirmed=true | 同订单查单后尝试关单，不能关闭已支付订单 |
| refund.request | orderId、reason | 商户渠道的申请；Apple 渠道返回正确申请指引 |

客户端不能上传“付款成功”作为履约依据。payment.prepare 的 wxLoginCode 在服务端换取短期会话并核对 openId 与云调用身份一致。AppID、OfferID、金额、商品及环境由服务端配置绑定。

refund.request 不直接承诺退款资格，不自动扣 VIP。重复请求关联原申请。平台最终退款通知可以早于用户在本系统申请，仍必须识别和处理。

## 5 后台接口

所有 action 先查 admin_users。content、operations、super 分别表示题库、运营和超级管理员；super 可执行其他角色功能。

| action 组 | 最低权限 | 内容 |
| --- | --- | --- |
| admin.me | 已启用后台账号 | 当前角色与可用操作 |
| category.create / update | content | 新增、改名、排序；parentId 改动必须走预览 |
| category.change.preview / commit | super | 移动子树、停用启用、迁题迁卷和逻辑删除；绑定 planHash |
| question.list / get / save / disable | content | 题库管理；save 带 expectedRevision |
| paper.list / get / save / preview | content | 草稿及整卷预览 |
| paper.publish / unpublish / withdraw | content | 发布、下架、紧急撤回，必须 reason 和预期版本 |
| correction.preview / commit | super | 错误答案影响与重评任务 |
| upload.authorize / upload.status | content | 一次性上传票据，图片或导入文件用途明确 |
| import.validate / preview / commit / status | content | 批次校验、确认及查询；不能绕过 batch visibility |
| member.list / get | operations | 必要会员资料、成绩与有关订单 |
| member.disable / ranking.ban | super | 原因必填，禁榜与账号停用分别记录 |
| vip.grant / revokeGift | super | 来源可追溯，不能删除付费权益 |
| order.list / get / reconcile | operations | 订单查询与同订单核对，不修改金额 |
| refund.review | operations | 审核建议，不能发起渠道退款 |
| refund.execute | super | 绑定申请和金额，渠道支持时执行 |
| plan.save / publish / disable | super | 商品校验及发布，旧订单不追改 |
| growth.preview / publish | super | 门槛变化预览与配置发布 |
| adminUser.save / disable | super | 后台角色管理，禁止误删最后一个可用超级管理员 |
| metrics.summary / feedback.list / feedback.resolve | operations | 基础统计与反馈处理 |
| job.get / audit.list | 按对象权限 | 作业状态及必要审计；不能泄露秘密 |
| job.resume | super | 仅可恢复已定义的中断步骤，不能跳过校验直接标成功 |

危险操作预览返回 previewId、planHash、expiresAt、affectedCounts、warnings；commit 输入 previewId、planHash、reason、confirmed=true 和 idempotencyKey。预览有效期默认 10 分钟，期间对象版本变化使其失效。

## 6 业务错误码

| code | 含义与处理 |
| --- | --- |
| INVALID_ARGUMENT | 字段或范围不合法；逐字段提示 |
| AUTH_REQUIRED | 缺可信平台身份；先登录 |
| MEMBER_REQUIRED | 已有平台身份但未完成业务注册 |
| ACCOUNT_DISABLED | 账号停用，不自动重试 |
| FORBIDDEN | 角色不足，不自动重试 |
| NOT_FOUND | 资源不存在或不允许获知其存在 |
| VIP_REQUIRED | 当前试卷需有效 VIP，保留草稿 |
| CATEGORY_UNAVAILABLE | 类目停用或不可选 |
| CATEGORY_IN_USE | 需先迁移引用 |
| CATEGORY_DEPTH_LIMIT | 超三级或移动后超深 |
| CATEGORY_CYCLE | 自父、移入后代或环 |
| VERSION_CONFLICT | 重新读取并确认，不能静默覆盖 |
| DRAFT_CONFLICT | 跨设备旧草稿冲突 |
| ACTIVE_ATTEMPT_EXISTS | 继续原卷或明确放弃后替换 |
| ALREADY_SUBMITTED | 查看已提交结果，不重复结算 |
| IDEMPOTENCY_CONFLICT | 同一业务键不同输入，必须排查 |
| UNANSWERED_CONFIRM_REQUIRED | 用户明确确认空题计零后可提交 |
| CONTENT_UPDATING | 结构维护中，显示原因与保留状态 |
| PAPER_WITHDRAWN | 试卷紧急撤回 |
| PAYMENT_PENDING | 查询原订单，禁止诱导重复购买 |
| ENTITLEMENT_PENDING | 已付待开通，禁止再买一次 |
| PAYMENT_CHANNEL_UNAVAILABLE | 当前端或资质不可用，不绕行错误支付渠道 |
| IMPORT_INVALID | 返回行号与原因，整批拒绝 |
| SOURCE_KEY_CONFLICT | 来源键冲突，不覆盖 |
| RATE_LIMITED | 返回 retryAfterMs；客户端退避 |
| SERVICE_BUSY | 显示 requestId；结果未知先查原业务 |
| INTERNAL_ERROR | 显示 requestId；不返回堆栈或密钥 |

内部错误不返回数据库结构、堆栈、支付会话或签名明文。错误详情只能包含面向该用户的必要信息。

## 7 特殊 HTTP 入口

mw-upload：仅接受服务端创建的短期单次票据与规定内容类型，服务端复验票据、管理员仍启用、路径、大小和内容摘要。应用层图片上限 2 MB、CSV 上限 5 MB；目标网关最大请求体须在技术验证阶段实测。若平台上限更低，改为 CloudBase 官方授权直传并保持同等票据绑定与校验，不能提高公开存储权限规避。

mw-pay-hook：支持平台配置的校验握手及通知格式，保存原始请求字节用于验签，按微信当前虚拟支付通知规范解析 XML 或 JSON，验证后才分发。响应体、超时及重试语义遵循支付协议，不能返回通用 ok 信封冒充平台成功响应。

iOS 退款问询需及时返回真实已发货与使用证据，不能把“收到问询”当成“已退款”。内部 mw-jobs 不开放公网或客户端直接执行，平台定时触发与受控服务端调度校验来源后才可处理任务。
