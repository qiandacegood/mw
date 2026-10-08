# MW09 实际结果

日期：2026-10-09  
任务：三级类目基础管理  
状态：**已完成**（本地四项检查 0；mw-test 集合、指定索引与种子十类在；CLI 负向与未登录直写已拒；用户已登录后台手点正路径已闭合；测试 leftover=0，种子十类仍在）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、AppID、OPENID、CloudBase UID、token 只存在于被 Git 忽略的本地 `.env`。本文未写入、未提交这些值。

未把 A01—A31、T01—T30 标为通过。未标 A03 / A28 / A29 / T03 / T04 / T05 通过。未启动 MW10。未实现虚拟支付、VIP、订单、退款、题库、组卷、导入或类目迁移作业。未创建 `questions` / `papers` / `attempts` / `orders` / `vip_*`。未创建生产环境，未升级套餐，未开启超额计费。

## 1 本轮实现范围

| 项 | 处理 |
| --- | --- |
| 集合 | 新建 `categories`、`category_names`。复用 `app_config.catalog`、`idempotency`、`audit_logs` |
| 索引 | 仅数据模型第 7 节 `categories`：`parentId ASC, deletedAt ASC, sort ASC, _id ASC`。未建第 7 节其他未来索引 |
| 种子 | 产品 V1.1 §4.1 十个一级类目；确定性 `seedKey` ID；`$setOnInsert` / `category.seed` 幂等，不覆盖已改名节点 |
| 写并发 | **`expectedTreeVersion`**（`app_config.catalog.treeVersion`）。冲突回 `VERSION_CONFLICT` |
| 后台 | `mw-admin`：`category.tree` / `create` / `update` / `delete` / `seed`。最低写权限 content（super 可做） |
| 公开读 | `mw-public` `category.tree`：未删除且祖先链启用的节点；字段 id/parentId/depth/name/sort/enabled |
| 改父级 | `category.update` 带 `parentId`、以及 `category.change.preview/commit` → `PARENT_CHANGE_REQUIRES_MW18` |
| 删除 | 逻辑删除 `deletedAt`；有子节点或虚构题/卷引用 → `CATEGORY_IN_USE`，提示迁移是 MW18 |
| 维护 | 读树不受 `attemptStart` 等分项误阻断；结构写受 `contentWrites` 影响 |
| 未做 | 迁题迁卷、改父级预览提交、分类分重建、排行快照、MW10—MW13 |

字段白名单：创建 `name, parentId, sort, enabled, expectedTreeVersion`；更新 `categoryId, name, sort, enabled, expectedTreeVersion`。禁止客户端传 `categoryId` 当新建身份，禁止改 `ancestorIds` / `depth`。祖先路径只由服务端计算。`parentId=null` 为一级。

初始十类是可增减配置，不是写死枚举。同级 `normalizedName`（去首尾空白 + NFC）经 `category_names._id = H(parentId,normalizedName)` 占位。

## 2 本地检查

虚构夹具，不读真实 `.env`。

| 检查 | 退出码 |
| --- | --- |
| `npm run check:prototypes` | 0 |
| `npm run typecheck` | 0 |
| `npm run test` | 0 |
| `npm run build` | 0 |
| 密钥扫描（含在 `npm test`） | 通过 |

覆盖：十类种子幂等且改名后不再当枚举；一/二/三级可建，虚构 paper 夹具允许三级 `categoryId`（未写云端 papers）；拒第四级、缺父、同级重名、未知字段；自父/循环由 `validateParentAssignment` 覆盖；改名/排序/启停；无占用可逻辑删除，有子节点或虚构卷引用 `CATEGORY_IN_USE` 且树不变；`category.update` 带新 parentId 与 preview/commit 指向 MW18；伪造管理员 / 普通会员 / 缺登录失败关闭；`contentWrites` 阻断写、其他维护分项不阻断读树。

## 3 部署与云端核验（mw-test）

