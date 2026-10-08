# 云函数

MW04 一次性验证桩 `mw-validation-*` 仅作本地历史保留，不得复制为正式实现，云端已删除。

MW05 正式入口（部署到 mw-test；身份不来自请求体）：

| 函数 | 用途 |
| --- | --- |
| `cloudbase_auth` | 共享环境闸门。只信 `FROM_APPID` / `FROM_OPENID`，校验 MW AppID 白名单，默认拒绝 |
| `mw-public` | 公开只读骨架 |
| `mw-member` | 需可信共享小程序身份 |
| `mw-admin` | CloudBase uid + `admin_users` |
| `mw-upload` | 一次性票据，默认拒绝无票 |
| `mw-pay-hook` | 需签名，非正式支付通道 |
| `mw-jobs` | 拒绝客户端 |

临时 HTTP 探针 `mw-http-size-probe` 只用于 P10，测完必须删除。真实环境 ID 只出现在被 Git 忽略的本地 `.env`。
