# MW08 实际结果

日期：2026-10-09  
任务：会员注册与个人资料（整改）  
基线提交：`062aa943fd57f8b6aa0c7c6314cdde7bf4312d11`  
状态：**部分完成**（本地缺陷已修，mw-test 负向与基础设施已核验；共享环境可信 FROM 注册 / 重复注册 / me / 资料 / 并发仍未在开发者工具实跑，记 NOT_RUN）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token 只存在于被 Git 忽略的本地 `.env`。本文未写入、未提交这些值。

未把 A01—A31、T01—T30 标为通过。未启动 MW09。未实现虚拟支付、VIP 购买、订单或退款。MW07 保持「A 已完成，B 等待虚拟支付审核」。未创建生产环境，未升级套餐，未开启超额计费，未真实支付。未导入真实用户资料。

## 1 本轮整改范围

相对基线 `062aa94`，只修 MW08：

| 缺陷 | 处理 |
| --- | --- |
| 事务冲突无重试，失败者可能停在 SERVICE_BUSY | `registerMember` / `updateMemberProfile` 对可恢复事务争用做最多 3 次有界重试；注册在重试耗尽后若已有 identity/member，归并为同一 `memberId`，不再只回 SERVICE_BUSY |
| 本地并发只靠串行队列 | 新增 `contendingMemberBundle`：空快照对齐后一方提交、另一方读到 `TX_CONFLICT` 再读到已有身份 |
| 验证页误报 | `pages/mw08/index` 仅当两路都 `ok` 且 `memberId` 相同才记 `raceSameMember=true`；展示哈希 ID、created、replayed、错误码；可复制 `knownIds` |
| 空 knownIds 被当成云端无测试会员 | leftover 增加 `wroteDocs`；空 ID 且未声明写库只做精确 ID 空扫，不宣称云端无会员；已写库却无 ID 记 `KNOWN_IDS_MISSING_AFTER_WRITE` |

未复制 `mw-validation-*` 桩，未新建无必要云函数或后续业务集合。

## 2 明确未实现

- MW09 类目管理。
- MW07-B 虚拟支付、VIP 购买、订单、退款、vip_accounts。
- member.setRanking、注销、正式协议文案（MW24）。
- 勋章授予记录（MW16）；注册只初始化 `member_stats.levelId=L1`。
- 微信内容安全 / msgSecCheck。
- 手机号绑定、抓取微信头像昵称。
- 未新增公开停用接口。

## 3 接口与权限矩阵

| 调用 | 可信身份 | 未注册 | 已注册 active | 已注册 disabled |
| --- | --- | --- | --- | --- |
| 无 FROM_APPID/FROM_OPENID | AUTH_REQUIRED | — | — | — |
| 客户端带 openid/memberId/role/score | FORBIDDEN / CLIENT_IDENTITY_IGNORED | 同左 | 同左 | 同左 |
| 伪造 source/type/context | 不作为身份 | 同左 | 同左 | 同左 |
| 无共享配置（小程序页） | AUTH_REQUIRED | — | — | — |
| member.register 未同意或版本不符 | INVALID_ARGUMENT | 拒绝建号 | — | — |
| member.register 首次同意当前版本 | 建立唯一会员 | 成功 | 返回同一会员 | 返回同一会员，不新写资料 |
| member.me | MEMBER_REQUIRED | 本人脱敏资料 | 本人状态 |
| member.updateProfile | MEMBER_REQUIRED | 白名单更新 | ACCOUNT_DISABLED |
| 资源方 APPID/OPENID | 忽略 | 忽略 | 忽略 |

普通日志和 API 响应不输出 OPENID。审计只写 memberId、前后哈希和限长 reason。写成功可回哈希 `identityId` / `idempotencyId` / `auditId`，供精确清理。

## 4 集合、字段、索引和云函数

| 资源 | 处理 |
| --- | --- |
| 保留集合 | `identities`、`members`、`member_stats` |
| 复用 | `app_config`（`policies` 测试稿）、`idempotency`、`audit_logs` |
| 新增索引 | 无。按确定性 `_id` 点读 |
| 本轮部署 | 只重新部署正式入口 `mw-member`（`mw-public` 无代码改动，未再部署） |
| 未创建 | categories / papers / attempts / orders / vip_* 等后续集合 |
| 未新建云函数 | 未增加入口 |

确定性标识：

- `identities._id = H(provider,appId,openId)`，`provider=wechat_mini`
- `members._id = member_stats._id = H(kind,identityId)`
- `audit_logs._id = H(requestId,action,target)`，便于按哈希精确删除
- 文档不存 OPENID 明文

注册事务：读 identity / member / stats / idempotency，按需写这四者加一条审计。失败整单回滚。同键重放不追加第二份审计或初始化行。

**冲突有界重试**：已由本地代码与争用测试证明（见第 7 节）。**未**在 mw-test 用真实 FROM 并发闭合，结果文档不把云端并发唯一性写成已通过。

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
- **内容安全平台：NOT_RUN**。未调用 msgSecCheck，不宣称已开放任意昵称。没有安全实测手段，不为此新增危险接口。

## 7 本地检查

虚构 fixture：`wxmwallowedappid0001`、`mw08_openid_a` / `mw08_openid_b`。测试不读真实 `.env` / AppID / OPENID。

| 命令 | 退出码 |
| --- | --- |
| `npm run check:prototypes` | 0 |
| `npm run typecheck` | 0 |
| `npm test` | 0 |
| `npm run build` | 0 |

