# 07 思维工坊实际进度

开发手册 v0.1｜更新日期：2026年10月16日
[任务总览](02-roadmap.md)｜[手册入口](README.md)

本文件是开发执行状态入口。任务总览规定应做什么，本文件只记录实际做到哪里；证据和限制写入各任务结果，再由此处链接。

## 当前状态

- 产品说明书 V1.1、CloudBase 配套技术文档仍是现行设计输入。
- **MW01、MW02、MW03、MW05、MW06、MW07、MW08、MW09、MW10、MW11、MW13、MW14 已完成**；**MW04 部分完成**；**MW12 部分完成**；**MW15 已完成**（2026-10-14 手点与 leftover 收口闭合）；**MW16 已完成**（2026-10-15 用户手点 1–9 完成、leftover 收口闭合）；**MW17 已完成**（2026-10-15 用户手点 1–10 完成、leftover 收口闭合；过程中修掉一处 `ranking_rows` 行写入缺陷后补部署）；**MW18 已完成**（2026-10-15/16 A–D 接线与 mw-test 核验通过，E 段用户手点 1–12 与 leftover=0 闭合；未标 A28—A30 / T03—T07）；**MW19 已完成**（2026-10-16 A–D 接线与 mw-test 核验通过，E 段用户手点 1–12 与 leftover=0 闭合；未标 A22 / A23 / T18 / T19）；MW20—MW30 未开始。MW07 仅为技术样例：未真实扣款、未 iOS 现网、未购买闭环，未标 A14/A20/T20/T26 通过。MW06 在基线 `b2411c2` 上完成最终代码整改（alreadyResumed、缺 workStore 失败关闭、nonceReplay 门禁、jobs token 只读核验）后仍为“已完成”。
- mw-test 上 P01—P12 已逐项记录：P01—P07、P09、P12 为 PASS；MW04 真实剩余仅为 **P08/P10/P11 PARTIAL**。P08 已补记 `jobs` / `audit_logs` 索引、MW09 的 `categories` 指定索引（`parentId/deletedAt/sort/_id`）、MW10 的 `questions` 指定索引（`categoryId/status/updatedAt/_id`），以及 MW11 的 `papers` 两条指定索引（`status/categoryId/publishedAt/_id` 与 `status/sort/_id`）；其余未来索引仍 PARTIAL。P10 仍 PARTIAL（网关 413）。已锁定 Nodejs20.19 与 SDK。正式六入口、`cloudbase_auth`、`admin_users` 与 MW06 四集合已部署；MW09 已部署 `categories` / `category_names` 与种子十类；MW10 已部署 `questions` / `question_versions` / `media_assets` / `upload_tickets`；MW11 已部署 `papers` / `paper_versions` / `paper_chunks` / `paper_answers`。**没有生产环境、没有真实支付**。
- MW07-A 已于 2026-10-08 按官方现行页与思维工坊项目小程序后台完成资格核对。用户其后完成后台开通，并写入本地沙箱配置名。MW07-B 已落地签名/通知/发货隔离样例；`mw-pay-hook` 已覆盖带 `openid` 的 GET 握手、XML/JSON POST 与伪造/APIv3 拒绝。沙箱 `/xpay/query_order` 已对未知单号调用一次 `env=1`：`errcode=268490001`，`authPathReached=true`，`signatureAccepted=true`，`wroteDocs=false`。未把 A14/A20 或 T20/T26 标为通过。未真实扣款、未做 iOS 现网、未做购买闭环。
- 已在 `F:/MW/main` 初始化 Git，并以仓库级身份创建基线提交 `8294079`；`main` 已推送至 `https://github.com/qiandacegood/mw.git` 并跟踪 `origin/main`。
- MW08 代码整改 `a763d0f` 仍有效。其后曾有一轮 automator 自动跑页、导入 knownIds、精确删除 9 条，属非用户手点，不能标完成，也不改写成当时已手点通过。本轮由用户在微信开发者工具手点「运行 MW08 套件」与「复制 knownIds」闭合可信 FROM 正路径：并发唯一性来自这次手点摘要（`raceSameMember=true`）；写入新哈希 knownIds 后精确清理，`leftoverDocs=0`、`cloudWriteClaimed=true`、`wroteDocs=true`。
- MW14 已完成（`4881ef7`）。本轮只做 MW15，不改写 MW14，不改写 MW12，不重开 MW13，不启动 MW16—MW20。A 段 `mw-member` 已接通 `attempt.submit` / `result` / `analysis` / `history`，事务内按最高分差结算；B 段结果页 / 解析 / 历史成绩已接线，已交卷后答题页改为查看结果。C 段已在 mw-test 部署 `paper_bests` / `score_events` / `score_metrics` 与指定索引，负向核验 `ok:true`。D 段用户手点与 leftover=0 未闭合，故 MW15 只标部分完成。未标 A01—A31、T01—T30，尤其未标 A04 / A05 / A06 / A07 / A08 / A11 / T08 / T09 / T10 / T11 / T15。MW07 已完成（仅技术样例），不把 A14/A20/T20/T26 标通过。

