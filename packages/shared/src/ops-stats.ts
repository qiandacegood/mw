import { hashNamedFields } from "./canonical.js";
import { dayKeyShanghai, toUtcIso } from "./clock.js";
import { isVipActive } from "./vip.js";

/**
 * MW25 后台基础统计与逐步教程契约。
 * 口径对齐产品 V1.1 第 15 节。流水不当利润。重复练习计入次数。
 * 教程每步必须对应已有 action，禁止占位。
 */

export const OPS_STATS_SCHEMA_VERSION = 1;
export const OPS_STATS_ACTIONS = ["ops.stats", "ops.exceptions", "ops.tutorial"] as const;
export const OPS_STATS_SNAPSHOT_ID_FIELDS = ["kind", "schemaVersion", "dayKey"] as const;
/** 单页扫描大小。MW25 原上限；MW26 用它做分页 page，不再把 200 当成全集。 */
export const OPS_STATS_SCAN_LIMIT = 200;
/**
 * 单次 ops.stats 请求的最大扫描条数（分页累计）。
 * 不是新大盘：超预算必须 scanTruncated=true，禁止静默少计。不在请求路径扫 10 万答题。
 */
export const OPS_STATS_SCAN_BUDGET = 2_000;

export const OPS_STATS_MONEY_FIELDS = [
  "paidOrderCount",
  "confirmedReceiptFen",
  "refundedFen",
  "abnormalGrantOrderCount"
] as const;

export const OPS_STATS_NOTES = {
  registeredMembers: "注册会员数：status 为 active / disabled / deleting，不含已注销 deleted。",
  completedRecords:
    "完成记录=有效已交卷（state=submitted 且 score 为整数）。当日按北京时间日历日。同一会员重复练习计入次数。",
  uniqueAnswerers: "独立答题人数：有效已交卷记录的去重 memberId。",
  paperAverages: "每卷平均分按全部有效已交卷记录计算，不是单卷最高分。重复练习计入次数。",
  activeVip: "有效 VIP 与 MW20 账本同一判权：now < expiresAt。",
  turnoverIsNotProfit: "已确认收款是流水，不是净利润。退款后的差额仍不是利润。",
  amountsInFen: "金额单位为分。时间单位为 ISO。",
  scanBudget: "统计按页扫描；触达单次预算时 scanTruncated=true，禁止把 200 条当全集。",
  scanTruncatedBanner: "scanTruncated 必须显示在统计数字旁；true 时标明未扫全，数字不是全集。",
  noFakeTickets: "异常入口接到对账差异、异常开通、待处理退款、开放反馈，不另造工单。"
} as const;

export type OpsAdminRole = "content" | "operations" | "super";
export type OpsTutorialPage =
  | "admin-import-questions"
  | "admin-import-papers"
  | "admin-import"
  | "admin-papers"
  | "admin-categories"
  | "admin-vip"
  | "admin-orders"
  | "admin-refunds"
  | "admin-ops";

export type OpsTutorialStep = {
  step: number;
  id: string;
  title: string;
  actions: readonly string[];
  page: OpsTutorialPage;
  viewRoles: readonly OpsAdminRole[];
  executeRole: OpsAdminRole;
  note: string;
  placeholder: false;
};

