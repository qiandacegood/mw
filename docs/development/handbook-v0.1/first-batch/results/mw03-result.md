# MW03 实际结果

日期：2026年10月8日（第三轮稳定性复核后按实测改写）  
任务：工程骨架与本地检查  
状态：**已完成**（本地骨架可复现；微信开发者工具冒烟 NOT_RUN）

## 1 版本与修改范围

- 工作区：原生小程序 TS、Vue 3 后台、云函数入口骨架、`packages/shared`。
- 隔离模拟：`paper.detail`，业务规则只在 `packages/shared/src`。
- 2026-10-08 第二轮整改：
  - 复现 `npm test` 因 `@mw/miniprogram` 收集 `mock-client.test.ts` 失败（`Cannot find packages/shared/src/errors.js`），根命令退出码 1。
  - `@mw/shared` 不再把 `src/index.ts` 作为 Node/Vitest 运行时入口。`scripts/ensure-shared-js.mjs` 从同一 `src` 生成 `dist/*.js`；包 `exports` 指向 `dist`。
  - 小程序构建仍从同一 `src` 打到 `miniprogram_npm/@mw/shared`（CJS）。Vitest 别名与包入口都指向这份编译 JS，不再一套走裸 TS、一套只认 `miniprogram_npm`。
  - 未删除、跳过或弱化小程序测试。`services/mock-client.test.ts` 实际执行并通过。
  - 构建前清理旧生成 JS 与 `miniprogram_npm`；入口按 `app.json` 页面清单和 `services` 目录发现；检查每页 JS/JSON/WXML/WXSS。
  - 保留运行时 import 检查，并实际执行生成版 `mock-client.js`，确认返回 `paper_fict_logic_l1`。
  - 未复制第二套业务规则。未执行 `npm audit fix --force`。
- 2026-10-08 第三轮：
  - 根目录 `npm test` 增加 `scripts/check-prototype-scripts.mjs`（解析 `index.html` / `miniprogram.html` / `admin.html` 内联脚本）。
  - 确认当时无其它 npm test/vitest 进程后，每次删除 `packages/shared/dist` 再串行 `npm test`，连续 5 次退出码均为 0。未改 ensure 为原子生成。

## 2 可见入口

| 入口 | 路径或命令 |
| --- | --- |
| 根脚本 | `npm run typecheck` / `npm test` / `npm run build` / `npm run check:prototypes` |
| 共享 JS | `scripts/ensure-shared-js.mjs`（test/build 前置） |
| 小程序构建 | `npm run build -w @mw/miniprogram` |
| 导入与生成版执行检查 | 构建末步自动运行 |
| DevTools 冒烟 | `npm run smoke:devtools -w @mw/miniprogram` |

## 3 实际执行的检查

环境：Windows，Node v24.21.0，`F:\MW\main`。

```text
npm run typecheck
npm test
npm run build
npm run smoke:devtools -w @mw/miniprogram
```

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| typecheck | 0 | 4 个工作区通过 |
| test | 0 | 先跑原型脚本检查；11 项全部执行并通过：admin 1、miniprogram 1、shared 7、api 2 |
| 删除 dist 后串行 test×5 | 0,0,0,0,0 | 当时无其它 npm test/vitest；单进程连续 5 次 |
| build | 0 | 后台 Vite 成功；小程序写出 `app.js`、`pages/home/index.js`、`services/mock-client.js`、`miniprogram_npm/@mw/shared/index.js`；`checked 4 js files; all runtime imports resolve`；`generated mock-client returned paper_fict_logic_l1` |
| check:prototypes | 0 | `index.html` 无内联脚本；`miniprogram.html`/`admin.html` 各 1 段解析通过 |
| smoke:devtools | 0 | **NOT_RUN**（`reason=cli-not-found`，未安装未经授权软件） |

Vitest / 依赖公告：npm 仍报开发依赖漏洞。只记录，未执行 `npm audit fix --force`。

## 4 限制与验证层级

| 层级 | 状态 |
| --- | --- |
| 类型检查与单元测试 | 通过（11 项） |
| 小程序 JS 构建产物 | 通过 |
| 运行时模块解析自动检查 | 通过 |
| 生成版 mock-client 实际执行 | 通过（`paper_fict_logic_l1`） |
| 微信开发者工具导入/编译/首页显示 | NOT_RUN |
| CloudBase | 未接线 |

缺 DevTools 不把整项降为部分完成，但不得声称首页已在开发者工具中显示。

## 5 完成条件

typecheck、test、build 均为退出码 0，小程序测试实际执行。DevTools 冒烟明确为 NOT_RUN。

## 6 交给 MW04

实施基线第 11 节。无可用环境时只做准备。
