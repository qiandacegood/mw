# 思维工坊实施基线 V1.0

日期：2026年10月8日  
依据：[产品说明书 V1.1](../product/product-spec-v1.1.md)、[技术架构](technical-design-v1.0.md)、[数据模型](data-model-v1.0.md)、[接口契约](../api/api-contract-v1.0.md)、[一致性流程](consistency-v1.0.md)、[支付方案](../operations/payment-v1.0.md)、[部署运维](../operations/cloudbase-deployment-v1.0.md)。  
状态：开发人员可直接使用的实施约定。本文件整理已有设计，不重做产品调研，不启动业务编码，也不表示程序或云端能力已验证。

配套样例：[samples/contracts](../../samples/contracts/README.md)。  
MW04 / MW07 验证清单见第 11、12 节。

## 1 文档地位

| 资料 | 作用 |
| --- | --- |
| 产品 V1.1 | 现行业务范围与 A01—A31 |
| 产品 V1.0 | 仅历史保留；不得恢复固定一级类目或排行费用筛选 |
| 技术文档各自的 V1.0 | 现行技术版本号，不表示沿用旧产品规则 |
| 本实施基线 V1.0 | 把已固定规则收成一份可执行入口；发现冲突时定向修正原文档，不另造平行协议 |

三个已确认决定必须贯穿实现：

1. 类目可增减删除，最多三级；初始十个一级类目不是写死枚举。
2. 免费卷与 VIP 卷统一计入四维排行，不提供费用筛选。
3. 云平台为腾讯云 CloudBase：文档型数据库、云函数、云存储、静态托管。

未确认的品牌、售价、环境 ID、主体、正式协议与正式题库一律使用明确标注的占位或虚构值，不得当作正式运营决定。

## 2 固定实施约定

### 2.1 标识边界

| 种类 | 规则 |
| --- | --- |
| 内部业务 ID | 服务端生成，camelCase 字段，如 `memberId`、`paperId`、`attemptId`、`orderId`。名称、昵称、题号不作标识。 |
| 确定性主键 | `H(x)`：对带字段名、固定顺序的规范 JSON 做 SHA-256，使用完整十六进制。不截短。 |
| 随机实体 ID | 不承载业务含义；正式编码在目标 SDK 字符与长度核实后冻结。 |
| 渠道业务号 | 订单、退款在传给支付渠道前映射为独立编号并唯一存储。内部 `orderId` / `refundId` 不等于 OfferID、商户号、微信交易号。 |
| 环境与主体 | `CLOUDBASE_ENV_ID` ≠ `WECHAT_APP_ID` ≠ OfferID ≠ 支付商户号。客户端不得选择现网环境。 |
| 禁止外泄 | 不向客户端返回 openId、session_key、AppKey、签名明文、支付回调原文。 |

客户端传入的 `userId`、`openid`、`role`、`score`、`vipExpiresAt` 一律不可信。

### 2.2 时间

- 内部保存：UTC 毫秒或数据库 Date。
- API：带 `Z` 的 ISO 8601，例如 `2026-10-03T02:00:00.000Z`。
- 界面与周期边界：`Asia/Shanghai`。
- VIP 1 天 = 86400 秒，按 24 小时相加，不按自然月。
- 周：北京时间周一 00:00 起，到下一周一 00:00 前；`weekKey` 为该周一的 `YYYY-MM-DD`。
- 月：北京时间当月 1 日 00:00 起；`monthKey` 为 `YYYY-MM`。
- 到期时刻恰好到达即失效。
- 周期归属取服务端首次接受有效交卷的时间；重放不改归属。

### 2.3 分值与金额

- 题目分、卷分、总分、分类分、增量：安全整数，禁止浮点累积。
- 金额：整数人民币分 `*Fen`。界面可格式化为元，存储与接口用分。
- 套餐对用户展示天数；持久化为 `durationSeconds = days * 86400`。
- 占位价必须标注 `PLACEHOLDER`，不得发布为正式售价。

### 2.4 题目版本与试卷快照

- 题目修改产生新 `question_versions`，已发布引用不可覆盖。
- 试卷发布后冻结当时题面、答案、解析、分值、图片引用与 `access`。
- 答题记录绑定 `paperVersionId`；相同 `questionId` 按该快照解释。
- 未交卷接口、题面块、前端包均不得含正确答案或解析；解析图片不得混入公开题面。
- 首版不开放已发布卷的免费 / VIP 互转；改权限或改题结构视为新卷。