export const OPS_TUTORIAL_STEPS: readonly OpsTutorialStep[] = [
  {
    step: 1,
    id: "import",
    title: "导入题库 / 试卷",
    actions: ["import.validate", "import.preview", "import.commit", "import.status"],
    page: "admin-import",
    viewRoles: ["content", "operations", "super"],
    executeRole: "content",
    note: "走现有 import.*。MW12 仍是部分完成，教程不把导入标验收通过。",
    placeholder: false
  },
  {
    step: 2,
    id: "publish",
    title: "上架试卷",
    actions: ["paper.publish"],
    page: "admin-papers",
    viewRoles: ["content", "operations", "super"],
    executeRole: "content",
    note: "走现有 paper.publish。发布不等于公众上线。",
    placeholder: false
  },
  {
    step: 3,
    id: "correction",
    title: "题目纠错",
    actions: ["correction.preview", "correction.commit", "correction.status"],
    page: "admin-papers",
    viewRoles: ["content", "operations", "super"],
    executeRole: "super",
    note: "走现有 correction.*。改分仅 super。operations 只能看到入口。",
    placeholder: false
  },
  {
    step: 4,
    id: "category-change",
    title: "类目迁移",
    actions: ["category.change.preview", "category.change.commit", "category.change.status"],
    page: "admin-categories",
    viewRoles: ["content", "operations", "super"],
    executeRole: "super",
    note: "走现有 category.change.*。有引用先迁移，不能偷偷删除。",
    placeholder: false
  },
  {
    step: 5,
    id: "vip-gift",
    title: "人工赠送 VIP",
    actions: ["vip.grant"],
    page: "admin-vip",
    viewRoles: ["operations", "super"],
    executeRole: "super",
    note: "走现有 vip.grant。来源标 gift，不写订单，不冒充付款。",
    placeholder: false
  },
  {
    step: 6,
    id: "order-reconcile",
    title: "订单核对",
    actions: ["order.list", "order.get", "order.reconcile"],
    page: "admin-orders",
    viewRoles: ["operations", "super"],
    executeRole: "operations",
    note: "走现有 order.*。不修改金额。content 无订单明细。",
    placeholder: false
  },
  {
    step: 7,
    id: "refund",
    title: "退款审核 / 执行",
    actions: ["refund.review", "refund.execute"],
    page: "admin-refunds",
    viewRoles: ["operations", "super"],
    executeRole: "super",
    note: "review 可由 operations 写建议。execute 仅 super。Apple 无商户退款按钮。",
    placeholder: false
  }
] as const;

export type OpsExceptionKind = "reconcile_diff" | "abnormal_grant" | "pending_refund" | "open_feedback";

export type OpsExceptionEntry = {
  kind: OpsExceptionKind;
  count: number;
  page: OpsTutorialPage;
  action: string;
  note: string;
};

export type OpsPaperStat = {
  paperId: string;
  paperTitle: string;
  completedCount: number;
  averageScore: number;
  repeatPracticeCounts: true;
};

export type OpsStatsNumbers = {
  registeredMembers: number;
  completedRecordsToday: number;
  completedRecordsTotal: number;
  uniqueAnswerers: number;
  papers: OpsPaperStat[];
  activeVipCount: number;
  paidOrderCount: number;
  confirmedReceiptFen: number;
  refundedFen: number;
  abnormalGrantOrderCount: number;
};

export type OpsStatsView = OpsStatsNumbers & {
  schemaVersion: number;
  generatedAt: string;
  dayKey: string;
  notes: typeof OPS_STATS_NOTES;
  turnoverIsNotProfit: true;
  amountsUnit: "fen";
  timeUnit: "iso";
  vipRule: "now < expiresAt";
  repeatPracticeCounts: true;
  scanBudget: number;
  scanTruncated: boolean;
};

export type OpsMemberRow = { memberId: string; status: string };
export type OpsAttemptRow = {
  attemptId: string;
  memberId: string;
  paperId: string;
  paperTitle?: string;
  score: number | null;
  state: string;
  submittedAt: string;
};
export type OpsVipRow = { memberId: string; expiresAt: string | null };
export type OpsOrderRow = { orderId: string; payState: string; grantState: string; amountFen: number };
export type OpsRefundRow = { refundId: string; orderId: string; state: string; confirmedFen: number | null };
export type OpsDiffRow = { diffId: string; orderId: string; diffKind: string; status: string };
export type OpsFeedbackRow = { feedbackId: string; status: string };