## 任务状态

| 编号 | 任务 | 当前状态 |
| --- | --- | --- |
| MW01 | 实施基线与接口约定 | [已完成](first-batch/results/mw01-result.md) |
| MW02 | 页面原型与视觉规范 | [已完成](first-batch/results/mw02-result.md) |
| MW03 | 工程骨架与本地检查 | [已完成](first-batch/results/mw03-result.md) |
| MW04 | CloudBase 环境与关键能力验证 | [部分完成](first-batch/results/mw04-result.md) |
| MW05 | 可信入口与后台权限 | [已完成](first-batch/results/mw05-result.md) |
| MW06 | 业务事务与持久任务基础 | [已完成](first-batch/results/mw06-result.md)（整改闭环后恢复） |
| MW07 | 虚拟支付资格与接入验证 | [已完成（仅技术样例；未真实扣款、未标 A14/A20/T20/T26）](first-batch/results/mw07b-result.md) |
| MW08 | 会员注册与个人资料 | [已完成](first-batch/results/mw08-result.md) |
| MW09 | 三级类目基础管理 | [已完成](first-batch/results/mw09-result.md) |
| MW10 | 图片素材与题库管理 | [已完成](first-batch/results/mw10-result.md) |
| MW11 | 试卷编排与发布快照 | [已完成](first-batch/results/mw11-result.md) |
| MW12 | 题库与试卷批量导入 | [部分完成](first-batch/results/mw12-result.md) |
| MW13 | 首页与三级分类选卷 | [已完成](first-batch/results/mw13-result.md) |
| MW14 | 答题草稿与继续练习 | [已完成](first-batch/results/mw14-result.md) |
| MW15 | 交卷评分与成绩解析 | [已完成](first-batch/results/mw15-result.md)（2026-10-14 手点与 leftover 收口闭合） |
| MW16 | 成长等级与勋章 | [已完成](first-batch/results/mw16-result.md)（2026-10-15 用户手点 1–9 与 leftover 收口闭合；步骤 10 为 NOT_RUN） |
| MW17 | 四维排行榜 | [已完成](first-batch/results/mw17-result.md)（2026-10-15 用户手点 1–10 与 leftover 收口闭合；过程中修掉三处缺陷并补部署 `runtime.sha256=ccc7fcfa…`） |
| MW18 | 类目迁移与安全删除 | [已完成](first-batch/results/mw18-result.md)（E 段手点 1–12 与 leftover=0 已闭合；未标 A28—A30 / T03—T07） |
| MW19 | 题目纠错与历史重评分 | [已完成](first-batch/results/mw19-result.md) |
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

## 补充任务

| 编号 | 任务 | 当前状态 |
| --- | --- | --- |
| MW-UI01 | [UI 规范定稿与答题页样板](first-batch/mw-ui01-tdesign-quiz.md) | **已完成**（2026-10-15）：规范与组件映射定稿、TDesign 1.17.0 接入与可重复构建、答题页样板、本地检查（typecheck / 230 项测试 / 导入检查 165 文件）全部通过；开发者工具可见检查由**用户手点 4 步全通过**闭合（执行者侧未读取编译面板，记为 NOT_RUN）。结果：[mw-ui01-result.md](first-batch/results/mw-ui01-result.md) |

本补充任务只落实 TDesign 视觉基线和实际答题页样板，不启动 MW17，不改写已完成业务任务的状态。实施及验收结果另记本任务结果文件。

MW-UI01 已知遗留（不在本任务范围，供后续任务处理）：① 题图 / 选项图与放大预览未接线（`attempt.questionPage` 只返回 `assetIds`，无媒体读取 action）；② 大字号切换入口未实现；③ 结果页 / 解析页尚未按新基线换肤。本轮无云端写入，leftover 清理不适用；未改动 MW01—MW16 的完成记录。

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
| M0 开发条件就绪 | 未达到（缺 MW04 收口；MW07 已完成，仅技术样例） |
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

