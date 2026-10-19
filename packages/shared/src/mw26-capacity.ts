import { hashNamedFields } from "./canonical.js";
import { attemptIdFor } from "./attempt.js";
import { identityDocId, memberDocId } from "./member.js";
import { paperVersionId } from "./paper.js";
import { paperIdForSourceKey } from "./import.js";
import { scoreMetricId } from "./scoring.js";
import { monthKeyShanghai, weekKeyShanghai } from "./clock.js";

/**
 * MW26 安全矩阵 + 容量夹具契约。
 * 确定性 _id，可精确收口。空清单或 wroteDocs=false 不得 leftover=0。
 */

export const MW26_FIXTURE_ROUND = "MW26";
export const MW26_FIXTURE_MARKER = "mw26-load";
export const MW26_IDENTITY_APP_ID = "wxmw26fixtureappid0001";

export const MW26_TARGET_MEMBERS = 10_000;
export const MW26_TARGET_PAPERS = 1_000;
export const MW26_TARGET_ATTEMPTS = 100_000;
export const MW26_TARGET_CONCURRENCY = 50;
export const MW26_READ_P95_MS = 1_000;
export const MW26_SUBMIT_P95_MS = 2_000;
export const MW26_RANKING_REFRESH_TARGET_MS = 60_000;

export const MW26_MEMBER_ID_FIELDS = ["kind", "round", "index"] as const;
export const MW26_PAPER_SOURCE_FIELDS = ["kind", "round", "index"] as const;

export const MW26_FIXTURE_COLLECTIONS = [
  "members",
  "identities",
  "member_stats",
  "papers",
  "paper_versions",
  "attempts",
  "score_metrics"
] as const;

export const MW26_NEVER_DELETE = [
  "jobs",
  "audit_logs",
  "idempotency",
  "ranking_heads",
  "ranking_rows",
  "app_config",
  "categories",
  "orders",
  "refunds",
  "payment_receipts",
  "callback_events",
  "vip_accounts",
  "vip_grants",
  "vip_plans"
] as const;

export type Mw26SecurityResult = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";

export type Mw26SecurityRow = {
  id: string;
  result: Mw26SecurityResult;
  note: string;
};

export type Mw26FixtureCounts = {
  members: number;
  papers: number;
  attempts: number;
};

export function mw26MemberIndexId(index: number, round = MW26_FIXTURE_ROUND): string {
  return hashNamedFields({ kind: "mw26-member", round, index }, MW26_MEMBER_ID_FIELDS);
}

export function mw26OpenId(index: number, round = MW26_FIXTURE_ROUND): string {
  return hashNamedFields({ kind: "mw26-openid", round, index }, MW26_MEMBER_ID_FIELDS);
}

export function mw26IdentityId(index: number, round = MW26_FIXTURE_ROUND, appId = MW26_IDENTITY_APP_ID): string {
  return identityDocId(appId, mw26OpenId(index, round));
}

export function mw26MemberId(index: number, round = MW26_FIXTURE_ROUND, appId = MW26_IDENTITY_APP_ID): string {
  return memberDocId(mw26IdentityId(index, round, appId));
}

export function mw26PaperSourceKey(index: number, round = MW26_FIXTURE_ROUND): string {
  return `mw26:${round}:paper:${index}`;
}

export function mw26PaperId(index: number, round = MW26_FIXTURE_ROUND): string {
  return paperIdForSourceKey(mw26PaperSourceKey(index, round));
}

export function mw26PaperVersionIdOf(index: number, round = MW26_FIXTURE_ROUND): string {
  return paperVersionId(mw26PaperId(index, round), 1);
}

export function mw26AttemptId(memberIndex: number, paperIndex: number, seq = 0, round = MW26_FIXTURE_ROUND): string {
  const memberId = mw26MemberId(memberIndex, round);
  return attemptIdFor(memberId, `mw26:${round}:attempt:${memberIndex}:${paperIndex}:${seq}`);
}

export function mw26TotalMetricId(memberIndex: number, round = MW26_FIXTURE_ROUND): string {
  return scoreMetricId({
    metricGeneration: "base",
    scope: "total",
    periodKey: "all",
    categoryId: "",
    memberId: mw26MemberId(memberIndex, round)
  });
}

export type Mw26PeriodState = {
  seededAt: string;
  weekKeyShanghai: string;
  monthKeyShanghai: string;
};

export function mw26PeriodStateFromSeededAt(seededAt: Date): Mw26PeriodState {
  return {
    seededAt: seededAt.toISOString(),
    weekKeyShanghai: weekKeyShanghai(seededAt),
    monthKeyShanghai: monthKeyShanghai(seededAt)
  };
}

export function mw26RequirePeriodState(state: {
  seededAt?: unknown;
  weekKeyShanghai?: unknown;
  monthKeyShanghai?: unknown;
}): Mw26PeriodState {
  const week = typeof state.weekKeyShanghai === "string" ? state.weekKeyShanghai.trim() : "";
  const month = typeof state.monthKeyShanghai === "string" ? state.monthKeyShanghai.trim() : "";
  if (!week || !month) {
    throw new Error("MW26_PERIOD_KEYS_MISSING");
  }
  const seededAt = typeof state.seededAt === "string" ? state.seededAt : "";
  return { seededAt, weekKeyShanghai: week, monthKeyShanghai: month };
}

