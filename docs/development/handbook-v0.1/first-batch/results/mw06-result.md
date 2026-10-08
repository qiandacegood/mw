# MW06 实际结果

日期：2026年10月8日  
任务：[业务事务与持久任务基础](../mw06-transaction-jobs.md)  
状态：**已完成**（最终整改基线 `b2411c2`：alreadyResumed 仅在同键 pending 时收敛；缺 workStore 失败关闭；`nonceReplay` 为 verify 必选门禁；只读核验确认 jobs token 仅在 `mw-jobs`。MW04 的 P08 仅补记已落地索引，P10/P11 仍为 PARTIAL）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、后台用户 ID、AppID、调用令牌只在被 Git 忽略的本地 `.env`。未输出、未提交。未启动 MW07。

未把 A01—A31、T01—T30 标为通过。未创建生产环境，未升级套餐，未开启超额计费，未真实支付，未增加公开创建任意任务接口，未部署高频定时触发器。

## 1 整改范围

- 人工 `job.resume` 将当前周期 `attempts` 置 0，并增加 `resumeCount` / `totalAttempts` / `lastResumeHash`。恢复后 acquire 不再返回 `MAX_ATTEMPTS_REACHED`。
- resume 的 job 更新、幂等终态和审计在同一 CloudBase 事务提交；故障注入后重试收敛到原成功或原失败，不返回永久 `pending`。
- 审计 `before` 使用真实原状态（`needsReview` 与 `retryable` 分别验证）；`reason` 限长并去掉密码/Token/密钥形态。
- 重新部署时合并各函数已有环境变量；`MW_JOBS_INVOKE_TOKEN` 只进入 `mw-jobs`。
- 同一 `serverInvoke` 签名复用 nonce 幂等结果，不产生第二次副作用。
- `mw06:verify` 全部必选门禁为 true 才退出 0，其中 **`nonceReplay` 已列入 required**；真实 timer 仍记 **NOT_RUN**。
- `mw06:verify-leftovers`：ACL 必须取得且为 `ADMINONLY`；未登录读 `jobs` 必须实际执行并被拒；集合/索引/测试文档/timer/EnableOverrun 任一未确认即非零退出。七个正式函数只读核验 `tokenPresent`/`tokenTargets`，jobs token 只能出现在 `mw-jobs`。
- 新幂等键不得把 running/succeeded/cancelled 误报为 resume 成功；成功任务 + 新键 + 相同 reason 拒绝且不追加成功审计。
- `resumeDefinedJob` / `processSignedJobsCommand` 缺 `workStore` 失败关闭，正式入口不得分步降级。

## 2 云端版本

| 项 | 结果 |
| --- | --- |
| 正式入口运行时 | Nodejs20.19（`mw-public` / `mw-member` / `mw-admin` / `mw-upload` / `mw-pay-hook` / `mw-jobs` / `cloudbase_auth`） |
| 本地官方 runtime 摘要 | `0d031e70775f` |
| 存储 ACL | 已取得且为 ADMINONLY |
| 未登录客户端直读 `jobs` | 实际执行并被拒绝 |
| 高频 timer | 未部署（`fn detail` 已确认无 timer） |

## 3 本地与云端闭环

验证数据前缀 `mw06/test`。受控签名调用，不是真实 timer。

