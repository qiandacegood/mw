# MW05 实际结果

日期：2026年10月8日  
任务：[可信入口与后台权限](../mw05-trusted-entry.md)  
状态：**已完成**（正式入口、`admin_users`、开发者工具共享环境 FROM 上下文、真实 Web 登录均已闭合。MW04 的 P08/P10/P11 限制仍保留，不在本任务范围）

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

### 3.1 后台登录（P04 / P06）— **PASS**

2026-10-08 用户在 `http://localhost:4174/` 亲自输入密码后回报（无密码、无 uid 原文）：

```json
{
  "loggedIn": true,
  "uidPresent": true,
  "roles": ["super"],
  "enabled": true
}
```

CloudBase 会话存在，且 `admin.me` 读到 `admin_users` 中启用的 `super`。

1. 打开本地后台：`http://localhost:4174/`（`npm run dev --workspace=@mw/admin`）。
2. **在页面亲自输入用户名和密码**。不要把密码发给对话或写入仓库。
3. 点击「登录并读取 admin.me」。成功时应看到 `roles` 含 `super`，且 `loggedIn=true`。
4. 把页面上的 JSON（不含密码）告诉执行者后，才能把 P04 真实登录与 P06 标为 PASS。

### 3.2 资源方 AppID 是什么、写在哪

资源方 AppID **不是**思维工坊自己的 AppID。

- 思维工坊 AppID：调用方，写在 `F:/MW/main/.env` 的 `WECHAT_APP_ID`（或 `MW_ALLOWED_MINI_APPIDS`）。
- **资源方 AppID**：钱大册小程序的 AppID。mw-test 挂在钱大册主体下，微信侧的环境主人是钱大册。共享调用时，小程序要用 `new wx.cloud.Cloud({ resourceAppid, resourceEnv })`，这里的 `resourceAppid` 就是它。

写入位置：同一个被 Git 忽略的文件 **`F:/MW/main/.env`**，新增一行：

```text
MW_RESOURCE_APPID=wx开头的钱大册小程序AppID
```

不要发到对话，不要提交。不要去改腾讯云账号的微信公众平台关联。

查找办法（只读，不要改绑定）：

1. 打开**钱大册**小程序的微信开发者工具 → 右上角「详情」→「基本信息」→ AppID。
2. 或登录[微信公众平台](https://mp.weixin.qq.com/) 进入钱大册小程序 → 开发管理 → 开发设置 → 开发者 ID（AppID）。
3. 或 CloudBase 控制台打开 mw-test → 环境设置里已关联的微信小程序，那个 AppID 就是资源方。

写好后在 `F:/MW/main` 运行：`npm run mw05:write-local`，再执行下面的开发者工具步骤。`cloud.local.js` 缺少资源方 AppID 时，探针会显示 `LOCAL_SHARED_CONFIG_MISSING`。

### 3.3 微信开发者工具逐步操作（P05）— **PASS**

2026-10-08 开发者工具共享环境探针实据（未粘贴 AppID/OpenID/环境 ID）：

- 编译模式启动页：`pages/probe/index`
- 页顶：`LOCAL_SHARED_CONFIG_PRESENT`
- `mw-public`：`ok=true`，`trustedFromContext=false`（公开入口不要求会员 FROM）
- `mw-member`：`ok=true`，`trustedFromContext=true`

只回报 `trustedFromContext` 和 `reason`，不要粘贴 AppID、OpenID、环境 ID。

1. 确认 `F:/MW/main/.env` 已有真实 `WECHAT_APP_ID`（思维工坊）和 `MW_RESOURCE_APPID`（钱大册）。
2. 在 `F:/MW/main` 运行：`npm run mw05:write-local`，然后 `npm run mw05:deploy`（把白名单注入 `cloudbase_auth`）。
3. 打开微信开发者工具（基础库 2.13.0 或以上）。
4. 「导入项目」：目录选 `F:/MW/main/apps/miniprogram`。AppID 选思维工坊正式号（不要用测试号 touristappid）。若工具提示覆盖，以本地已忽略的 `project.private.config.json` 为准。
5. 右上角「详情」→「本地设置」：勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」（仅本机调试）。
6. 确认该思维工坊小程序已在钱大册云开发控制台「更多 → 环境共享」里被授权使用 mw-test。不要去改「微信公众平台关联」。
7. 编译后打开页面「共享环境探针」（`pages/probe/index`）。若首页没有入口，点编译器的页面下拉选该页，或把路径改到 `pages/probe/index`。**必须重新编译**；必要时「工具 → 清缓存 → 全部清除」后再编译。
8. 点「调用 mw-public」，再点「调用 mw-member」。
9. 把两行结果里的 `ok`、`trustedFromContext`、`reason` 发回。  
   - 会员调用成功且 `trustedFromContext=true` 才可把 P05 标 PASS。  
   - `APPID_NOT_ALLOWED`：白名单不是思维工坊 AppID，或未重新 deploy。  
   - `LOCAL_SHARED_CONFIG_MISSING`：`.env` 缺 `MW_RESOURCE_APPID`，或未跑 `mw05:write-local`。  
   - `LOCAL_SHARED_REQUIRE_FAILED`：开发者工具没读到本地配置；先清缓存再编译。  
   - `NO_FROM_APPID`：不是用 `Cloud({ resourceAppid, resourceEnv })` 的共享调用。

P05 已按上表实据标为 PASS。

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

本任务约定范围已满足：六入口与 `cloudbase_auth`、`admin_users` 双层校验、真实 Web 登录（P04/P06）、开发者工具可信 FROM（P05）、临时 HTTP 探针后删除。未创建未来业务集合/索引（P08 保持 PARTIAL）、未把 HTTP 网关 4.9 MB 变成可上传（P10 保持 PARTIAL）、未在控制台逐条点选函数规则（P11 保持 PARTIAL）。这些限制记在 MW04，不阻止本任务标为已完成。
