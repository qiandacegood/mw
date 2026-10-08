# CloudBase SDK 与运行时锁定（MW04）

日期：2026-10-08  
真实环境 ID 只写在被 Git 忽略的本地 `.env`，本文件不写环境 ID。

| 项 | 锁定版本 | 说明 |
| --- | --- | --- |
| 本地 Node | v24.21.0 | 开发机，不可当作云函数运行时 |
| 生产级云函数运行时 | Nodejs20.19 | CLI 正式推荐；实测可部署 |
| Nodejs22.21 | 可部署，CLI 仍标公测 | 且 Node 22+ 不支持云端 `installDependency` |
| Nodejs24.11 | 运行时页标 Active LTS | CLI 仍标公测，本次不作为生产冻结 |
| `@cloudbase/node-sdk` | 3.18.3 | npm `latest`；不使用 `next` 4.x |
| `@cloudbase/js-sdk` | 3.10.1 | Web / 后台候选 |
| `@cloudbase/cli` | 3.8.5 | 与本机已装 CLI 一致 |
| `wx-server-sdk` | 4.0.2 | 仅验证函数读取云调用上下文 |

禁止在部署或 package.json 中写 `latest`。