export function isRegisteredMemberStatus(status: string): boolean {
  return status === "active" || status === "disabled" || status === "deleting";
}

export function isValidSubmittedAttempt(row: Pick<OpsAttemptRow, "state" | "score" | "submittedAt">): boolean {
  return row.state === "submitted" && typeof row.score === "number" && Number.isInteger(row.score) && Boolean(row.submittedAt);
}

export function isAbnormalGrantOrder(row: Pick<OpsOrderRow, "payState" | "grantState">): boolean {
  return row.payState === "paid" && (row.grantState === "error" || row.grantState === "pending" || row.grantState === "processing");
}

export function isPendingRefundState(state: string): boolean {
  return state === "requested" || state === "reviewed" || state === "processing";
}

export function canViewOpsStats(roles: readonly string[]): boolean {
  return roles.includes("operations") || roles.includes("super");
}

export function canViewOpsTutorial(roles: readonly string[]): boolean {
  return roles.includes("content") || roles.includes("operations") || roles.includes("super");
}

export function tutorialStepsForRoles(roles: readonly string[]): OpsTutorialStep[] {
  const canOps = roles.includes("operations") || roles.includes("super");
  const canContent = roles.includes("content") || canOps;
  return OPS_TUTORIAL_STEPS.filter((step) => {
    if (step.viewRoles.includes("operations") && canOps) return true;
    if (step.viewRoles.includes("content") && canContent && step.viewRoles.includes("content")) return true;
    return false;
  }).map((step) => ({ ...step, actions: [...step.actions], viewRoles: [...step.viewRoles], placeholder: false as const }));
}

export function opsStatsSnapshotId(dayKey: string, schemaVersion = OPS_STATS_SCHEMA_VERSION): string {
  return hashNamedFields(
    { kind: "ops_stats", schemaVersion, dayKey },
    OPS_STATS_SNAPSHOT_ID_FIELDS
  );
}

export function opsStatsSnapshotWrite(input: {
  dayKey: string;
  generatedAt: string;
  schemaVersion?: number;
}): Record<string, unknown> {
  const schemaVersion = input.schemaVersion ?? OPS_STATS_SCHEMA_VERSION;
  return {
    kind: "ops_stats",
    schemaVersion,
    dayKey: input.dayKey,
    generatedAt: input.generatedAt,
    fixture: true,
    note: "MW25 leftover fixture. 确定性 _id + 版本。载荷不含 _id。"
  };
}

export function stripOpsStatsMoney<T extends Record<string, unknown>>(data: T): Omit<T, (typeof OPS_STATS_MONEY_FIELDS)[number]> {
  const next = { ...data };
  for (const key of OPS_STATS_MONEY_FIELDS) {
    delete next[key];
  }
  return next;
}

export function opsScanTruncatedNotice(scanTruncated: boolean, scanBudget?: number): string {
  const budget = typeof scanBudget === "number" && Number.isFinite(scanBudget) ? `（预算 ${scanBudget}）` : "";
  if (scanTruncated) {
    return `scanTruncated=true：未扫全，数字不是全集${budget}`;
  }
  return `scanTruncated=false：本轮扫描未截断${budget}`;
}