只整改并收口 MW08，不启动 MW09，不实现虚拟支付 / VIP / 订单 / 退款。MW07 保持 A 已完成、B 等待虚拟支付审核。没有把 A01—A31 或 T01—T30 标为已通过。

| 任务 | 结果 |
| --- | --- |
| MW08 整改 | [mw08-result.md](first-batch/results/mw08-result.md)（相对 `062aa94`：有界重试与归并、可争用本地测试、验证页防误报、leftover `wroteDocs`；四项本地检查为 0；只部署 `mw-member`；代码已落在 `a763d0f`；当时开发者工具 FROM 正路径仍 NOT_RUN，故当时仍为部分完成） |
| MW08 状态纠正 | [mw08-result.md](first-batch/results/mw08-result.md)（工作区曾把 MW08 误标已完成；上一轮 automator 自动跑页、导入 knownIds、精确删除 9 条，属非用户手点，不能标完成，也不能改写成当时已手点通过；纠正当时开发者工具用户手点 FROM 正路径 = NOT_RUN；`a763d0f` 代码整改仍有效） |
| MW08 手点收口 | [mw08-result.md](first-batch/results/mw08-result.md)（用户在微信开发者工具手点闭合：`sharedConfig=true`；首次 register `created=true`；同键重放 `replayed=true`；并发两路都 `ok` 且 `raceSameMember=true`；me `hasOpenId=false`；合法资料 OK；伪造 `CLIENT_IDENTITY_IGNORED`；新导入 9 个哈希 knownIds 后精确删除 9 条，`leftoverDocs=0`、`cloudWriteClaimed=true`、`wroteDocs=true`；未标 A01/A26/A31、T01；内容安全与停用云端写保持 NOT_RUN） |
| MW09 | [mw09-result.md](first-batch/results/mw09-result.md)（已完成：本地四项检查 0；用户已登录后台手点建二级/三级、改名、排序、停用再启用、无占用删除，同级重名 `NAME_CONFLICT`；导入 7 个测试哈希后精确清理，另按测试 ID 清理 18 条本轮 audit/idempotency；`leftoverDocs=0`、`wroteDocs=true`、种子十类仍在；未标 A03/A28/A29/T03/T04/T05；未启动 MW10） |
| MW10 | [mw10-result.md](first-batch/results/mw10-result.md)（部分完成：本地四项检查 0；已部署 `mw-admin` / `mw-upload`；mw-test 已建 questions / question_versions / media_assets / upload_tickets 与 questions 指定索引；CLI 负向 AUTH_REQUIRED / FORBIDDEN；未登录直写拒绝；存储未授权拒绝；超额关闭；种子十类仍在；当时已登录后台正路径 NOT_RUN；未标 A04/A08/A24/T15/T27；未启动 MW11） |
| MW10 手点收口 | [mw10-result.md](first-batch/results/mw10-result.md)（用户已登录后台手点：单选保存成功；多选首次因正确答案不足 2 项 `INVALID_ARGUMENT`，新建后保存成功 revision 1；判断保存成功；题干图与解析图 complete 后自动重放均为 `TICKET_REPLAY`；假格式 `UNSUPPORTED_IMAGE`；停用成功。用户哈希与云端解析对上 2 题 / 2 个已报 version / 2 个已报 asset；精确清理 28 个 knownIds 后 leftoverDocs=0、leftoverObjects=0、wroteDocs=true、种子十类仍在；未标 A04/A08/A24/T15/T27；未启动 MW11） |

同日稍后启动 MW10，不启动 MW11，不实现组卷发布、CSV 导入、答题交卷、VIP / 订单 / 退款、类目迁移。没有把 A01—A31 或 T01—T30 标为已通过。用户手点三种题型、图片与票据重放后，精确清理 leftover=0，MW10 收口为已完成。仍不启动 MW11。

同日再后启动 MW11，只做试卷编排与发布快照，不启动 MW12，不实现 CSV 导入、答题草稿、交卷评分、VIP / 订单 / 退款、类目迁移。没有把 A01—A31 或 T01—T30 标为已通过，尤其未标 A02 / A22 / T18。