export function mw26WeekMetricIdForKey(memberIndex: number, weekKey: string, round = MW26_FIXTURE_ROUND): string {
  return scoreMetricId({
    metricGeneration: "base",
    scope: "week",
    periodKey: weekKey,
    categoryId: "",
    memberId: mw26MemberId(memberIndex, round)
  });
}

export function mw26MonthMetricIdForKey(memberIndex: number, monthKey: string, round = MW26_FIXTURE_ROUND): string {
  return scoreMetricId({
    metricGeneration: "base",
    scope: "month",
    periodKey: monthKey,
    categoryId: "",
    memberId: mw26MemberId(memberIndex, round)
  });
}

export function mw26WeekMetricId(memberIndex: number, now: Date, round = MW26_FIXTURE_ROUND): string {
  return mw26WeekMetricIdForKey(memberIndex, weekKeyShanghai(now), round);
}

export function mw26MonthMetricId(memberIndex: number, now: Date, round = MW26_FIXTURE_ROUND): string {
  return mw26MonthMetricIdForKey(memberIndex, monthKeyShanghai(now), round);
}

/** 清理必须用状态里保存的周/月键再生 _id，禁止用清理时刻的 new Date()。 */
export function mw26CleanupMetricIds(
  memberIndex: number,
  state: Mw26PeriodState,
  round = MW26_FIXTURE_ROUND
): { total: string; week: string; month: string } {
  const period = mw26RequirePeriodState(state);
  return {
    total: mw26TotalMetricId(memberIndex, round),
    week: mw26WeekMetricIdForKey(memberIndex, period.weekKeyShanghai, round),
    month: mw26MonthMetricIdForKey(memberIndex, period.monthKeyShanghai, round)
  };
}

export function mw26UnauthStorageVerdict(input: {
  urlCount: number;
  saw200: boolean;
  deniedCount: number;
  requestFailed: boolean;
}): Mw26SecurityRow {
  if (input.urlCount <= 0) {
    return { id: "S03", result: "NOT_RUN", note: "no storage URL; 不得 PASS" };
  }
  if (input.requestFailed) {
    return { id: "S03", result: "BLOCKED", note: "storage request failed; 不得 PASS" };
  }
  if (input.saw200) {
    return { id: "S03", result: "FAIL", note: "unauth analysis object returned 200" };
  }
  if (input.deniedCount > 0) {
    return { id: "S03", result: "PASS", note: "unauth analysis object non-200" };
  }
  return { id: "S03", result: "BLOCKED", note: "storage probe incomplete; 不得 PASS" };
}

export function mw26LoggedInRoleRow(
  id: "S06" | "S07",
  unauthDenied: boolean,
  unauthNote: string
): Mw26SecurityRow {
  const who = id === "S06" ? "content" : "operations";
  if (!unauthDenied) {
    return { id, result: "FAIL", note: `${unauthNote}; logged-in ${who} 留 E` };
  }
  return {
    id,
    result: "NOT_RUN",
    note: `${unauthNote}; logged-in ${who} NOT_RUN（E）。未登录负向不得写成整行产品 PASS`
  };
}

export function mw26FixturePayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const payload = {
    fixtureRound: MW26_FIXTURE_ROUND,
    fixtureMarker: MW26_FIXTURE_MARKER,
    ...extra
  };
  if (Object.prototype.hasOwnProperty.call(payload, "_id")) {
    throw new Error("MW26_ID_IN_PAYLOAD");
  }
  return payload;
}

export function percentileNearestRank(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

export function mw26ScaleBlockedReason(actual: Mw26FixtureCounts, target: Mw26FixtureCounts = {
  members: MW26_TARGET_MEMBERS,
  papers: MW26_TARGET_PAPERS,
  attempts: MW26_TARGET_ATTEMPTS
}): string | null {
  if (actual.members >= target.members && actual.papers >= target.papers && actual.attempts >= target.attempts) {
    return null;
  }
  return `SCALE_DEGRADED actual=${actual.members}/${actual.papers}/${actual.attempts} target=${target.members}/${target.papers}/${target.attempts}`;
}

export type Mw26LeftoverInput = {
  wroteDocs: boolean;
  resolved: boolean;
  fixtureRemain: number;
  seedPresent: boolean;
  knownIdRemain?: number;
};

export function mw26LeftoverDecision(input: Mw26LeftoverInput): { ok: boolean; reason: string; leftoverDocs: number } {
  const leftoverDocs = Math.max(input.fixtureRemain, input.knownIdRemain ?? 0);
  if (input.wroteDocs !== true) {
    return { ok: false, reason: "WROTE_DOCS_FALSE", leftoverDocs };
  }
  if (input.resolved !== true) {
    return { ok: false, reason: "KNOWN_IDS_NOT_RESOLVED", leftoverDocs };
  }
  if ((input.knownIdRemain ?? 0) > 0) {
    return { ok: false, reason: "KNOWN_IDS_REMAIN", leftoverDocs };
  }
  if (input.fixtureRemain > 0) {
    return { ok: false, reason: "INDEPENDENT_REMAIN", leftoverDocs };
  }
  if (input.seedPresent !== true) {
    return { ok: false, reason: "SEED_CATEGORIES_MISSING", leftoverDocs: 0 };
  }
  return { ok: true, reason: "LEFTOVER_CLEARED", leftoverDocs: 0 };
}

export const MW26_SECURITY_IDS = [
  "S01",
  "S02",
  "S03",
  "S04",
  "S05",
  "S06",
  "S07",
  "S08",
  "S09",
  "S10",
  "S11",
  "S12",
  "S13",
  "S14",
  "S15",
  "S16",
  "S17"
] as const;
