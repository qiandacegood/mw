# 视觉规范

版本：MW-UI01 实施基线（2026-10-15）  
历史来源：MW02《页面原型与视觉规范》（2026-10-08，占位走查稿）。本轮在 MW02 基础上定稿为可复用的实施基线，不另造第二套规范。  
组件库：微信原生版 `tdesign-miniprogram@1.17.0`（MIT），主题变量与组件映射见 [tdesign-component-map.md](tdesign-component-map.md)。  
状态：规范已定稿；答题页样板的视觉确认已于 2026-10-15 由用户手点通过（4 步全通过，见 [quiz-tdesign-review.md](prototypes/quiz-tdesign-review.md) 与 [MW-UI01 结果](../development/handbook-v0.1/first-batch/results/mw-ui01-result.md)）。

关于“定稿”的边界：本轮版本化的是 UI 实施基线（颜色、字体、间距、圆角、触控尺寸、组件映射）。正式 Logo、运营插画、勋章美术仍可在 MW28 前替换。

## 1 品牌与颜色

### 1.1 品牌

| 项 | 值 | 说明 |
| --- | --- | --- |
| 产品名 | 思维工坊 | 已定 |
| 标志 | 圆角方块 +「思」字，见 `assets/brand/logo-placeholder.svg` | 仍为占位，MW28 前替换 |
| 主色 | `#2B6CB0` | 延续 MW02，**不改成 TDesign 默认蓝** |
| 主色深 | `#2C5282` | 主色按下 |
| VIP / 勋章金 | `#D69E2E` | 仅作后续主题变量，答题页不使用营销装饰 |

### 1.2 语义变量（MW-UI01 定义，唯一引用层）

样板与后续页面样式**只引用 `--mw-*` 语义变量**；TDesign 组件通过 §1.3 的映射表间接拿到同一套值。

| 语义 | 变量 | 值 | 用途 |
| --- | --- | --- | --- |
| 品牌 | `--mw-color-brand` | `#2B6CB0` | 主按钮、选中描边、进度条、当前题 |
| 品牌深 | `--mw-color-brand-strong` | `#2C5282` | 按下态 |
| 品牌浅 | `--mw-color-brand-soft` | `#EBF8FF` | 选中底色、已答格子 |
| 品牌禁用 | `--mw-color-brand-disabled` | `#B3D7F2` | 禁用填充 |
| 页面背景 | `--mw-color-page` | `#F7FAFC` | 页面底色 |
| 卡片 | `--mw-color-surface` | `#FFFFFF` | 卡片、选项、面板 |
| 填充 | `--mw-color-fill` | `#EDF2F7` | 次级底、状态胶囊、未答格子 |
| 主文字 | `--mw-color-text` | `#1A202C` | 题干、选项 |
| 次文字 | `--mw-color-text-weak` | `#4A5568` | 题号/已答、说明 |
| 禁用文字 | `--mw-color-text-disabled` | `#A0AEC0` | 不可操作 |
| 边框 | `--mw-color-border` | `#E2E8F0` | 细边框 |
| 强边框 | `--mw-color-border-strong` | `#CBD5E0` | 未选中控件描边 |
| 成功 | `--mw-color-success` | `#276749` | 已保存 |
| 警告 | `--mw-color-warning` | `#C05621` | 保存中、离线 |
| 错误 | `--mw-color-danger` | `#C53030` | 保存失败、版本冲突、加载失败 |
| 金色 | `--mw-color-gold` | `#D69E2E` | VIP / 勋章（本轮不用于答题页） |

答题页状态只用“文字 + 图标 + 颜色”三者组合表达，**不允许只靠颜色**：例如「已保存 / 保存失败 / 尚未同步」都带明确文案，图标只做辅助。

### 1.3 映射到 TDesign 主题变量

实现位置：`apps/miniprogram/app.wxss`（全局只声明变量，不覆盖组件选择器）。