### 2.5 错误码

下列为独立 `error.code`，不得合并成一个字符串：

| code | 处理 |
| --- | --- |
| INVALID_ARGUMENT | 逐字段提示 |
| AUTH_REQUIRED | 缺可信平台身份，先登录 |
| MEMBER_REQUIRED | 已有平台身份但未注册 |
| ACCOUNT_DISABLED | 账号停用，不自动重试 |
| FORBIDDEN | 角色不足 |
| NOT_FOUND | 不存在或不允许获知其存在 |
| VIP_REQUIRED | 保留草稿，引导开通 |
| CATEGORY_UNAVAILABLE | 停用或逻辑删除节点 |
| CATEGORY_IN_USE | 先迁移引用 |
| CATEGORY_DEPTH_LIMIT | 第四级或移动后超深 |
| CATEGORY_CYCLE | 自父、移入后代或环 |
| VERSION_CONFLICT | 重读后确认 |
| DRAFT_CONFLICT | 跨设备旧草稿 |
| ACTIVE_ATTEMPT_EXISTS | 继续或明确放弃原卷 |
| ALREADY_SUBMITTED | 查看已提交结果 |
| IDEMPOTENCY_CONFLICT | 同键不同输入，必须排查 |
| UNANSWERED_CONFIRM_REQUIRED | 确认空题计零 |
| CONTENT_UPDATING | 结构维护中 |
| PAPER_WITHDRAWN | 紧急撤回 |
| PAYMENT_PENDING | 查原订单 |
| ENTITLEMENT_PENDING | 已付待开通，禁止再买一次 |
| PAYMENT_CHANNEL_UNAVAILABLE | 不绕行错误渠道 |
| IMPORT_INVALID | 整批拒绝 |
| SOURCE_KEY_CONFLICT | 不覆盖 |
| RATE_LIMITED | 按 `retryAfterMs` 退避 |
| SERVICE_BUSY | 先查原资源 |
| INTERNAL_ERROR | 显示 `requestId`，结果未知先查 |

成功与失败信封见接口契约第 1 节。支付通知与上传不套该信封。

### 2.6 分页

- 默认 `limit=20`，最大 `100`。
- 使用不透明 `cursor`；服务端绑定过滤、排序和快照 `generation`。
- 修改过滤条件必须重新分页，禁止把任意 offset 用于大表深分页。

### 2.7 写操作幂等

- 写操作必须带 `idempotencyKey`；创建后重试不得换键。
- `requestId` 仅诊断，不是身份，也不是业务幂等键。
- 存储：`idempotency._id = H(actorId, action, key)`，比较 `payloadHash`。
- 同键同输入：返回原结果。
- 同键不同输入：`IDEMPOTENCY_CONFLICT`。
- 结果未知：先查原资源，再决定是否用原键重放。
- 外部支付、退款、上传必须在事务外使用独立业务号查询，不能只靠数据库事务重试。

## 3 身份、函数与集合命名

### 3.1 六个函数入口

| 函数 | 调用方 | 可做 | 不可做 |
| --- | --- | --- | --- |
| mw-public | 小程序云调用 | 公开只读 | 转发后台或支付写 |
| mw-member | 小程序云调用 | 注册、答题、本人订单 | 信任客户端身份字段 |
| mw-admin | Web SDK | 后台角色操作 | 客户端直连集合 |
| mw-upload | HTTPS | 一次性票据上传 | 无票据或过期票据 |
| mw-pay-hook | HTTPS | 支付通知 | 套用会员登录网关或通用 ok 信封 |
| mw-jobs | 定时 / 可信服务端 | 补偿、导入、榜、迁移 | 公网或客户端直接执行 |

云平台识别微信用户 ≠ 业务已注册。`member.register` 须 `accepted=true` 且协议版本有效。后台角色只认 `admin_users`：`content`、`operations`、`super`。

### 3.2 集合与状态（不得另造同义枚举）

