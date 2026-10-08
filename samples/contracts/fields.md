# 样例字段说明

与实施基线和接口契约一致。未列字段默认拒绝。

## 请求公共字段

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| apiVersion | string | 固定 `"1"` |
| action | string | 白名单动作名 |
| requestId | string | 诊断用，非身份 |
| idempotencyKey | string | 写操作必填；重试保持不变 |
| data | object | 动作参数，未知字段拒绝 |

## 成功 / 失败

| 字段 | 说明 |
| --- | --- |
| ok | 布尔 |
| requestId | 回显 |
| serverTime | UTC，带 `Z` |
| data | 成功白名单 |
| error.code | 独立错误码 |
| error.message | 面向当前用户 |
| error.retryable | 结果未知时仍须先查原资源 |
| error.details | 不含堆栈、密钥、答案 |

## 内容与成绩

| 字段 | 说明 |
| --- | --- |
| categoryId / paperId / questionId / attemptId / memberId | 内部稳定标识 |
| depth | 1–3 |
| parentId | 一级为 `null` |
| access | 仅试卷：`free` / `vip` |
| difficulty | `beginner` / `intermediate` / `challenge` |
| optionIds | `attempt.save` / `attempt.submit` 请求里本人已选选项；规范排序后比较，顺序不影响判分 |
| selectedOptionIds | 仅 `attempt.analysis` 返回的本人选择，语义同交卷时的 `optionIds` |
| correctOptionIds | 仅交卷后的 `attempt.analysis`（及服务端私有答案块）；未交卷禁止出现 |
| directScore | 仅本节点直接挂卷最高分之和 |
| inclusiveScore | 本节点及后代，paperId 去重 |
| delta | 本次新增总分 |
| bestScore | 该卷历史最高 |

未交卷的 `attempt.get` / `attempt.questionPage` 不得出现 `answer`、`analysis`、`correctOptionIds`。`attempt.analysis` 不得改用 `optionIds` 表示本人选择，以免与提交字段混淆。

## 订单与 VIP

| 字段 | 说明 |
| --- | --- |
| payState | pending / confirming / paid / closed |
| grantState | pending / processing / granted / error / revokedRemaining |
| refundState | none / requested / processing / succeeded / failed |
| amountFen / priceFen | 整数分 |
| durationSeconds | 天数 × 86400 |
| expiresAt / grantedAt / paidAt | UTC |
| channelBizNo | 渠道侧业务号，不等于内部 orderId |
| displayStatus | 仅展示组合，服务端仍以三维状态为准 |

## 幂等

| 字段 | 说明 |
| --- | --- |
| payloadHash | 规范 JSON 的 SHA-256 十六进制 |
| resultRef | 已成功结果的定位 |