| 语义 | TDesign 变量 | 值 |
| --- | --- | --- |
| 品牌色阶 | `--td-brand-color-1 … -10` | `#EBF8FF / #D6EBFA / #B3D7F2 / #8CC0E8 / #63A6DC / #3F8DCB / #2B6CB0 / #2C5282 / #1D4877 / #16375C` |
| 页面背景 | `--td-bg-color-page` | `#F7FAFC` |
| 卡片背景 | `--td-bg-color-container` | `#FFFFFF` |
| 组件填充 | `--td-bg-color-component` | `#EDF2F7` |
| 主文字 | `--td-text-color-primary` | `#1A202C` |
| 次文字 | `--td-text-color-secondary` | `#4A5568` |
| 占位/禁用 | `--td-text-color-placeholder` / `--td-text-color-disabled` | `#A0AEC0` |
| 边框 | `--td-border-level-1-color` / `--td-component-stroke` | `#E2E8F0` |
| 强边框 | `--td-border-level-2-color` / `--td-component-border` | `#CBD5E0` |
| 成功 | `--td-success-color` | `#276749` |
| 警告 | `--td-warning-color` | `#C05621` |
| 错误 | `--td-error-color` | `#C53030` |

说明：TDesign 1.17.0 的主题文件把 `--td-brand-color` 定义为 `var(--td-primary-color-7)`，因此只需覆盖 1–10 色阶即可让 `--td-brand-color`、`--td-brand-color-active/light/disabled` 全部落在品牌色上。`--td-bg-color-component` 在该版本主题文件中未定义、组件通过 fallback 使用，故本轮显式声明以保证进度条轨道等中性填充落在基线值上。

## 2 字体、间距、圆角与触控尺寸

| 项 | 变量 | 值 | 说明 |
| --- | --- | --- | --- |
| 正文 | `--mw-font-size-body` | `32rpx`（16px） | 延续 MW02 默认字号 |
| 大字号正文 | `--mw-font-size-body-large` | `40rpx`（20px） | 供系统/用户大字号模式使用 |
| 正文行高 | `--mw-line-height-body` | `1.6` | 延续 MW02 |
| 卡片圆角 | `--mw-radius-card` | `16rpx`（8px） | 白卡片 |
| 控件圆角 | `--mw-radius-control` | `16rpx`（8px） | 选项、答题卡格子 |
| 页面左右边距 | `--mw-space-page` | `32rpx`（16px） | 设计宽 375，延续 MW02 |
| 最小触点 | `--mw-tap-min` | `88rpx`（44px） | 可点击区域下限 |

偏差记录（MW-UI01 实际取值与原因）：

- TDesign 1.17.0 的 `size="medium"` 按钮高度是 `80rpx`（40px），**低于基线 44px**。答题页在 `.quiz-actions` 内把 `--td-button-medium-height` 提升到 `88rpx`，改动只作用于底部操作区。
- 保存状态胶囊既是状态也是“保存失败后重试”的入口，因此最小高度取 `88rpx`，满足 44px 触点。
- 字号：当前没有全站字号设置开关，大字号仅作为 token 保留，本轮不实现切换入口（不扩大范围）。

字体族：小程序沿用系统字体栈；后台为 `system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`。TDesign 自身使用 `--td-font-family`（`PingFang SC, Microsoft YaHei, Arial Regular`）。

## 3 布局

### 3.1 小程序

- 设计宽 375，内容左右 16px（`32rpx`）。
- 底部 Tab 四项等高，图标 + 文字；答题栈页面隐藏 Tab。
- 答题页自上而下：试卷标题 / 保存状态 → 题号·已答·进度条 → 题干与选项卡片 → 底部固定操作区（上一题 / 答题卡 / 下一题 / 交卷）。
- 底部固定操作区必须留安全区，且不得遮住最后一个选项或长题干：页面内容底部内边距为 `300rpx + env(safe-area-inset-bottom)`。
- 窄屏（320）仍能看到交卷按钮；三个次级按钮等分一行，交卷单独整行。
- 答题卡以底部弹出面板呈现，格子弹窗内滚动，最多容纳 100 题。
- 多选标签固定文案「多选题」，**不显示正确项数量**；判断题标签固定「判断题」。
- 图片：默认最大宽 100%，点击进入放大层；加载失败显示重载，不把缺图当完整题。**答题页当前不渲染题图**：`attempt.questionPage` 只返回 `assetIds`，服务端没有提供可读的图片地址或私有媒体读取入口（见 [mw-ui01-result.md](../development/handbook-v0.1/first-batch/results/mw-ui01-result.md) 第 5 节）。

