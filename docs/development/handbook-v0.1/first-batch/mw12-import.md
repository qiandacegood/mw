# MW12 题库与试卷批量导入

开发手册 v0.1｜任务状态：部分完成（结果见 [results/mw12-result.md](results/mw12-result.md)）
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)

## 目标与可见结果

后台提供题库导入、试卷导入两个入口，以及 UTF-8 CSV 模板、校验预览、确认提交和批次结果页。不实现答题草稿、交卷、成长、排行、类目迁移、VIP/订单/退款。

完成后应交付：

1. 本执行说明与 [results/mw12-result.md](results/mw12-result.md)。
2. 题库 / 试卷 CSV 模板与字段说明；开发样例必须虚构。
3. `mw-admin` 的 `import.validate` / `preview` / `commit` / `status`；复用 `upload.authorize`，`purpose=import`。
4. 集合 `import_batches` / `import_rows` / `source_keys`，以及数据模型已列的 `import_rows(batchId ASC, rowNo ASC)` 索引。
5. 未 committed 的导入草稿在列表、按 ID 读取、试卷引用和发布中都不可见。
6. 本地五项检查退出码 0。用户手点 1–8 闭合前整项最多部分完成。

## 输入

MW10 题目版本与 upload ticket、MW11 试卷快照、MW06 事务/幂等/审计、MW09 种子十类。只操作 mw-test。不开启超额，不购买套餐，不真实扣款。

## 本任务工作范围

1. 单文件 ≤5 MB、最多 1000 个数据行，UTF-8 CSV。超限拒绝。
2. 阻断错误整批不写入有效题目/试卷。非阻断疑似重复只提示。
3. 状态机 `uploaded → validated → staging → committed / failed`。先全文件校验再接受确认。
4. 分批写入占位，批次未 committed 前按 ID 也不可见。提交用小事务把批次置 committed。
5. 同文件摘要返回原批。已存在来源键冲突不覆盖。类目版本变化必须重新校验。
6. 导入内容当普通文本，处理电子表格公式注入，不抓取远程 URL。
7. 最低权限 content（super 可做；operations 拒绝）。写操作必须 `idempotencyKey`。
8. 用户手点后台正路径；执行者不得 CLI 冒充登录。A21 / T16 / T17 只积累机制证据，不标通过。

## 不包含的工作

不启动 MW13 / MW14 / MW18 / MW20 / MW21。不导入真实会员或真实题。不把未 committed 草稿拿去 `paper.publish`。不修改腾讯云微信公众平台关联、不改生产、不开超额。
