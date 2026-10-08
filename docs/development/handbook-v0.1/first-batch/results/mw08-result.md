# MW08 实际结果

日期：2026-10-09  
任务：会员注册与个人资料（整改；状态纠正；用户手点收口）  
基线提交：`062aa943fd57f8b6aa0c7c6314cdde7bf4312d11`  
代码整改提交：`a763d0f8a32eaee813e0e83083eedfdc86a00cd5`  
状态：**已完成**（用户手点开发者工具闭合；并发唯一性来自这次手点摘要；清理后 leftover=0）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token 只存在于被 Git 忽略的本地 `.env`。本文未写入、未提交这些值。

未把 A01—A31、T01—T30 标为通过。未启动 MW09。未实现虚拟支付、VIP 购买、订单或退款。MW07 保持「A 已完成，B 等待虚拟支付审核」。未创建生产环境，未升级套餐，未开启超额计费，未真实支付。未导入真实用户资料。

代码整改提交仍是 `a763d0f`。收口证据是本轮用户手点页面摘要 + 新导入的哈希 knownIds + 写后精确清理；上一轮 automator 不能当完成证据。本文件与进度入口的状态更正在随后的文档提交中入库，不改代码整改哈希。

## 1 本轮整改范围

相对基线 `062aa94`，只修 MW08。下列代码整改已在 `a763d0f`，**仍有效**：

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
| 本轮部署 | `a763d0f` 当轮只重新部署正式入口 `mw-member`。手点收口当轮 `mw-member` 无未部署改动，未再部署 |
| 未创建 | categories / papers / attempts / orders / vip_* 等后续集合 |
| 未新建云函数 | 未增加入口 |

确定性标识：

- `identities._id = H(provider,appId,openId)`，`provider=wechat_mini`
- `members._id = member_stats._id = H(kind,identityId)`
- `audit_logs._id = H(requestId,action,target)`，便于按哈希精确删除
- 文档不存 OPENID 明文

注册事务：读 identity / member / stats / idempotency，按需写这四者加一条审计。失败整单回滚。同键重放不追加第二份审计或初始化行。

**冲突有界重试**：本地代码与争用测试已证明（见第 7 节）。mw-test 真 FROM 并发两路都 `ok` 且同一 `memberId`，`raceSameMember=true`，证据来自本轮**用户手点**页面摘要，不是 automator。

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
| `npm run check:prototypes` | 0（手点收口当轮复跑仍为 0） |
| `npm run typecheck` | 0（手点收口当轮复跑仍为 0） |
| `npm test` | 0（手点收口当轮复跑仍为 0；密钥扫描 246 个已跟踪文件通过） |
| `npm run build` | 0（手点收口当轮复跑仍为 0） |

本地 PASS 新增/加强：

- 可争用 store：两路都成功且同一 `memberId`；只有一份 identity / member / stats；首次注册审计一条；同键重放不追加审计。
- 已有会员后持续抛事务冲突：归并同一 `memberId`，不再停在 SERVICE_BUSY。
- 资料更新遇一次 `TX_CONFLICT` 后重试成功。
- leftover：空 `knownIds` + `wroteDocs=false` 不失败，也不声称云端无会员；`wroteDocs=true` 且无 ID 失败。

串行 memory queue 仍保留，**不**当作 CloudBase 争用证据。

## 8 mw-test 有限验证

真实身份证据与本地 fixture **分开记录**。CLI 无小程序 FROM 上下文，不能用 `tcb` / CLI invoke 冒充 FROM。

其后有一轮执行者用 `miniprogram-automator` / 开发者工具服务端口自动调用 `pages/mw08/index` 的 `runSuite`，并导入 knownIds、精确删除 9 条。该轮**不是用户手点**，其被忽略的 `tmp/mw08/from-suite-report.json` 为 `ok: false`（失败项 `noSecretsInPage`）。automator 自动跑页、导入 knownIds、精确删除 9 条，只记为「非用户手点，不能标完成」；**不**改写成当时已手点通过，也**不**把该报告或当时 knownIds 当作本轮完成证据。

本轮由用户用正式 AppID（非 touristappid）在微信开发者工具打开思维工坊，进入 `pages/mw08/index`，以既有共享环境 `Cloud({ resourceAppid, resourceEnv })` 手点「运行 MW08 套件」，再点「复制 knownIds」。点运行后页面曾无中间态（套件在等云函数，当时未改 `summary`）；复制后页面出现完整摘要，说明套件已跑完，不是 CLI/automator 代跑。用户发回的页面摘要：`sharedConfig=true`；首次 `member.register` 为 `ok` / `created=true`，回哈希 `memberId` / `identityId`；同键重放同一 `memberId` 且 `replayed=true`；并发两路都 `ok`、同一 `memberId`、`raceSameMember=true`；`member.me` 成功且 `hasOpenId=false`，摘要无 OpenID / AppID / 环境 ID 值；合法 `member.updateProfile` 为 `OK`；伪造 `openid` / `memberId` / `role` 返回 `CLIENT_IDENTITY_IGNORED`。本轮未重新部署：`mw-member` 相对已部署版本无未部署改动。

