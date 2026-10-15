# TDesign 组件映射与接入约定

日期：2026-10-15（MW-UI01）  
配套：[visual-spec.md](visual-spec.md)（视觉基线）· [prototypes/quiz-tdesign-review.md](prototypes/quiz-tdesign-review.md)（答题页样板预览与手点说明）

## 1 版本与许可证

| 项 | 值 |
| --- | --- |
| 包名 | `tdesign-miniprogram`（微信原生小程序版） |
| 版本 | `1.17.0`，在 `apps/miniprogram/package.json` 中**精确锁定**（无 `^`、无 `latest`） |
| 锁定校验 | 构建时 `scripts/build-miniprogram.mjs` 会比对声明版本与已安装版本，不一致直接失败 |
| 许可证 | MIT |
| 最低基础库 | `^2.6.5`（官方 README 声明） |
| 产物目录 | `node_modules/tdesign-miniprogram/miniprogram_dist`（`package.json` 的 `miniprogram` 字段） |

升级步骤（本轮不做，留给后续任务）：改 `apps/miniprogram/package.json` 的精确版本 → `npm install` → 跑构建 → 逐个手点样板页确认图标、间距、事件未变。

## 2 接入与构建

本工程的 `miniprogram_npm` 是**构建产物**，不走微信开发者工具的“构建 npm”：

- 小程序根目录 `apps/miniprogram` 下没有 `node_modules`，`project.config.json` 因此保持 `packNpmManually: false`、`packNpmRelationList: []`。
- `npm run build -w @mw/miniprogram` 会**先删除整个 `miniprogram_npm` 再重建**，其中包含 `@mw/shared`（esbuild 打包 `packages/shared/src`）与本次新增的 TDesign 运行时。
- 开发者工具若提示找不到 npm 包，或在工具内执行过“构建 npm”，**必须重跑一次构建**，再回到模拟器。

构建顺序（可复现）：

```powershell
cd F:\MW\main                         # 必须在仓库根目录，否则 npm 会在当前目录写 package-lock.json
npm install
npm run build -w @mw/miniprogram      # 重建 miniprogram_npm（@mw/shared + tdesign-miniprogram + tslib）
npm run check -w @mw/miniprogram      # typecheck + test，需要先 build
```

TDesign 的复制规则（`scripts/build-miniprogram.mjs`）：

1. 以样板实际用到的组件为种子（`TDESIGN_COMPONENTS`），加上 app.wxss 显式引用的主题入口（`TDESIGN_STYLE_ENTRIES`）。
2. 解析 `.js`（`import/require`）、`.json`（`usingComponents`）、`.wxml`（`import/include/wxs src`）、`.wxss`（`@import`）四类引用，递归收集**最小文件集合**；任何一条解析不到就构建失败。
3. `miniprogram_dist/<路径>` 复制到 `miniprogram_npm/tdesign-miniprogram/<路径>`；发布产物内自带的 `miniprogram_dist/miniprogram_npm/<包>` 提升到 `miniprogram_npm/<包>`（目前只用到 `tslib`）。

第 2 步必须保持目录结构不变：`t-checkbox` 与 `t-checkbox-group` 之间是靠**组件相对路径的关系声明**（`../checkbox-group/checkbox-group`）自动建联的，拆散目录会让分组拿不到子项。

验证：

- `scripts/check-miniprogram-imports.mjs` 在构建后独立复查**全部** `miniprogram_npm`（含 TDesign 与 tslib）的 js/json/wxml/wxss 依赖是否都能解析，并检查 `pages/quiz/index.json` 引用的组件是否落到真实 `.json`。检查器不跳过第三方目录。
- 连续两次构建的 `miniprogram_npm` 清单（路径 + 大小）SHA-256 完全一致，可重复。
- 本任务实测：TDesign 运行时 89 个文件、253.7 KB（其中 `tdesign-miniprogram/` 目录 88 个文件 / 241.6 KB，`tslib` 1 个文件 / 12.1 KB）；`miniprogram_npm` 合计 91 个文件 / 435.7 KB（含 `@mw/shared` 2 个文件 / 182 KB）。主包仍远低于 2 MB 限制。

## 3 组件映射

