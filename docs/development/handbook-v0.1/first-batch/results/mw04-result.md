# MW04 实际结果

日期：2026年10月8日  
任务：[CloudBase 环境与关键能力验证](../mw04-cloudbase.md)  
状态：**部分完成**（P01—P07、P09、P12 为 PASS；P08 / P10 / P11 为 PARTIAL。P04/P05/P06 已由 MW05 手工登录与共享环境探针闭合）

工作区：`F:/MW/main`。本机 Windows，Node v24.21.0，npm 11.19.0，CloudBase CLI 3.8.5。  
环境 ID 只写在被 Git 忽略的本地 `.env`（`CLOUDBASE_ENV_ID`），本文不重复。脱敏证据在同样被忽略的 `tmp/mw04/`。

未把 A01—A31、T01—T30 标为通过。未创建生产环境，未升级套餐，未开启超额计费，未配置正式域名，未真实支付，未导入真实用户或题库。账号下另有非本项目环境，按授权未使用、未改动。

## 1 环境与版本

| 项 | 实测 |
| --- | --- |
| 逻辑名 | mw-test，仅测试 |
| 环境别名 | mw |
| 地域 | ap-shanghai |
| 套餐 | 个人版 `baas_personal`，预付资源点 |
| 超额按量 | `EnableOverrun=false`，未改 |
| 自动续费 | 关闭 |
| 到期 | 2026-11-08 23:59:59 |
| 计费周期 | 2026-10-08 ~ 2026-11-08 |
| 配额 | 40,000 资源点；QPS 配额 500 |
| 数据库 | 文档型云数据库实例 RUNNING；环境详情无 PostgreSQL 段；用量模块为 NoSQL Database |
| 存储 | 上海对象存储桶；默认曾是「所有用户可读」；已改为 ADMINONLY |
| 云函数命名空间 | 与测试环境同一命名空间 |
| 静态托管 | 平台默认域名 online；未配置正式域名 |
| 生产级运行时 | **Nodejs20.19**（云端 v20.19.3） |
| Nodejs22.21 | 可部署，云端 v22.21.1；CLI 仍标公测，且 Node 22+ 不支持云端安装依赖 |
| SDK | `@cloudbase/node-sdk@3.18.3`，`@cloudbase/js-sdk@3.10.1`，`wx-server-sdk@4.0.2` |
| CLI | `@cloudbase/cli@3.8.5`（lockfile 锁定，不使用 latest） |

安全配置位置：`.env`、`cloudbaserc.json`、`configs/local.json`（均 Git 忽略）。`.env.example` / `cloudbaserc.example.json` / `configs/local.example.json` 只有无效占位。

## 2 P01—P12

