# MW26 权限安全与容量专项验证

开发手册 v0.1｜任务状态：已完成（A—D 已接线并核验；E 段用户手点 1–7 全过，leftover=0 已核验。未标 A06 / A08 / A25 / A27 / A31 / T09 / T15 / T20 / T27 / T30。MW04 / MW12 仍部分完成）  
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)｜[结果](results/mw26-result.md)

本任务分多段。只操作 mw-test。没有生产环境、没有真实扣款、没有真实退款、没有 iOS / Apple 现网。`VIRTUAL_PAY_ENV` 保持沙箱，不切现网 AppKey。不开启超额。不启动 MW27—MW30。不实现备份演练、正式售价、生产开放注册。不把 A01—A31、T01—T30 标通过（尤其未标 A06 / A08 / A25 / A27 / A31 / T09 / T15 / T20 / T27 / T30，也不回标 A14 / A19 / A20 / A21）。不改写 MW01—MW25 与 MW-UI01 的历史完成记录。不把 MW04 / MW12 从部分完成改成已完成。本轮是安全矩阵 + 容量/并发报告 + 针对缺陷的必要修复与复验，不重写 VIP / 订单 / 退款账本，不重做导入 / 纠错 / 迁类 / 赠送 / 注销。不自动提交、推送或发布。E 段与 leftover=0 已闭合。

## 分段

| 分段 | 名称 | 本对话 |
| --- | --- | --- |
| MW26-A | 安全矩阵清单、容量夹具契约、并发/延迟/榜单全量名次成本测量口径 | 本对话实现 |
| MW26-B | 未登录/伪造入口/直连集合负向核验脚本；必要时修安全规则或代码缺陷并复验该条 | 本对话实现 |
| MW26-C | 虚构负载生成与清理、50 并发读/交卷、冷热启动与 ranking 全量名次成本 | 本对话实现 |
| MW26-D | leftover 云脚本、mw-test 部署与负向核验；报告写入任务结果 | 本对话部署到 mw-test |
| MW26-E | 用户手点与 leftover=0 | 用户确认 1–7 全过；leftover=0 已核验 |

## 目标与可见结果

1. 安全矩阵覆盖客户端直连、未知入口、伪造 FROM、角色越权（机制/未登录负向；已登录手点留 E）、上传票据重放与超限、注入、签名、mw-test 隔离、日志脱敏。结果只能写 PASS / FAIL / BLOCKED / NOT_RUN。模拟成功不得写成平台验收通过。
2. 容量用虚构数据：目标 1 万会员 / 1000 卷 / 10 万答题记录 / 50 并发。读接口 P95 目标 1 秒、交卷 P95 目标 2 秒；支付外部等待单独报告。记录冷热启动、数据体积、索引、运行时与地域。
3. 榜单更新目标 60 秒；必须计入为全体参与者生成完整名次的成本，不能只测前 100 行查询。
4. 达不到容量目标时先优化脏榜合并、分页和任务预算，再决定资源调整；不开启超额、不擅自加资源掩盖问题。
5. MW25 统计 200 扫描上限若在本轮压测中暴露为缺陷，可修并复验，但不把 ops 大盘做成 MW26 范围外的新功能。
6. 负载数据可识别、可精确收口：夹具标记 `fixtureRound=MW26` + 确定性 SHA-256 `_id`。不得把历史会员、种子十类、真实订单/退款/vip 账本当负载删掉。空清单或 `wroteDocs=false` 不得报 leftover=0。
7. CloudBase 写入不把文档自带 `_id` 再 set 回去。新文档不依赖多集合事务里直接插入。
8. 只针对本轮发现的缺陷修复后复验该缺陷，不反复全量跑。

## 已裁定（本轮不重开）

1. 本轮是安全矩阵 + 容量/并发报告 + 针对缺陷的必要修复与复验，不重写 VIP / 订单 / 退款账本，不重做导入 / 纠错 / 迁类 / 赠送 / 注销。
2. 不把 MW04 从部分完成改成已完成（P08/P10/P11 仍 PARTIAL）。不把 MW12 标完成。
3. 达不到容量目标时先优化脏榜合并、分页和任务预算，再决定资源调整；不开启超额、不擅自加资源掩盖问题。
4. 结果只能写 PASS / FAIL / BLOCKED / NOT_RUN；模拟成功不得写成平台验收通过。
5. 执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。可做授权范围内的部署、只读核验、未登录负向、签名 `jobs.tick`、本地/脚本压测（虚构身份哈希，不登录真人微信）。角色越权的已登录手点留给 E。
6. 不启动 MW27—MW30。不实现备份演练、正式售价、生产开放注册。
7. 不把 A01—A31、T01—T30 标通过。不改写 MW01—MW25 与 MW-UI01 的历史完成记录。

