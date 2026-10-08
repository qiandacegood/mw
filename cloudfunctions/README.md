# MW04 一次性验证桩

`mw-validation-*` 全部是 mw-test 上的一次性能力验证桩，不是正式业务入口，也不得复制为 MW05 实现。

| 函数 | 验证用途 | 明确未完成 |
| --- | --- | --- |
| `mw-validation-runtime22` | Nodejs22.21 是否可部署 | 不是生产冻结运行时 |
| `mw-validation-probe` | ping、伪造身份、事务、索引、存储边界 | 非正式入口 |
| `mw-validation-public` | 公开只读与越权拒绝 | 非正式目录接口 |
| `mw-validation-member` | 无可信上下文时拒绝写 | 非正式会员入口 |
| `mw-validation-admin` | 无 Auth uid 时拒绝后台动作 | **未完成真实 Auth** |
| `mw-validation-upload` | 5 MB 应用边界与伪造票据拒绝 | `ticket_fict` **不是真票据** |
| `mw-validation-pay-hook` | 缺签名字段时拒绝 | **未进行密码学验签** |
| `mw-validation-jobs` | 客户端触发拒绝 | **未完成可信调度来源** |

真实环境 ID 只出现在被 Git 忽略的本地 `.env` / `cloudbaserc.json`。部署使用 `npm run mw04:validate`；收尾使用 `npm run mw04:teardown`（默认 dry-run）或 `npm run mw04:teardown:confirm`。

正式六入口仍在 `services/api/src/entrypoints`。MW03 起未接线；MW05 必须按基线重新实现身份、权限、验签与调度，不能把本目录桩代码当正式实现。