| 对象 | 集合 | 状态 / 枚举 |
| --- | --- | --- |
| 会员 | members | `active` / `disabled` / `deleting` / `deleted`；`rankingOptIn` 默认 `false` |
| 类目 | categories | `depth` ∈ {1,2,3}；`parentId=null` 为一级；`ancestorIds` 不含自身 |
| 试卷权限 | papers | `access`：`free` / `vip` |
| 难度 | papers / questions | `beginner` / `intermediate` / `challenge` ↔ 入门 / 进阶 / 挑战 |
| 答题 | attempts | `inProgress` / `submitted` / `abandoned` |
| 榜单 | score_metrics / ranking_* | `scope`：`total` / `category` / `week` / `month`；无 `accessFilter` |
| 订单付款 | orders.payState | `pending` / `confirming` / `paid` / `closed` |
| 权益发放 | orders.grantState | `pending` / `processing` / `granted` / `error` / `revokedRemaining` |
| 退款 | orders.refundState | `none` / `requested` / `processing` / `succeeded` / `failed` |
| 导入 | import_batches | `uploaded` / `validated` / `staging` / `committed` / `failed` |
| 任务 | jobs | `queued` / `running` / `retryable` / `needsReview` / `succeeded` / `cancelled` |

订单页文案是上述三维状态的组合，不是第四套状态机。对照：

| 用户可见 | 条件 |
| --- | --- |
| 待支付 | payState=pending |
| 确认中 | payState=confirming |
| 已支付 | payState=paid 且 grantState=pending |
| 开通中 | payState=paid 且 grantState=processing |
| 已完成 | payState=paid 且 grantState=granted |
| 已关闭 | payState=closed |
| 退款相关 | refundState ≠ none，叠加渠道文案 |

## 4 计分、类目与排行

### 4.1 计分

```text
本次卷分 = Σ 各题实得分
计入分   = 同一 paperId 全部有效已提交记录的最高分
总分     = Σ 各卷计入分
类目含后代分 = 该类目及其后代各卷计入分（按 paperId 去重）
本次新增分 = max(0, 本次卷分 − 交卷前该卷最高分)
```

同卷 60 → 80 → 70：增量 60、20、0，计入 80。再加另一卷 50：总分 130。  
父级含后代分，**不可**把父级分与子级分再加总成分。题库主类目不计分。  
VIP 购买不加分，无倍数。零分不上榜。

多选：所选集合与正确集合完全相同才得全分；少选、多选、错选、空答均为 0，不倒扣。

### 4.2 类目树

- 最多三级；一、二、三级均可挂卷。
- 服务端拒绝：第四级、自父、缺父、移入后代、同级规范名重名、移动后超深。
- 停用节点及其后代：不供新发布和新开始，分类导航与分类榜隐藏；合法历史分仍计入总分和周月榜。
- 删除：逻辑删除，保留稳定 ID；有引用必须先迁移。
- 分类分字段必须分开命名：`directScore`（仅本节点直接挂卷）、`inclusiveScore`（本节点及后代，去重）。

### 4.3 排行

- 四榜统一计入免费与 VIP 卷。`ranking.list` / `ranking.me` 禁止 `access`、`freeOnly` 等费用参数。
- `paper.list` 仍可用 `access` 选卷，不影响计分。
- 并列竞赛排名 1、1、3；同分再按 `reachedAt`、`memberId`。
- 前 100 名含边界并列；本人名次与公开行必须同 `generation`。
- 新会员默认不参与公开榜；未参与仍计分成长。

## 5 VIP 有效期

未开通或已到期：`expiresAt = grantedAt + durationSeconds`。  
仍有效：`expiresAt = max(currentExpiresAt, grantedAt) + durationSeconds`。

虚构核算（占位，非正式商品）：

| 事件 | UTC | 北京时间 | 结果 |
| --- | --- | --- | --- |
| 首次发放 30 天 | 2026-10-03T02:00:00.000Z | 2026-10-03 10:00:00 | 到期 2026-11-02T02:00:00.000Z |
| 到期前续 30 天 | 2026-10-20T02:00:00.000Z | 2026-10-20 10:00:00 | 到期 2026-12-02T02:00:00.000Z |

发放延迟从实际开通时刻起算未用时长。一订单一发放；多笔已付订单按同一 `vip_accounts` 串行，不得互相覆盖。

## 6 页面范围（交给 MW02）

小程序底部四项：首页、分类、排行榜、我的。

必须可走查：首页、分类树与面包屑、试卷列表 / 详情、答题 / 答题卡、结果 / 解析、四维排行、VIP 中心与购买、订单列表 / 详情、注册协议、个人资料与成长。