## 安全矩阵清单

结果栏只能是 PASS / FAIL / BLOCKED / NOT_RUN。CLI 未登录负向与本地机制不等于产品验收通过。已登录角色手点留 E。

| 编号 | 覆盖 | 方法 | 预期 | 谁跑 |
| --- | --- | --- | --- | --- |
| S01 | 客户端直连数据库读 `paper_answers` | 未登录 JS SDK `get` | 拒绝 | B 脚本 |
| S02 | 客户端直连改成绩（`attempts` / `score_metrics` / `paper_bests`） | 未登录 JS SDK `add`/`set` | 拒绝 | B 脚本 |
| S03 | 客户端直读解析图 | 未登录拉存储对象 | 非 200（403 或 ADMINONLY）。未拿到存储 URL 记 NOT_RUN，请求失败记 BLOCKED，二者不得 PASS | B 脚本 |
| S04 | 未知函数入口 / 入口串 action | 未登录调 `mw-public` 写动作、不存在入口 | `ACTION_DENIED` / `UNKNOWN_ENTRY` / 平台拒绝 | B 脚本 |
| S05 | 伪造 FROM / 请求体身份字段 | 事件带 `openid` / `FROM_OPENID` / `role` | `CLIENT_IDENTITY_IGNORED` 或 `AUTH_REQUIRED` | B 脚本 |
| S06 | content 无订单明细 | 本地角色单测 + E 手点 | `FORBIDDEN`，响应无金额 | B 本地；E 手点 |
| S07 | operations 不能退款/改分 | 本地角色单测 + E 手点 | `SUPER_ROLE_REQUIRED` | B 本地；E 手点 |
| S08 | 上传票据重放 | 无票、已消耗票 | `TICKET_REQUIRED` / `TICKET_REPLAY` | B 脚本 + 本地已有单测 |
| S09 | 上传超限 | 超应用限额 | 拒绝 | B 脚本 + 本地已有单测 |
| S10 | 导入 CSV 注入 | 未登录 `import.validate`，载荷含公式 | `AUTH_REQUIRED` / `FORBIDDEN`，不执行外部内容 | B 脚本 |
| S11 | 昵称注入 | 未登录 `member.updateProfile` 特殊字符 | `AUTH_REQUIRED` 或昵称校验拒绝 | B 脚本 |
| S12 | 查询构造注入 | 客户端 `where` 异常键 | 集合默认拒绝 | B 脚本 |
| S13 | 支付通知伪造 | 未签名 / 错签名调 `mw-pay-hook` | 不开通，`vipGranted=false` | B 脚本 |
| S14 | jobs token | 无 mac / 错 mac / 伪造 Timer；token 不得出现在其它函数 | 拒绝；仅 `mw-jobs` 有 token | B 脚本 |
| S15 | idempotency | 未登录带幂等键写动作 | `AUTH_REQUIRED` | B 脚本 |
| S16 | mw-test 与其它环境隔离 | `APP_ENV=mw-test`、其它环境计数、超额关闭、沙箱 `VIRTUAL_PAY_ENV=1`、无现网 AppKey | 硬门禁 | B/D 脚本 |
| S17 | 日志脱敏 | 审计 sanitizer + 公开榜响应 | 无 OPENID / 答案全集 / AppKey | B 本地 + 公开榜响应扫描 |

S06 / S07 的已登录 content / operations 手点是 E，执行者不得代登。B 段只记未登录负向与本地机制，**不得把未登录拒绝写成整行产品 PASS**；已登录部分保持 NOT_RUN（E）。未登录本身被放行则记 FAIL。

## 容量夹具契约

| 项 | 规则 |
| --- | --- |
| 标记 | 每条负载文档 `fixtureRound="MW26"`、`fixtureMarker="mw26-load"` |
| `_id` | 确定性 SHA-256：`hashNamedFields`，可由 `(round, kind, index)` 再生，不依赖扫描全集 |
| 目标 | 会员 10000、试卷 1000、已交卷记录 100000；可降级，必须写明实际规模与 BLOCKED 原因 |
| 可写集合 | `members` / `identities` / `member_stats` / `papers` / `paper_versions` / `attempts` / `score_metrics` |
| 永不写入当负载 | `orders` / `refunds` / `vip_*` / `payment_receipts` / `callback_events` / `audit_logs` / `jobs` / 种子十类 |
| 写入方式 | 单集合 upsert；`$set` / `set()` 载荷不含 `_id`；不走多集合事务直接插入 |
| 身份 | 虚构 openId 哈希，不登录真人微信，不写真实 OPENID 明文到仓库 |
| 收口 | 只按再生 `_id` 精确删本轮夹具；独立核查按 `fixtureRound=MW26` 计数，不靠 DELETE 成功数 |
| 禁止 | 空清单或 `wroteDocs=false` 报 leftover=0；`find({},100)` 当全集；删历史会员 / 种子十类 / 订单 / 退款 / vip 账本 / 审计 |

