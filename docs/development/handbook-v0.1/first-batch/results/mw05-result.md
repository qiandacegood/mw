# MW05 实际结果

日期：2026年10月8日  
任务：[可信入口与后台权限](../mw05-trusted-entry.md)  
状态：**部分完成**（正式入口与 `admin_users` 已落地；真实 Web 登录与共享环境 FROM 上下文仍待用户手工完成）

工作区：`F:/MW/main`。只操作 mw-test。环境 ID、后台用户 ID、AppID 只在被 Git 忽略的本地 `.env`。未输出、未提交。

未把 A01—A31、T01—T30 标为通过。未创建生产环境，未升级套餐，未开启超额计费，未真实支付，未开放公开管理员注册，未修改腾讯云账号的微信公众平台关联。

## 1 实现范围

- 最小权限 `cloudbase_auth`：只信 `FROM_APPID` / `FROM_OPENID`，忽略资源方 `APPID` / `OPENID`，白名单为空或占位时失败关闭。
- 正式六入口骨架：`mw-public`、`mw-member`、`mw-admin`、`mw-upload`、`mw-pay-hook`、`mw-jobs`。不是 `mw-validation-*` 的复制。
- `admin_users` 已创建并以受控脚本预置本地 `MW_ADMIN_UID`：`roles=["super"]`、`enabled=true`、`authVersion=1`。
- 后台同时要求 CloudBase uid 与 `admin_users`。客户端 `uid`/`role` 视为伪造。
- 管理页接 `@cloudbase/js-sdk@3.10.1` 用户名密码登录。密码只在浏览器输入。
- 小程序增加共享环境探针页，不在仓库写入真实 env / AppID。

## 2 云端调用（CLI，无小程序上下文）

| 入口 | 输入 | 结果 |
| --- | --- | --- |
| mw-public / public.ping | 合法信封 | `ok=true`，骨架 |
| mw-public / home.get | data 内 userId/role | `FORBIDDEN` / `CLIENT_IDENTITY_IGNORED` |
| mw-member / member.session | CLI 无 FROM_* | `AUTH_REQUIRED` / `NO_FROM_APPID` |
| mw-admin / admin.me | 请求体 uid/role | `FORBIDDEN` / `CLIENT_IDENTITY_IGNORED` |
| mw-jobs | fromClient | `CLIENT_INVOKE_DENIED` |
| mw-pay-hook | 无签名 | `SIGNATURE_REQUIRED` |
| mw-upload | 无票据 | `TICKET_REQUIRED` |
| cloudbase_auth | CLI | `errCode=403` / `NO_FROM_APPID` |

本地单元测试覆盖：嵌套伪造字段、资源方 APPID/OPENID 误用、错误 FROM_APPID、普通用户、停用管理员、公开管理员注册拒绝。

## 3 用户必须手工完成（未完成不得标 PASS）

### 3.1 后台登录（P04 / P06）

1. 打开本地后台：`http://localhost:4174/`（`npm run dev --workspace=@mw/admin`）。
2. **在页面亲自输入用户名和密码**。不要把密码发给对话或写入仓库。
3. 点击「登录并读取 admin.me」。成功时应看到 `roles` 含 `super`，且 `loggedIn=true`。
4. 把页面上的 JSON（不含密码）告诉执行者后，才能把 P04 真实登录与 P06 标为 PASS。

### 3.2 微信开发者工具共享环境（P05）

本地 `WECHAT_APP_ID` 仍是占位时，`cloudbase_auth` **失败关闭**，这是有意的。

1. 把真实 MW 小程序 AppID 写入本地 `.env` 的 `WECHAT_APP_ID` 或 `MW_ALLOWED_MINI_APPIDS`（不要发到对话、不要提交）。
2. 把资源方（钱大册）AppID 写入本地 `MW_RESOURCE_APPID`。不要改腾讯云账号的微信公众平台关联。
3. 运行 `npm run mw05:deploy` 以把白名单注入 `cloudbase_auth`。
4. 用微信开发者工具打开 `apps/miniprogram`。真实 AppID 只放 `project.private.config.json`（已忽略）。
5. 生成本地 `cloud.local.js`（`mw05:deploy` 会写；已忽略）。打开「共享环境探针」页。
6. 先调 `mw-public`，再调 `mw-member`。只回报 `trustedFromContext` 是否为 true，以及 `reason` 枚举。不要粘贴 AppID/OpenID。
7. **只有实际出现可信 FROM_APPID/FROM_OPENID 后，P05 才能标 PASS。** 本次未跑开发者工具，P05 保持 NOT_RUN。

## 4 云资源

| 资源 | 结果 |
| --- | --- |
| 新增并保留 | `cloudbase_auth`、`mw-public`、`mw-member`、`mw-admin`、`mw-upload`、`mw-pay-hook`、`mw-jobs` |
| 新增集合 | `admin_users`（仅此集合；未建未来业务集合/索引） |
| 临时 HTTP | `mw-http-size-probe` 及对应 HTTP 通路：已精确删除 |
| 存储 ACL | 保持 ADMINONLY |
| 超额计费 | `EnableOverrun=false`（账号下其他环境未改） |

## 5 费用

个人版预付资源点。本次部署与调用会产生函数冷启动和调用量；`tcb env usage` 仍可能延迟。未购买、未续费、未开通超额、无现金支付。

## 6 本地检查

| 命令 | 退出码 |
| --- | --- |
| `npm run check:prototypes` | 0 |
| `npm run typecheck` | 0 |
| `npm test` | 0（含身份伪造、停用管理员、普通用户越权、共享来源错误、密钥扫描） |
| `npm run build` | 0 |

## 7 完成条件

未全部满足：缺真实 Web 登录闭合，缺开发者工具共享调用的 FROM 上下文。因此整项为部分完成。
