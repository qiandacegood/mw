# MW01 实际结果

日期：2026年10月8日（含第二轮文档断链整改）  
任务：[实施基线与接口约定](../mw01-baseline.md)  
状态：**已完成**（文档检查完成，程序与云端能力未验证）

## 1 实现或文档版本与修改范围

首轮交付：

- 新增 [实施基线 V1.0](../../../../architecture/implementation-baseline-v1.0.md)。
- 新增虚构样例目录 [samples/contracts](../../../../../samples/contracts/README.md)。
- 定向修正产品订单展示态、数据模型枚举、接口错误码拆分与目录说明。

2026-10-08 审核整改：

- 去掉 `mw01-baseline.md`「本次尚未创建这些产物」过期句，改为已交付链接。
- 去掉 `directory-layout.md`「results 目前为空」。
- `scoring-deltas.json`：`mem_fict_1001` 仅混合卷、当时 `totalScore=80`；`mem_fict_1003` 三张逻辑卷、当时 `totalScore=190`。
- `attempt.analysis` 字段统一为 `selectedOptionIds` + `correctOptionIds`；提交仍用 `optionIds`。已同步 API 契约、`fields.md`、样例与 `@mw/shared` 类型。

2026-10-08 第二轮：

- 修正 `mw01-baseline.md` 中 `samples/contracts` 相对链接（该文件在 `first-batch`，应回到 `F:/MW/main`，原先多一层 `../` 指向 `F:/MW`）。
- 抽查本轮涉及手册、架构、设计入口与结果文档的本地 Markdown 相对链接，目标均存在。

未修改产品 V1.0 历史原文，未创建云资源。

## 2 可见入口

| 产物 | 路径 |
| --- | --- |
| 实施基线 | `docs/architecture/implementation-baseline-v1.0.md` |
| 样例说明 | `samples/contracts/README.md` |
| 字段说明 | `samples/contracts/fields.md` |
| 类目与反例 | `samples/contracts/categories.json` |
| 题面与少选 | `samples/contracts/attempt-questions.json` |
| 分差与分类去重 | `samples/contracts/scoring-deltas.json` |
| VIP 与订单 | `samples/contracts/vip-orders.json` |
| 幂等 | `samples/contracts/idempotency.json` |
| MW04 清单 | 实施基线第 11 节 |
| MW07 清单 | 实施基线第 12 节 |

## 3 本次检查

| 检查 | 环境 | 结果 |
| --- | --- | --- |
| 过期描述 | 本地文档 | 已改 |
| 80 与 190 叙事 | 样例 JSON | 分属不同会员与时间点 |
| analysis 字段名 | API / fields / 样例 / 类型 | `selectedOptionIds` / `correctOptionIds` |
| 60/80/70 增量 | 人工 | 60、20、0；计入 80 |
| 分类分去重 | 人工 | 50/60/80 → 190/140/80，总分 190 |

未运行云端程序测试。

## 4 限制

- 本项文档检查完成，程序与云端能力未验证。
- 占位价与虚构 ID 不是正式运营配置。

## 5 完成条件

满足 MW01。整改后仍保持「文档检查完成，程序与云端能力未验证」。

## 6 交给后续任务

- MW02：页面范围、角色与状态。
- MW03：目录与契约、`samples/contracts`。
- MW04 / MW07-A：实施基线第 11、12 节。
