# MW04 实际结果

日期：2026年10月8日  
任务：[CloudBase 环境与关键能力验证](../mw04-cloudbase.md)  
状态：**部分完成**（P01—P03、P07、P09、P12 为 PASS；P04 / P08 / P10 / P11 为 PARTIAL；P05 正式微信身份与 P06 后台登录缺输入。P01—P12 已逐项记录，其中部分 NOT_RUN/PARTIAL）

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
| P04 | node-sdk 3.18.3 / js-sdk 3.10.1 | lockfile + 云端 ping | 锁定明确版本并测事务/登录候选 | SDK 已锁定：云端加载 node-sdk 3.18.3、wx-server-sdk 4.0.2；js-sdk 3.10.1 已写入 admin 依赖 | `package-lock.json`、ping | **PARTIAL** | 真实 Web 登录未测；未使用 `next` 4.x |
| P05 | probe + CLI 调用 | 传入伪造 userId/openid/role/score | 身份来自运行上下文，伪造无效 | 识别伪造字段且 `client_identity_accepted=false`；WX 上下文无 APPID/OPENID | invoke_identity | **部分 PASS / 正式微信 NOT_RUN** | 无小程序测试号，不能标可信云调用已通过 |
| P06 | probe admin + 无测试管理员 | 传入伪造 uid/role | 认证 uid + `admin_users` 两层 | 无 Auth uid，伪造 uid 被忽略，`allowed=false` | invoke_admin | **NOT_RUN** | 按基线：没有测试管理员不标通过 |
| P07 | probe 事务 | 60/100/101 次操作；双实例争用 | 记录上限、超时、冲突 | 60=2.918s、100≈4.15s、101=4.197s 均成功；双 invoke 恰好 slot_b 获胜，另一路 ALREADY_TAKEN，`remaining=0` | invoke_tx_ops / tx_claim_race / tx_read | **PASS** | 100 次约 4.15 秒，已超过设计目标 3 秒；MW06 仍按 ≤60 次设计预算。官方 100 次在 101 次未拒绝；30s 超时未做空转等待 |
| P08 | `mw_validation_index` | 建组合索引并按 parentId/deletedAt/sort/_id 查 | 顺序与索引可用 | 代表性组合索引及 CLI 路径已验证：SDK `createIndex` 不是函数；CLI `createIndexes` 索引 2→3；查询顺序 `cat_root_b`, `cat_root_a` | invoke_index、index_cli | **PARTIAL** | 数据模型第 7 节全部业务索引尚未落地 |
| P09 | 存储 ACL + 临时链 | 默认私有，服务端短期读，不开放公桶 | ADMINONLY；未授权 403；属主才签发 | 默认曾为可读；已改为 ADMINONLY。属主签发 60s 临时链；非属主不签发。**PASS 依据是 ACL 修复后的 private-retest 403** | fixup + private-retest | **PASS** | 改 ACL 前 CDN 曾 200，属旧公开权限/传播，不以当时结果作为通过依据 |
| P10 | 4.9 / 5.1 MB 虚构文件 | 上传或网关拒绝 | 4.9 可接受，5.1 被拒或记录边界 | 应用入口已测：存储 SDK/CLI 两者都成功；`mw-validation-upload` 对 5.1 MB 返回 PAYLOAD_TOO_LARGE（limit 5242880） | size invoke、cli_upload、upload entry | **PARTIAL** | HTTP 网关 **NOT_RUN**（未部署 HTTP 函数）。删除验证函数不改变本项，也不构成通过 |
| P11 | 六类有限入口 | 伪造身份与越权 action | 公开只读、会员需可信上下文、后台两层、上传要票据、支付要签名、任务拒客户端 | 验证桩拒绝链已测；Web SDK 无凭据直读集合报 MISSING_CREDENTIALS | 各 entry invoke、client_direct_db | **PARTIAL** | 真实小程序身份、函数安全规则及正式入口未测。删除验证桩不把本项改写成通过 |
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

1. 正式小程序 AppID / 云调用 OPENID：无测试号，P05 可信上下文 NOT_RUN。
2. 测试管理员与 Web SDK 登录：无预置账号，P06 NOT_RUN。
3. HTTP 网关真实字节上限：未部署 HTTP 函数，避免额外公网面。
4. 小程序开发者工具 / 真机调用函数安全规则。
5. 官方事务「最多 100 次」在本次 101 次操作未触发失败；更大上限未继续加压。
6. 集合级控制台安全规则未用交互控制台逐条点选；CLI 无已确认的按集合 ACL 命令，故未猜测配置。五个 `mw_validation_*` 名称收尾后均不存在。
7. 小程序端函数安全规则在验证桩删除后仍未测。

## 6 本地检查与完成条件

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run check:prototypes` | 0 | 原型脚本解析通过 |
| `npm run typecheck` | 0 | 4 个工作区通过 |
| `npm test` | 0 | 14 项：admin 1、miniprogram 1、shared 10、api 2 |
| `npm run build` | 0 | 后台 Vite 与小程序构建通过 |

完成条件未全部满足：缺测试管理员与小程序测试号，不能把 MW04 标为已完成。

## 7 交给 MW05

- 生产级运行时冻结 Nodejs20.19；SDK 与 CLI 版本见 [sdk-lock.md](../../../../../infra/cloudbase/sdk-lock.md)。
- 存储保持 ADMINONLY；读取必须服务端校验后再签发短期 URL。
- 客户端身份字段不可信；后台必须 Auth uid + `admin_users`。
- **MW05 可有限启动**：入口骨架与拒绝越权。**不能**宣称可信小程序登录或后台登录已闭合，也不得复制 `mw-validation-*` 桩为正式实现。