后台核心：登录、类目、题库、组卷发布、导入、会员、订单与退款审核、成长配置、榜单治理、反馈与统计。角色：游客、免费会员、有效 VIP、过期 VIP；页面状态：空白、加载、错误、处理中。

正式品牌未定，MW02 只用占位素材。

## 7 目录与配置边界（交给 MW03）

| 路径 | 用途 |
| --- | --- |
| apps/miniprogram | 原生微信小程序 + TypeScript |
| apps/admin | Vue 3 + TypeScript + Vite |
| services/api | 六个入口与领域模块；适配器隔离 CloudBase |
| packages/shared | 类型、校验、错误码；不含答案与密钥 |
| samples/contracts | 本基线虚构接口样例 |
| infra/cloudbase | 待 MW04 后按真实环境参数化，禁止写入真实环境 ID |

`.env.example` 只列变量名与无效占位。MW03 可用隔离模拟接口验证契约，不得创建云资源或默认部署。

建议环境变量名（值全部占位）：`CLOUDBASE_ENV_ID`、`WECHAT_APP_ID`、`APP_ENV`、`VIRTUAL_PAY_OFFER_ID`、`VIRTUAL_PAY_ENV`。密钥类变量只出现在 example，不写真实值。

## 8 事务与异步

必须同步原子：交卷结果与最高分 / 总分 / 分数事件；付款确认与唯一发放任务；VIP 发放与订单发放标识；退款结果与撤销任务。

可以异步：勋章、公开榜快照、分类重建、导入、纠错、对账。事务内必须落下持久 `jobs`，不能只靠内存 Promise。

设计预算：单事务 ≤ 60 次操作、目标 < 3 秒；平台上限待 MW04 核实（文档称最多 100 次 / 30 秒）。导入 1000 行不得塞进一个事务。

## 9 占位值（非运营决定）

| 项 | 占位 | 说明 |
| --- | --- | --- |
| 品牌名 | 思维工坊 | 已有产品名，标志与主色未定 |
| 主色 | `#2B6CB0` | MW02 占位，正式发布前可替换 |
| 环境名 | `mw-test` / `mw-prod` | 规划名称，不是环境 ID |
| 环境 ID | `env-placeholder-not-real` | 禁止当真实 ID 使用 |
| AppID | `wx_placeholder_appid` | 虚构 |
| OfferID | `offer_placeholder` | 虚构 |
| 30 天套餐价 | `9900` 分 | `PLACEHOLDER_PRICE`，非正式售价 |
| 90 / 365 天价 | `26900` / `89900` 分 | 同上 |
| 会员 / 订单 | `mem_fict_*` / `ord_fict_*` | 虚构，非真实个人信息 |

## 10 本次定向修正

不改变产品范围，只消除同义冲突：

1. 产品 V1.1 §7 订单文案改为三维状态的展示组合，与 §12.3、支付方案一致。
2. 数据模型补齐 `payState` / `grantState` / `refundState` 枚举、`rankingOptIn` 默认值、难度枚举。
3. 接口契约将合并书写的错误码拆成独立 code，并固定分类分字段名与难度枚举。
4. 目录说明增加 `samples/contracts`。
5. 技术文档入口增加本基线。

产品 V1.0、历史决定原文不改写。

## 11 MW04 平台验证清单

本项只说明怎么验证、需要什么输入、失败如何处理。**未连接控制台，未读取项目凭据，未声称已通过。**