`ranking_heads` / `ranking_rows` / `app_config/ranking` 是共享派生快照，不计入 leftover 删除清单。收口后由 E 重建公开榜，避免半发布。

## 测量口径

| 指标 | 口径 |
| --- | --- |
| 读 P95 | mw-test 上 50 并发 `public.ping` / `home.get` / `category.tree` / `ranking.list`（未登录公开入口）。P95 目标 1 秒。含冷启动首次与热启动后续，分开报。 |
| 交卷 P95 | 云端真人微信 50 路交卷执行者不得冒充，标 BLOCKED/NOT_RUN。本轮测：本地 `attempt.submit` 50 并发（虚构身份、内存或同等模块路径）P95 目标 2 秒；另报云端未登录 `attempt.submit` 负向延迟（预期 `AUTH_REQUIRED`）。T09 并发 20 次机制已有单测，不把模拟写成 T09 平台通过。 |
| 支付外部等待 | 不真实扣款。单独一行 NOT_RUN/BLOCKED，不并进交卷 P95。 |
| 榜单全量名次成本 | 用夹具规模（及本地 1 万目标）调用 `buildRankingBoards` / `rebuildRanking`，计入全体参与者行生成与写入，不只测前 100 行 `ranking.list`。目标刷新 60 秒。`truncated=true` 视为未达到全量。 |
| 冷热启动 | 冷：本轮第一次公开调用；热：随后样本。记录函数超时/内存/运行时/地域（上海个人版），不把超时改大来冲 P95。 |
| 数据体积 | 本轮夹具实际写入条数、集合、是否触及扫描上限。 |
| 超额 | `EnableOverrun=false`。达不到目标先分页/预算，再记录 BLOCKED，不加资源。 |
| 统计截断 | admin-ops 统计数字旁醒目显示 `scanTruncated`；true 时标明「未扫全，数字不是全集」。禁止只藏在 JSON。 |

百分位用 nearest-rank：排序后 `ceil(p/100 * n)` 位置（1-based）。样本不足 50 时如实写 n。

## leftover 门禁

| 类别 | 是否计入 leftover | 规则 |
| --- | --- | --- |
| 本轮夹具会员/身份/统计/卷/答题/指标 | 是 | 按确定性 `_id` 精确删；独立路径按 `fixtureRound=MW26` 计数 |
| `score_metrics` 周/月行 | 是 | `mw26:seed` 把 `seededAt` / `weekKeyShanghai` / `monthKeyShanghai` 写入 `configs/mw26-verify-state.json`（Git 忽略）。`mw26:cleanup` 用状态键再生 `_id`，禁止 `new Date()` |
| 种子十类 | 否 | 永不删除 |
| 历史会员、非本轮成绩 | 否 | 不删 |
| `jobs` / `audit_logs` / 幂等 | 否 | 不把审计和任务恢复证据一律删除 |
| `ranking_heads` / `ranking_rows` / `app_config` | 否 | 共享聚合；E 收口后重建 |
| gift / order / refund / `payment_receipts` / `vip_*` | 否 | 永不整单当 leftover 删掉 |

空清单或 `wroteDocs=false` 不得报 leftover=0。沿用 MW15 起的独立核查。

## 必须由用户手点（E 段）

执行者不得 automator / CLI / 浏览器冒充 super 或微信身份。可做授权范围内的部署、只读核验、未登录负向、签名 `jobs.tick`、本地/脚本压测（虚构身份哈希）。

E 手点至少覆盖：

1. 未登录不能直读答案集合或解析图。
2. content 看不到订单明细。
3. operations 不能退款/改分。
4. 伪造支付通知/未知入口被拒。
5. 上传票据不能重放。
6. 压测后公开榜不半发布且无 OPENID。
7. 收口只删本轮夹具，不删审计/订单/退款/种子十类/非本轮会员。

第 7 步 leftover=0 须同时跑 `mw26:independent-check` 与 `mw26:verify-leftovers`。空清单不得当 0。

## 不包含的工作

不启动 MW27—MW30。不实现备份演练、正式售价、生产开放注册。不把 A06 / A08 / A25 / A27 / A31 / T09 / T15 / T20 / T27 / T30 标为正式验收通过。不把 MW04 / MW12 标完成。不重写 VIP / 订单 / 退款账本。不开启超额。不自动提交、推送或发布。