部署入口：**`mw-admin`、`mw-public`**。未部署其他入口，未复制 `mw-validation-*`，未新建无必要云函数。

| 项 | 结果 |
| --- | --- |
| 集合 `categories` / `category_names` | 新建成功 |
| 指定索引 | leftover 核验 `indexConfirmed=true`（`idx_categories_parent_deleted_sort_id`） |
| 种子十类 | `seedCount=10`，`mw-public category.tree` `treeVersion=1`、`nodeCount=10` |
| EnableOverrun | `false` |
| 其他环境 | 数量 2，未改 |
| 存储 ACL | ADMINONLY |
| 未登录 Web SDK 直写 `categories` / `category_names` | 拒绝 |
| CLI 无登录 create/update/delete | `AUTH_REQUIRED`（`NO_AUTH_UID`） |
| CLI 伪造 `role`/`uid` | `FORBIDDEN` / `CLIENT_IDENTITY_IGNORED` |
| 题卷等未来集合 | `listCollections` 未见 questions/papers/attempts/orders/vip_* |

用户手点后写入被忽略的 `configs/mw09-verify-state.json`（`wroteDocs=true`，7 个测试哈希：3 个类目 + 4 个名称占位）。按精确 `_id` 删除 7 条；另按测试 `categoryId` 精确 target 清理 18 条本轮 `audit_logs` / `idempotency`。leftover：`leftoverDocs=0`、`seedCount=10`、`cloudWriteClaimed=true`、`exactIdSweepOnly=true`。空 knownIds 未当成「云端无类目」。

## 4 后台可信身份正路径

用户在本机后台登录后手点（不是 CLI 伪造 FROM/role，也不是 automator）。脱敏摘要：

| 操作 | 结果 |
| --- | --- |
| `category.seed` | `ok`，`treeVersion=1`（幂等，未覆盖十类名称） |
| 一级下建二级 | `95488c33…`，`depth=2`，`MW09测试二级`，`treeVersion=2` |
| 再建三级 | `0eccb8b7…`，`depth=3`，`MW09测试三级`，`treeVersion=3` |
| 改名 | 二级改为 `MW09测试三级A`，`treeVersion=4` |
| 改排序 | 后续 update 至 `sort=3`，`treeVersion=6` |
| 停用再启用 | `enabled=false` → `true`，`treeVersion=7` / `8` |
| 同级重名 | `INVALID_ARGUMENT` / `NAME_CONFLICT` |
| 无占用测试一级 | `031d8439…` 创建后逻辑删除，`treeVersion=9` / `10` |

写并发字段为 `expectedTreeVersion`。终态树仍含种子十类（逻辑思维等），测试二级挂在「逻辑思维」下。第四级尝试未出现在摘要中；「第四级或同级重名」已由同级重名拒绝满足。

## 5 通过标准对照

| 条件 | 本轮 |
| --- | --- |
| 本地四项检查 0 | 满足 |
| 拒绝规则与无占用删除有测试 | 满足（本地夹具 + 云端同级重名/无占用删除） |
| mw-test 集合+索引+种子十类在 | 满足 |
| 直写拒绝、超额关闭、只动 mw-test | 满足 |
| 后台可信身份下的新增/改名/排序/启停/无占用删除至少一条真实证据 | 满足（用户已登录后台手点） |
| 测试 leftover=0，种子十类仍在 | 满足 |
| 未做改父级/迁移，未建题卷集合 | 满足 |

因此 MW09 **已完成**。本轮结束不启动 MW10。未标 A03 / A28 / A29 / T03 / T04 / T05 通过。

## 6 已知限制

- 云端占用拒绝（真题真卷引用）本轮没有题卷集合，只在本地虚构夹具证明。
- 停用后代不可新发布/新开答：本轮无卷，只在读树 `effectiveEnabled` 体现。
- `category.change.preview / commit` 未实现，接口拒绝并指向 MW18。
