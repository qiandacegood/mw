# MW08 实际结果

日期：2026-10-08  
任务：会员注册与个人资料  
状态：**部分完成**（本地实现与 CLI / 数据库边界已闭环；共享环境可信 FROM 注册、重复注册、me、资料更新和并发唯一性未在 mw-test 实跑，记 NOT_RUN）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token 只存在于被 Git 忽略的本地 `.env`。本文未写入、未提交这些值。

未把 A01—A31、T01—T30 标为通过。未启动 MW09。未实现虚拟支付、VIP 购买、订单或退款。MW07 保持「A 已完成，B 等待虚拟支付审核」。未创建生产环境，未升级套餐，未开启超额计费，未真实支付。未导入真实用户资料。

## 1 实现范围

已接到正式 `mw-member` / `mw-public`，复用 MW06 的幂等、审计、maintenance 和事务预算（≤60）。

| action | 入口 | 说明 |
| --- | --- | --- |
| member.register | mw-member | 同意当前协议/隐私版本后建立 identities + members + member_stats |
| member.me | mw-member | 只读当前可信身份对应会员，脱敏，停用仍可查看 |
| member.updateProfile | mw-member | 只改 nickname / avatarKey，带 expectedRevision |
| member.session | mw-member | 保留 MW05 探针；现可回报是否已注册 |
| policies.current | mw-public | 返回当前测试稿协议版本，供注册页读取 |

小程序新增「注册 / 我的 / 资料 / MW08 验证」页，默认系统昵称与内置头像，协议框不预勾选。

## 2 明确未实现

- MW09 类目管理。
- MW07-B 虚拟支付、VIP 购买、订单、退款、vip_accounts。
- member.setRanking、注销、正式协议文案（MW24）。
- 勋章授予记录（MW16）；注册只初始化 `member_stats.levelId=L1`。
- 微信内容安全 / msgSecCheck。
- 手机号绑定、抓取微信头像昵称。

## 3 接口与权限矩阵

| 调用 | 可信身份 | 未注册 | 已注册 active | 已注册 disabled |
| --- | --- | --- | --- | --- |
| 无 FROM_APPID/FROM_OPENID | AUTH_REQUIRED | — | — | — |
| 客户端带 openid/memberId/role/score | FORBIDDEN / CLIENT_IDENTITY_IGNORED | 同左 | 同左 | 同左 |
| 伪造 source/type/context | 不作为身份 | 同左 | 同左 | 同左 |
| member.register 未同意或版本不符 | INVALID_ARGUMENT | 拒绝建号 | — | — |
| member.register 首次同意当前版本 | 建立唯一会员 | 成功 | 返回同一会员 | 返回同一会员，不新写资料 |
| member.me | MEMBER_REQUIRED | 本人脱敏资料 | 本人状态 |
| member.updateProfile | MEMBER_REQUIRED | 白名单更新 | ACCOUNT_DISABLED |
| 资源方 APPID/OPENID | 忽略 | 忽略 | 忽略 |

普通日志和 API 响应不输出 OPENID。审计只写 memberId、前后哈希和限长 reason。

## 4 集合、字段、索引和云函数

| 资源 | 处理 |
| --- | --- |
| 新增并保留集合 | `identities`、`members`、`member_stats` |
| 复用 | `app_config`（写入 `policies` 测试稿）、`idempotency`、`audit_logs` |
| 新增索引 | 无。这三项按确定性 `_id` 点读，与数据模型第 7 节一致 |
| 部署入口 | 只重新部署 `mw-public`、`mw-member` |
| 未创建 | categories / papers / attempts / orders / vip_* 等后续集合 |
| 未新建云函数 | 未增加入口 |

确定性标识：

- `identities._id = H(provider,appId,openId)`，`provider=wechat_mini`
- `members._id = member_stats._id = H(kind,identityId)`
- 文档不存 OPENID 明文

注册事务：读 identity / member / stats / idempotency，按需写这四者加一条审计。冲突有界重试。失败整单回滚。

## 5 协议 / 隐私同意

`app_config.policies` 当前测试稿：

- `agreementVersion = mw08-test-agreement-v1`
- `privacyVersion = mw08-test-privacy-v1`
- `placeholder=true`，正式文案 MW24

`accepted` 必须为 `true`，且两个版本与当前配置完全一致，否则拒绝。同意记录只写在 `members.consentVersions`。

## 6 昵称与头像

- 昵称 2—16 字；汉字、字母、数字、`·`；禁止空白、URL、保留名。
- 头像仅 `avatar.builtin.01`—`12`。
- 写请求体上限 4096 字节。
- **内容安全平台：NOT_RUN / PARTIAL**。未调用 msgSecCheck，不宣称已开放任意昵称。

