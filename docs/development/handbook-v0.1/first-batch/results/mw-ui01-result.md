# MW-UI01 实际结果

日期：2026-10-15  
任务：[UI 规范定稿与答题页样板](../mw-ui01-tdesign-quiz.md)  
状态：**已完成**（2026-10-15 收口）—— 规范、组件映射、可运行样板、构建闭环与本地检查已交付；用户手点 4 步通过，视觉基线确认完成。可见检查中「执行者读取编译面板」一项仍为 NOT_RUN（执行者只把工程交到 IDE，未替代用户查看），改以**用户手点报告**作为可见证据。

工作区：`F:/MW/main`。本轮**未访问云端**（无云函数调用、无数据库读写、无部署、无 cleanup 脚本），未改动评分 / VIP / 支付 / 历史数据，未启动 MW17—MW30，未全站换肤，未自动提交或推送。  
未改写 MW01—MW16 的完成记录；未把 A01—A31 / T01—T30 标通过。当前分支与工作区差异见第 2 节，均为本轮新增/修改，未覆盖他人未提交改动（开工时 `git status` 仅有任务书与进度入口两处任务制定改动）。

## 1 交付清单

| 必交项 | 文件 | 状态 |
| --- | --- | --- |
| 视觉基线定稿 | `docs/design/visual-spec.md`（保留 MW02 历史来源并标记本轮版本） | 已交付 |
| 设计入口 | `docs/design/README.md` | 已更新 |
| 答题相关交互 / 状态说明 | `docs/design/interactions.md`（§3 第 1、4 条）、`docs/design/state-matrix.md`（§4 保存态、§6 备注） | 已更新 |
| TDesign 版本 / 变量 / 组件 / 接入说明 | `docs/design/tdesign-component-map.md` | 已交付 |
| 实际答题页样板 | `apps/miniprogram/pages/quiz/index.{ts,json,wxml,wxss}` | 已交付（真实路由，真实接口接线） |
| 必要 UI 单元 | `apps/miniprogram/services/attempt-ui.ts` 新增 `choiceOptionIds` / `quizTypeLabel` / `answeredPercentOf`（纯函数，已被页面与测试共用） | 已交付 |
| 构建适配 | `scripts/build-miniprogram.mjs`、新增 `scripts/mp-module-specs.mjs`、`scripts/check-miniprogram-imports.mjs` | 已交付 |
| 依赖与锁文件 | `apps/miniprogram/package.json`（精确 `1.17.0`）、`package-lock.json` | 已交付 |
| 预览与手点说明 | `docs/design/prototypes/quiz-tdesign-review.md` | 已交付 |
| 进度入口 | `docs/development/handbook-v0.1/07-progress.md` 补充任务区 | 已更新 |
| 结果文档 | 本文件 | — |

答题页组件注册（`pages/quiz/index.json`，10 个）：`t-button`、`t-icon`、`t-loading`、`t-progress`、`t-tag`、`t-popup`、`t-radio`、`t-radio-group`、`t-checkbox`、`t-checkbox-group`。

## 2 变更清单

```
M  apps/miniprogram/app.wxss                        # 新增 TDesign 主题入口 @import + MW-UI01 语义变量
M  apps/miniprogram/package.json                    # 新增 tdesign-miniprogram 精确 1.17.0
M  apps/miniprogram/pages/quiz/index.json           # 注册 10 个 TDesign 组件
M  apps/miniprogram/pages/quiz/index.wxml           # 全量重写页面模板
M  apps/miniprogram/pages/quiz/index.wxss           # 全量重写样式（仅 .quiz-* 专用类）
M  apps/miniprogram/pages/quiz/index.ts             # 事件适配 + 提交锁 + 新增派生状态
M  apps/miniprogram/services/attempt-ui.ts          # 新增 3 个纯函数
M  apps/miniprogram/services/attempt.ts             # 追加 re-export
M  apps/miniprogram/services/attempt.test.ts        # 新增 4 项适配测试
M  apps/miniprogram/types/wx.d.ts                   # 手写全局类型跟随新方法/事件签名
M  scripts/build-miniprogram.mjs                    # TDesign 按需复制 + 版本锁定校验
M  scripts/check-miniprogram-imports.mjs            # 覆盖面扩到 js/json/wxml/wxss + 裸包名
A  scripts/mp-module-specs.mjs                      # 构建与检查共用的依赖提取规则
A  docs/design/tdesign-component-map.md
A  docs/design/prototypes/quiz-tdesign-review.md
A  docs/development/handbook-v0.1/first-batch/results/mw-ui01-result.md
M  docs/design/{README,visual-spec,interactions,state-matrix}.md
M  package-lock.json
```

