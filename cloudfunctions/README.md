# MW04 有限验证函数

这些函数只用于 mw-test 能力验证，不是正式业务入口。名称带 `mw-validation-` 前缀。

真实环境 ID 只出现在被 Git 忽略的本地 `.env` / `cloudbaserc.json`。部署使用 `npm run mw04:validate`。

正式六入口仍在 `services/api/src/entrypoints`，MW03 起未接线。
