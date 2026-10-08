# 07 思维工坊实际进度

开发手册 v0.1｜更新日期：2026年10月9日  
[任务总览](02-roadmap.md)｜[手册入口](README.md)

本文件是开发执行状态入口。任务总览规定应做什么，本文件只记录实际做到哪里；证据和限制写入各任务结果，再由此处链接。

## 当前状态

- 产品说明书 V1.1、CloudBase 配套技术文档仍是现行设计输入。
- **MW01、MW02、MW03、MW05、MW06 已完成**；**MW04 部分完成**；**MW07 部分完成（A 已完成，B 未开始/受阻）**；**MW08 部分完成**；MW09—MW30 未开始。MW06 在基线 `b2411c2` 上完成最终代码整改（alreadyResumed、缺 workStore 失败关闭、nonceReplay 门禁、jobs token 只读核验）后仍为“已完成”。
- mw-test 上 P01—P12 已逐项记录：P01—P07、P09、P12 为 PASS；MW04 真实剩余仅为 **P08/P10/P11 PARTIAL**。P08 已补记本次落地的 `jobs` / `audit_logs` 索引，其余未来索引仍 PARTIAL。已锁定 Nodejs20.19 与 SDK。正式六入口、`cloudbase_auth`、`admin_users` 与 MW06 四集合已部署。**没有生产环境、没有真实支付**。
- MW07-A 已于 2026-10-08 按官方现行页与思维工坊项目小程序后台完成资格核对：已认证企业、类目「工具 > 信息查询」已通过、未备案、虚拟支付入口存在且条件满足但**尚未开通**。未把 A14/A20 或 T20/T26 标为通过。
- 已在 `F:/MW/main` 初始化 Git，并以仓库级身份创建基线提交 `8294079`；`main` 已推送至 `https://github.com/qiandacegood/mw.git` 并跟踪 `origin/main`。
- 下一项建议：先用开发者工具补齐 MW08 的共享环境可信 FROM 正路径，再决定是否进入 MW09。本轮不启动 MW09。MW07-B 待用户完成虚拟支付开通后再启动。

## 任务状态

| 编号 | 任务 | 当前状态 |
| --- | --- | --- |
| MW01 | 实施基线与接口约定 | [已完成](first-batch/results/mw01-result.md) |
| MW02 | 页面原型与视觉规范 | [已完成](first-batch/results/mw02-result.md) |
| MW03 | 工程骨架与本地检查 | [已完成](first-batch/results/mw03-result.md) |
| MW04 | CloudBase 环境与关键能力验证 | [部分完成](first-batch/results/mw04-result.md) |
| MW05 | 可信入口与后台权限 | [已完成](first-batch/results/mw05-result.md) |
| MW06 | 业务事务与持久任务基础 | [已完成](first-batch/results/mw06-result.md)（整改闭环后恢复） |
| MW07 | 虚拟支付资格与接入验证 | [部分完成（A 已完成，B 未开始/受阻）](first-batch/results/mw07a-result.md) |
| MW08 | 会员注册与个人资料 | [部分完成](first-batch/results/mw08-result.md) |
| MW09 | 三级类目基础管理 | 未开始 |
| MW10 | 图片素材与题库管理 | 未开始 |
| MW11 | 试卷编排与发布快照 | 未开始 |
| MW12 | 题库与试卷批量导入 | 未开始 |
| MW13 | 首页与三级分类选卷 | 未开始 |
| MW14 | 答题草稿与继续练习 | 未开始 |
| MW15 | 交卷评分与成绩解析 | 未开始 |
| MW16 | 成长等级与勋章 | 未开始 |
| MW17 | 四维排行榜 | 未开始 |
| MW18 | 类目迁移与安全删除 | 未开始 |
| MW19 | 题目纠错与历史重评分 | 未开始 |
| MW20 | VIP 权益账本与判权 | 未开始 |
| MW21 | VIP 套餐与在线购买 | 未开始 |
| MW22 | 退款与账务对账 | 未开始 |
| MW23 | 个人中心与反馈运营 | 未开始 |
| MW24 | 正式协议与账号注销 | 未开始 |
| MW25 | 后台运营统计与使用说明 | 未开始 |
| MW26 | 权限安全与容量专项验证 | 未开始 |
| MW27 | 备份恢复与发布回退演练 | 未开始 |
| MW28 | 首批正式内容与运营配置 | 未开始 |
| MW29 | 双端全流程与支付验收 | 未开始 |
| MW30 | 正式发布与首版交接 | 未开始 |

