# MW07-B 实际结果

日期：2026年10月9日
任务：[虚拟支付签名、查单、通知与发货样例](../mw07b-virtual-payment.md)
分段：**B 通过（仅技术样例）**；签名、通知验签、发货确认适配器已落地；hook 已覆盖带 openid 的真实消息推送形态；沙箱查单已发出
整项状态：**已完成（仅技术样例；未真实扣款、未 iOS 现网、未购买闭环）**

工作区：`F:/MW/main`。只使用 mw-test。没有生产环境、没有真实扣款、没有 iOS 现网付款、没有购买闭环。未把 A14/A20 或 T20/T26 标为通过。未输出、未提交 AppID、环境 ID、OPENID、OfferID、AppKey、AppSecret、通知 Token/AES 或单号真值。未向 mw-test 写入 `orders` / `payment_receipts` / `vip_accounts` / `vip_grants` / `callback_events`。`wroteDocs=false`。未启动 MW12。

## 1 结论

MW07-B **通过（仅技术样例）**。隔离技术样例（签名、环境门禁、查单适配器、通知验签、发货确认适配器、资格矩阵）已落地。`mw-pay-hook` 在验签前不再走会员 `forgedDenied`：带 `openid` 的 GET URL 握手、XML POST、JSON POST 可到达验签；伪造签名与 APIv3 仍拒绝；平台通知里的 `openid` / `OpenId` / `FromUserName` 不视为客户端伪造身份。沙箱 `/xpay/query_order` 已对未知单号调用一次 `env=1`，未创建业务订单、未发放 VIP。A14/A20/T20/T26 仍未通过。

整项 MW07 标 **已完成**，限制如下：仅技术样例、未真实扣款、未做 iOS 现网、未做购买闭环。不改用普通微信支付。

## 2 官方现行资料（2026-10-09 重新读取）

不沿用 2026-10-03 产品说明书第 21 节或 2026-10-08 A 段摘录当最终算法。下列页面均在当日直接读取。

| 资料 | URL | 本次读取要点 |
| --- | --- | --- |
| 虚拟支付主指引 | https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html | Android / 鸿蒙 / Windows 走微信支付；iOS 走 Apple 支付。Apple **不支持沙箱**，仅现网。`paySig = hex(hmac_sha256(appKey, uri + '&' + signData))`；`signature = hex(hmac_sha256(sessionKey, signData))`。官方测试向量：`uri=/xpay/query_user_balance`、固定 `post_body`、`appkey=12345` → `pay_sig=c37809f27c6d7fd1837ad2500a04512b66b34fd793a39a385fade56dca89a4b5`；固定 `session_key` → `signature=089d9e8dc5d308977360c4b79ec600a93d736802802a807d634192328032f6c7`。`env=0` 现网 AppKey，`env=1` 沙箱 AppKey。通知事件为 `xpay_*`，响应 XML/JSON `ErrCode`。 |
| 技术服务费 | https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/devplan.html | Android / 鸿蒙 / Windows 主动支付：标准 10%，当前生效 1%。iOS：标准 17%（含 12% Apple 佣金），当前生效 12%，全部为 Apple 佣金。首版不做自动续费。 |
| 查询订单 | https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order.html | `POST /xpay/query_order?access_token=&pay_sig=`。body：`openid`、`env`、`order_id` 或 `wx_order_id`。金额字段单位为分。`268490003` 为签名错误。不支持云调用。 |
| 通知已发货 | https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_notify_provide_goods.html | `POST /xpay/notify_provide_goods`。仅现金单；正常 `xpay_goods_deliver_notify` 成功响应后不必再调。本轮不对真实未授权订单调用。 |
| 启动退款 | https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_refund_order.html | 支付后 365 天内可启动；180 天内退手续费。本轮**未调用**。 |
| wx.requestVirtualPayment | https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html | `mode=short_series_goods`；`buyQuantity`、`goodsPrice`（分）、`env`、`offerId`、`productId`、`outTradeNo`。本轮未真机拉起。 |
| 消息推送验签 | https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push.html | Token + timestamp + nonce 字典序 SHA1；安全模式用 `msg_signature` 与 AES-256-CBC。官方 URL/明文/密文夹具已对照。**不是**微信支付 APIv3。 |
| 云函数虚拟支付回调 | https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/guide/wechatpay/virtual-payment-callback.html | 事件类型与 `ErrCode=0` 应答。本轮只验签并解析事件类型，不发放。 |

普通小程序支付 APIv3 仍只作查单原则对照，不是本产品通道：https://pay.wechatpay.cn/doc/v3/merchant/4012791911

## 3 本地配置名检查（无真值）

| 变量名 | 状态 |
| --- | --- |
| VIRTUAL_PAY_OFFER_ID | 存在 |
| VIRTUAL_PAY_ENV | 存在（值为沙箱 `1`，不输出其它字符） |
| VIRTUAL_PAY_APP_KEY | 存在 |
| VIRTUAL_PAY_APP_KEY_LIVE | 存在（本轮未使用） |
| VIRTUAL_PAY_NOTIFY_TOKEN | 缺失 |
| VIRTUAL_PAY_ENCODING_AES_KEY | 缺失 |
| WECHAT_APP_ID | 存在 |
| WECHAT_APP_SECRET | 存在 |

