export const ERROR_CODES = [
  "INVALID_ARGUMENT",
  "AUTH_REQUIRED",
  "MEMBER_REQUIRED",
  "ACCOUNT_DISABLED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VIP_REQUIRED",
  "CATEGORY_UNAVAILABLE",
  "CATEGORY_IN_USE",
  "CATEGORY_DEPTH_LIMIT",
  "CATEGORY_CYCLE",
  "VERSION_CONFLICT",
  "DRAFT_CONFLICT",
  "ACTIVE_ATTEMPT_EXISTS",
  "ALREADY_SUBMITTED",
  "IDEMPOTENCY_CONFLICT",
  "UNANSWERED_CONFIRM_REQUIRED",
  "CONTENT_UPDATING",
  "PAPER_WITHDRAWN",
  "PAYMENT_PENDING",
  "ENTITLEMENT_PENDING",
  "PAYMENT_CHANNEL_UNAVAILABLE",
  "IMPORT_INVALID",
  "SOURCE_KEY_CONFLICT",
  "RATE_LIMITED",
  "SERVICE_BUSY",
  "INTERNAL_ERROR"
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}

export function errorMessage(code: ErrorCode): string {
  const map: Record<ErrorCode, string> = {
    INVALID_ARGUMENT: "字段或范围不合法",
    AUTH_REQUIRED: "需要可信平台身份",
    MEMBER_REQUIRED: "请先注册会员",
    ACCOUNT_DISABLED: "账号已停用",
    FORBIDDEN: "权限不足",
    NOT_FOUND: "资源不存在",
    VIP_REQUIRED: "本试卷需要有效 VIP",
    CATEGORY_UNAVAILABLE: "类目不可用",
    CATEGORY_IN_USE: "类目仍有引用，需先迁移",
    CATEGORY_DEPTH_LIMIT: "类目最多三级",
    CATEGORY_CYCLE: "类目不能形成循环",
    VERSION_CONFLICT: "版本冲突，请重新读取",
    DRAFT_CONFLICT: "草稿版本冲突",
    ACTIVE_ATTEMPT_EXISTS: "已有进行中的试卷",
    ALREADY_SUBMITTED: "记录已提交",
    IDEMPOTENCY_CONFLICT: "同一业务键对应不同输入",
    UNANSWERED_CONFIRM_REQUIRED: "未答题需确认计零",
    CONTENT_UPDATING: "内容结构维护中",
    PAPER_WITHDRAWN: "试卷已紧急撤回",
    PAYMENT_PENDING: "支付结果确认中",
    ENTITLEMENT_PENDING: "已支付，权益开通中",
    PAYMENT_CHANNEL_UNAVAILABLE: "当前支付渠道不可用",
    IMPORT_INVALID: "导入整批无效",
    SOURCE_KEY_CONFLICT: "来源键冲突，不覆盖",
    RATE_LIMITED: "请求过于频繁",
    SERVICE_BUSY: "服务繁忙",
    INTERNAL_ERROR: "内部错误"
  };
  return map[code];
}