| 任务 | 结果 |
| --- | --- |
| MW11 | [mw11-result.md](first-batch/results/mw11-result.md)（进行中：本地四项检查 0；已部署 `mw-admin` / `mw-public`；mw-test 已建 papers 四集合与两条指定索引；CLI 负向 AUTH_REQUIRED / FORBIDDEN；未登录直写拒绝；超额关闭；种子十类仍在；当时已登录后台正路径 NOT_RUN；未标 A02/A22/T18；未启动 MW12） |
| MW11 手点收口 | [mw11-result.md](first-batch/results/mw11-result.md)（用户已登录后台手点：组卷 draft revision 1、预览成功、发布 published revision 2；缺块 `CHUNK_MISSING`、坏摘要 `MANIFEST_HASH_MISMATCH`；发布后改题再 get/preview；下架 unpublished revision 3；撤回 withdrawn revision 4。用户哈希与云端解析对上 1 卷 / 1 version / 1 chunk / 1 answer / 1 题 / 2 个 question_versions；精确清理 19 个 knownIds 后 leftoverDocs=0、leftoverObjects=0、wroteDocs=true、种子十类仍在；未标 A02/A22/T18；未启动 MW12） |
| MW07-B | [mw07b-result.md](first-batch/results/mw07b-result.md)（官方页按 2026-10-09 重读；签名官方向量、发货适配器已落地；hook 已覆盖带 openid 的真实形态；沙箱查单 env=1 未知单 `errcode=268490001`、`authPathReached=true`、`signatureAccepted=true`、`wroteDocs=false`；未真实扣款、未标 A14/A20/T20/T26；未启动 MW12） |
| MW12 | [mw12-result.md](first-batch/results/mw12-result.md)（部分完成：用户自报手点 4–8 通过；本份 knownIds 解析题库批 16 条后精确删除，`leftoverDocs=0`、`wroteDocs=true`；无试卷 hashed id；未标 A21/T16/T17；不改写成已完成） |
| MW13 leftover 门禁 | [mw13-result.md](first-batch/results/mw13-result.md)（部分完成：leftover 不再自动收货架/列表；导入只接受 SHA-256；解析失败不得当 leftover=0；leftoverObjects 不再写死 0。公开读未重写。当时手点与 leftover 未做） |
| MW13 手点收口 | [mw13-result.md](first-batch/results/mw13-result.md)（已完成：用户手点 1–6 自报符合预期；两份测试卷哈希导入解析 2=2，精确删除 8 条后 leftoverDocs=0、wroteDocs=true、cloudWriteClaimed=true、exactIdSweepOnly=true、种子十类仍在、未出现 attempts/orders/vip_*；未标 A01/A02/A03/T03/T15；未启动 MW14；MW12 仍部分完成） |

## 本轮执行记录（2026-10-10）

只做 MW14。A 段领域逻辑已接线。上一轮执行中断（模型重复响应），本轮接手先修阻断、补全 C 段 leftover 云脚本与集合索引，执行部署与负向核验（仅 mw-test），并综合用户手点 1–8 与 leftover=0 收口；未提交。MW14 可标已完成。

| 任务 | 结果 |
| --- | --- |
| MW14-A | [mw14-attempt.md](first-batch/mw14-attempt.md)（已接线：`mw-member` 接通 6 个 attempt action，`member.me` 返回真实草稿摘要；本段不重写） |
| MW14-B | [mw14-attempt.md](first-batch/mw14-attempt.md)（已接线：试卷详情开始、答题页/答题卡/保存状态、首页继续练习；交卷只说明 MW15 未接通） |
| MW14-C | [mw14-attempt.md](first-batch/mw14-attempt.md)（已完成，仅 mw-test：`leftoverVerifyDecision` 补齐、`mw14-deploy`/`mw14-leftover-verify` 修正、新增 `mw14-assert` 与 `mw14-verify`；`npm run mw14:deploy` 建 `attempts`/`active_attempts` 与本人历史索引；`npm run mw14:verify` 负向核验 `ok:true`；本地五项检查 0） |
| MW14-D | [mw14-result.md](first-batch/results/mw14-result.md)（已完成：用户手点 1–8 自报通过；本轮 2 卷 + 1 attempt 哈希精确解析 3=3、删除 10 条、`leftoverDocs=0`，`mw14:verify-leftovers` 真实退出码 0） |