本地 PASS 新增/加强：

- 可争用 store：两路都成功且同一 `memberId`；只有一份 identity / member / stats；首次注册审计一条；同键重放不追加审计。
- 已有会员后持续抛事务冲突：归并同一 `memberId`，不再停在 SERVICE_BUSY。
- 资料更新遇一次 `TX_CONFLICT` 后重试成功。
- leftover：空 `knownIds` + `wroteDocs=false` 不失败，也不声称云端无会员；`wroteDocs=true` 且无 ID 失败。

串行 memory queue 仍保留，**不**当作 CloudBase 争用证据。

## 8 mw-test 有限验证

真实身份证据与本地 fixture **分开记录**。CLI 无小程序 FROM 上下文。本机 `AppData` 下仅有微信开发者工具用户数据，未找到可用 CLI，因此可信登录正路径未自动实跑。

| 项 | 结果 |
| --- | --- |
| 只部署改动的 `mw-member` | PASS |
| 未登录 / 无 FROM 调用 register、me | PASS（CLI 负向，`AUTH_REQUIRED`） |
| 客户端伪造 openid/memberId/role | PASS（CLI 负向，`FORBIDDEN` / `CLIENT_IDENTITY_IGNORED`） |
| policies.current | PASS（此前 CLI 负向/只读） |
| 未登录 Web SDK 直写 members / identities | PASS，被拒绝 |
| EnableOverrun=false | PASS |
| 存储 ACL=ADMINONLY | PASS |
| 账号下其他环境未改 | PASS（只读核验 otherEnvCount=2，未操作） |
| 可信注册 / 重复注册 / me / 资料更新 | **NOT_RUN**（开发者工具 FROM 未实跑） |
| 并发注册两路都成功且同一会员 | **NOT_RUN**（未在 mw-test 真 FROM 闭合） |
| 停用会员云端写拒绝 | **NOT_RUN**（无真实停用身份，未新增公开停用接口） |
| 昵称内容安全真实验证 | **NOT_RUN** |

测试标识：`MW08`。不把并发唯一性写成已在 mw-test 闭合。

## 9 测试数据清理与残留核验

本轮未在开发者工具写入会员文档，`wroteDocs=false`。`npm run mw08:cleanup` 按已知哈希 `_id` 精确删除；空 ID 时不把「云端无测试会员」当成已证明。`npm run mw08:verify-leftovers`：`leftoverDocs=0` 只表示精确 ID 空扫，`cloudWriteClaimed=false`，`exactIdSweepOnly=true`；集合在，ACL=ADMINONLY，客户端直写仍拒绝。正式集合、`policies` 测试稿和代码保留。未按宽泛条件批量删除。

若之后开发者工具实跑产生文档：把页面可复制的 `knownIds` 写入被 Git 忽略的 `configs/mw08-verify-state.json`（`npm run mw08:import-known-ids -- <json>`），再按精确 `_id` 清理 identities / members / member_stats 以及本轮 idempotency / audit_logs；此时 leftover 必须核到 `leftoverDocs=0`。

## 10 费用与环境边界

个人版预付资源点。本次有 `mw-member` 部署和只读残留核验。`EnableOverrun=false`。未购买、未续费、未开通超额、无现金支付。未创建生产环境。未改账号下其他 CloudBase 环境。

## 11 PASS / PARTIAL / NOT_RUN

| 项 | 判定 |
| --- | --- |
| 本地四项检查 | PASS |
| 冲突有界重试与争用测试 | PASS（本地） / **NOT_RUN**（mw-test 真 FROM） |
| 验证页并发判定 | PASS（本地逻辑：两路都成功且同一 memberId） |
| 可信身份只认 FROM_* | PASS（本地 + CLI 负向） |
| 协议同意与版本校验 | PASS（本地） |
| 资料白名单与内置头像 | PASS（本地） |
| 停用禁写 | PASS（本地） / **NOT_RUN**（mw-test） |
| maintenance 分项不误阻断 | PASS（本地） |
| 幂等与无孤立行 | PASS（本地） |
| 数据库直写拒绝 | PASS（mw-test） |
| leftover 空 ID 不再误报 | PASS（本地决策 + 本轮 `wroteDocs=false` 空扫） |
| 微信内容安全 | **NOT_RUN** |
| 开发者工具 FROM 正路径 | **NOT_RUN** |
| A01 / A26 / A31 / T01 | 不标通过 |
| MW07-B | 不标通过 |

## 12 后续遗留风险

1. 仍须用微信开发者工具打开思维工坊，进入 `pages/mw08/index`，用既有共享环境 `Cloud({ resourceAppid, resourceEnv })` 实跑：首次注册、同键重放、两路并发都成功且同一 memberId、me 脱敏、合法资料、伪造身份拒绝、未登录/无共享配置拒绝。通过后写入 knownIds、精确清理，才能把 MW08 标为已完成。
2. 昵称仍走保守字符集；接入内容安全前不得放开任意输入。
3. `policies` 仍是测试稿，正式注册/收款前必须换成 MW24 文案。
4. `member.me` 的 VIP / 草稿为占位，分别留给 MW20 / MW14。

## 13 完成判定

本轮必改缺陷已在代码与本地测试落地，mw-test 只完成负向、部署与基础设施核验。必选的可信 FROM 正路径未闭环，因此 **MW08 仍为部分完成**。本轮不启动 MW09。
