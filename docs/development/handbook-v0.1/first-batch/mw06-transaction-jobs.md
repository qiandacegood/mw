# MW06 业务事务与持久任务基础

开发手册 v0.1｜任务状态：已完成（整改后结果见 [results/mw06-result.md](results/mw06-result.md)）  
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)

## 目标与可见结果

实现可持久化、可查询、可安全恢复的业务任务、租约令牌、幂等、审计和维护状态基础，供后续已列业务复用。不是通用工作流平台。不实现会员、题库、排行、权益或支付业务。

完成后应交付：

1. 本执行说明。
2. 集合 `jobs`、`idempotency`、`audit_logs`、`app_config`（仅 `maintenance` 固定配置）及本任务所需索引。
3. `mw-admin` 的 `job.get` / `job.resume`（super），以及受控 `mw-jobs` 工作器入口。
4. 本地单元与集成测试、mw-test 有限验证与精确清理。
5. 实际结果：[results/mw06-result.md](results/mw06-result.md)，并由实际进度链接。

## 输入

MW05 已完成的正式六入口、`admin_users` 双层后台权限、共享环境 FROM_* 身份。MW01 幂等约定、数据模型第 2/4/7 节、一致性第 7 节、接口契约第 5/6 节、部署方案第 4/5 节、验收计划 T07。生产运行时 Nodejs20.19。只操作现有 mw-test。环境配置只从被 Git 忽略的 `.env` 读取。

## 本任务工作范围

1. `jobs` 支持 `queued` / `running` / `retryable` / `needsReview` / `succeeded` / `cancelled`；取得租约原子递增 `fencingToken`；续租、保存游标、成功、失败都校验当前 token；租约过期后旧工作器不得继续写入；有限重试超限进入 `needsReview`。不得把 `event.type` / `Type` 当可信定时来源。
2. 幂等：`idempotency._id = H(actorId, action, idempotencyKey)` 为完整 SHA-256；保存 `payloadHash`、`status`、`resultRef`。同键同输入重放，同键不同输入 `IDEMPOTENCY_CONFLICT`。`requestId` 只诊断。未知结果先查原记录。
3. `maintenance` 分项：`contentWrites`、`attemptStart`、`attemptSubmit`、`purchaseCreate`、`entitlementApply`，每项含 `enabled` / `reason` / `jobId` / `revision`。禁止一个总开关误阻断支付通知或其他无关入口。
4. `audit_logs` 只追加；记录必要操作者、action、target、reason、requestId、前后摘要。禁止密码、身份原文、题目全集、支付秘密或完整环境变量。
5. `job.get` 受后台权限保护；`job.resume` 仅 super。普通用户、停用管理员和伪造角色拒绝。不增加公开创建任意任务接口。
6. `mw-jobs` 拒绝客户端和伪造 timer；验证脚本走受控服务端签名调用。不部署高频定时触发器；可保留定时配置模板。
7. 索引：`jobs` 为 `state ASC, nextRunAt ASC, _id ASC`；`audit_logs` 为 `target ASC, createdAt DESC, _id ASC`。MW04 P08 只更新本次已落地索引，其余未来索引保持 PARTIAL。P10/P11 不因本任务改为 PASS。
8. mw-test 有限验证使用 `mw06/test` 前缀虚构数据；结束后精确清理测试文档，保留正式集合、索引和基础代码。事务操作预算 ≤60，并记录耗时。
9. 数据库集合客户端默认拒绝。不开放数据库或存储直接写入，不改变存储 ADMINONLY。

## 不包含的工作

不实现会员注册、题库、排行、权益账本或真实支付。不创建其他未来业务集合。不操作其他 CloudBase 环境。不创建生产环境。不升级套餐。不开启超额计费。不输出或提交环境 ID、AppID、用户 ID、密码、Token、密钥和原始证据。不把 A01—A31、T01—T30 整体标为通过。

## 有限检查与完成条件

- 两实例争抢同一任务恰好一个获得租约；中断后按游标接续（1→2）；旧 token 写入失败。
- 人工 resume 开启新的有限重试周期；恢复后可再次 acquire，不得再因旧周期次数返回 `MAX_ATTEMPTS_REACHED`。
- 幂等重放与摘要冲突、pending 必须可收敛、有限重试进入 `needsReview`、maintenance 分项互不误阻断。
- 管理员权限与伪造来源拒绝；已登录 super 的 `job.get` / `job.resume` 以真实闭环为准。
- 本地 `check:prototypes` / `typecheck` / `test` / `build` 与本任务只读残留核验可复现。
- 全部必要条件满足才标已完成；否则标部分完成或待验收，并写明缺口。

## 交给下一任务的内容

后续写入口复用本项 jobs、幂等、审计与分项维护标记。MW07 仍按自身范围做支付资格与接入，不把本项基础误写成支付已交付。