| 项 | 结果 |
| --- | --- |
| 只部署改动的 `mw-member` | PASS（`a763d0f` 当轮已部署；手点收口当轮无未部署改动，未再部署） |
| 未登录 / 无 FROM 调用 register、me | PASS（CLI 负向，`AUTH_REQUIRED`） |
| 客户端伪造 openid/memberId/role | PASS（CLI 负向 + 开发者工具手点页，`FORBIDDEN` / `CLIENT_IDENTITY_IGNORED`） |
| policies.current | PASS（此前 CLI 负向/只读；正路径套件读取当前测试稿） |
| 未登录 Web SDK 直写 members / identities | PASS，被拒绝 |
| EnableOverrun=false | PASS |
| 存储 ACL=ADMINONLY | PASS |
| 账号下其他环境未改 | PASS（只读核验 otherEnvCount=2，未操作） |
| 可信注册 / 重复注册 / me / 资料更新 | PASS（开发者工具用户手点共享环境真 FROM） |
| 并发注册两路都成功且同一会员 | PASS（mw-test 用户手点真 FROM，`raceSameMember=true`） |
| 停用会员云端写拒绝 | **NOT_RUN**（无真实停用身份，未新增公开停用接口；本地已覆盖） |
| 昵称内容安全真实验证 | **NOT_RUN** |

测试标识：`MW08`。页面可复制 `knownIds` 已写入被 Git 忽略的 `configs/mw08-verify-state.json`：`wroteDocs=true`，9 个 ID 全是 64 位十六进制哈希，不是 OpenID。会员/身份哈希与上一轮 automator 相同，属同一 FROM 用户的确定性 `_id`，属预期；idempotency / audit 与上一轮 automator 名单不同，按这次手点新名单导入。未把上一轮 `from-suite-report.json` 或当时 knownIds 当作完成证据。

## 9 测试数据清理与残留核验

用户手点正路径写入后，`wroteDocs=true`。`npm run mw08:import-known-ids` 把页面哈希 ID 写入被 Git 忽略的 `configs/mw08-verify-state.json`（未提交）。`npm run mw08:cleanup` 只按已知哈希 `_id` 删除 identities / members / member_stats 以及本轮 idempotency / audit_logs，禁止宽泛条件批量删除：`deleted=9`，`failed=0`，`exactIdsOnly=true`。`npm run mw08:verify-leftovers`：`leftoverDocs=0`，`cloudWriteClaimed=true`，`wroteDocs=true`，`exactIdSweepOnly=true`。此时的 0 是写后精确清理，不是空扫。集合仍在：identities / members / member_stats。ACL=ADMINONLY，EnableOverrun=false，客户端直写仍拒绝。正式集合、`policies` 测试稿和代码保留。

上一轮 automator 写后删 9 条仍只记为非用户手点，不能改写成当时已手点通过。

## 10 费用与环境边界

个人版预付资源点。`a763d0f` 当轮有 `mw-member` 部署。手点收口当轮有精确删除与只读残留核验，无新部署。`EnableOverrun=false`。未购买、未续费、未开通超额、无现金支付。未创建生产环境。未改账号下其他 CloudBase 环境。

## 11 PASS / PARTIAL / NOT_RUN

| 项 | 判定 |
| --- | --- |
| 本地四项检查 | PASS |
| 冲突有界重试与争用测试 | PASS（本地 + mw-test 用户手点真 FROM 并发同一 memberId） |
| 验证页并发判定 | PASS（本地逻辑 + 开发者工具手点实跑：两路都成功且同一 memberId） |
| 可信身份只认 FROM_* | PASS（本地 + CLI 负向 + 开发者工具手点伪造拒绝） |
| 协议同意与版本校验 | PASS（本地 + 正路径使用当前 policies 测试稿） |
| 资料白名单与内置头像 | PASS（本地 + 开发者工具手点合法更新） |
| 停用禁写 | PASS（本地） / **NOT_RUN**（mw-test，未新增公开停用接口） |
| maintenance 分项不误阻断 | PASS（本地） |
| 幂等与无孤立行 | PASS（本地 + 同键重放 `replayed=true`） |
| 数据库直写拒绝 | PASS（mw-test） |
| leftover 写后精确清理 | PASS（`wroteDocs=true`，`cloudWriteClaimed=true`，`leftoverDocs=0`） |
| 微信内容安全 | **NOT_RUN** |
| 开发者工具用户手点 FROM 正路径 | PASS |
| automator / 服务端口自动跑页 | 已发生，非用户手点，不能标完成，不改写成当时已手点通过 |
| A01 / A26 / A31 / T01 | 不标通过 |
| MW07-B | 不标通过 |

## 12 后续遗留风险

1. 昵称仍走保守字符集；接入内容安全前不得放开任意输入。内容安全平台保持 NOT_RUN。
2. `policies` 仍是测试稿，正式注册/收款前必须换成 MW24 文案。
3. `member.me` 的 VIP / 草稿为占位，分别留给 MW20 / MW14。
4. 停用会员云端写拒绝保持 NOT_RUN；未新增公开停用接口，本地已覆盖即可。
5. 验证页「运行 MW08 套件」在云函数返回前不更新 `summary`，容易被看成无反应；本轮以复制后出现的完整摘要为准，未改页面逻辑冒充已手点。

## 13 完成判定

用户手点开发者工具闭合可信 FROM 正路径；并发唯一性来自这次手点摘要（`raceSameMember=true`）；写入哈希 knownIds 后按精确 `_id` 清理，leftover=0。**MW08 已完成**。上一轮 automator 自动跑页仍只记为非用户手点，不改写成当时已手点通过。未把 A01 / A26 / A31 / T01 标为通过。内容安全和停用云端写保持 NOT_RUN。本轮不启动 MW09。