| 检查 | 结果 |
| --- | --- |
| 两工作器争抢同一任务 | 恰好一个获得租约，另一路 `LEASE_HELD` |
| 工作器 A 保存游标后中断 | `cursor.done=1` |
| 租约过期后 B 接续 | B 取得更高 `fencingToken`，游标 **1→2** |
| A 使用旧 token 写入 | `STALE_FENCING_TOKEN` |
| 同签名 nonce 重放 | 重放原结果，租约次数不增加 |
| 同幂等键同输入 | 重放 |
| 同幂等键不同输入 | `IDEMPOTENCY_CONFLICT` |
| 有限重试 | 进入 `needsReview` |
| 未登录 `job.get` / 伪造 resume | 拒绝 |
| 已登录 super `job.get` | 成功（来源：2026-10-08 本地后台页，用户亲自输入密码；本轮未再要求输入） |
| 已登录 super `job.resume` | `ok=true`，`state=queued`，`pending=false`，`replayed=false`（同一来源，本轮未再登录） |
| resume 后受控 acquire | `attempts=0` 的新周期领取成功，不是 `MAX_ATTEMPTS_REACHED` |
| resume 后旧 token 写入 | 失败（queued 时 `JOB_NOT_RUNNING`；verify 中 running 时 `STALE_FENCING_TOKEN`） |
| resume 后完成 | 受控 worker `succeed`，状态 `succeeded` |
| 非 super / 停用管理员 | 仅本地权限矩阵，未伪造云端实测 |
| 事务预算 | 单次最大 **4** 次操作、最长 **498 ms**，均 ≤60 |

真实 CloudBase timer 未实测，记 **NOT_RUN**。

pending 故障注入（本地）：幂等写入后失败、job 更新后失败、审计写入失败，随后同键重试得到确定的原成功；业务失败同键重试得到原失败，不残留不可恢复 pending。

## 4 集合、索引、函数与配置

| 资源 | 处理 |
| --- | --- |
| 新增并保留集合 | `jobs`、`idempotency`、`audit_logs`、`app_config` |
| 保留已有 | `admin_users`、正式六入口、`cloudbase_auth` |
| 新增并保留索引 | `idx_jobs_state_nextrun_id`、`idx_audit_target_created_id` |
| 未创建 | categories / papers / attempts 等未来集合及其余第 7 节索引 |
| 新增配置模板 | `infra/cloudbase/mw-jobs-timer.example.json`（未部署） |
| 测试文档 | 本轮 `jobs` / `idempotency` / `audit_logs` 已按前缀与已知 _id 精确删除；残留核验 `leftoverDocs=0` 且计数已确认 |
| 正式集合/索引/代码 | 保留 |
| 其他函数环境变量 | 只读核验七个正式函数：`tokenPresent=true`，`tokenTargets=["mw-jobs"]`。本轮只重新部署 `mw-admin` / `mw-jobs`，未建集合/索引/timer |

## 5 费用

个人版预付 40,000 资源点。`EnableOverrun=false`，未改账号下其他环境。未购买、未续费、未开通超额、无现金支付。本次有函数部署与调用，资源点统计可能尚未入账。

## 6 本地检查

| 命令 | 退出码 |
| --- | --- |
| `npm run check:prototypes` | 0 |
| `npm run typecheck` | 0 |
| `npm test` | 0（含 resume 新周期、e2e、pending 故障恢复、审计两条路径、nonce 重放、残留离线断言、密钥扫描） |
| `npm run build` | 0 |
| `npm run mw06:verify` | 0（全部必选门禁 true；`continuedCursor=1->2`；`realTimerVerified=false`） |
| `npm run mw06:verify-leftovers` | 0（ACL/未登录拒绝/集合/索引/文档/timer/EnableOverrun/tokenTargets 均已确认） |

测试不读真实 `.env` 秘密；云端验证脚本只在本机读取被忽略的环境文件。

## 7 未验证边界

- 未实测平台真实 timer 触发；只验证伪造 `Type/Timer` 被拒，以及受控签名调用。记 **NOT_RUN**。
- 未把集合安全规则在控制台逐条点选（MW04 P11 仍 PARTIAL）。未登录客户端读 `jobs` 已被拒绝。
- 非 super / 停用管理员未再做云端登录实测，沿用本地权限矩阵。
- 未实现会员、题库、排行、权益或支付业务。

## 8 完成判定

整改与真实 mw-test 闭环已满足：可持久化任务、租约令牌、有限重试、人工 resume 新周期、幂等冲突与 pending 收敛、nonce 防重放、分项维护、审计追加、受权 `job.get` / super `job.resume`、受控工作器、索引落地、测试数据清理。可以把 MW06 标为已完成。不能把 MW04 标为已完成，也不得把 P10/P11 改为 PASS。未启动 MW07。