未修改：任何云函数、`packages/shared` 业务逻辑、后台 UI、`app.json`、`project.config.json`、`docs/development/handbook-v0.1/first-batch/*` 既有任务书与结果、`docs/design/prototypes/*.html`（走查稿）。

## 3 TDesign 接入与构建闭合

| 项 | 结果 |
| --- | --- |
| 包 / 版本 | `tdesign-miniprogram@1.17.0`，`apps/miniprogram/package.json` 精确锁定（无 `^` / `latest`），锁文件已更新 |
| 许可证 | MIT |
| 最低基础库 | `^2.6.5`（官方 README 声明；本工程未声明最低基础库，无需改动） |
| 实际安装产物 | `node_modules/tdesign-miniprogram/miniprogram_dist`（`package.json.miniprogram` 指向该目录） |
| 复制产物 | `apps/miniprogram/miniprogram_npm/tdesign-miniprogram/**` + `apps/miniprogram/miniprogram_npm/tslib/**` |
| 复制规模 | TDesign 运行时 89 个文件 / 253.7 KB（`tdesign-miniprogram/` 目录 88 个文件 / 241.6 KB + `tslib` 1 个文件 / 12.1 KB，含 `common/style/theme/_index.wxss` 与 `common/**`） |
| `miniprogram_npm` 总量 | 91 个文件 / 435.7 KB（含 `@mw/shared` 2 个文件 / 182 KB）；主包仍远低于 2 MB 限制 |
| 版本校验 | 构建脚本比对「声明版本 vs 已安装版本」，不一致即失败；非精确版本也会失败 |

复制规则（`scripts/build-miniprogram.mjs`）：以样板实际组件为种子，加上 `app.wxss` 显式引用的主题入口 `common/style/theme/_index.wxss`（它不被任何组件 wxss 引用，必须单独作为种子，否则 `@import` 会指向不存在的文件），然后解析 `.js` 的 `import/require`、`.json` 的 `usingComponents`、`.wxml` 的 `import/include/wxs src`、`.wxss` 的 `@import`，递归收集最小文件集；**任何一条解析不到即构建失败**。发布产物内自带的 `miniprogram_dist/miniprogram_npm/<包>`（目前只有 `tslib`）提升到 `miniprogram_npm/<包>`，其余保持 `miniprogram_npm/tdesign-miniprogram/<路径>` 结构不变——`t-checkbox` ↔ `t-checkbox-group` 靠组件相对路径的关系声明建联，拆散目录会让分组拿不到子项。

**可重复构建（本轮要求的关键证据）**：`miniprogram_npm` 每次构建都被整个删除后重建。连续两次构建后，产物清单（相对路径 + 文件大小）的 SHA-256 完全一致：

```
build#1 manifest sha256 = 5DFD30E178497BE27951310A8821851BEC19A37D2D282ABD4613444A504C168A
build#2 manifest sha256 = 5DFD30E178497BE27951310A8821851BEC19A37D2D282ABD4613444A504C168A
identical = True    file count = 91
```

`@mw/shared` 能力保留：构建仍用 esbuild 把 `packages/shared/src` 打成 `miniprogram_npm/@mw/shared/index.js`，导入检查器继续实跑该产物并断言 `fetchPaperDetail("paper_fict_logic_l1")` 正常返回。

