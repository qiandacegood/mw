# MW11 实际结果

日期：2026-10-09  
任务：试卷编排与发布快照  
状态：**已完成**（本地四项检查 0；mw-test 已建 papers / paper_versions / paper_chunks / paper_answers 与 papers 两条指定索引；已部署 `mw-admin` / `mw-public`；CLI 负向 AUTH_REQUIRED / FORBIDDEN；未登录直写四集合拒绝；超额关闭；用户已登录后台手点组卷 / 预览 / 发布 / 缺块拒绝 / 坏摘要拒绝 / 改题后再读 / 下架 / 撤回；按精确 `_id` 清理后 leftover=0，种子十类仍在）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码只存在于被 Git 忽略的本地 `.env`。本文未写入、未提交这些值。

未把 A01—A31、T01—T30 标为通过。未标 A02 / A22 / T18 通过。未启动 MW12。未实现 CSV 导入、答题草稿、交卷评分、VIP / 订单 / 退款、类目迁移。未创建 `attempts` / `paper_bests` / `orders` / `vip_*` / `import_*`。未改存储为公开，未重建 HTTP 大文件探针，未开超额，未创建生产环境。发布不等于公众上线，也不等于 MW13 首页选卷已完成。

## 1 本轮实现范围

| 项 | 处理 |
| --- | --- |
| 集合 | 新建 `papers`、`paper_versions`、`paper_chunks`、`paper_answers` |
| 索引 | 仅数据模型第 7 节 papers 两条：`status ASC, categoryId ASC, publishedAt DESC, _id ASC` 与 `status ASC, sort ASC, _id ASC`。P08 继续 PARTIAL |
| 后台 API | `mw-admin`：`paper.list` / `get` / `save` / `preview` / `publish` / `unpublish` / `withdraw`。最低权限 **content**（super 可做；operations 不能组卷） |
| 写并发 | 写操作必须 `idempotencyKey` + `expectedRevision`；冲突 `VERSION_CONFLICT`，不静默覆盖 |
| 发布 | 先组完整 chunks + answers + version 并校验题数/题序/1—100 整数分/满分/块摘要/manifestHash，最后切换 `activeVersionId`。缺块、坏摘要、停用/删除类目、未 ready 素材、题目 currentVersion 对不上均拒绝，不露半套 |
| 不可变 | 已发布 `paper_versions` / chunks / answers 不可覆盖。被已发布卷引用的 `question_versions` 停用走 MW10 paper-ref 拒绝 |
| 下架 | `unpublish`：status=`unpublished`，只阻止新开始。`withdraw`：必须 reason，status=`withdrawn`，`PAPER_WITHDRAWN` |
| 权限 | 首版不开放已发布卷 free↔vip 互转；类目不在普通编辑表单改。标题/简介/排序可改并留审计 |
| 公开读 | `mw-public` `paper.list` / `paper.detail` 只回已发布摘要，不含答案、解析、`paper_answers`、`question_versions`。不是 MW13 |
| 后台页 | 接 MW02 试卷页：组卷、整卷预览、发布、普通下架、紧急撤回；解析图不进公开包 |
| 未做 | CSV 导入、attempt.*、交卷评分、VIP / 订单 / 退款、类目迁移、MW12 / MW13 |

P08 已补记 papers 两条指定索引。**P10 仍 PARTIAL**。**P11 不准改成 PASS**。

## 2 本地检查

虚构题目与虚构试卷，不读真实 `.env`。

| 检查 | 退出码 |
| --- | --- |
| `npm run check:prototypes` | 0 |
| `npm run typecheck` | 0 |
| `npm run test` | 0 |
| `npm run build` | 0 |
| 密钥扫描（含在 `npm test`） | 通过 |

已覆盖：1 题与 21 题（跨两块）、满分计算、非法题数/分值/未知字段拒绝；缺块、坏摘要、未 ready 图不可发布；发布后改题旧 `paper_versions` / chunks / answers 不变；unpublish 与 withdraw 状态不同；会员 / 公开 / 伪造管理员读不到答案和解析；客户端伪造身份写卷拒绝。T18 只积累机制证据，**不标通过**。

## 3 部署与云端核验（mw-test）

部署入口：**`mw-admin`、`mw-public`**。未部署其他入口，未复制 `mw-validation-*`，未新建无必要云函数，未重建 `mw-http-size-probe`。

