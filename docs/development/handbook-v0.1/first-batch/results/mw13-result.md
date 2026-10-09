# MW13 实际结果

日期：2026-10-10
任务：首页与三级分类选卷
状态：**已完成**（leftover 收集门禁已改；本地五项检查为 0；用户手点 1–6 自报符合预期；两份测试卷哈希导入后精确解析 2=2，删除 8 条，leftover=0。公开读/小程序浏览未重写）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token、后台密码只存在于被 Git 忽略的本地 `.env`。本文未写入、未提交这些值。未写入明文 paperId。

未把 A01—A31、T01—T30 标为通过。尤其未标 A01 / A02 / A03 / T03 / T15。未改写 MW12 为已完成。未启动 MW14。未实现 `attempt.*`、交卷、成长、排行、VIP 账本或支付。未创建 `attempts` / `orders` / `vip_*`。未开超额，未创建生产环境。未新建集合或索引。

## 1 本轮 leftover 门禁

| 项 | 处理 |
| --- | --- |
| 收集 | 去掉首页货架/分类列表/打开详情的自动 `rememberPapers` / `rememberPaperId`。仅详情页「记入本轮 leftover」写入。默认复制 `{ "papers": [] }` |
| 导入 | 只接受 SHA-256。空清单、非哈希失败退出，不再静默丢弃未匹配项 |
| 解析 | 禁止 `find({}, 100)` 当全集；按 count 分页。导入哈希数 > 匹配真实 `_id`、扫不全、匹配 0 条均失败，不写 `resolved=true`，不猜删 |
| 清理 | 只删已解析本轮测试卷及其 version / chunk / answer。不删种子十类，不删 MW11/MW12 非本轮残留 |
| 核验 | leftover-verify 只查已解析 `knownIds`，不扫整表。`leftoverObjects` 由已知 object id 确认，不再写死 0。空 `knownIds` / `wroteDocs=false` 仍为 `WROTE_DOCS_FALSE` |
| 未改 | 公开读契约、小程序浏览路径、`attempt.start`、排行榜费用筛选 |

## 2 本地检查

虚构类目与虚构试卷，不读真实 `.env`。

| 检查 | 退出码 |
| --- | --- |
| `npm run check:prototypes` | 0 |
| `npm run typecheck` | 0 |
| `npm run test` | 0 |
| `npm run build` | 0 |
| `git diff --check` | 0 |

已覆盖机制：父级含后代去重、未发布不可见、停用类目拒绝、游标改筛选须重开、详情无答案、`home.get` 非骨架、leftover 不自动收目录卷。T03 / T15 只积累机制证据，**不标通过**。

## 3 必须由用户点（执行者未代点）

后台用已有 content 登录，新发免费 + VIP 两份虚构测试卷，挂到已有启用类目，未改种子树。只在小程序把这两份点「记入本轮 leftover」。断网步曾误点编译导致复制为空，用户重做记入后贴回正好 2 个 SHA-256。

| 步骤 | 状态 |
| --- | --- |
| 1. 后台新发免费 + VIP 两份虚构测试卷 | PASS（用户手点） |
| 2. 微信开发者工具打开小程序并确认共享云 | PASS（用户手点） |
| 3. 游客：首页动态根类目 → 分类面包屑 → 父级含后代去重 → 难度/免费VIP/未做已做（已做应空）→ 推荐/最新 → 详情无答案 | PASS（用户自报符合预期） |
| 4. 注册/登录后再走同一路径；首页可读 member.me 总分/等级占位；免费测试卷可见开始（只提示 MW14 未接通）；VIP 测试卷 VIP_REQUIRED 无开始 | PASS（注册页 `ok=true` / `memberId=present` / `created=true`；其后路径用户自报符合预期） |
| 5. 查找已下架 PAPER_UNPUBLISHED、撤回 PAPER_WITHDRAWN、停用类目 CATEGORY_UNAVAILABLE；无卷/断网有明确提示。排行榜仍是「MW17 未做」，无费用筛选 | PASS（用户自报符合预期） |
| 6. 只点「复制本轮 leftover knownIds」。剪贴板只能是这两份测试卷的 SHA-256 | PASS（正好 2 个哈希，无明文 `_id`） |

执行者未 CLI 冒充 admin / FROM / 角色。未用 automator 或服务端口代替用户手点。

## 4 leftover

用户贴入 2 个 SHA-256。导入 `importedHashCount=2`。解析 `matchedPaperCount=2`（导入数 = 匹配数），`knownIdCount=8`：papers 2、versions 2、chunks 2、answers 2、objects 0。未扫整表猜删。精确删除 8 条，`failed=0`，`exactIdsOnly=true`。随后 leftover-verify：

| 项 | 值 |
| --- | --- |
| `wroteDocs` | true |
| `cloudWriteClaimed` | true |
| `exactIdSweepOnly` | true |
| `leftoverDocs` | 0 |
| `leftoverObjects` | 0（`leftoverObjectsConfirmed=true`，由已知 object id 空集确认，不是写死 0） |
| `seedPresent` / `seedCount` | true / 10 |
| `EnableOverrun` | false |
| `clientDenied` | true |
| `attempts` / `orders` / `vip_*` | 未出现 |

空 knownIds 未当干净。未清理非本轮 MW11/MW12 残留。

## 5 建议状态

**已完成**。手点 1–6 与 leftover=0 均已闭合。不标 A01 / A02 / A03 / T03 / T15。不改 MW12。不启动 MW14。发起人审核通过后提交推送收口。