**不依赖开发者工具“构建 npm”**：小程序根目录 `apps/miniprogram` 下没有 `node_modules`，`project.config.json` 因此保持 `packNpmManually: false`、`packNpmRelationList: []`。工具内“构建 npm”会覆盖本工程手工产出的 `miniprogram_npm`，已写入预览说明：**误点后重跑一次 `npm run build -w @mw/miniprogram` 即可恢复**。

### 3.1 导入检查器扩展

原检查器只处理 `@mw/shared` 这一种裸包名，且只扫 `.js`。本轮：

- 覆盖 `.js` / `.json` / `.wxml` / `.wxss` 四类引用；`.json` 的 `usingComponents` 必须落到真实组件 `.json`，只命中 `.js` 不算通过。
- 裸包名统一到 `miniprogram_npm/` 解析（因此 `tslib`、`@mw/shared`、以及 `pages/quiz/index.json` 里的 `tdesign-miniprogram/...` 都被真实校验）。
- **不跳过第三方目录**：`check-miniprogram-imports.mjs` 会逐个检查 `miniprogram_npm/tdesign-miniprogram/**` 与 `miniprogram_npm/tslib/**`。当前 165 个小程序文件全部通过。
- 构建与检查共用 `scripts/mp-module-specs.mjs` 的提取规则，避免“构建按 A 复制、检查按 B 判定”的分歧。

顺带修掉两个**真实的假阳性**（原正则 `from|require(|import(` 会把源码字符串里的字面量当成模块说明符）：

1. `tslib` 内部 `__rest(r, ["from","to","direction"])` 被读成一次 `from` 依赖；
2. 共享包字符串 `"purpose must be prompt, analysis or import"` 结尾的 `import"` 被读成一次副作用 import。

修法是给 `from` / `require(` / `import(` 加前置否定断言（排除引号、反引号、`$`、标识符字符），副作用 import 改为语句级锚定 `(?:^|[;{}\n])\s*import\s+["']`。已核实 TDesign 产物中没有副作用式 import，该分支只是保持正确性。

## 4 答题页改造（事件适配是本轮主要回归风险）

结构：页头（标题 + 保存状态胶囊 + 题号/已答数量 + 进度条）→ 离线说明条 → 题干卡片（题型标签 + 题干 + 选项）→ 提示 → 底部固定操作区（上一题 / 答题卡 / 下一题 / 整行交卷）→ 默认收起的调试与测试区 → 答题卡底部弹层。

事件适配（`pages/quiz/index.ts` + `services/attempt-ui.ts`）：

| 原实现 | 现实现 | 适配点 |
| --- | --- | --- |
| `bindtap` + `event.currentTarget.dataset.id` | `t-radio-group` / `t-checkbox-group` 的 `bind:change` | `detail.value` 单选为标量、多选为数组 |
| 手工 `[...current, optionId]` 维护数组 | 受控回写：页面把 `detail.value` 经 `choiceOptionIds(type, value)` 归一成 `optionIds[]` 写回 `data` | 两个分组都是**受控**组件，`change` 不会自己改 `value`，不回写会“勾选弹回” |
| 跳题按 `ord` 计算 | 不变（`jump` → `showIndex(ord - 1)`，答题卡数据来自 `quizCard`） | 答题卡三态由 `quizCard` 给出的 `done` / `current` 决定 |
| 保存状态为纯文字 | 图标 + 文案 + 颜色；文案与状态唯一来源仍是 `displaySave` | 未新增第二套保存逻辑 |

保持不变的业务语义（逐条核对）：

- 选择后走同一 `attempt.save` 流程；**只有服务端确认的 `revision` / `answeredCount` 才显示“已保存”**，失败的本地改动只置为未确认并排队重发。
- 保存中 / 保存失败**仍然可以交卷**，没有为了组件 loading 样式去禁用交卷（离线“尚未同步”除外，这是 MW14/MW15 既有语义，离线交卷被拒并提示）。
- 版本冲突仍弹原生 `wx.showModal`「用服务器 / 用本页」，`applyConflictChoice` 的三分支（`none` / `reload` / `resend`）未改。
- 未答二次确认仍用原生 `wx.showModal`，确认后以 `confirmUnanswered=true` 重发；`unansweredConfirmCopy` 未改。
- 交卷处理中防重复：新增实例级锁 `this.submitting` + 按钮 `disabled/loading`。未答递归调用前**先释放锁**，否则会把自己挡掉。超时仍按原 `attemptId` 查状态，不新建一轮。
- 已提交转结果：`submitMode = quizSubmitMode(attemptState)`，整页只读 + 「查看结果」跳 `pages/result/index`，未改跳转参数。
- leftover 入口保留原有可达性与“只有用户点击才记入”的语义，收进明确标识、默认收起的折叠测试区；展开面板只切换布尔值，不写任何数据。

