# 答题页样板预览与手点说明（MW-UI01）

日期：2026-10-15  
样板页面：`apps/miniprogram/pages/quiz/index`（真实小程序页面，不是 HTML 或截图替代）  
规范依据：[visual-spec.md](../visual-spec.md)、[tdesign-component-map.md](../tdesign-component-map.md)

## 1 验证层级（先说清哪一层做过、哪一层没做）

| 层级 | 做了什么 | 结果 |
| --- | --- | --- |
| 本地模拟 | 单元测试（事件适配、保存态、交卷体、未答确认）+ 构建期依赖解析检查 | 通过，见第 5 节 |
| 实际编译 | 用开发者工具 CLI 打开本工程，交由 IDE 编译并在模拟器查看 | **用户手点 4 步通过**（2026-10-15）；执行者侧未读取编译面板，记为 NOT_RUN |
| 真实云端 | 真实身份 + 真实云环境写入 | **未做**，本任务不做任何云端访问 |

第 4 节的手点清单已由用户完成（4 步全部通过），可见验证据此闭合。

## 2 如何打开样板

```powershell
# 0) 必须先切到仓库根目录，否则 npm 会在当前目录写 package-lock.json
#    （在 C:\Windows\System32 下执行会报 EPERM 权限错误）
cd F:\MW\main

# 1) 首次或依赖变更时安装；依赖已装好时可跳过
npm install

# 2) 重建 miniprogram_npm（会删除后重建，必须重跑）
npm run build -w @mw/miniprogram

# 3) 微信开发者工具打开“小程序根目录”，不是仓库根目录
#    目录：F:\MW\main\apps\miniprogram
#    本地设置里确认勾选「不校验合法域名、web-view、TLS 版本以及 HTTPS 证书」
```

要点：

- 若报 `npm error EPERM: operation not permitted, open 'C:\Windows\System32\package-lock.json'`，说明命令不是在仓库根目录执行的（终端当前目录是 `C:\Windows\System32`）；`cd F:\MW\main` 后重跑即可，这个错误不影响项目文件。
- 导入时若被要求选择目录，指向 `apps/miniprogram`（`project.config.json` 的 `miniprogramRoot`）。
- **不要**在开发者工具里点“构建 npm”。本工程的 `miniprogram_npm` 由 `npm run build -w @mw/miniprogram` 生成；工具内构建 npm 会覆盖它。若误点，重跑一次构建即可。
- 图标字体走 `https://tdesign.gtimg.com/...`，真机预览需要把 `tdesign.gtimg.com` 加入 downloadFile 合法域名；开发者工具默认不校验时不受影响。
- 想要看到“答题中”的完整界面，需要一条真实的进行中答题记录（`attemptId`)。**本任务没有、也不会伪造数据和云端写入**，所以直接进 `/pages/quiz/index` 只会看到“缺少答题记录”的空态。完整手点路径见第 4 节第 3 步。

## 3 样板包含什么

- 页头：试卷标题 + 保存状态胶囊（未保存 / 保存中 / 已保存 / 保存失败 / 尚未同步 / 版本冲突，均为图标 + 文字 + 颜色）、题号 `第 n / N 题`、已答数量、题目进度条。
- 题干卡片：题型标签（单选题 / 多选题 / 判断题）+ 题干（16px、行高 1.6，长题干换行）。
- 选项：多选用 `t-checkbox-group` + `t-checkbox`（方框图标），单选与判断用 `t-radio-group` + `t-radio`（圆形图标）；选中态 = 品牌描边 + 品牌浅底 + 控件高亮 + 选项序号变色。
- 底部固定操作区：`上一题 / 答题卡 / 下一题` 三个次按钮 + 整行 `交卷` 主按钮；按钮高度已提升到 44px。
- 答题卡：底部弹出面板，当前题 / 已答 / 未答三态，含图例与“已答不代表答对”的说明，格子弹窗内滚动。
- 加载中 / 加载失败可重试 / 已交卷只读（入口改为“查看结果”）三态。
- 离线说明条与点击状态胶囊重试保存。
- 默认收起的“调试与测试区（非正式）”，保留原 leftover 入口，展开不写任何数据。
- 超长文本、最多 100 题（答题卡滚动）、320 窄屏（三个次按钮等分、交卷单独整行）。

## 4 手点清单（4 步，已由用户完成并通过）

1. 打开工程，等模拟器编译完成。**预期**：编译面板无“找不到组件 / 无法解析路径”一类报错；`pages/quiz/index` 能编译。
2. 编译面板/模拟器里若出现 `tdesign-miniprogram` 相关错误，记录原文并在仓库根重跑 `npm run build -w @mw/miniprogram`。
3. 走一遍完整答题页：从首页/试卷详情进入一条**真实进行中**记录（或继续练习）→ 检查第 3 节列出的每一项。重点确认：
   - 多选勾选后**不会弹回**（受控组件回写正确）；
   - 单选/判断互斥，且重复点已选项不会取消；
   - 保存状态胶囊随时间/网络变化，文案与颜色一致；
   - 答题卡能跳题且当前题标记正确；
   - 交卷时若有未答会先弹二次确认；离线时交卷被拒。
4. 在模拟器里切换“浅色/深色”不影响本页（小程序未开启 darkmode，本页固定浅色基线）；再把模拟器宽度切到窄屏（如 iPhone SE / 320），确认交卷按钮仍可见。

## 5 本任务已完成的检查证据

- `npm run build -w @mw/miniprogram`：复制 TDesign 运行时 89 个文件 / 253.7 KB；`miniprogram_npm` 合计 91 个文件 / 435.7 KB（含 `@mw/shared` 182 KB）。
- 连续两次构建的 `miniprogram_npm` 清单（相对路径 + 大小）SHA-256 一致 → 可重复构建。
- `scripts/check-miniprogram-imports.mjs`：检查 165 个小程序文件（js/json/wxml/wxss），包括 `miniprogram_npm/tdesign-miniprogram/**` 与 `miniprogram_npm/tslib/**`，全部依赖可解析；`pages/quiz/index.json` 引用的 10 个组件都落到真实组件定义。
- `npm run typecheck`：通过。
- `npm test`（根）：8 + 24 + 89 + 109 = 230 项通过。其中新增 4 项针对 `choiceOptionIds` / `quizTypeLabel` / `answeredPercentOf` 的适配测试。
- `npm run check:prototypes`：通过（未改动 HTML 走查稿的脚本）。

## 6 已知限制与缺口

1. 题图 / 选项图与放大预览**未接线**：`attempt.questionPage` 只返回 `assetIds`，没有可读地址，`packages/shared/src/media.ts` 只有后台上传侧、没有小程序读取入口。为不伪造图片，本页不渲染图片。详见 [结果文档](../../development/handbook-v0.1/first-batch/results/mw-ui01-result.md) 第 5 节。
2. 大字号：语义变量 `--mw-font-size-body-large`（20px）已定义，但全站没有字号切换入口，本轮不实现。
3. 结果页/解析页尚未换肤，只在规范里预留正确/错误配色。
4. `docs/design/prototypes/*.html` 仍是 MW02 的走查稿（用于角色/状态切换与段落走查），不是实施基线；两者不一致时以小程序页面 + [visual-spec.md](../visual-spec.md) 为准。本轮**没有**把走查稿改成新基线，避免与微信小程序实现并行维护两套。
