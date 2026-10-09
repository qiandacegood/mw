# MW10 实际结果

日期：2026-10-09  
任务：图片素材与题库管理  
状态：**已完成**（本地四项检查 0；mw-test 集合与 `questions` 指定索引已建；CLI 负向、未登录直写与未授权存储已拒；超额关闭；用户已登录后台手点三种题型、题干图、解析图、停用、假格式与同一票据重放；按精确 `_id` / objectKey 清理后 leftover=0，种子十类仍在）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码只存在于被 Git 忽略的本地 `.env`。本文未写入、未提交这些值，也未写入明文 upload token。

未把 A01—A31、T01—T30 标为通过。未标 A04 / A08 / A24 / T15 / T27 通过。未启动 MW11。未实现组卷发布、CSV 导入、答题交卷、VIP / 订单 / 退款、类目迁移。未创建 `papers` / `attempts` / `orders` / `vip_*`。未改存储为公开，未重建 HTTP 大文件探针，未开超额，未创建生产环境。

## 1 本轮实现范围

| 项 | 处理 |
| --- | --- |
| 集合 | 新建 `questions`、`question_versions`、`media_assets`、`upload_tickets` |
| 索引 | 仅数据模型第 7 节 `questions`：`categoryId ASC, status ASC, updatedAt DESC, _id ASC`。未建 papers / attempts 等其余第 7 节索引 |
| 题目 API | `mw-admin`：`question.list` / `get` / `save` / `disable`。最低权限 **content**（super 可做） |
| 写并发 | `save` 必须带 `expectedRevision`；冲突 `VERSION_CONFLICT`，不静默覆盖 |
| 版本 | 改题只追加 `question_versions`；旧 version 文档不覆盖。夹具模拟已被卷引用时 `question.disable` 拒绝，不丢题 |
| 题型 | 单选 2—8 不重复且恰好 1 个正确；多选 3—8、正确项 ≥2 且少于选项数；判断固定「正确」「错误」。解析非空，`defaultPoints` 正整数，难度为入门/进阶/挑战，类目须未删除且可用于组织 |
| 图片 | JPG / PNG / WebP，单张 ≤ 2 MB，文件头（magic）校验；拒 SVG / HTML / 脚本 / 外链。`purpose` 区分 `prompt` 与 `analysis` |
| 上传 | `upload.authorize` / `upload.status` + `mw-upload` 一次性票据约 10 分钟；绑定 adminUid、maxBytes、objectKey、contentType。明文票据不入日志。重放 / 过期 / 换 sha256 / 换用途 / 换管理员失败 |
| 隔离 | 对象走 `mw-test/media/{purpose}/...`；默认不可直读。解析图 `kind=analysis` 不进 `mw-public` / `mw-member` / 未交卷接口 |
| 后台 | 接 MW02 `admin-questions`：三种题型、图片上传、放大预览、缺图明确失败可重载；上传成功后自动重放同一票据；「新建下一题」避免覆盖 |
| 未做 | 组卷、导入批次、交卷评分、试卷集合、公开大文件入口 |

P08 已补记 `questions` 指定索引。**P10 仍 PARTIAL**（HTTP 网关对 4.9 MB 与 5.1 MB 均 413）。应用层图片上限仍是 2 MB；上传走票据绑定，不把存储改成公开。

## 2 本地检查

虚构题目与虚构小图，不读真实 `.env`。

| 检查 | 退出码 |
| --- | --- |
| `npm run check:prototypes` | 0 |
| `npm run typecheck` | 0 |
| `npm run test` | 0 |
| `npm run build` | 0 |
| 密钥扫描（含在 `npm test`） | 通过 |

覆盖：三种题型合法保存；非法选项数 / 答案集合 / 空解析 / 非正分值 / 未知字段 / 停用类目拒绝；`expectedRevision` 冲突；改题新 versionId、旧 version 内容不变；超 2 MB、假扩展名 HTML/SVG、外链、analysis 与 prompt 用途绑错；票据一次成功、重放失败、过期失败、换 sha256 失败；会员 / 公开 / 伪造管理员读不到答案和 analysis；`question_versions` / 解析图不出现在公开或会员响应；客户端伪造 uid/role 写题或签发票据拒绝。本地可有判分纯函数测试，**不标 A04 通过**。

## 3 部署与云端核验（mw-test）

部署入口：**`mw-admin`、`mw-upload`**。未部署其他入口，未复制 `mw-validation-*`，未新建无必要云函数，未重建 `mw-http-size-probe`。