同日稍后启动 MW15，只做交卷评分与成绩解析。不改写 MW14，不改写 MW12，不重开 MW13，不启动 MW16—MW20。没有把 A01—A31 或 T01—T30 标为已通过，尤其未标 A04 / A05 / A06 / A07 / A08 / A11 / T08 / T09 / T10 / T11 / T15。

| 任务 | 结果 |
| --- | --- |
| MW15-A | [mw15-submit.md](first-batch/mw15-submit.md)（已接线：三题型判分；`mw-member` 接通 submit / result / analysis / history；事务内幂等最高分差结算） |
| MW15-B | [mw15-submit.md](first-batch/mw15-submit.md)（已接线：结果页 / 逐题解析 / 历史成绩；已交卷后答题页改为查看结果） |
| MW15-C | [mw15-result.md](first-batch/results/mw15-result.md)（已完成，仅 mw-test：`mw15:deploy` 新建三集合与指定索引、只部署 `mw-member`、跳过 attempts 历史索引；`mw15:verify` 负向 `ok:true`；本地五项检查 0） |
| MW15-D | [mw15-result.md](first-batch/results/mw15-result.md)（未闭合：手点 1–8 为 NOT_RUN；空清单 `mw15:verify-leftovers` 退出码 1，`WROTE_DOCS_FALSE`，不得当 leftover=0） |

## 本轮执行记录（2026-10-14）

先做 MW15-D 收口（用户手点与 leftover=0），同日续做 MW16。不改写 MW14、MW12，不重开 MW13，不启动 MW17。只操作 mw-test。没有把 A01—A31 或 T01—T30 标为已通过。

| 任务 | 结果 |
| --- | --- |
| MW15-D 手点 | [mw15-result.md](first-batch/results/mw15-result.md)（用户手点 1–8 自报符合预期；第 5 步分数链 6→6→9→9 与云端 6 条 `score_events` 一致；期间 1 次 `DRAFT_CONFLICT` 属预期草稿并发门禁） |
| MW15 leftover 第 1 轮 | 入册 1 卷 + 1 attempt 后导入 / 解析 / 清理 / 核验，脚本 `ok:true`、`leftoverDocs=0`；但这是入册范围内的 0，范围不完备，不得据此标闭合 |
| MW15 leftover 第 2 轮 | 用户确认 4 份 MW15 卷为本轮测试卷后定点补齐：删 37 份对象（`failed=0`），其后补删 1 条事件；独立按 paper/member 核查本轮对象为 0；MW14 遗留 3 条 abandoned attempt 保留未动 |
| 本地五项检查 | 0（`check:prototypes` / `typecheck` / `test` 103 项 / `build` / `git diff --check`；跑前已停 4174 后台 Vite） |

本轮发现（详见 [mw15-result.md](first-batch/results/mw15-result.md) 第 6 节）：`mw15:resolve-known-ids` 推导的事件 id 与云端真实 `_id` 不一致，且 DELETE 对不存在的 id 也返回成功，导致 `failed` 计数不能反映"是否真的删到了"；自 MW15 起 leftover 结论须附一条不依赖 knownIds 的独立核查。另有 `score_metrics` 4 条聚合文档随清理删除、`member_stats.totalScore` 仍为 9，榜侧指标需在 MW17 之前处理。MW15 状态由"部分完成"更正为"已完成"。

同日续做 MW16，只做成长等级与勋章。不启动 MW17，不改写 MW12 / MW14 / MW15，不重开 MW13，不冻结上线门槛。没有把 A01—A31 或 T01—T30 标为已通过，尤其未标 A09 / T29。

| 任务 | 结果 |
| --- | --- |
| MW16-A | [mw16-growth.md](first-batch/mw16-growth.md)（已接线：`@mw/shared` 门槛映射与跨级补齐勋章；`attempt.submit` 事务内定级并补授；`member.register` 授予首枚勋章；新增 `member.growth`） |
| MW16-B | [mw16-growth.md](first-batch/mw16-growth.md)（已接线：`growth.config` / `growth.preview` / `growth.publish` / `growth.recompute`；读任意后台角色，发布与重算需 super） |
| MW16-C | [mw16-growth.md](first-batch/mw16-growth.md)（已接线：「我的」个人成长展示＝等级 / 总分 / 升级进度 / 已得勋章；首页等级不再是占位） |
| MW16-D | [mw16-result.md](first-batch/results/mw16-result.md)（已完成，仅 mw-test：`mw16:deploy` 新建 `medal_grants` 与 `idx_medal_grants_member_awarded`、种子 `app_config/growth`、只部署 `mw-member` / `mw-admin`；`mw16:verify` 负向 `ok:true`；本地五项检查 0） |
| MW16-E | [mw16-result.md](first-batch/results/mw16-result.md)（当轮未闭合：手点 1–9 为 NOT_RUN；空清单下 `mw16:verify-leftovers` 退出码 1、`WROTE_DOCS_FALSE`，`mw16:independent-check` 退出码 1、`KNOWN_IDS_NOT_RESOLVED`，不得当 leftover=0。已于 2026-10-15 闭合，见下节） |