未提取自定义组件：本轮只有答题页复用这些 UI 单元，`attempt-ui.ts` 已提供可测试的纯逻辑，再拆 custom component 属提前造组件平台。仅保留三处纯函数（`choiceOptionIds` / `quizTypeLabel` / `answeredPercentOf`），供后续结果页 / 解析页直接复用。

## 5 缺口与限制

1. **题图 / 选项图与放大预览未接线（缺口，未伪造）**。核实结果：`attempt.questionPage` 返回的 `stem` / `options` 只有 `assetIds`（`packages/shared/src/paper.ts` 的 `PaperChunkItem`），没有可读 URL；`packages/shared/src/media.ts` 只有后台上传侧的资产集合与校验，全仓 `getTempFileURL` / `fileID` / `assetUrls` 无命中，`docs/api/api-contract-v1.0.md` 也没有媒体读取 action。因此本页**不渲染任何图片**，也不复制 `t-image` / `t-image-viewer` 占包体。`state-matrix.md` §6「题图 / 解析图」一行据此标注为当前不可点通，需先补媒体读取接口。
2. **大字号模式未实现切换入口**。语义变量 `--mw-font-size-body-large`（40rpx / 20px）已定义，但全站没有字号设置入口，本轮不扩大范围。页面正文使用 `--mw-font-size-body` + 行高 1.6，长题干与长选项换行（`word-break: break-word`）且 `max-label-row="{{99}}"` 关闭 TDesign 默认 3 行截断。
3. **TDesign 图标字体是外部资源**：`icon.wxss` 的 `@font-face` 指向 `https://tdesign.gtimg.com/icon/0.4.5/fonts/t.*`。创建者工具默认“不校验合法域名”时正常；真机 / 正式环境需把 `tdesign.gtimg.com` 加入 downloadFile 合法域名，否则图标可能不显示。
4. **偏差已记录**：TDesign `size="medium"` 按钮高 40px < 基线 44px，故在 `.quiz-actions` 内把 `--td-button-medium-height` 提到 88rpx；保存状态胶囊最小高度 88rpx，同时满足“状态 + 重试入口”的触点要求。
5. **HTML 走查稿未同步**：`docs/design/prototypes/*.html` 仍是 MW02 走查稿（角色/状态切换用），本轮刻意不改，避免与小程序实现并行维护两套；两者不一致时以小程序页面 + `visual-spec.md` 为准，已在设计入口与本说明中写明。
6. **未发现既有业务缺陷**：本轮改动集中在呈现与事件适配，未触发任何跨业务的逻辑调整；`attempt-ui.ts` 既有函数未改语义，只在末尾追加三个纯函数。
7. **选项没有“不可操作”态（有意为之）**：答题期间按契约必须允许继续作答——保存中 / 保存失败 / 离线都不能锁死选择，`PaperChunkItem.options` 也没有 `disabled` 字段。因此选项只有“默认 / 选中”两态，加上“已交卷”时的整页只读；“暂不可交卷”由保存状态胶囊、冲突弹窗与离线提示表达，不用禁用选项实现。
8. **答题卡滚动容器用 `max-height: 50vh`**：`scroll-view` 官方要求竖向滚动给固定高度，这里用受约束的最大高度（内容超出时高度即被约束为 50vh）。1 题与 100 题两种规模需要用户手点时各看一眼（预览说明第 4 节已含）。

## 6 验证结果

