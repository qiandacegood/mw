# 虚构接口样例

日期：2026年10月8日  
依据：[实施基线 V1.0](../../docs/architecture/implementation-baseline-v1.0.md)、[接口契约 V1.0](../../docs/api/api-contract-v1.0.md)。

这些文件是接口约定证据，供 MW03 契约测试与后续模块对照。它们**不是**已通过的业务程序测试，也不含真实会员、真实订单或可用凭据。

| 文件 | 覆盖边界 |
| --- | --- |
| [envelope.json](envelope.json) | 成功 / 失败信封、分页、时间格式 |
| [categories.json](categories.json) | 一至三级挂卷；第四级与循环反例 |
| [attempt-questions.json](attempt-questions.json) | 单选、多选、判断、少选；未交卷不含答案 |
| [scoring-deltas.json](scoring-deltas.json) | 60/80/70 增量；父子分类分不重复加总 |
| [vip-orders.json](vip-orders.json) | 首次开通与续期；待支付、确认中、已付待开通 |
| [idempotency.json](idempotency.json) | 同键同输入可重放；同键不同输入冲突 |
| [member-register.json](member-register.json) | 可信注册信封；不含 OpenID；内容安全记 NOT_RUN |

字段说明见 [fields.md](fields.md)。全部 ID 使用 `*_fict_*` 前缀。金额带 `PLACEHOLDER_PRICE`。