MW16 内一并评估 MW15 遗留（[mw16-result.md](first-batch/results/mw16-result.md) 第 6 节）：只读核查确认 `score_metrics` 0 条、`member_stats` 1 条且 `totalScore=9` / `levelId=L1`、`medal_grants` 0 条。MW16 等级与勋章只依赖 `member_stats.totalScore` 与 `medal_grants`，故不依赖被删的指标；但榜侧指标仍缺失，须在 MW17 开工前重建。另按 MW15 教训，MW16 的 leftover=0 必须同时附一条不依赖 knownIds、只按 member/paper 关系精确查询的独立核查（已在脚本与门禁中实现）。

## 收口记录（2026-10-15）

只做 MW16 收口：用户手点 E 段 6–9 与 leftover=0。不改写 MW12 / MW14 / MW15，不重开 MW13，不启动 MW17。只操作 mw-test。没有把 A01—A31 或 T01—T30 标为已通过，尤其未标 A09 / T29。

| 任务 | 结果 |
| --- | --- |
| MW16 手点 1–9（用户手点） | 通过。第 7 步有云端回读证据（`app_config/growth` `configVersion=3`、门槛 0/100/300/800/1500/3000、`publishedAt=2026-10-14T15:40:43.970Z`；9 分会员等级回落 L3→L1 且勋章一枚未减）；第 8 / 9 步为用户手点报告（第 9b 步新建的 VIP 卷「MW16VIP虚构练习卷」在免费会员下显示 `VIP_REQUIRED`、未真实扣款）；第 10 步为可选，记 NOT_RUN |
| MW16 leftover 收口 | 用户手点入册 1 卷 + 1 会员（本轮新注册身份，`totalScore=0`）+ 0 attempt；`mw16:import-known-ids` / `mw16:resolve-known-ids` 退出码 0；`mw16:cleanup` `targetCount=5`、`deleted=5`、`failed=0`、`independentAfterTotal=0`；`mw16:verify-leftovers` **`ok:true`、退出码 0**（knownIds 路径与独立路径同时为 0） |
| 第三条独立旁证（不依赖 knownIds） | 只看集合全集计数：`papers` 7→6、`medal_grants` 4→3、`score_metrics` 0→0、`categories` 11→11（MW13 遗留子类目「逻辑二」未删）；无 `orders` / `vip_*` |
| 本地五项检查 | 0（`check:prototypes` / `typecheck` / `test` 226 项 / `build` / `git diff --check`）。跑前须先停 4174 后台 Vite：它占用 `packages/shared/dist`，会让 `ensure-shared-js.mjs` 删除失败 |
| 提交与推送 | `a7a4612`（42 个文件：源码 + 脚本 + 文档），已推送 `origin/main`；本节哈希回写在其后的文档提交 |

A09 / T29 仍未标通过（可覆盖部分见 [mw16-result.md](first-batch/results/mw16-result.md) 第 4 节，不可覆盖部分依赖 MW20 权益账本与后续验收轮次）。`score_metrics` / `paper_bests` / `score_events` 均为 0 条，源头也已缺失，**不补写伪造聚合**；**发起人 2026-10-15 已定口径：不补记**，MW17 必须接受"历史轨迹缺失"并在榜侧显式处理 `member_stats.totalScore`（9）与 `score_metrics`（0 条）的不一致（第 6.1 节）。

遗留：`score_metrics` / `paper_bests` / `score_events` 三项均为 0 条——MW15 收口清理时连产生聚合的源头记录一并删除，9 分只剩 `member_stats.totalScore=9`（`scoreSeq=6`），故**无法忠实重建**四维指标；本轮不补写伪造聚合，口径留待 MW17 开工前由发起人确定（[mw16-result.md](first-batch/results/mw16-result.md) 第 6.1 节列了两个选项）。`member_stats` 为 2 条（9 分 / L1 与 0 分 / L1）；收口后 `medal_grants` 3 条均属历史 9 分会员（本次取"保留成长态"路径，只清了新注册身份的 `register` 授予）。A09 / T29 仍不标通过：可覆盖部分（跨级补齐、等级下降、重复不重复授予、正常既得勋章不删）已有手点与云端证据，不可覆盖部分依赖 MW20 权益账本与后续验收轮次。MW16 状态由"部分完成"更正为"已完成"。