| 编号 | 验证项 | 需要的输入 | 做法 | 失败处理 |
| --- | --- | --- | --- | --- |
| P01 | 传统文档模式而非 PG | 可用测试环境或拟用环境 | 控制台核对数据库模式 | 停用按本文档实现的权限/SDK 假设，先改环境或改文档 |
| P02 | 地域与环境归属 | 环境 ID、地域、是否已有环境 | 记录真实 ID 的安全存放位置，不写入仓库 | 无环境则 MW04 只完成准备，不能标整项通过 |
| P03 | Node 运行时 | 目标环境支持列表 | 核实 Nodejs22.21（或继任）是否生产支持 | 另选支持版本并冻结；不静默降级 |
| P04 | SDK 组合 | `@cloudbase/node-sdk`、`js-sdk` 候选版本 | 锁定后测服务端事务与 Web 登录 | 组合不兼容则换版本并更新 lockfile |
| P05 | SDK 身份上下文 | 小程序云调用测试号 | 确认身份来自运行上下文，客户端同名字段无效 | 未通过不得做会员写接口 |
| P06 | 后台账号密码登录 | 预置测试管理员（非正式运营账号） | Web SDK 登录后函数读 uid 再查 `admin_users` | 普通登录用户不得有后台权 |
| P07 | 事务上限 | 官方当前文档 + 实测 | 记最大操作数、时长、按 doc 访问限制 | 超限则拆事务并改一致性预算 |
| P08 | 索引 | 数据模型第 7 节清单 | 按真实查询计划创建并解释 | 缺索引或顺序错误则补清单 |
| P09 | 私有图片短期读 | 测试对象 | 默认拒绝客户端读写，签发短期 URL | 失败不得开放公开桶 |
| P10 | 5 MB 上传与网关 | 4.9 MB / 5.1 MB 虚构 CSV | 测 mw-upload 或官方直传 | 网关更低则改直传，保持票据绑定 |
| P11 | 六入口权限 | 未登录 / 会员 / 后台三角色 | 越权调用 mw-admin、mw-jobs、直连集合 | 任一失败阻断依赖该入口的开发收尾 |
| P12 | 费用边界 | 负责人预算 | 只记录套餐与预估，不自动购买 | 无预算则不创建付费资源 |

验证记录必须写环境、版本、时间、PASS / FAIL / BLOCKED / NOT_RUN。本地模拟不得标 MW04 通过。

## 12 MW07 支付验证清单

分 A 资格、B 技术。MW07-A 在本基线后即可准备资料；MW07-B 依赖 MW04。

### 12.1 MW07-A 主体与商品

| 编号 | 验证项 | 需要的输入 | 做法 | 失败处理 |
| --- | --- | --- | --- | --- |
| Q01 | 主体类型 | 个人 / 个体户 / 企业 | 对照当前虚拟支付入口 | 能力不足则呈报，不改用普通支付、不删 iOS |
| Q02 | 小程序 AppID 与类目 | 真实 AppID（经安全渠道） | 核对应经营类目 | 不匹配则停商品配置 |
| Q03 | 虚拟支付资格与 OfferID | 控制台资格状态 | 记录有/无，不抄密钥 | 无资格则 MW07 整项不能完成 |
| Q04 | Android / iOS 商品 | 测试商品 ID、占位价 | 天数、价格分、渠道映射一致 | 缺一端则该端路径 BLOCKED |
| Q05 | iOS 条件 | 系统 ≥ iOS 15、微信 ≥ 8.0.68、中国大陆 App Store、金额 ≥ 1 元 | 再核对待发布日官方文档 | 条件变化则更新产品/支付文档 |
| Q06 | 退款能力差异 | 主体与渠道 | Android 商户退款；iOS 无商户退款按钮 | 界面必须按渠道分支 |

### 12.2 MW07-B 签名、通知、查单

| 编号 | 验证项 | 需要的输入 | 做法 | 失败处理 |
| --- | --- | --- | --- | --- |
| R01 | 支付签名 | 沙箱或授权测试密钥 | 用官方测试向量，适配器集中验签 | 失败不得上收银台 |
| R02 | session 与身份 | 一次性 wx.login code | 换 session 后核对 openId 与云调用一致 | 不一致拒绝 prepare |
| R03 | 通知验签 | 平台测试报文 | 保存原始字节再验签；XML 关 XXE | 失败拒绝，不建单不发放 |
| R04 | 通知与查单互补 | 丢通知样例 | 只信校验后的通知或查单 | 客户端 success 不开通 |
| R05 | 发货确认 | 已发放订单 | 权益持久成功后才确认；重放同结论 | 确认失败只重发确认，不加天数 |
| R06 | Apple 问询 / 退款 | 授权现网或官方问询样例 | 返回真实发货与使用证据 | 无授权则 NOT_RUN，不伪称通过 |
| R07 | 沙箱与现网隔离 | 环境白名单 | 测试通知不能改现网权益 | 失败立即停该环境支付开关 |
| R08 | 真实扣款 | 金额上限授权 | 本清单默认不执行 | 未授权一律不发起 |

正式售价缺失不阻止 MW07-A 资料核对；真实扣款必须另有金额授权。

## 13 检查结论

本项为文档核对与样例准备。字段、状态、角色、类目和排行含义已按第 10 节对齐。  
**本项文档检查完成，程序与云端能力未验证。**
