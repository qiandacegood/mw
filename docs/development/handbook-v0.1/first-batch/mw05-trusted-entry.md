# MW05 可信入口与后台权限

开发手册 v0.1｜任务状态：进行中（结果见 [results/mw05-result.md](results/mw05-result.md)）  
[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)

## 目标与可见结果

在 mw-test 上建立正式六入口骨架、最小权限 `cloudbase_auth`、后台 `admin_users` 双层校验，以及真实 Web SDK 登录页。不复制 `mw-validation-*` 验证桩。不开放公开管理员注册。不创建全部未来业务集合。

## 输入

MW04 锁定的 Nodejs20.19 与 SDK、实施基线第 3/11 节、技术架构第 2–3 节、数据模型 `admin_users`、部署方案第 4 节、接口契约第 2/5 节。后台用户 ID 只写在本地 `.env` 的 `MW_ADMIN_UID`。

## 本任务工作范围

1. `cloudbase_auth` 只信任 `FROM_APPID` / `FROM_OPENID`，校验 MW AppID 白名单，默认拒绝其他来源。
2. 正式入口：`mw-public`、`mw-member`、`mw-admin`、`mw-upload`、`mw-pay-hook`、`mw-jobs`。
3. 预置 `admin_users`；后台同时验证 CloudBase uid 与白名单。
4. 管理后台接真实 Web SDK 用户名密码登录；密码只允许用户在页面输入。
5. 准备微信开发者工具共享环境调用步骤；未取得可信 FROM 上下文前 P05 不得标 PASS。
6. 临时 HTTP 函数实测 4.9/5.1 MB 后精确删除。

## 不包含

不实现会员注册、题库、支付履约、定时任务业务。不修改腾讯云账号的微信公众平台关联。不操作非 mw-test 环境。不把环境 ID、用户 ID、AppID、密码写入仓库。