### 6.1 本地模拟（已执行，PASS）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | 退出码 0（admin / miniprogram / shared / api） |
| 构建 + 导入检查 | `npm run build` / `npm run build -w @mw/miniprogram` | 退出码 0；`checked 165 miniprogram files`；TDesign 89 files / 253.7 KB |
| 可重复构建 | 连续两次 `npm run build -w @mw/miniprogram` | 两次清单 SHA-256 一致（见第 3 节） |
| 单元测试 | `npm test` | 退出码 0；workspaces 共 **230** 项通过（shared 89 / api 109 / admin 8 / miniprogram 24），含新增 4 项适配测试 |
| 原型脚本 | `npm run check:prototypes` | 退出码 0（未改 HTML 走查稿） |
| 空白检查 | `git diff --check` | 退出码 0（仅 CRLF 提示，无空白错误） |

新增测试（`services/attempt.test.ts`）：

- `choiceOptionIds`：多选数组保序、空数组 / `undefined` / 非数组（如误传标量）都归零；单选与判断取标量并包成单元素数组；`""` / `null` / `undefined` 归零。
- 适配结果可直接进入既有 `buildSaveBody` 结构（`answers[]` 只含非空题，题号排序）。
- `quizTypeLabel`（含未知类型的兜底）与 `answeredPercentOf`（0 / 0、向上取整、超 100 夹回）。

**未用桩替换真实请求**：没有新增 mock 路由，也没有把 `memberAction` 改成假响应；现有 `services/mock-client.js` 仍只用于构建期断言与既有页面，未混入正式答题路由。

### 6.2 实际编译与可见检查（用户手点闭合）

执行者侧（NOT_RUN，如实记录）：

- 本机存在微信开发者工具：`F:\Software\Wechat\微信web开发者工具\cli.bat`。
- 已执行 `cli open --project F:\MW\main\apps\miniprogram`，返回 `✓ open`（IDE 服务端口 13627）。工程已交到 IDE，编译器与模拟器由 IDE 运行；**执行者没有读取编译面板与模拟器**，故「执行者读取编译结果」一项为 NOT_RUN。
- 刻意**没有**执行 `cli build-npm`：它会覆盖本工程手工产出的 `miniprogram_npm`。打开工程后已复核产物仍在（`tdesign-miniprogram` 88 个文件 + `tslib` + `@mw/shared` 齐全）。
- 未安装 `miniprogram-automator`，未用 CLI / automator 冒充身份或代替用户手点。

用户手点（2026-10-15，闭合）：**4 步全部通过**。按 [quiz-tdesign-review.md §4](../../../../design/prototypes/quiz-tdesign-review.md) 的清单逐项报告：

| 步骤 | 内容 | 结果 |
| --- | --- | --- |
| 1 | 打开 `apps/miniprogram`，等编译完成，编译面板无「找不到组件 / 无法解析路径」 | PASS（用户手点报告） |
| 2 | 用真实进行中记录走完整答题页（多选不弹回、单选互斥、保存状态流转、答题卡跳题、未答确认、离线拒交卷） | PASS（用户手点报告） |
| 3 | 窄屏 320：交卷按钮仍可见、底部安全区不遮选项 | PASS（用户手点报告） |
| 4 | 抽查首页 / 结果页 / 我的页仍能正常编译显示（本轮动了全局 `app.wxss`） | PASS（用户手点报告） |

口径说明：第 2 步里「保存失败、版本冲突、提交中」等状态需要构造条件（断网、跨设备改稿、服务端延迟），用户未逐项细分开列，本次按「完整走查通过」记录；若后续要单独复现这三态，可按预览说明第 4 节重做，不影响本轮结论。**执行者未替代用户点击，也没有伪造平台身份。**

### 6.3 真实云端（未做）

**云端写入：无；leftover 清理：不适用。** 本轮没有新增注册、答题、保存、交卷等**写入**动作，未使用伪造身份，未部署、未改数据、未调用历史 cleanup 脚本。用户手点第 2 步若走了真实答题流程，可能产生一份进行中 / 已提交的答题记录，属用户自己账号的正常业务数据，**不属于本任务的测试造物，不做清理、也不计入 leftover**。不强套 MW16 的写入门禁，不声称 leftover=0。