| 项 | 结果 |
| --- | --- |
| 集合 `questions` / `question_versions` / `media_assets` / `upload_tickets` | 已建 |
| 指定索引 | leftover `indexConfirmed=true`（`idx_questions_category_status_updated_id`） |
| 种子十类 | leftover `seedCount=10`，`seedPresent=true` |
| EnableOverrun | `false` |
| 其他环境 | 数量 2，未改 |
| 存储 ACL | ADMINONLY |
| 未授权存储 GET | leftover `storageDenied=true`（非 200） |
| 未登录 Web SDK 直写 `questions` / `question_versions` / `media_assets` / `upload_tickets` | 拒绝（`clientDenied=true`） |
| CLI 无登录 `question.save` / `upload.authorize` | `AUTH_REQUIRED`（`NO_AUTH_UID`） |
| CLI 伪造 `role`/`uid` | `FORBIDDEN` / `CLIENT_IDENTITY_IGNORED` |
| `mw-upload` 无票据 | `FORBIDDEN` / `TICKET_REQUIRED` |
| `mw-public` home.get | 无 answer / analysis / question_versions |
| 试卷等未来集合 | `papers` / `attempts` / `orders` / `vip_*` 未建 |

用户脱敏证据里的 knownIds 是 `SHA-256(真实 _id)`，不能直接当云端主键删。本轮用种子类目 `285ed461ccf0ef4839af4a3cee9580cb8b206b510923b20b83aadd4c17f4b547` 解析出本轮测试文档，写入被忽略的 `configs/mw10-verify-state.json`（`wroteDocs=true`）。哈希对上：2 题、2 个用户已报 version、2 个用户已报 asset。

解析计数（只报数量，不报明文 `_id` / objectKey / fileId）：questions 2、versions 3、assets 3、tickets 3、objects 3、idempotency 7、audits 7，合计 knownIdCount=28。

精确清理尝试 28 条，其中 1 条删除命令非 0（不影响后续核验）。随后 leftover：`leftoverDocs=0`、`leftoverObjects=0`、`exactIdSweepOnly=true`、`cloudWriteClaimed=true`、`wroteDocs=true`、种子十类仍在。

## 4 后台可信身份正路径

用户在本机后台用 MW05 已闭合的用户名密码手点。执行者未代替登录，未用 automator / 服务端口代替手点。

脱敏摘要：

| 步骤 | 结果 |
| --- | --- |
| `question.save` 单选 | `ok`，revision 1 |
| `question.save` 多选（正确答案不足 2） | `INVALID_ARGUMENT` / `multiple choice needs at least 2 correct options` |
| `question.save` 判断 | `ok`，revision 2（同一题追加不可变 version） |
| `upload.authorize` + `mw-upload.complete` 题干图 | `ok`，`ticketOnce=true` |
| `mw-upload.replay` 题干图 | `INVALID_ARGUMENT` / `TICKET_REPLAY` |
| `upload.authorize` + `mw-upload.complete` 解析图 | `ok`，`ticketOnce=true` |
| `mw-upload.replay` 解析图 | `INVALID_ARGUMENT` / `TICKET_REPLAY` |
| `question.disable` | `ok`，status=`disabled` |
| 假格式图 complete | `INVALID_ARGUMENT` / `UNSUPPORTED_IMAGE` |
| `question.save` 多选（新建，正确答案 ≥2） | `ok`，revision 1，status=`active` |

用户回报的题目哈希与云端解析哈希一致：`11c793a6…` / `af9d6dff…`；version 哈希 `6ef9be03…` / `c3de85b7…`；asset 哈希 `f61cb797…` / `5cb4a174…`。票据明文未出现在回报里。

解析图隔离的云端负向已在部署核验中证明：`mw-public` / `mw-member` 响应不含 answer / analysis / `question_versions`。本轮未把解析 fileId 或环境 ID 写入对话。

## 5 通过标准对照

| 条件 | 本轮 |
| --- | --- |
| 本地四项检查 0 | 满足 |
| 三种题型与版本保存有测试 | 满足 |
| 图片格式 / 2 MB / 票据重放有测试 | 满足 |
| 解析图不进公开 / 会员响应 | 满足 |
| mw-test 集合+索引在；直写拒绝；存储未授权 403；超额关闭；只动 mw-test | 满足 |
| 已登录后台至少各有一题三种题型、一题干图、一解析图隔离证据 | 满足 |
| 测试 leftover=0，存储测试对象清空，种子十类仍在 | 满足（`wroteDocs=true`，精确 ID 清扫） |
| 未建试卷集合，未做导入 / 组卷 | 满足 |

因此 **MW10 已完成**。不进入 MW11。不把评分、导入、组卷或 VIP 标为通过。