通知验签使用官方公开夹具，不依赖本地 Token/AES。沙箱查单已发出，见第 6 节。

## 4 资格 / 条件矩阵（脱敏）

| 项 | 结果 | 说明 |
| --- | --- | --- |
| Android | 官方可用（微信支付） | 本轮仅技术样例，未真机拉起 |
| 鸿蒙 | 官方可用（微信支付） | 同 Android |
| Windows | 官方可用（微信支付） | 客户端须识别 `platform=windows`；未测 |
| iOS / Apple | **待现网授权** | Apple **无沙箱**。不能用 `env=1` 冒充 iOS 通过。须 iOS 15+、微信 8.0.68+、至少 1 元、中国大陆 App Store。退款由用户向 App Store 申请，商户不能主动退。 |
| 沙箱 env=1 | 配置名已存在 | 本轮默认环境。未做真实扣款 |
| 现网 env=0 | 代码路径存在，**未调用** | 客户端传入 `env=0` 会被拒绝。现网 AppKey 名存在但未使用 |
| 测试商品 | 已由用户创建、未对外定价 | 不写 productId 真值 |
| 退款 | 仅记录规则 | 365 天可启动；180 天内退手续费；Apple 不支持商户主动退款。未调用 `/xpay/refund_order` |
| 回调协议 | 虚拟支付消息推送 | `xpay_goods_deliver_notify` 等；XML/JSON `ErrCode`。拒绝 APIv3 `resource.ciphertext` |
| A14 / A20 / T20 / T26 | **未通过** | 未购买闭环、未 iOS 现网、未真机付款 |

## 5 实现（隔离样例）

| 能力 | 位置 | 本轮行为 |
| --- | --- | --- |
| 签名 | `packages/shared/src/virtual-pay.ts` | 官方测试向量对照通过。`quantity` 固定 1。金额用分。 |
| 环境门禁 | 同上 | 只信服务端配置。客户端选现网拒绝。 |
| 查单适配器 | `services/api/src/modules/virtual-pay-xpay.ts` | 可组 `/xpay/query_order` 请求。已对未知单号做一次沙箱调用。 |
| 通知验签 | `services/api/src/modules/virtual-pay-notify.ts` + `mw-pay-hook` | 入口先把原始 `ctx.event` 交给验签，不经 `unwrapFunctionEvent` / `forgedDenied`。覆盖：GET 握手（query 含官方夹具 + openid）返回 echostr；XML/JSON POST（query/body 含 openid）`ErrCode=0` 且 `vipGranted=false`；伪造签名拒绝；APIv3 头或 `resource.ciphertext` 为 `APIV3_REJECTED`。 |
| 发货确认 | `virtual-pay-xpay.ts` | 适配器存在。默认 `allowConfirm=false`，不对真实未授权订单发“已发货”。负向夹具使用官方错误码 `268490002`。 |

未实现 `order.create`、`payment.prepare`、真机 `wx.requestVirtualPayment`、VIP 发放、退款、对账。

## 6 沙箱查单

已对未知单号调用一次 `env=1` 的 `/xpay/query_order`。未写 OfferID / AppKey / AppSecret / AppID / openid / 单号真值。未调用现网 `env=0`。未调用 `/xpay/refund_order`。

| 字段 | 值 |
| --- | --- |
| errcode | 268490001 |
| authPathReached | true |
| signatureAccepted | true |
| wroteDocs | false |

`268490001` 为官方「openid 错误」。本次使用合成未知 openid，该码表示请求已到达 xpay 且支付签名被接受，不是业务已付或已发货。未创建业务订单，未发放 VIP。

## 7 本轮明确未执行

- 未真实扣款，未开启超额计费，未购买套餐
- 未 iOS / Apple 现网付款
- 未调用 `/xpay/refund_order`，未对线上未知单 `notify_provide_goods`
- 未向 mw-test 写支付/权益业务文档
- 未标 A14/A20/T20/T26 通过
- 未启动 MW12 / MW20 / MW21 / MW22 / MW29
- 未提交、未推送

## 8 本地检查

命令在 `F:/MW/main` 运行。

| 命令 | 退出码 |
| --- | --- |
| `npm run check:prototypes` | 0 |
| `npm run typecheck` | 0 |
| `npm test` | 0 |
| `npm run build` | 0 |
| `git diff --check` | 0 |

## 9 仍未交付（不索要真值）

通知 URL / Token / AES 仍可待后续任务再配。公开发布前另办备案。iOS 现网须另授权。A14/A20/T20/T26 仍未通过。

以上缺口**不阻止 MW08—MW19**，也不启动它们。本轮到此停止，不启动 MW12。