### 3.2 后台

- 最小可用宽 1200；左侧 220 导航，右侧内容。
- 危险操作使用独立确认条：影响数量 + 原因 + `confirmed`。
- 题库管理员侧栏不出现「订单明细」入口。

## 4 组件规则

组件名称、属性与事件以 TDesign 1.17.0 实际产物为准，映射见 [tdesign-component-map.md](tdesign-component-map.md)。

| 场景 | 组件 | 规则 |
| --- | --- | --- |
| 主按钮 | `t-button theme="primary"` | 主色实心，禁用时不降低对比到无法辨认 |
| 次按钮 | `t-button variant="outline"` | 描边；品牌色描边表示“更常用”，中性描边表示“次要” |
| 题型标签 | `t-tag theme="primary" variant="light"` | 文案区分题型，不靠颜色区分 |
| 题目进度 | `t-progress label="{{false}}"` | 只表达“已答/总题数”，不是得分 |
| 选项 | `t-radio` / `t-checkbox`（分组：`t-radio-group` / `t-checkbox-group`） | 选项卡片由专用类提供边框与选中底；选中态 = 品牌描边 + 品牌浅底 + 控件高亮 |
| 答题卡 | `t-popup placement="bottom"` + 自有格子 | 当前题 / 已答 / 未答三态可区分，可跳题 |
| 权限标签 | 免费：灰底；VIP：金色 | 本轮不动 |

状态与图标（同一套 TDesign 线性图标，`t-icon`）：

| 状态 | 文案 | 图标 | 颜色 |
| --- | --- | --- | --- |
| 未保存 | 未保存 | `time` | 次文字 |
| 保存中 | 保存中 | `loading`（旋转） | 警告 |
| 已保存 | 已保存 | `check-circle` | 成功 |
| 保存失败 | 保存失败 | `error-circle` | 错误 |
| 版本冲突 | 版本冲突 | `error-circle` | 错误 |
| 尚未同步 | 尚未同步 | `cloud` | 错误 |

正确/错误配色（`--mw-color-success` / `--mw-color-danger`）**仅在规范中定义，供后续结果页与解析页使用**；答题过程中不显示正确答案、对错颜色或解析，本轮不实现结果页换肤。

## 5 无障碍与适配

- 可点击区域不小于 44×44px（已按 §2 偏差记录逐项落实）。
- 支持系统大字号；长题干、长选项换行，不缩小到不可读。
- 色块不作为唯一信息：保存状态、答题卡格子、选项选中态都另有文字或形状。
- 窄屏（320）仍能看到交卷按钮。

## 6 素材落位

| 文件 | 用途 |
| --- | --- |
| `assets/brand/logo-placeholder.svg` | 占位标志（未换正式 Logo） |
| `assets/brand/README.md` | 授权与替换说明 |
| `docs/design/prototypes/*.html` | 走查稿，不进小程序包 |
| `docs/design/prototypes/quiz-tdesign-review.md` | 答题页样板预览与手点说明 |

## 7 版本记录

| 版本 | 日期 | 内容 |
| --- | --- | --- |
| MW02 占位 | 2026-10-08 | 占位品牌与走查基线，非正式定稿 |
| MW-UI01 实施基线 | 2026-10-15 | 定稿语义变量与 TDesign 映射、字号/间距/圆角/触点数值、组件与图标规则；答题页按本规范落地 |