### 6.4 截图

本轮未把截图入仓（用户口头报告通过）。如需留档，按预览说明第 4 节补：默认答题、已选多选、答题卡弹层、保存失败或冲突、提交中、已提交只读、320 窄屏；入仓前先去除身份与环境敏感信息。

## 7 全局影响与回退

全局影响（仅两处）：

1. `apps/miniprogram/app.wxss` 新增一行 `@import "./miniprogram_npm/tdesign-miniprogram/common/style/theme/_index.wxss"` 与一组变量声明（`--mw-*` 自有语义变量 + `--td-*` 主题变量）。**不新增、不修改任何选择器**，也不改 `page` 既有的 `background` / `color` / `font-size`。未注册 TDesign 组件的页面渲染结果不变（首页 / 分类 / 结果 / 解析 / 我的都没有 `usingComponents`，已实测仍能编译 + 通过导入检查）。
2. `package-lock.json` 新增 `tdesign-miniprogram@1.17.0`（纯新增，无其它依赖变更）。

风险点：`app.wxss` 若在 `miniprogram_npm` 未构建时被编译，会因 `@import` 路径不存在而报错——这是刻意的，避免“忘了构建 npm 却看起来正常”。恢复方式同上。

回退方法（互不影响，可分别回退）：

- **回退答题页**：`git checkout -- apps/miniprogram/pages/quiz apps/miniprogram/app.wxss apps/miniprogram/types/wx.d.ts apps/miniprogram/services/attempt-ui.ts apps/miniprogram/services/attempt.ts apps/miniprogram/services/attempt.test.ts`，回到 MW15 的纯原生答题页（`pages/quiz/index.json` 需同时去掉 `usingComponents`，回退后 `app.wxss` 不再引用 TDesign 主题入口）。
- **回退构建与接入**：`git checkout -- scripts/build-miniprogram.mjs scripts/check-miniprogram-imports.mjs` 并删除 `scripts/mp-module-specs.mjs`，再 `npm uninstall tdesign-miniprogram -w @mw/miniprogram`，最后 `npm run build -w @mw/miniprogram` 重建 `miniprogram_npm`。
- **回退文档**：对应 `docs/design/*` 与 `docs/development/handbook-v0.1/07-progress.md` 的补充任务行。
- 云端无动作，无需回退数据。

## 8 建议状态

**已完成**（2026-10-15 收口）。

任务书完成条件逐条对应：

| 完成条件 | 结果 |
| --- | --- |
| 规范和组件映射齐备 | 满足：`visual-spec.md`（保留 MW02 历史来源 + 本轮版本记录）、`tdesign-component-map.md`（版本 / 官方参考 / 变量映射 / 组件映射 / 实际文件 / 接入构建） |
| 实际答题页使用 TDesign | 满足：`pages/quiz/index` 真实路由、真实 `attempt.*` 接口接线，10 个 TDesign 组件 |
| 构建可重复 | 满足：连续两次构建产物清单 SHA-256 一致；`@mw/shared` 能力保留；不依赖工具内构建 npm |
| 必要代码检查通过 | 满足：typecheck 0 / `npm test` 0（230 项）/ 导入检查 165 文件 / `check:prototypes` 0 / `git diff --check` 0 |
| 开发者工具可见检查完成 | 满足（用户手点 4 步通过）；执行者侧「读取编译面板」仍为 NOT_RUN，已在 6.2 分别记录 |
| 用户审阅样板后确认视觉基线 | 满足（2026-10-15 用户手点通过后确认） |

未做的事（与任务书一致）：未把 A01—A31 / T01—T30 标通过；未启动 MW17—MW30；未改评分 / VIP / 支付 / 历史数据；未全站换肤；未自动提交或推送；未改写 MW01—MW16 的完成记录。

遗留缺口（不影响本任务收口，供后续任务处理）：题图 / 选项图与放大预览未接线（缺媒体读取 action，见第 5 节第 1 条）；大字号切换入口未实现；结果页 / 解析页尚未换肤。
