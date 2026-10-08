# MW04 实际结果

日期：2026年10月8日  
任务：[CloudBase 环境与关键能力验证](../mw04-cloudbase.md)  
状态：**部分完成**（P01—P04、P07—P09、P11 有限入口、P12 已实测；P05 正式微信身份与 P06 后台登录缺输入；P10 HTTP 网关未部署）

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
| P04 | node-sdk 3.18.3 / js-sdk 3.10.1 | lockfile + 云端 ping | 锁定明确版本并测事务/登录候选 | 云端加载 node-sdk 3.18.3、wx-server-sdk 4.0.2；js-sdk 3.10.1 已写入 admin 依赖 | `package-lock.json`、ping | **PASS** | 未使用 `next` 4.x；js-sdk 未做真实 Web 登录 |
| P05 | probe + CLI 调用 | 传入伪造 userId/openid/role/score | 身份来自运行上下文，伪造无效 | 识别伪造字段且 `client_identity_accepted=false`；WX 上下文无 APPID/OPENID | invoke_identity | **部分 PASS / 正式微信 NOT_RUN** | 无小程序测试号，不能标可信云调用已通过 |
| P06 | probe admin + 无测试管理员 | 传入伪造 uid/role | 认证 uid + `admin_users` 两层 | 无 Auth uid，伪造 uid 被忽略，`allowed=false` | invoke_admin | **NOT_RUN** | 按基线：没有测试管理员不标通过 |
| P07 | probe 事务 | 60/100/101 次操作；双实例争用 | 记录上限、超时、冲突 | 60=2.918s、100=4.150s、101=4.197s 均成功；双 invoke 恰好 slot_b 获胜，另一路 ALREADY_TAKEN，`remaining=0` | invoke_tx_ops / tx_claim_race / tx_read | **PASS** | 官方 100 次在 101 次未拒绝；30s 超时未做空转等待 |
| P08 | `mw_validation_index` | 建组合索引并按 parentId/deletedAt/sort/_id 查 | 顺序与索引可用 | SDK `createIndex` 不是函数；CLI `createIndexes` 索引 2→3；查询顺序 `cat_root_b`, `cat_root_a` | invoke_index、index_cli | **PASS** | 业务集合索引仍须在 MW05+ 按清单落地 |
| P09 | 存储 ACL + 临时链 | 默认私有，服务端短期读，不开放公桶 | ADMINONLY；未授权 403；属主才签发 | 默认曾为可读；已改为 ADMINONLY。属主签发 60s 临时链；非属主不签发。ACL 生效后 CDN/COS 未授权均为 403 | fixup + private-retest | **PASS** | 改 ACL 前 CDN 曾 200，属旧公开权限/传播，已复测 |
| P10 | 4.9 / 5.1 MB 虚构文件 | 上传或网关拒绝 | 4.9 可接受，5.1 被拒或记录边界 | 存储 SDK 与 CLI 两者都成功；`mw-validation-upload` 对 5.1 MB 返回 PAYLOAD_TOO_LARGE（limit 5242880） | size invoke、cli_upload、upload entry | **PASS（边界已记录）** | 未部署 HTTP 函数，网关字节上限 **NOT_RUN** |
| P11 | 六类有限入口 | 伪造身份与越权 action | 公开只读、会员需可信上下文、后台两层、上传要票据、支付要签名、任务拒客户端 | 均按设计拒绝或放行；Web SDK 无凭据直读集合报 MISSING_CREDENTIALS | 各 entry invoke、client_direct_db | **PASS（有限入口）** | 非正式业务；小程序端函数安全规则 **NOT_RUN** |
| P12 | 个人版用量 | 只记录，不购买 | 不开启超额 | 40,000 点，用量接口仍 0.00（官方可延迟至 2 天）；未买资源包、未超额 | env usage | **PASS** | 实际消耗以控制台延迟统计为准 |

## 3 实际创建或修改的云资源

保留，供 MW05 对照；删除前须再确认。

| 资源 | 处理 |
| --- | --- |
| 云函数 `mw-validation-runtime22` | 新建，Nodejs22.21，已保留 |
| 云函数 `mw-validation-probe` | 新建，Nodejs20.19，已保留 |
| 云函数 `mw-validation-public` / `member` / `admin` / `upload` / `pay-hook` / `jobs` | 新建有限入口，已保留 |
| 集合 `mw_validation_tx` / `index` / `admin_users` / `files` / `docs` | 测试集合，已保留 |
| 索引 `mw_validation_parent_sort` | 在 `mw_validation_index` 上由 CLI 创建 |
| 对象 `mw-test/validation/*` | 私有测试文件，已保留 |
| 存储 ACL | 改为 ADMINONLY 并保留 |
| 生产环境 / 正式域名 / 超额计费 | 未创建、未配置、未开启 |

## 4 费用与资源点

- 周期内套餐 40,000 点。两次 `tcb env usage` 均显示 0.00 / 40000.00，资源包与按量均为 0。
- 未购买、未续费、未开通超额。函数调用与存储上传已发生，资源点统计可能尚未入账。
- 无现金支付动作。

## 5 未验证及受阻

1. 正式小程序 AppID / 云调用 OPENID：无测试号，P05 可信上下文 NOT_RUN。
2. 测试管理员与 Web SDK 登录：无预置账号，P06 NOT_RUN。
3. HTTP 网关真实字节上限：未部署 HTTP 函数，避免额外公网面。
4. 小程序开发者工具 / 真机调用函数安全规则。
5. 官方事务「最多 100 次」在本次 101 次操作未触发失败；更大上限未继续加压。
6. 集合级控制台安全规则未用交互控制台逐条点选；未登录 Web SDK 直读已被拒绝。

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
- 可启动 MW05 入口骨架与拒绝越权；**不能**宣称可信小程序登录或后台登录已闭合。