## 本轮执行记录（2026-10-15，MW17）

只做 MW17：用户手点 E 段 1–10 与 leftover=0。不改写 MW12 / MW14 / MW15 / MW16，不重开 MW13，不启动 MW18。只操作 mw-test。没有把 A01—A31 或 T01—T30 标为通过，尤其未标 **A10—A13 / T11—T14**。

| 任务 | 结果 |
| --- | --- |
| MW17-A / B / C | 已接线（[mw17-ranking.md](first-batch/mw17-ranking.md)；`@mw/shared` 排行纯逻辑、服务端五个动作、小程序排行榜页） |
| MW17-D | 已完成（仅 mw-test）：`mw17:deploy` 部署 `mw-member` / `mw-admin` / `mw-public`、新建 `ranking_heads` / `ranking_rows` 与 `idx_ranking_rows_board_generation_ordinal`、**不预置任何榜单文档**；`mw17:verify` 负向 `ok:true`（费用筛选拒绝、入口隔离、未登录 / 伪造身份、客户端直写拒绝、种子十类在、无 `orders` / `vip_*`） |
| MW17-E 手点 1–10 | 通过（用户手点并观察到预期结果）：第 1–2 步后台读状态与重建发布；第 3–5 步空榜 / 历史缺口 / 游客无本人条 / 主动开启参与；第 6 步交卷上榜（rank 1、榜值 10）；第 7–10 步重复练习不重复加分、退出立即不公开、分类与周 / 月榜、更新延迟 |
| 过程中修掉的缺陷 | ① 快照落后被本人区域误报成「零分不上榜」（改按可追溯榜值分流）；② `cloud-ranking-stores.ts` 的 `writeRows()` 在 `set()` 载荷里带不可写的 `_id`，导致只要有名次行的重建必 `RANKING_ROWS_WRITE_FAILED`（已修 + 失败时按代回收行 + 全仓源码守卫 + 补部署）；③ 小程序单测可能跑到上一次构建的旧 JS（`vitest.config.ts` 改为 `.ts` 优先） |
| MW17 leftover 收口 | **闭合**：用户入册 3 条 attempt + 1 个会员；只读安全核查发现标记的 2 张卷是 MW11 / MW14 历史虚构练习卷（非本轮新建，其中一张还被历史 9 分会员 4 条 attempt 引用），经用户确认**保留**；重新导入后 `mw17:cleanup` `targetCount=14` / `deleted=14` / `failed=0`；后台重建后 `mw17:verify-leftovers` **`ok:true`、退出码 0**（knownIds 路径、按 member / paper 关系核查、本轮身份在 `ranking_rows` 的残留三条同时为 0） |
| 收口后云端复核 | `score_metrics` / `score_events` / `paper_bests` / `ranking_rows` 均 0；`attempts` 4 条全属历史会员（未动）；`medal_grants` 3 条历史保留；`members` / `member_stats` 2 / 2，账号与总分（9 / 10）保留；`lastBuildOk=true`、`publishedGeneration=gen_3183f198…`、`historyGapMembers=2` / `historyGapScore=19`（本轮测试身份总分保留但指标已清，口径为「不补记」） |
| 本地检查 | `check:prototypes` 0、`typecheck` 0、workspaces 单测 **280** 项全 0（admin 8 / miniprogram 36 / shared 111 / api 125）、`mw16:assert` / `mw17:assert` 0。**整链 `npm test` / `npm run build` 无法原样执行**：用户的后台 Vite（4174）期间占用 `packages/shared/dist`，而 `ensure-shared-js.mjs` 是两条命令的首步（删除失败即中断）→ 已按等价步骤逐段复跑（prototypes、`mw05-emit-runtime`、`tsc -p packages/shared/tsconfig.build.json --noEmit`、各工作区 build 与 vitest、断言脚本）全部 0；停掉 4174 后可原样补跑 |
| 未做 / 已知边界 | 手点 2 的「非 super 被拒」子项未做（需临时非 super 账号；该判定与 `reason` / 幂等键校验已有 API 单测覆盖，未登录调用 `ranking.rebuild` 的 `AUTH_REQUIRED` 已有 CLI 证据；`admin_users` 复核仅 1 个 2026-10-08 建立的 super 账号，无临时账号残留）；`git diff --check` 仅剩 `docs/design/README.md` / `visual-spec.md` 的 MW-UI01 遗留尾随空格（非本轮文件，未代改） |
| 提交与推送 | 待发起人确认后提交（本轮改动：`scripts/mw17-*.mjs`、`package.json`、`services/api/src/modules/cloud-ranking-stores.ts`、小程序排行榜文案与 `vitest.config.ts`、开发手册文档） |

