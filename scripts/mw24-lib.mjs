import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand } from "./mw06-lib.mjs";
import { mergeSandboxVirtualPayEnv } from "./mw21-lib.mjs";

export const MW24_DEPLOY_ENTRIES = ["mw-admin", "mw-member", "mw-public"];
export const POLICIES_DOC_ID = "policies";
export const MW24_COLLECTIONS = [];
export const MW24_INDEXES = [];
export const MW24_NEVER_DELETE = [
  "jobs",
  "audit_logs",
  "idempotency",
  "ranking_heads",
  "ranking_rows",
  "app_config",
  "categories",
  "vip_accounts",
  "vip_grants",
  "vip_plans",
  "orders",
  "refunds",
  "payment_receipts",
  "callback_events"
];

export function mergeSandboxVirtualPayEnv24(existingEnvs = {}) {
  return mergeSandboxVirtualPayEnv(existingEnvs);
}

export function mw24Tmp() {
  const dir = join(projectRoot(), "tmp", "mw24");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw24(value) {
  return redact(value);
}

export function emptyMw24KnownIds() {
  return {
    members: [],
    identities: [],
    stats: [],
    medalGrants: [],
    feedbacks: []
  };
}

export function knownIdCountOf(knownIds) {
  return Object.values(knownIds || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

export function knownIdCountDeletable(knownIds) {
  const next = { ...emptyMw24KnownIds(), ...(knownIds || {}) };
  return (
    (next.members || []).length +
    (next.identities || []).length +
    (next.stats || []).length +
    (next.medalGrants || []).length +
    (next.feedbacks || []).length
  );
}

export function mw24LeftoverDecision(input) {
  const count = knownIdCountDeletable(input.knownIds);
  if (input.wroteDocs !== true) {
    return { ok: false, reason: "WROTE_DOCS_FALSE", leftoverDocs: count };
  }
  if (input.resolved !== true) {
    return { ok: false, reason: "KNOWN_IDS_NOT_RESOLVED", leftoverDocs: count };
  }
  if (count > 0) {
    return { ok: false, reason: "KNOWN_IDS_REMAIN", leftoverDocs: count };
  }
  if (input.independentRemain > 0) {
    return { ok: false, reason: "INDEPENDENT_REMAIN", leftoverDocs: input.independentRemain };
  }
  if (input.seedPresent !== true) {
    return { ok: false, reason: "SEED_CATEGORIES_MISSING", leftoverDocs: 0 };
  }
  return { ok: true, reason: "LEFTOVER_CLEARED", leftoverDocs: 0 };
}

export function policiesUpdateDoc(now = new Date()) {
  return {
    kind: "policies",
    agreementVersion: "mw24-test-agreement-v1",
    privacyVersion: "mw24-test-privacy-v1",
    agreementTitle: "用户协议（测试稿）",
    privacyTitle: "隐私政策（测试稿）",
    agreementText:
      "【测试稿 mw24-test-agreement-v1】本协议为思维工坊测试环境文案，非正式运营条款。正式文案由负责人确认后替换本版本。注册须主动勾选当前版本，禁止预勾选。账号注销须重新认证，未完成订单须先处理。支付与退款记录按最小必要保留。",
    privacyText:
      "【测试稿 mw24-test-privacy-v1】本说明为思维工坊测试环境隐私口径，非正式隐私政策。不开放生产真实注册或收款。注销后展示资料删除或最小保留；订单、退款与交易证据按最小必要保留，不承诺立即删除全部交易记录。公开榜与接口响应不含微信开放平台身份标识。",
    placeholder: true,
    note: "负责人未确认正式文案；本轮使用带版本号的测试稿。不开放生产真实注册或收款。",
    support: {
      title: "客服入口（测试稿）",
      channel: "in-app",
      hours: "工作日 09:00-18:00（测试）",
      note: "题目或解析错误请走解析页反馈，不要把订单售后发到这里。本轮客服入口为测试稿，正式方式仍待负责人确认。",
      placeholder: true,
      updatedAt: now.toISOString()
    },
    schemaVersion: 1,
    updatedAt: now.toISOString()
  };
}

export { createCollectionCommand, createIndexCommand, listIndexCommand, projectRoot };