## 状态规则

| 状态 | 含义 |
| --- | --- |
| 未开始 | 尚未启动该任务 |
| 进行中 | 已明确启动，正在按范围工作 |
| 部分完成 | 已有明确可用产物，必要子段仍未完成 |
| 待验收 | 实现已交付，必要验收尚未结束 |
| 受阻 | 已启动且当前所需外部条件缺失；写明缺什么和可继续做什么 |
| 已完成 | 该任务约定的必要产物和检查全部满足，有结果记录链接 |

新增“已完成”状态必须链接实际结果，并记录环境、版本和保留限制。已验收后发现实质缺陷，应记录重开或修复状态，不修改历史通过记录冒充当时已覆盖。

## 里程碑

| 里程碑 | 当前状态 |
| --- | --- |
| M0 开发条件就绪 | 未达到（缺 MW04 收口；MW07-A 已完成，B 未开始） |
| M1 练习闭环 | 未达到 |
| M2 成长与内容维护 | 未达到 |
| M3 交易与运营闭环 | 未达到 |
| M4 首版待发布 | 未达到 |
| M5 首版正式交付 | 未达到 |

## 本轮执行记录（2026-10-08）

连续执行 MW01—MW03 后，同日启动 MW04，并续做 MW05、MW06。没有把 A01—A31 或 T01—T30 标为已通过。

| 任务 | 结果 |
| --- | --- |
| MW01 | [mw01-result.md](first-batch/results/mw01-result.md)（整改后仍为已完成） |
| MW02 | [mw02-result.md](first-batch/results/mw02-result.md)（第三轮后台走查后仍为已完成） |
| MW03 | [mw03-result.md](first-batch/results/mw03-result.md)（串行 npm test×5 均为 0；DevTools NOT_RUN） |
| MW04 | [mw04-result.md](first-batch/results/mw04-result.md)（部分完成：P01—P07/P09/P12 PASS；P08/P10/P11 PARTIAL；HTTP 4.9/5.1 均为 413） |
| MW05 | [mw05-result.md](first-batch/results/mw05-result.md)（已完成：P04/P05/P06 手工验证已闭合） |
| MW06 | [mw06-result.md](first-batch/results/mw06-result.md)（最终整改后已完成：alreadyResumed 收敛收紧、缺 workStore 失败关闭、nonceReplay 必选、tokenTargets 仅 mw-jobs；真实 timer NOT_RUN；未启动 MW07） |
| MW07-A | [mw07a-result.md](first-batch/results/mw07a-result.md)（官方现行页与项目小程序后台已核对：已认证企业、未备案、虚拟支付可申请未开通；B 受阻；未标 A14/A20、T20/T26 通过） |
| MW08 | [mw08-result.md](first-batch/results/mw08-result.md)（部分完成：基线 `062aa94` 整改后本地重试/争用测试与验证页判定已修；mw-test 负向与 leftover 空扫已核验；可信 FROM 注册/重放/me/资料/并发仍 NOT_RUN；未标 A01/A26/A31、T01 通过；未启动 MW09） |

## 本轮执行记录（2026-10-09）

只整改 MW08，不启动 MW09，不实现虚拟支付 / VIP / 订单 / 退款。MW07 保持 A 已完成、B 等待虚拟支付审核。没有把 A01—A31 或 T01—T30 标为已通过。

| 任务 | 结果 |
| --- | --- |
| MW08 整改 | [mw08-result.md](first-batch/results/mw08-result.md)（相对 `062aa94`：有界重试与归并、可争用本地测试、验证页防误报、leftover `wroteDocs`；四项本地检查为 0；只部署 `mw-member`；开发者工具 FROM 正路径 NOT_RUN，故仍为部分完成） |