## 7 本地检查

虚构 fixture：`wxmwallowedappid0001`、`mw08_openid_a` / `mw08_openid_b`。测试不读真实 `.env`。

| 命令 | 退出码 |
| --- | --- |
| `npm run check:prototypes` | 0 |
| `npm run typecheck` | 0 |
| `npm test` | 0 |
| `npm run build` | 0 |

本地已覆盖：未登录、缺 FROM、伪造身份、未同意/版本错误、首次注册、重复注册、并发只建一份、跨身份隔离、me 脱敏、合法资料、非法昵称/头像/未知字段、篡改角色积分 VIP 状态被拒且库未变、停用禁写、maintenance 不误阻断、幂等重放无第二份审计、事务崩溃无孤立行。

## 8 mw-test 有限验证

真实身份验证与本地 fixture **分开记录**。本轮 CLI 无小程序 FROM 上下文。本机未找到可用的微信开发者工具 CLI，因此可信登录链路未自动实跑。

| 项 | 结果 |
| --- | --- |
| 只部署 mw-public / mw-member | PASS |
| 未登录 / 无 FROM 调用 register、me | PASS，`AUTH_REQUIRED` |
| 客户端伪造 openid/memberId/role | PASS，`FORBIDDEN` / `CLIENT_IDENTITY_IGNORED` |
| policies.current | PASS |
| 未登录 Web SDK 直写 members / identities | PASS，被拒绝 |
| EnableOverrun=false | PASS |
| 存储 ACL=ADMINONLY | PASS |
| 账号下其他环境未改 | PASS（只读核验 otherEnvCount=2，未操作） |
| 可信注册 / 重复注册 / me / 资料更新 | **NOT_RUN**（CLI 无 FROM；DevTools CLI 不可用） |
| 并发注册只产生一个内部会员 | **NOT_RUN**（同上） |
| 停用会员云端写拒绝 | **NOT_RUN**（无真实停用身份可调） |
| 昵称内容安全真实验证 | **NOT_RUN** |

测试标识：`MW08`，CLI requestId 前缀 `mw08/test/cli/`。

## 9 测试数据清理与残留核验

本轮 CLI 验证没有成功写入会员资料。`npm run mw08:cleanup` 按已知 `_id` 精确删除，删除数 0。`npm run mw08:verify-leftovers`：`leftoverDocs=0`，集合在，ACL=ADMINONLY，客户端直写仍拒绝。正式集合、`policies` 测试稿和代码保留。未按宽泛条件批量删除，未删除既有用户数据（本轮也未创建会员文档）。

## 10 费用与环境边界

个人版预付资源点。本次有函数部署、集合创建和有限调用。`EnableOverrun=false`。未购买、未续费、未开通超额、无现金支付。未创建生产环境。未改账号下其他 CloudBase 环境。

## 11 PASS / PARTIAL / NOT_RUN

| 项 | 判定 |
| --- | --- |
| 本地四项检查 | PASS |
| 可信身份只认 FROM_* | PASS（本地 + CLI 负向） |
| 协议同意与版本校验 | PASS（本地） |
| 并发/重试唯一性 | PASS（本地） / **NOT_RUN**（mw-test 真 FROM） |
| 资料白名单与内置头像 | PASS（本地） |
| 停用禁写 | PASS（本地） / **NOT_RUN**（mw-test） |
| maintenance 分项不误阻断 | PASS（本地） |
| 幂等与无孤立行 | PASS（本地） |
| 数据库直写拒绝 | PASS（mw-test） |
| 微信内容安全 | **NOT_RUN** |
| A01 / A26 / A31 / T01 | 不标通过 |
| MW07-B | 不标通过 |

## 12 后续遗留风险

1. mw-test 上尚未用共享环境小程序真实验证注册、me、资料更新和并发唯一性。页面 `pages/mw08/index` 已可在开发者工具手动跑，补验后才能把本项标完成。
2. 昵称仍走保守字符集；接入内容安全前不得放开任意输入。
3. `policies` 仍是测试稿，正式注册/收款前必须换成 MW24 文案。
4. `member.me` 的 VIP / 草稿为占位，分别留给 MW20 / MW14。

## 13 完成判定

本任务实现已落地，本地验收已闭环，mw-test 只完成负向与基础设施核验。必选的可信登录正路径未闭环，因此 **不能把 MW08 标为已完成**。本轮不启动 MW09。类目管理并不依赖会员注册真实验证；是否进入 MW09 由后续安排决定，建议先补 MW08 的开发者工具可信验证。