## 本轮执行记录（2026-10-15，MW18）

只做 MW18：类目迁移与安全删除。不改写 MW12 / MW14 / MW15 / MW16 / MW17，不重开 MW13，不启动 MW19—MW30。只操作 mw-test。没有把 A01—A31 或 T01—T30 标为通过，尤其未标 **A28—A30 / T03—T07**。未自动提交、推送或发布。

| 任务 | 结果 |
| --- | --- |
| MW18-A / B / C | 已接线（[mw18-category-change.md](first-batch/mw18-category-change.md)）：方案 A 分类投影、`category.change.preview` / `commit` / `status`、`catalog.change` 持久任务、停用保留指标、category-only 重建隔离、后台预览确认、小程序结构更新中） |
| MW18-D | 已完成（仅 mw-test）：`mw18:deploy` 部署 `mw-admin` / `mw-jobs` / `mw-public` / `mw-member`，新建 `catalog_change_previews` / `catalog_change_jobs` 与两条索引；`mw18:verify` **`ok:true`**（未登录预览 `AUTH_REQUIRED`、伪造 Timer `FORGED_TIMER_DENIED`、种子十类 10、`orders`/`vip_*` 文档 0） |
| MW18-E 手点与 leftover | **闭合**。用户手点 1–12 符合预期（测A 迁到测B、维护期分类页更新中、停用后已开始卷可交、category-only 重建不改 `publishedGeneration`）；入册 12 条后精确删除 12；`mw18:verify-leftovers` **`ok:true`**、`leftoverDocs=0`、种子十类 10 |
| 本地检查 | `typecheck` 0、`npm test` 0（workspaces **289** 项：admin 8 / miniprogram 36 / shared 115 / api 130）、`npm run build` 0。当时 4174 未占用 `shared/dist` |
| 提交与推送 | 本轮收口提交并推送 |

## 本轮执行记录（2026-10-16，MW19）

只做 MW19：题目纠错与历史重评分。不改写 MW01—MW18 与 MW-UI01 的历史完成记录，不启动 MW20—MW30。只操作 mw-test。没有把 A01—A31 或 T01—T30 标为通过，尤其未标 **A22 / A23 / T18 / T19**。未自动提交、推送或发布。E 段用户手点与 leftover=0 已闭合。

| 任务 | 结果 |
| --- | --- |
| MW19-A / B / C | 已接线（[mw19-correction.md](first-batch/mw19-correction.md)）：纠错计划与结构指纹、补偿事件归原周期、`correction.preview` / `commit` / 持久 `grade.correction`、只关交卷并 35 秒排空、后台预览确认、小程序更正提示 |
| MW19-D | 已完成（仅 mw-test）：`mw19:deploy` 部署 `mw-admin` / `mw-jobs` / `mw-member` / `mw-public`，集合 `correction_previews` / `correction_jobs` 与两条索引；`mw19:verify` **`ok:true`**（未登录预览 `AUTH_REQUIRED`、伪造 Timer `FORGED_TIMER_DENIED`、种子十类 10、`orders`/`vip_*` 文档 0） |
| 本地检查 | `typecheck` 0、`npm test` 0（workspaces **300** 项：admin 8 / miniprogram 36 / shared 122 / api 134）、`npm run build` 0。跑前已停 4174 |
| MW19-E 手点与 leftover | **闭合**。用户确认手点 1–12 均通过；入册 9 条哈希，resolve 并按试卷题面补齐后精确删除 30、失败 0；`mw19:verify-leftovers` **`ok:true`**、`leftoverDocs=0`、`independentRemain=0`、种子十类 10 |
| 提交与推送 | 发起人确认后提交推送收口 |