| 用途 | TDesign 组件 | 关键属性（1.17.0 实测） | 事件与参数 |
| --- | --- | --- | --- |
| 底部主/次按钮、重试、查看结果 | `t-button` | `theme`(`default`/`primary`/`danger`/`light`)、`variant`(`base`/`outline`/`text`/`dashed`)、`size`、`block`、`disabled`、`loading` | `bind:tap`；`detail` 是原始点击事件 |
| 状态图标、折叠箭头、保存中旋转 | `t-icon` | `name`、`size`、`color` | 无 |
| 整页加载态 | `t-loading` | `theme`(`circular`)、`size`、`text` | 无 |
| 已答/总题数进度 | `t-progress` | `percentage`(Number)、`label`(`{{false}}` 隐藏默认百分比文案)、`theme="line"` | 无 |
| 题型标签 | `t-tag` | `theme="primary"`、`variant="light"`、`size` | 无 |
| 单选、判断题选项 | `t-radio-group` + `t-radio` | 分组 `value`(String)、`bind:change`；子项 `value`(optionId)、`block`、`icon="circle"`、`max-label-row="{{99}}"` | `change` → `detail.value` 为**单个** string |
| 多选选项 | `t-checkbox-group` + `t-checkbox` | 分组 `value`(Array)、`bind:change`；子项 `value`(optionId)、`block`、`icon="rectangle"`、`borderless="{{true}}"`、`max-label-row="{{99}}"` | `change` → `detail.value` 为 **string[]** |
| 答题卡底部面板 | `t-popup` | `visible`、`placement="bottom"`、`close-on-overlay-click` | `visible-change` → `detail.visible`（仅在点遮罩/关闭按钮时为 `false`） |

### 3.1 业务元素 → 组件 → 状态 → 实际文件

| 业务元素 | 用到的 TDesign 组件或自有实现 | 状态 | 实际文件（仓库相对路径） |
| --- | --- | --- | --- |
| 试卷标题 | 自有 `.quiz-head__title` | 正常 | `apps/miniprogram/pages/quiz/index.wxml` / `.wxss` |
| 当前题号 / 总题数 / 已答数量 | 自有 `.quiz-head__meta` | 正常 | 同上 |
| 题目进度 | `t-progress`（`label="{{false}}"`） | 0–100%，只表示已答比例 | `apps/miniprogram/pages/quiz/index.wxml` |
| 保存状态 | `t-icon`（`time`/`loading`/`check-circle`/`error-circle`/`cloud`）+ 自有胶囊 `.quiz-save` | 未保存 / 保存中 / 已保存 / 保存失败 / 版本冲突 / 尚未同步 | 展示：`pages/quiz/index.wxml` + `.wxss`；文案与状态唯一来源：`apps/miniprogram/services/attempt-ui.ts` 的 `displaySave` |
| 题型标签 | `t-tag`（`theme="primary" variant="light"`） | 单选题 / 多选题 / 判断题 | `pages/quiz/index.wxml`；文案来源 `quizTypeLabel`（`services/attempt-ui.ts`） |
| 题干 | 自有 `.quiz-stem__text` | 存在 | `pages/quiz/index.wxml` / `.wxss` |
| 题图 / 选项图 | **未实现（缺口）** | — | 见 [结果文档](../development/handbook-v0.1/first-batch/results/mw-ui01-result.md) 第 5 节 |
| 多选选项 | `t-checkbox-group` + `t-checkbox`（`icon="rectangle"`、`borderless`） | 默认 / 选中 / 不可操作（只读时 `readonly`） | 结构：`pages/quiz/index.wxml`；选中态：`.quiz-options .quiz-option--on`（`pages/quiz/index.wxss`）；取值适配：`choiceOptionIds`（`services/attempt-ui.ts`） |
| 单选 / 判断选项 | `t-radio-group` + `t-radio`（`icon="circle"`） | 同上 | 同上 |
| 选项序号与长文本 | 自有 `.quiz-option__id` / `.quiz-option__text`（`max-label-row="{{99}}"` 关闭截断） | 正常 / 超长换行 | `pages/quiz/index.wxml` / `.wxss` |
| 底部操作区 | `t-button` × 4（`theme`/`variant` 区分主次） | 默认 / 禁用（首题、末题）/ 提交中 | 结构：`pages/quiz/index.wxml`；44px 触点：`.quiz-actions`（`pages/quiz/index.wxss`） |
| 答题卡 | `t-popup`（`placement="bottom"`）+ 自有格子 | 当前题 / 已答 / 未答 | 结构：`pages/quiz/index.wxml`；三态样式：`.quiz-cell--done` / `.quiz-cell--current`；数据：`quizCard`（`services/attempt-ui.ts`） |
| 离线说明条 | 自有 `.quiz-alert--warning` + `t-icon`（`cloud`） | 离线 / 在线 | `pages/quiz/index.wxml` / `.wxss`；状态来源 `applyNetworkChange` / `displaySave` |
| 加载中 / 加载失败可重试 | `t-loading` / `t-icon` + `t-button` | 加载中 / 失败 / 重试中 | `pages/quiz/index.wxml` |
| 已交卷只读 | 自有 `.quiz-done` + `t-icon` + `t-button` | 已提交 | `pages/quiz/index.wxml`；跳转 `goResult`（`pages/quiz/index.ts`） |
| 危险确认（版本冲突、未答确认） | `wx.showModal`（原生，刻意不换） | 冲突待选 / 未答二次确认 | `pages/quiz/index.ts` + `services/attempt-ui.ts` 的 `conflictChoiceOf` / `unansweredConfirmCopy` |
| 本轮 leftover 测试入口 | 自有折叠区 `.quiz-test` + `t-button` | 收起 / 展开 / 已记入 | `pages/quiz/index.wxml` / `.wxss`；写入仍只在用户点击时发生（`services/known-ids.ts`） |

