# MW07-B 虚拟支付签名、查单、通知与发货样例

开发手册 v0.1｜任务状态：已完成（仅技术样例）；hook 已覆盖带 openid 的 GET/XML/JSON 真实形态；沙箱查单已发出。结果见 [results/mw07b-result.md](results/mw07b-result.md)
[整项说明](mw07-virtual-payment.md)｜[任务总览](../02-roadmap.md)｜[实际进度](../07-progress.md)｜[A 段结果](results/mw07a-result.md)

**本轮只执行 MW07-B。** 不启动 MW12 或任何下一项。不得把 A14/A20 或 T20/T26 标为通过。不得实现购买闭环。

## 目标与可见结果

在 MW07-A 已确认主体资格、用户已在 MP 完成后台开通、本地已写入沙箱配置的前提下，交付隔离技术样例：虚拟支付签名、沙箱查单适配器、通知验签、发货确认适配器，并记录 Android / iOS / 商品 / 退款 / 回调 / 现网条件。

完成后应交付：

1. 本执行说明。
2. B 段结果：[results/mw07b-result.md](results/mw07b-result.md)。
3. 07-progress.md 与本文件状态一致。

## 本轮范围

| 分段 | 名称 | 本轮 |
| --- | --- | --- |
| MW07-A | 主体及渠道资格核对 | 已完成（2026-10-08），不重做 |
| **MW07-B** | 签名、查单、通知和发货样例技术验证 | **执行** |

B 只做隔离技术样例：

1. 按当日重读的官方算法生成/校验 `paySig`、`signature`；`quantity` 固定 1；业务金额用人民币分。
2. 服务端按配置选择 `env`；`VIRTUAL_PAY_ENV=1` 为沙箱。禁止接受客户端 `env` 选现网。`env=0` 代码路径可存在，本轮默认不调用现网。
3. `/xpay/query_order` 服务端适配器。密钥就绪时允许对未知单号做一次沙箱查单，只证明接口与鉴权通路，不创建业务订单、不发放 VIP。
4. `mw-pay-hook` 按虚拟支付消息推送协议验签；保留原始字节，先验签再解析；XML 关闭外部实体与外网。失败直接拒绝。成功只解析事件类型，不发放 VIP。通知不是微信支付 APIv3。
5. `/xpay/notify_provide_goods` 隔离适配器与单测。没有真实已付订单时不对线上未知单确认发货。
6. 脱敏记录各端、沙箱/现网、退款、回调与测试商品条件。测试商品只记「已由用户创建、未对外定价」，不写 productId 真值。

## 明确禁止

- 实现 `order.create`、`payment.prepare`、`wx.requestVirtualPayment` 真机拉起、VIP 发放、退款、对账、人工开 VIP。
- 调用 `/xpay/refund_order`。
- 使用 `env=0` 现网 AppKey 调接口（代码存在性除外，结果须写明未调用）。
- 向 mw-test 写入 `orders` / `payment_receipts` / `vip_accounts` / `vip_grants` / `callback_events` 等业务文档。默认零云写入。
- 部署生产、改安全规则、改钱大册关联、开启超额计费、购买套餐、真实扣款、iOS/Apple 现网付款。
- 用普通微信支付、二维码、外部网页或人工开 VIP 替代虚拟支付。
- 把 A14、A20、T20、T26 标通过。
- 复制 `mw-validation-*` 桩；把 leftover 脚本当完成证明。
- 打印、提交或写入结果文档：`.env` 真值、AppID、OPENID、env ID、admin 密码、upload token、OfferID、AppKey、AppSecret、pay secrets、通知 Token/AES。
- 把 `.env`、`configs/*-verify-state.json`、`tmp/` 提交进 Git。
- 向用户追问密钥或身份真值。
- 启动 MW12、MW20、MW21、MW22、MW29。

## 完成条件

- 官方页已按当日重读并记 URL。
- 签名有官方或固定夹具对照，测试通过。
- 查单适配器存在；密钥就绪则有脱敏沙箱查单结论。密钥缺失则标受阻，不编造成功。
- `mw-pay-hook` 能拒绝伪造通知，能对夹具验签；不是 APIv3。
- 发货确认适配器存在，并说明未对真实未授权订单确认发货。
- Android/iOS/商品/退款/回调/现网条件已记录。iOS 标为待现网授权，不能用沙箱冒充通过。
- 未把 A14/A20/T20/T26 标通过。
- 本地 `check:prototypes` / `typecheck` / `test` / `build` / `git diff --check` 退出码 0。
- 07-progress 与结果文档状态一致。

## 交给后续任务的内容

B 即使整项 MW07 可标已完成，也只证明隔离技术样例。MW20 权益账本、MW21 套餐购买、MW22 退款对账、MW29 真机付款均未开始。A14/A20/T20/T26 仍未通过。
