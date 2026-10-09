# MW13 首页与三级分类选卷

开发手册 v0.1｜任务状态：已完成（结果见 [results/mw13-result.md](results/mw13-result.md)）
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)

## 目标与可见结果

小程序交付首页、分类、试卷列表和详情。公开读走 `mw-public`：`home.get`、`category.tree`、`paper.list`、`paper.detail`。未注册可浏览；详情无正确答案。不实现答题草稿、交卷、成长、排行、导入整改、VIP 购买。

完成后应交付：

1. 本执行说明与 [results/mw13-result.md](results/mw13-result.md)。
2. `home.get`：动态根类目、推荐卷、新上架卷摘要、公开配置版本。登录后首页可读 `member.me` 显示总分和等级占位。
3. 公开 `paper.list` / `paper.detail`：只回已发布卷；`includeDescendants` 默认 true；按 paperId 去重；难度 / 免费或 VIP / 未做或已做筛选；推荐与最新排序；不透明游标。
4. 小程序四导航「首页、分类、排行榜、我的」。本轮做前三项浏览页；排行榜占位「MW17 未做」，不加费用筛选。
5. 本地五项检查退出码 0。用户手点 1–6 与 leftover=0 已闭合。

## 输入

MW11 发布快照、MW08 注册/资料、MW09 种子十类、MW02 状态矩阵。只操作 mw-test。不开启超额，不真实扣款。正式 VIP 判权是 MW20；本轮 VIP 卷只显示 `VIP_REQUIRED`。

## 本任务工作范围

1. 游客可走首页 → 分类面包屑 → 父级含后代去重列表 → 筛选排序 → 详情。
2. 详情禁止答案、解析、`paper_answers`、`question_versions`、`correctOptionIds`。`publicSafe` 泄漏则 `INTERNAL_ERROR`。
3. 停用/删除类目及其后代不出现；请求停用类目 `CATEGORY_UNAVAILABLE`。下架 / 撤回 / 无卷 / 网络失败有明确状态。
4. 开始免费卷：未注册提示先注册（复用 MW08）。免费会员看 VIP 卷：`VIP_REQUIRED`，无开始。免费卷「开始」只说明 MW14 未接通，不真正开局。
5. 不新建 `attempts` / `orders` / `vip_*`。P08 继续 PARTIAL。不复制 `mw-validation-*`。

## leftover 门禁

1. 首页货架、分类列表、自动浏览不得写入 leftover `knownIds`。只有用户在详情页主动点「记入本轮 leftover」的本轮测试卷才进入复制清单。默认复制是空 `papers`。
2. leftover 导入只接受 SHA-256。空清单、非哈希、导入哈希数大于匹配到的真实 `_id` 必须失败退出，不得把未匹配当 leftover=0。禁止 `find({}, 100)` 当全集；扫不全或匹配不到就失败，不得猜删。
3. leftover 只准删本轮测试卷及其 version / chunk / answer。不得删种子十类，不得删 MW11/MW12 非本轮残留。空 `knownIds` / `wroteDocs=false` 继续判不干净（`WROTE_DOCS_FALSE`）。leftover-verify 只查已解析 `knownIds`，不扫整表。`leftoverObjects` 必须由已解析 object id 确认，不得写死 0 证明云干净。
4. 不实现 `attempt.start`。不恢复排行榜费用筛选。不改公开读契约。

用户已新发两份虚构测试卷（一份免费、一份 VIP），只把这两份记入本轮 leftover。手点 1–6 与 leftover=0 已闭合。

## 不包含的工作

不启动 MW14 / MW15 / MW17 / MW20。不实现 `attempt.*`、交卷、排行、支付。不把 MW12 标已完成。不把 A01 / A02 / A03 / T03 / T15 标通过。
