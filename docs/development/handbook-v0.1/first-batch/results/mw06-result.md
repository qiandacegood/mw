# MW06 实际结果

日期：2026年10月8日  
任务：[业务事务与持久任务基础](../mw06-transaction-jobs.md)  
状态：**已完成**（jobs / 幂等 / 审计 / 分项 maintenance 已落地；mw-test 完成两实例租约、中断接续、旧 token 拒绝、幂等与 needsReview。MW04 的 P08 仅更新本次索引，P10/P11 仍为 PARTIAL）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、后台用户 ID、AppID、调用令牌只在被 Git 忽略的本地 `.env`。未输出、未提交。

未把 A01—A31、T01—T30 标为通过。未创建生产环境，未升级套餐，未开启超额计费，未真实支付，未增加公开创建任意任务接口，未部署高频定时触发器。

## 1 实现范围

- 共享领域：规范 JSON 完整 SHA-256、`jobs` 状态机、`fencingToken`、分项 `maintenance`、只追加审计摘要、幂等 `H(actorId,action,idempotencyKey)`。
- `mw-admin`：`job.get`（已启用管理员）、`job.resume`（仅 super，写幂等与审计）。普通用户、停用管理员、伪造角色拒绝。
- `mw-jobs`：只接受受控 `serverInvoke` HMAC。客户端、`fromClient`、伪造 `Type/Timer` 拒绝。`event.Type` 不能冒充可信来源。
- 仅创建并保留集合：`jobs`、`idempotency`、`audit_logs`、`app_config`（`maintenance` 固定文档）。未创建其他未来业务集合。
- 索引已落地：`jobs(state ASC, nextRunAt ASC, _id ASC)` 名为 `idx_jobs_state_nextrun_id`；`audit_logs(target ASC, createdAt DESC, _id ASC)` 名为 `idx_audit_target_created_id`。
- 定时配置只保留模板 `infra/cloudbase/mw-jobs-timer.example.json`，未部署。

## 2 云端版本

| 项 | 结果 |
| --- | --- |
| 正式入口运行时 | Nodejs20.19（`mw-public` / `mw-member` / `mw-admin` / `mw-upload` / `mw-pay-hook` / `mw-jobs` / `cloudbase_auth`） |
| 本地官方 runtime 摘要 | `4c53e9ec1fc2`（emit 后部署 `mw-jobs`） |
| 存储 ACL | ADMINONLY，未改 |
| 客户端直读 `jobs` | 未登录拒绝 |
| 高频 timer | 未部署 |

## 3 两实例、租约过期、旧 token 与幂等

验证数据前缀 `mw06/test`。受控并发调用，不是真实 timer。

| 检查 | 结果 |
| --- | --- |
| 两工作器争抢同一任务 | 恰好一个获得租约（`fencingToken=1`），另一路 `LEASE_HELD` |
| 工作器 A 保存游标后中断 | `cursor.done=1`，状态仍 `running` |
| 租约过期后 B 接续 | B 取得 `fencingToken=2` 并继续，游标从 1 到 2 |
| A 使用旧 token 写入 | `STALE_FENCING_TOKEN` |
| 同幂等键同输入 | 重放，不新建第二项 |
| 同幂等键不同输入 | `IDEMPOTENCY_CONFLICT` |
| 有限重试 | 第二次失败进入 `needsReview` |
| `job.get` / `job.resume` | 本地覆盖权限矩阵；云端未登录 `job.get` 为 `AUTH_REQUIRED`，伪造 `role` 的 resume 为 `CLIENT_IDENTITY_IGNORED` |
| 事务预算 | 单次最大 2 次操作、最长 247 ms（此前一轮争抢 531 ms），均 ≤60 |

真实 CloudBase timer 未实测，记 **NOT_RUN**。

## 4 集合、索引、函数与配置

| 资源 | 处理 |
| --- | --- |
| 新增并保留集合 | `jobs`、`idempotency`、`audit_logs`、`app_config` |
| 保留已有 | `admin_users`、正式六入口、`cloudbase_auth` |
| 新增并保留索引 | `idx_jobs_state_nextrun_id`、`idx_audit_target_created_id`（listIndexes 已见字段与名称） |
| 未创建 | categories / papers / attempts 等未来集合及其余第 7 节索引 |
| 新增配置模板 | `infra/cloudbase/mw-jobs-timer.example.json`（未部署） |
| 测试文档 | 已按 `_id` 精确删除；残留核验 `leftoverDocs=0` |
| 正式集合/索引/代码 | 保留 |

## 5 费用

个人版预付 40,000 资源点。`tcb env usage` 的已扣值为 0（官方可延迟）。`EnableOverrun=false`，未改账号下其他环境。未购买、未续费、未开通超额、无现金支付。本次有函数部署与调用，资源点统计可能尚未入账。

## 6 本地检查

| 命令 | 退出码 |
| --- | --- |
| `npm run check:prototypes` | 0 |
| `npm run typecheck` | 0 |
| `npm test` | 0（含并发租约、fencingToken、游标接续、needsReview、幂等冲突、maintenance 分项、伪造来源、密钥扫描、残留判定夹具） |
| `npm run build` | 0 |
| `npm run mw06:verify` | 0 |
| `npm run mw06:verify-leftovers` | 0 |

测试不读真实 `.env` 秘密；云端验证脚本只在本机读取被忽略的环境文件。

## 7 未验证边界

- 未实测平台真实 timer 触发；只验证伪造 `Type/Timer` 被拒，以及受控签名调用。
- 未再做一次后台 Web 登录后的 `job.get`；云端已拒绝未登录与伪造角色，读取状态由受控 `inspect` 与本地管理员用例覆盖。
- 未把集合安全规则在控制台逐条点选（MW04 P11 仍 PARTIAL）。未登录客户端读 `jobs` 已被拒绝。
- 未实现会员、题库、排行、权益或支付业务。

## 8 完成判定

本任务约定的必要产物和检查已满足：可持久化任务、租约令牌、有限重试、幂等冲突、分项维护、审计追加、受权 `job.get` / super `job.resume`、受控工作器、索引落地、测试数据清理。可以把 MW06 标为已完成。不能把 MW04 标为已完成，也不得把 P10/P11 改为 PASS。