| 项 | 结果 |
| --- | --- |
| 集合 `papers` / `paper_versions` / `paper_chunks` / `paper_answers` | 已建 |
| 指定索引 | `idx_papers_status_category_published_id`、`idx_papers_status_sort_id` |
| 种子十类 | leftover `seedCount=10`，`seedPresent=true` |
| EnableOverrun | `false` |
| 其他环境 | 数量 2，未改 |
| 未登录 Web SDK 直写四集合 | 拒绝（`clientDenied=true`） |
| CLI 无登录 `paper.save` / `paper.publish` | `AUTH_REQUIRED`（`NO_AUTH_UID`） |
| CLI 伪造 `role`/`uid` | `FORBIDDEN` / `CLIENT_IDENTITY_IGNORED` |
| `mw-public` `paper.list` | 无 answer / analysis / paper_answers / question_versions |
| 未来集合 | `attempts` / `paper_bests` / `orders` / `vip_*` / `import_*` 未建 |

用户脱敏证据里的 knownIds 是 `SHA-256(真实 _id)`，不能直接当云端主键删。本轮按用户回报哈希解析本轮测试文档，写入被忽略的 `configs/mw11-verify-state.json`（`wroteDocs=true`）。哈希对上：1 卷、1 个 paper_version、1 个 chunk、1 个 answer、1 题、2 个 question_versions。

解析计数（只报数量，不报明文 `_id`）：papers 1、versions 1、chunks 1、answers 1、questions 1、questionVersions 2、idempotency 6、audits 6，合计 knownIdCount=19。

精确清理删除 19 条，`failed=0`，`exactIdsOnly=true`。随后 leftover：`leftoverDocs=0`、`leftoverObjects=0`、`exactIdSweepOnly=true`、`cloudWriteClaimed=true`、`wroteDocs=true`、种子十类仍在。

## 4 后台可信身份正路径

用户在本机后台用 MW05 已闭合的用户名密码手点。执行者未代替登录，未用 automator / 服务端口 / 伪造 FROM 或 admin uid 冒充。写并发为 `expectedRevision`。

脱敏摘要：

| 步骤 | 结果 |
| --- | --- |
| `paper.save` | `ok`，status=`draft`，revision 1，questionCount 1，maxScore 5 |
| `paper.preview` | `ok` |
| `paper.publish` | `ok`，status=`published`，revision 2 |
| 故障 `paper.publish`（缺块） | `INVALID_ARGUMENT` / `CHUNK_MISSING` |
| 故障 `paper.publish`（坏摘要） | `INVALID_ARGUMENT` / `MANIFEST_HASH_MISMATCH` |
| `paper.get`（发布后改题） | `ok` |
| `paper.preview`（发布后改题） | `ok` |
| `paper.unpublish` | `ok`，status=`unpublished`，revision 3 |
| `paper.withdraw` | `ok`，status=`withdrawn`，revision 4；reason 为紧急撤回未提交交卷 |

用户回报的试卷哈希与云端解析哈希一致：`3126478a…`；version 哈希 `a4671c56…`；chunk 哈希 `a1639baf…`；answer 哈希 `f9da1e14…`；题目哈希 `976606e6…`；两个 question_version 哈希 `e41139ef…` / `2894db98…`。同一 `paper_version` 在下架与撤回时未换；两个题目版本对应发布后改题。终态 `withdrawn` / revision 4。

答案与解析隔离的云端负向已在部署核验中证明：`mw-public` 响应不含 answer / analysis / `paper_answers` / `question_versions`。本轮未把明文 paperId / versionId 或环境 ID 写入本文。

## 5 通过标准对照

| 条件 | 本轮 |
| --- | --- |
| 本地四项检查 0 | 满足 |
| 1/21 题、满分、非法拒绝、缺块/坏摘要/未 ready 图有测试 | 满足 |
| 发布后改题快照不变；unpublish ≠ withdraw | 满足 |
| 公开/会员/伪造身份读不到答案解析 | 满足 |
| mw-test 集合+索引在；直写拒绝；超额关闭；只动 mw-test | 满足 |
| 已登录后台组卷/预览/发布/缺块拒绝/改题快照/下架/撤回 | 满足 |
| 测试 leftover=0 且 wroteDocs=true 且精确 ID 清扫 | 满足 |

因此 **MW11 已完成**。不进入 MW12。不把 A02 / A22 / T18 或首页选卷标为通过。
