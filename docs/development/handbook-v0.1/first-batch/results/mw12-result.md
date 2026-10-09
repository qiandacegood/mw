# MW12 实际结果

日期：2026-10-09
任务：题库与试卷批量导入
状态：**部分完成**（机制已落地；用户自报手点 4–8 通过；题库批 leftover `wroteDocs=true` / `leftoverDocs=0`；本份 knownIds 无试卷 id；未标 A21 / T16 / T17 通过；未启动 MW13）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码、upload token、OfferID、AppKey、AppSecret 只存在于被 Git 忽略的本地 `.env`。本文未写入、未提交这些值。

未把 A01—A31、T01—T30 标为通过。尤其未标 A21 / T16 / T17。未启动 MW13 / MW14 / MW18 / MW20 / MW21。未导入真实会员、真实题或真实售价。未实现答题草稿、交卷、成长、排行、类目迁移、VIP / 订单 / 退款。

## 1 本轮实现范围

| 项 | 处理 |
| --- | --- |
| 后台入口 | 题库导入、试卷导入；模板下载与字段说明；预览、确认提交、批次状态、按 ID 读草稿 |
| 模板 | UTF-8 CSV。题库：来源键、类目、题型、题干、选项 A—H、答案、解析、分值、难度、可选图。试卷：卷来源键、标题、类目、简介、目标、难度、权限、时长、题目来源键、题序、该题分值 |
| 接口 | `mw-admin` `import.validate` / `preview` / `commit` / `status`。最低权限 content（super 可做；operations 拒绝）。写操作必须 `idempotencyKey` |
| 上传 | 复用 `upload.authorize`，`purpose=import`；一次性票据、10 分钟；明文票据不入日志/证据 |
| 限制 | 单文件 ≤5 MB、最多 1000 数据行、UTF-8 |
| 可见性 | 草稿带 `importBatchId`。未 committed 时列表、按 ID、试卷引用、发布均不可见 |
| 提交 | 先全文件校验；核对行数/摘要/引用后用小事务置 `committed`；类目版本变化阻止并要求重新校验 |
| 幂等 | 同文件摘要返回原批；已存在来源键冲突不覆盖 |
| 集合 | `import_batches` / `import_rows` / `source_keys`；仅补 `import_rows(batchId ASC, rowNo ASC)`。P08 继续 PARTIAL |
| 安全 | 普通文本，公式注入加前导引号，不抓远程 URL。客户端直写拒绝 |

## 2 本地检查

虚构样例，不读真实 `.env`。

| 检查 | 退出码 |
| --- | --- |
| `npm run check:prototypes` | 0 |
| `npm run typecheck` | 0 |
| `npm test` | 0 |
| `npm run build` | 0 |
| `git diff --check` | 0 |

## 3 用户手点（执行者不得代点）

本轮执行者未登录管理后台，未用 CLI / automator / 服务端口冒充 FROM 或 admin uid。

| 步骤 | 结果 |
| --- | --- |
| 1 用 MW05 已闭合账号登录后台 | 用户回报已做 |
| 2 下载题库模板与试卷模板 | 用户回报已做 |
| 3 上传虚构合法题库 CSV → 预览 → 提交；committed 后按 ID 读到草稿题 | 用户回报已通过。本份 knownIds 解析出 1 个题库批 / 3 行 / 3 来源键 / 3 题 / 3 版本 |
| 4 再上传引用这些来源键的虚构试卷 CSV；未先有题的试卷导入必须失败 | 用户回报 4–8 全部通过。本份 JSON 无试卷 hashed id（`papers=0`），未把试卷批写入 leftover 清单 |
| 5 含阻断错行的文件：整批拒绝，不露半批 | 用户回报已通过 |
| 6 同一合法文件再传：返回原批 | 本份证据：`originalBatch=true`、`state=committed`、`rowCount=3` |
| 7 不同文件但来源键已存在：冲突不覆盖 | 本份证据：两次 `SOURCE_KEY_CONFLICT` |
| 8 复制 knownIds（只复制 SHA-256） | 已收到 hashed knownIds；1 批 + 3 素材。无明文 `_id` |

用户自报 4–8 通过。本份复制件只能证明题库批回放与来源键冲突，不能单独证明试卷提交。

## 4 非手点机制证据

以下只在本地测试/脚本完成，不能改写成用户已手点。

| 项 | 证据 |
| --- | --- |
| 1000 行上限 | 本地 `validateQuestionCsv` / `import.validate` 拒绝超过 1000 数据行 |
| 末行阻断 | 末行非法答案时整批 `IMPORT_INVALID`，不写题目文档 |
| 同文件幂等 | 相同字节再次 validate 返回 `originalBatch=true` |
| 来源键不覆盖 | 新文件重复已 committed 来源键 → `SOURCE_KEY_CONFLICT` |
| 未 committed 按 ID | 带 `importBatchId` 的草稿 `question.get` / `paper.get` 为 `NOT_FOUND` |
| 先题后卷 | 无已 committed 题目来源键时试卷 validate 失败 |
| 类目版本 | validate 后换 `treeVersion` 再 commit → `VERSION_CONFLICT` / `CATALOG_VERSION_CHANGED` |
| operations / 未登录 | official `CONTENT_ROLE_REQUIRED`；无 uid `AUTH_REQUIRED` |

## 5 部署与 leftover

只部署 `mw-admin`、`mw-upload`。mw-test 已新建 `import_batches` / `import_rows` / `source_keys`，以及 `idx_import_rows_batch_row`。CLI 无登录 `import.validate` / `import.commit` 为 `AUTH_REQUIRED`；伪造 `uid`/`role` 为 `FORBIDDEN`。未登录直写三集合拒绝。种子十类仍在（10）。`EnableOverrun=false`。未建 `attempts` / `orders` / `vip_*`。未复制 `mw-validation-*`，未重建 HTTP 大文件探针。

用户 hashed knownIds 已导入并解析为 16 个精确 `_id`（1 批 / 3 行 / 3 来源键 / 3 题 / 3 版本 / 3 素材；试卷 0）。按精确 `_id` 删除 16 条，`failed=0`。leftover：`wroteDocs=true`、`cloudWriteClaimed=true`、`leftoverDocs=0`、`leftoverObjects=0`、`exactIdSweepOnly=true`、`knownIdCount=16`、种子十类仍在、`EnableOverrun=false`、`clientDenied=true`。本清单不含试卷批；若云上另有试卷导入文档，不在这次扫描里。

## 6 未做与建议状态

建议状态：**部分完成**。题库批 leftover 已按精确 `_id` 清到 0。用户自报步骤 4–8 通过，但本份 knownIds 没有试卷 hashed id，不能把试卷导入标为有云端清理证据。不要把 A21 / T16 / T17 标通过。不要启动 MW13。