| 编号 | 环境/版本 | 操作 | 预期 | 实际 | 证据 | 结果 | 限制 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | mw-test / CLI 3.8.5 | `tcb env detail`、`env list --json`、用量模块 | 传统文档库，不是 PG | 数据库实例 RUNNING；用量为 NoSQL Database；无 PG 资源段 | `tmp/mw04/mw04-evidence.json` `env_detail` / `env_list` | **PASS** | 未登录控制台截图；以 CLI 资源清单为准 |
| P02 | 上海 / 个人版 | 核对地域、归属、ID 存放 | ID 不进仓库，只操作 mw-test | 地域 ap-shanghai，资源归属该环境；脚本拒绝非 `mw-` 环境 ID | `.env`（忽略）、`scripts/mw04-lib.mjs` | **PASS** | 账号另有其他环境，未触碰 |
| P03 | Nodejs22.21 与 20.19 | 部署 `mw-validation-runtime22` 与 probe | 核实 22.21 是否生产可用 | 22.21 可运行 v22.21.1；CLI 配置页仍标公测，官方推荐 Nodejs20.19；冻结 **Nodejs20.19 / v20.19.3** | `fn list`、invoke runtime/ping | **PASS** | 不把 22.21 当生产冻结；本机 Node 24 ≠ 云端 |
| P04 | node-sdk 3.18.3 / js-sdk 3.10.1 | lockfile + 后台登录页 | 锁定明确版本并测事务/登录候选 | SDK 仍锁定；用户在本地后台完成 `signInWithPassword`，`loggedIn=true` | admin 登录页 JSON | **PASS** | 未使用 `next` 4.x；密码未写入记录 |
| P05 | 正式入口 + 共享环境 | 必须用 FROM_APPID/FROM_OPENID | 身份来自共享调用上下文，伪造无效 | CLI 伪造字段已拒；开发者工具探针：`LOCAL_SHARED_CONFIG_PRESENT`，`mw-member` `ok=true` 且 `trustedFromContext=true` | 探针页截图（无 AppID/OpenID） | **PASS** | 未粘贴 FROM_* 原文；公开入口 `trustedFromContext=false` 符合设计 |
| P06 | mw-admin + 预置 admin_users | 伪造 uid/role；真实登录 | 认证 uid + `admin_users` 两层 | CLI 伪造字段 `FORBIDDEN`；真实登录 `roles=["super"]` 且 `enabled=true` | mw-admin invoke、登录页 JSON | **PASS** | 未输出 uid 原文 |
| P07 | probe 事务 | 60/100/101 次操作；双实例争用 | 记录上限、超时、冲突 | 60=2.918s、100≈4.15s、101=4.197s 均成功；双 invoke 恰好 slot_b 获胜，另一路 ALREADY_TAKEN，`remaining=0` | invoke_tx_ops / tx_claim_race / tx_read | **PASS** | 100 次约 4.15 秒，已超过设计目标 3 秒；MW06 仍按 ≤60 次设计预算。官方 100 次在 101 次未拒绝；30s 超时未做空转等待 |
| P08 | 数据模型第 7 节索引 | 不为改状态提前建齐未来集合 | 按真实查询计划创建并解释 | MW06 已创建并核验 `jobs` 的 `state/nextRunAt/_id` 与 `audit_logs` 的 `target/createdAt/_id`。**没有**创建 categories/papers/attempts 等其余未来集合或第 7 节其他业务索引 | mw06-result | **PARTIAL** | 仅更新本次已落地索引；其余未来索引保持 PARTIAL |
| P09 | 存储 ACL + 临时链 | 默认私有，服务端短期读，不开放公桶 | ADMINONLY；未授权 403；属主才签发 | 默认曾为可读；已改为 ADMINONLY。属主签发 60s 临时链；非属主不签发。**PASS 依据是 ACL 修复后的 private-retest 403** | fixup + private-retest | **PASS** | 改 ACL 前 CDN 曾 200，属旧公开权限/传播，不以当时结果作为通过依据 |
| P10 | 4.9 / 5.1 MB 虚构文件 | 临时 HTTP 函数 POST | 4.9 可接受，5.1 被拒或记录边界 | HTTP 网关对 **4.9 MB 与 5.1 MB 均返回 413**；随后精确删除 `mw-http-size-probe` 及 HTTP 通路 | tmp/mw05/mw05-http-evidence.json | **PARTIAL** | 网关上限低于 4.9 MB；应用层 5 MB 仍有效。未改正式入口为公网上传 |
| P11 | 六类正式入口 | 伪造身份与越权 action | 公开只读、会员需可信上下文、后台两层、上传要票据、支付要签名、任务拒客户端 | 正式六入口 + `cloudbase_auth` 已部署；CLI 拒绝链见 mw05-result；小程序会员共享调用已取得可信 FROM；后台真实登录已闭合 | 正式函数 invoke、探针页、登录页 | **PARTIAL** | 控制台逐条函数规则点选仍未完成 |
| P12 | 个人版用量 | 只记录，不购买 | 不开启超额 | 40,000 点，用量接口仍 0.00（官方可延迟至 2 天）；未买资源包、未超额 | env usage | **PASS** | 实际消耗以控制台延迟统计为准 |

## 3 云端验证资源收尾（2026-10-08）

MW04 能力验证完成后，不再长期保留可调用验证函数。本次只操作 mw-test；删除前再次核对函数名必须以 `mw-validation-` 开头，集合名必须以 `mw_validation_` 开头，存储前缀必须是 `mw-test/validation/`。禁止模糊匹配，未删除整个环境，未改其他环境。

删除验证资源只收缩攻击面，**不把删除写成 P05 / P06 / P10 通过**。