export function aggregateOpsStats(input: {
  now: Date;
  members: readonly OpsMemberRow[];
  attempts: readonly OpsAttemptRow[];
  vipAccounts: readonly OpsVipRow[];
  orders: readonly OpsOrderRow[];
  refunds: readonly OpsRefundRow[];
  scanBudget?: number;
  scanTruncated?: boolean;
}): OpsStatsView {
  const dayKey = dayKeyShanghai(input.now);
  const nowMs = input.now.getTime();
  const registeredMembers = input.members.filter((row) => isRegisteredMemberStatus(row.status)).length;
  const submitted = input.attempts.filter(isValidSubmittedAttempt);
  const completedRecordsToday = submitted.filter((row) => dayKeyShanghai(new Date(row.submittedAt)) === dayKey).length;
  const uniqueAnswerers = new Set(submitted.map((row) => row.memberId)).size;
  const byPaper = new Map<string, { title: string; scores: number[] }>();
  for (const row of submitted) {
    const current = byPaper.get(row.paperId) || { title: row.paperTitle || row.paperId, scores: [] };
    if (row.paperTitle) current.title = row.paperTitle;
    current.scores.push(row.score as number);
    byPaper.set(row.paperId, current);
  }
  const papers = [...byPaper.entries()]
    .map(([paperId, row]) => ({
      paperId,
      paperTitle: row.title,
      completedCount: row.scores.length,
      averageScore: row.scores.reduce((sum, score) => sum + score, 0) / row.scores.length,
      repeatPracticeCounts: true as const
    }))
    .sort((left, right) => right.completedCount - left.completedCount || left.paperId.localeCompare(right.paperId));
  const activeVipCount = input.vipAccounts.filter((row) => {
    if (!row.expiresAt) return false;
    const expiresAtMs = Date.parse(row.expiresAt);
    return Number.isFinite(expiresAtMs) && isVipActive(expiresAtMs, nowMs);
  }).length;
  const paid = input.orders.filter((row) => row.payState === "paid");
  const confirmedReceiptFen = paid.reduce((sum, row) => sum + (Number.isInteger(row.amountFen) ? row.amountFen : 0), 0);
  const refundedFen = input.refunds
    .filter((row) => row.state === "succeeded" && typeof row.confirmedFen === "number" && Number.isInteger(row.confirmedFen))
    .reduce((sum, row) => sum + (row.confirmedFen as number), 0);
  return {
    schemaVersion: OPS_STATS_SCHEMA_VERSION,
    generatedAt: toUtcIso(input.now),
    dayKey,
    registeredMembers,
    completedRecordsToday,
    completedRecordsTotal: submitted.length,
    uniqueAnswerers,
    papers,
    activeVipCount,
    paidOrderCount: paid.length,
    confirmedReceiptFen,
    refundedFen,
    abnormalGrantOrderCount: input.orders.filter(isAbnormalGrantOrder).length,
    notes: OPS_STATS_NOTES,
    turnoverIsNotProfit: true,
    amountsUnit: "fen",
    timeUnit: "iso",
    vipRule: "now < expiresAt",
    repeatPracticeCounts: true,
    scanBudget: input.scanBudget ?? OPS_STATS_SCAN_BUDGET,
    scanTruncated: input.scanTruncated === true
  };
}

export function aggregateOpsExceptions(input: {
  orders: readonly OpsOrderRow[];
  refunds: readonly OpsRefundRow[];
  diffs: readonly OpsDiffRow[];
  feedbacks: readonly OpsFeedbackRow[];
}): { entries: OpsExceptionEntry[]; fakeTickets: false } {
  return {
    fakeTickets: false,
    entries: [
      {
        kind: "reconcile_diff",
        count: input.diffs.filter((row) => row.status === "open").length,
        page: "admin-orders",
        action: "order.reconcile",
        note: "对账差异只列不改金额。接到现有订单核对页。"
      },
      {
        kind: "abnormal_grant",
        count: input.orders.filter(isAbnormalGrantOrder).length,
        page: "admin-orders",
        action: "order.list",
        note: "付款未开通或 grantState=error。接到现有订单页。"
      },
      {
        kind: "pending_refund",
        count: input.refunds.filter((row) => isPendingRefundState(row.state)).length,
        page: "admin-refunds",
        action: "refund.list",
        note: "待处理退款走现有审核/执行页。execute 仅 super。"
      },
      {
        kind: "open_feedback",
        count: input.feedbacks.filter((row) => row.status === "open").length,
        page: "admin-ops",
        action: "feedback.list",
        note: "开放反馈走本页既有处理，不能改答案库。"
      }
    ]
  };
}