### 3.2 事件参数适配（本轮的关键改动）

原页面用 `bindtap` + `event.currentTarget.dataset.id` 取选项；TDesign 分组组件改为 `bind:change` + `event.detail.value`。适配收敛在纯函数 `services/attempt-ui.ts` 的 `choiceOptionIds(type, value)`，页面只调用它：

- `multiple`：`detail.value` 是数组，逐项 `String` 化并丢弃空串，保持 TDesign 给出的顺序。
- `single` / `trueFalse`：`detail.value` 是标量，包成单元素数组；空值/未选中返回 `[]`，页面据此删除该题的答案键。
- 两种形态都直接落回既有 `answers: Record<questionId, optionIds[]>`，保存与交卷数据结构未变。

其他需要注意的点：

- 两个分组都是**受控**组件：`change` 事件不会自己改 `value`，页面必须在回调里把新值写回 `data`，否则勾选会弹回。
- `t-checkbox` 有 `borderless` 属性（不画分组分隔线），`t-radio` 没有；选项卡片自带边框，因此页面用专用类隐藏 `.t-radio__border`，避免卡片内出现多余细线。
- TDesign 组件默认 `styleIsolation: apply-shared`，页面 wxss 能作用到组件内部。本项目只在 `.quiz-*` 专用类下覆盖，不写全局组件选择器。

## 4 图标映射（同一套 TDesign 线性图标）

| 场景 | `t-icon` name |
| --- | --- |
| 未保存 | `time` |
| 保存中 | `loading`（页面加 `.quiz-spin` 旋转） |
| 已保存 | `check-circle` |
| 保存失败 / 版本冲突 | `error-circle` |
| 尚未同步 | `cloud` |
| 已交卷 | `check-circle` |
| 折叠区开合 | `chevron-down` / `chevron-right` |

图标字体的实际来源是 wxss 里的 `@font-face`，指向 `https://tdesign.gtimg.com/icon/0.4.5/fonts/t.*`。**这是一个外部资源依赖**：真机与预览需要在“不校验合法域名”之外，把 `tdesign.gtimg.com` 加入 downloadFile 合法域名，否则图标可能不显示。开发者工具默认勾选「不校验合法域名」时不受影响。

## 5 覆盖边界（本轮明确不做）

- 不做全站换肤：`app.wxss` 只新增 TDesign 主题入口 `@import` 与变量声明，其它页面没有注册 TDesign 组件，视觉不变。
- 不为组件库改写既有 JS 选择器/类名；答题页样式全部收在 `.quiz-*` 下。
- 不引入 `t-image` / `t-image-viewer`：题图没有可读地址（见 [结果文档](../development/handbook-v0.1/first-batch/results/mw-ui01-result.md) 第 5 节），不复制用不到的组件占包体。
- 危险确认仍用 `wx.showModal`（版本冲突、未答确认），不改成 TDesign 弹窗，避免在事件语义上引入第二套实现。

## 6 主题变量

语义变量与 `--td-*` 的完整映射表见 [visual-spec.md](visual-spec.md) 第 1 节。声明位置：`apps/miniprogram/app.wxss`。

对其它页面的影响：只新增变量与 TDesign 主题入口，不新增/修改任何选择器，也不改 `page` 的既有着色与字号，未注册 TDesign 组件的页面渲染结果不变。