| 资源 | 收尾结果 |
| --- | --- |
| 八个 `mw-validation-*` 函数 | 按精确白名单删除；复查剩余 0 |
| 对象 `mw-test/validation/*` | 删除 6 个测试对象；前缀列表为空 |
| 集合 `mw_validation_tx` / `index` / `files` | 精确 `drop` 成功（含其上验证索引） |
| 集合 `mw_validation_admin_users` / `docs` | 从未创建；`drop` 为 NamespaceNotFound |
| 文档批量删除 `limit:100` | CLI 拒绝（只接受 0 或 1）；未再猜测其它删除语法 |
| 空集合客户端规则 | 无按集合 ACL 的已确认 CLI；集合已不存在，故未猜测配置。`MISSING_CREDENTIALS` 只表示未登录客户端被拒绝，不是集合规则已经验证 |
| 存储 ACL | 保持 ADMINONLY，未恢复公开读取 |
| 未授权存储 GET | ACL 修复后的复测与收尾复查均为 403 |
| 超额计费 | 收尾前后均为 `EnableOverrun=false` |
| 账号下其他环境 | 数量仍为 2，未改动 |
| `tmp/mw04/mw04-evidence.raw.json` | 本地已删除；脚本不再生成 raw；`/tmp/` 保持 Git 忽略 |

收尾后精确 `drop` 复查：五个 `mw_validation_*` 名称均为 NamespaceNotFound。`count` / `collStats` 的 CLI 退出码在缺集合时仍可能为 0，不能当作“集合仍存在”，故未据此重建或改规则。存在性以 `drop` 的 NamespaceNotFound 与 `listCollections` 为准。

## 4 费用与资源点

- 周期内套餐 40,000 点。验证前后与收尾前后 `tcb env usage` 均显示 0.00 / 40000.00，资源包与按量均为 0。
- 删除八个验证函数、6 个测试对象和已存在的 `mw_validation_*` 集合未产生可见资源点入账；官方用量可能延迟最多 2 天。
- 未购买、未续费、未开通超额。函数调用与存储上传已发生，资源点统计可能尚未入账。
- 无现金支付动作。删除验证资源本身不是费用验收通过。

## 5 未验证及受阻

P04 / P05 / P06 已在 MW05 手工闭合（真实 Web 登录、`admin_users` 双层校验、开发者工具共享环境 `trustedFromContext=true`），不再列入未完成。

MW04 仍为部分完成，真实剩余仅为：

1. **P08**：MW06 已落地 `jobs` / `audit_logs` 两条查询索引。仍未创建 categories/papers/attempts 等其余未来业务集合，也未建第 7 节其他业务索引。保持 PARTIAL。
2. **P10**：HTTP 网关对 4.9 MB 与 5.1 MB 均返回 413；上限低于 4.9 MB。临时函数已删。
3. **P11**：控制台函数安全规则与集合级规则仍未逐条点选验证。

另记限制（不构成上述三项之外的未完成 P 项）：官方事务「最多 100 次」在本次 101 次操作未触发失败；更大上限未继续加压。P07 仍为 PASS。

## 6 本地检查与完成条件

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run check:prototypes` | 0 | 原型脚本解析通过 |
| `npm run typecheck` | 0 | 4 个工作区通过 |
| `npm test` | 0 | 工作区测试通过，含共享配置三态（不读真实本地配置） |
| `npm run build` | 0 | 后台 Vite 与小程序构建通过 |

完成条件未全部满足，原因仅为 **P08 / P10 / P11**。P04 / P05 / P06 已 PASS，不得再当作未完成原因。不能把 MW04 标为已完成。

## 7 交给后续

- 生产级运行时冻结 Nodejs20.19；SDK 与 CLI 版本见 [sdk-lock.md](../../../../../infra/cloudbase/sdk-lock.md)。
- 存储保持 ADMINONLY；读取必须服务端校验后再签发短期 URL。
- 客户端身份字段不可信；后台必须 Auth uid + `admin_users`；共享环境必须用 FROM_*。
- **MW05 已完成**（正式入口、真实 Web 登录、开发者工具可信 FROM 均已闭合）。
- **MW04 仍为部分完成**，真实剩余仅为 P08 / P10 / P11。MW06 只把 P08 中已落地的 `jobs` / `audit_logs` 索引补记进去，不得把 P10/P11 改写成 PASS。
