import { hashNamedFields } from "./canonical.js";
import { rejectUnknownKeys } from "./validate.js";

/**
 * MW16 成长等级与勋章纯逻辑。
 * 只做类型、门槛映射、勋章补齐计划与展示视图；不读写数据库、不含密钥。
 * 初始门槛来自产品说明书 V1.1 第 9.2 节的建议配置，上线门槛在 MW28 才冻结。
 */

export const GROWTH_CONFIG_DOC_ID = "growth";
export const GROWTH_SCHEMA_VERSION = 1;
export const DEFAULT_LEVEL_ID = "L1";
export const GROWTH_LEVEL_COUNT_MIN = 1;
export const GROWTH_LEVEL_COUNT_MAX = 12;

export const MEDAL_GRANT_SOURCE_REGISTER = "register";
export const MEDAL_GRANT_SOURCE_SUBMIT = "submit";
export const MEDAL_GRANT_SOURCE_RECOMPUTE = "recompute";
export const MEDAL_GRANT_SOURCE_CORRECTION = "correction";
export const MEDAL_GRANT_SOURCES = [
  MEDAL_GRANT_SOURCE_REGISTER,
  MEDAL_GRANT_SOURCE_SUBMIT,
  MEDAL_GRANT_SOURCE_RECOMPUTE,
  MEDAL_GRANT_SOURCE_CORRECTION
] as const;
export type MedalGrantSource = (typeof MEDAL_GRANT_SOURCES)[number];

export const MEDAL_GRANT_ID_FIELDS = ["memberId", "medalId"] as const;
export const GROWTH_LEVEL_ID_FIELDS = ["levelId"] as const;
export const GROWTH_PUBLISH_FIELDS = ["levels", "reason", "expectedConfigVersion"] as const;
/** 注意：memberId 属于不可信客户端字段，重算目标用 targetMemberId 传。 */
export const GROWTH_RECOMPUTE_FIELDS = ["targetMemberId", "limit"] as const;

export const DEFAULT_GROWTH_NOTE =
  "初始建议门槛，不是已确认的最终运营门槛；上线门槛在 MW28 冻结。";

export type GrowthLevel = {
  levelId: string;
  name: string;
  minScore: number;
  medalId: string;
  medalName: string;
};

export type GrowthConfigRecord = {
  configVersion: number;
  levels: GrowthLevel[];
  publishedAt: string;
  publishedBy: string;
  reason: string;
  note: string;
  placeholder: boolean;
  schemaVersion: number;
  updatedAt: string;
};

export type MedalGrantRecord = {
  grantId: string;
  memberId: string;
  medalId: string;
  levelId: string;
  medalName: string;
  sourceType: MedalGrantSource;
  sourceId: string;
  configVersion: number;
  awardedAt: string;
  revokedAt: string;
  reason: string;
  revision: number;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_GROWTH_LEVELS: readonly GrowthLevel[] = [
  { levelId: "L1", name: "思维新芽", minScore: 0, medalId: "medal.L1", medalName: "新芽" },
  { levelId: "L2", name: "思维学徒", minScore: 100, medalId: "medal.L2", medalName: "启程" },
  { levelId: "L3", name: "思维探索者", minScore: 300, medalId: "medal.L3", medalName: "探索" },
  { levelId: "L4", name: "思维进阶者", minScore: 800, medalId: "medal.L4", medalName: "进阶" },
  { levelId: "L5", name: "思维实践者", minScore: 1500, medalId: "medal.L5", medalName: "实践" },
  { levelId: "L6", name: "思维领航者", minScore: 3000, medalId: "medal.L6", medalName: "领航" }
] as const;

export function cloneGrowthLevels(levels: readonly GrowthLevel[]): GrowthLevel[] {
  return levels.map((row) => ({
    levelId: row.levelId,
    name: row.name,
    minScore: row.minScore,
    medalId: row.medalId,
    medalName: row.medalName
  }));
}

export function defaultGrowthLevels(): GrowthLevel[] {
  return cloneGrowthLevels(DEFAULT_GROWTH_LEVELS);
}

export function defaultGrowthConfig(now: Date, options: { publishedBy?: string; configVersion?: number } = {}): GrowthConfigRecord {
  const at = now.toISOString();
  return {
    configVersion: options.configVersion ?? 1,
    levels: defaultGrowthLevels(),
    publishedAt: at,
    publishedBy: options.publishedBy ?? "",
    reason: "初始建议门槛",
    note: DEFAULT_GROWTH_NOTE,
    placeholder: true,
    schemaVersion: GROWTH_SCHEMA_VERSION,
    updatedAt: at
  };
}

function asLevel(input: unknown, index: number): { ok: true; level: GrowthLevel } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, issues: [`levels[${index}] must be an object`] };
  }
  const rec = input as Record<string, unknown>;
  const extra = rejectUnknownKeys(rec, ["levelId", "name", "minScore", "medalId", "medalName"]);
  if (extra.length) issues.push(`levels[${index}] unknown fields: ${extra.join(",")}`);
  const levelId = typeof rec.levelId === "string" ? rec.levelId.trim() : "";
  const name = typeof rec.name === "string" ? rec.name.trim() : "";
  const medalId = typeof rec.medalId === "string" ? rec.medalId.trim() : "";
  const medalName = typeof rec.medalName === "string" ? rec.medalName.trim() : "";
  const minScore = rec.minScore;
  if (!levelId) issues.push(`levels[${index}] levelId required`);
  if (!name) issues.push(`levels[${index}] name required`);
  if (!medalId) issues.push(`levels[${index}] medalId required`);
  if (!medalName) issues.push(`levels[${index}] medalName required`);
  if (typeof minScore !== "number" || !Number.isInteger(minScore) || minScore < 0) {
    issues.push(`levels[${index}] minScore must be a non-negative integer`);
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    level: { levelId, name, minScore: minScore as number, medalId, medalName }
  };
}

export function normalizeGrowthLevels(input: unknown): { ok: true; levels: GrowthLevel[] } | { ok: false; issues: string[] } {
  if (!Array.isArray(input)) {
    return { ok: false, issues: ["levels must be an array"] };
  }
  const issues: string[] = [];
  const levels: GrowthLevel[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const parsed = asLevel(input[index], index);
    if (!parsed.ok) issues.push(...parsed.issues);
    else levels.push(parsed.level);
  }
  if (issues.length) return { ok: false, issues };
  const structural = validateGrowthLevels(levels);
  if (structural.length) return { ok: false, issues: structural };
  return { ok: true, levels };
}

export function validateGrowthLevels(levels: readonly GrowthLevel[]): string[] {
  const issues: string[] = [];
  if (levels.length < GROWTH_LEVEL_COUNT_MIN) issues.push("LEVELS_REQUIRED");
  if (levels.length > GROWTH_LEVEL_COUNT_MAX) issues.push("LEVELS_TOO_MANY");
  if (!levels.length) return issues;
  const first = levels[0] as GrowthLevel;
  if (first.minScore !== 0) issues.push("LEVEL_FIRST_MIN_NOT_ZERO");
  const levelIds = new Set<string>();
  const medalIds = new Set<string>();
  for (let index = 0; index < levels.length; index += 1) {
    const row = levels[index] as GrowthLevel;
    if (levelIds.has(row.levelId)) issues.push("LEVEL_ID_DUPLICATE");
    levelIds.add(row.levelId);
    if (medalIds.has(row.medalId)) issues.push("MEDAL_ID_DUPLICATE");
    medalIds.add(row.medalId);
    if (!row.name.trim()) issues.push("LEVEL_NAME_MISSING");
    if (!row.medalName.trim()) issues.push("MEDAL_NAME_MISSING");
    if (index > 0) {
      const previous = levels[index - 1] as GrowthLevel;
      if (row.minScore <= previous.minScore) issues.push("LEVEL_MIN_NOT_INCREASING");
    }
  }
  return [...new Set(issues)];
}

export function levelIdForScore(totalScore: number, levels: readonly GrowthLevel[] = DEFAULT_GROWTH_LEVELS): string {
  const sorted = [...levels].sort((left, right) => left.minScore - right.minScore);
  if (!sorted.length) return DEFAULT_LEVEL_ID;
  let current = sorted[0] as GrowthLevel;
  for (const row of sorted) {
    if (Number.isFinite(totalScore) && totalScore >= row.minScore) current = row;
  }
  return current.levelId;
}

export function levelForScore(totalScore: number, levels: readonly GrowthLevel[] = DEFAULT_GROWTH_LEVELS): GrowthLevel {
  const sorted = [...levels].sort((left, right) => left.minScore - right.minScore);
  const fallback: GrowthLevel = { levelId: DEFAULT_LEVEL_ID, name: DEFAULT_LEVEL_ID, minScore: 0, medalId: "", medalName: "" };
  if (!sorted.length) return fallback;
  const levelId = levelIdForScore(totalScore, sorted);
  return sorted.find((row) => row.levelId === levelId) || (sorted[0] as GrowthLevel);
}

export function nextLevelFor(totalScore: number, levels: readonly GrowthLevel[] = DEFAULT_GROWTH_LEVELS): GrowthLevel | undefined {
  const sorted = [...levels].sort((left, right) => left.minScore - right.minScore);
  return sorted.find((row) => row.minScore > totalScore);
}

export function levelsReached(totalScore: number, levels: readonly GrowthLevel[] = DEFAULT_GROWTH_LEVELS): GrowthLevel[] {
  const sorted = [...levels].sort((left, right) => left.minScore - right.minScore);
  return sorted.filter((row) => Number.isFinite(totalScore) && totalScore >= row.minScore);
}

export function levelProgress(
  totalScore: number,
  levels: readonly GrowthLevel[] = DEFAULT_GROWTH_LEVELS
): {
  levelId: string;
  levelName: string;
  medalId: string;
  medalName: string;
  minScore: number;
  nextLevelId: string | null;
  nextLevelName: string | null;
  nextMinScore: number | null;
  remaining: number;
  percent: number;
} {
  const current = levelForScore(totalScore, levels);
  const next = nextLevelFor(totalScore, levels);
  if (!next) {
    return {
      levelId: current.levelId,
      levelName: current.name,
      medalId: current.medalId,
      medalName: current.medalName,
      minScore: current.minScore,
      nextLevelId: null,
      nextLevelName: null,
      nextMinScore: null,
      remaining: 0,
      percent: 100
    };
  }
  const span = Math.max(1, next.minScore - current.minScore);
  const gained = Math.max(0, Math.min(span, totalScore - current.minScore));
  return {
    levelId: current.levelId,
    levelName: current.name,
    medalId: current.medalId,
    medalName: current.medalName,
    minScore: current.minScore,
    nextLevelId: next.levelId,
    nextLevelName: next.name,
    nextMinScore: next.minScore,
    remaining: Math.max(0, next.minScore - totalScore),
    percent: Math.round((gained / span) * 100)
  };
}

export function medalGrantId(memberId: string, medalId: string): string {
  return hashNamedFields({ memberId, medalId }, MEDAL_GRANT_ID_FIELDS);
}

export function medalGrantIdsFor(memberId: string, levels: readonly GrowthLevel[]): string[] {
  return [...new Set(levels.map((row) => row.medalId).filter(Boolean))].map((medalId) => medalGrantId(memberId, medalId));
}

export function newMedalGrant(input: {
  memberId: string;
  level: GrowthLevel;
  sourceType: MedalGrantSource;
  sourceId: string;
  configVersion: number;
  nowIso: string;
}): MedalGrantRecord {
  return {
    grantId: medalGrantId(input.memberId, input.level.medalId),
    memberId: input.memberId,
    medalId: input.level.medalId,
    levelId: input.level.levelId,
    medalName: input.level.medalName,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    configVersion: input.configVersion,
    awardedAt: input.nowIso,
    revokedAt: "",
    reason: "",
    revision: 1,
    schemaVersion: GROWTH_SCHEMA_VERSION,
    createdAt: input.nowIso,
    updatedAt: input.nowIso
  };
}

/** 跨级补齐：按现有总分补齐所有已达标但尚未授予的勋章；不撤销、不覆盖既得勋章。 */
export function planMedalGrants(input: {
  memberId: string;
  totalScore: number;
  levels: readonly GrowthLevel[];
  existingMedalIds: readonly string[];
  sourceType: MedalGrantSource;
  sourceId: string;
  configVersion: number;
  nowIso: string;
}): MedalGrantRecord[] {
  const owned = new Set(input.existingMedalIds);
  return levelsReached(input.totalScore, input.levels)
    .filter((level) => !owned.has(level.medalId))
    .map((level) =>
      newMedalGrant({
        memberId: input.memberId,
        level,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        configVersion: input.configVersion,
        nowIso: input.nowIso
      })
    );
}

export type GrowthMedalView = {
  levelId: string;
  name: string;
  minScore: number;
  medalId: string;
  medalName: string;
  reached: boolean;
  earned: boolean;
  awardedAt: string | null;
};

export type GrowthMemberView = {
  configVersion: number;
  totalScore: number;
  levelId: string;
  levelName: string;
  medalId: string;
  medalName: string;
  minScore: number;
  nextLevelId: string | null;
  nextLevelName: string | null;
  nextMinScore: number | null;
  remaining: number;
  percent: number;
  earnedCount: number;
  medals: GrowthMedalView[];
};

export function growthMemberView(input: {
  totalScore: number;
  levels: readonly GrowthLevel[];
  configVersion: number;
  grants?: readonly MedalGrantRecord[];
}): GrowthMemberView {
  const progress = levelProgress(input.totalScore, input.levels);
  const grants = input.grants || [];
  const byMedal = new Map<string, MedalGrantRecord>();
  for (const grant of grants) {
    if (grant.revokedAt) continue;
    const current = byMedal.get(grant.medalId);
    if (!current || grant.awardedAt < current.awardedAt) byMedal.set(grant.medalId, grant);
  }
  const medals: GrowthMedalView[] = [...input.levels]
    .sort((left, right) => left.minScore - right.minScore)
    .map((level) => {
      const grant = byMedal.get(level.medalId);
      return {
        levelId: level.levelId,
        name: level.name,
        minScore: level.minScore,
        medalId: level.medalId,
        medalName: level.medalName,
        reached: input.totalScore >= level.minScore,
        earned: Boolean(grant),
        awardedAt: grant ? grant.awardedAt : null
      };
    });
  return {
    configVersion: input.configVersion,
    totalScore: input.totalScore,
    levelId: progress.levelId,
    levelName: progress.levelName,
    medalId: progress.medalId,
    medalName: progress.medalName,
    minScore: progress.minScore,
    nextLevelId: progress.nextLevelId,
    nextLevelName: progress.nextLevelName,
    nextMinScore: progress.nextMinScore,
    remaining: progress.remaining,
    percent: progress.percent,
    earnedCount: medals.filter((row) => row.earned).length,
    medals
  };
}

export type GrowthImpactRow = {
  memberId: string;
  fromLevelId: string;
  toLevelId: string;
  fromLevelName: string;
  toLevelName: string;
  direction: "up" | "down" | "same";
  medalsToGrant: number;
};

export type GrowthImpactSummary = {
  scannedMembers: number;
  truncated: boolean;
  affected: number;
  upgraded: number;
  downgraded: number;
  unchanged: number;
  medalsToGrant: number;
  byTransition: { fromLevelId: string; toLevelId: string; count: number }[];
};

/** 门槛预览：按现有总分与新门槛重算等级，给出受影响人数与待补发勋章数。 */
export function growthImpactOf(input: {
  members: readonly { memberId: string; totalScore: number; levelId: string }[];
  levels: readonly GrowthLevel[];
  grantedMedalIdsByMember?: Record<string, readonly string[]>;
  truncated?: boolean;
}): GrowthImpactSummary {
  const rows: GrowthImpactRow[] = input.members.map((member) => {
    const current = levelForScore(member.totalScore, input.levels);
    const existing = new Set(input.grantedMedalIdsByMember?.[member.memberId] || []);
    const pending = levelsReached(member.totalScore, input.levels).filter((level) => !existing.has(level.medalId)).length;
    const orderFrom = orderOf(member.levelId, input.levels);
    const orderTo = orderOf(current.levelId, input.levels);
    const direction: GrowthImpactRow["direction"] =
      member.levelId === current.levelId ? "same" : orderTo > orderFrom ? "up" : "down";
    return {
      memberId: member.memberId,
      fromLevelId: member.levelId,
      toLevelId: current.levelId,
      fromLevelName: nameOfLevelId(member.levelId, input.levels),
      toLevelName: current.name,
      direction,
      medalsToGrant: pending
    };
  });
  const byTransitionMap = new Map<string, number>();
  for (const row of rows) {
    if (row.direction === "same") continue;
    const key = `${row.fromLevelId}->${row.toLevelId}`;
    byTransitionMap.set(key, (byTransitionMap.get(key) || 0) + 1);
  }
  return {
    scannedMembers: rows.length,
    truncated: input.truncated === true,
    affected: rows.filter((row) => row.direction !== "same").length,
    upgraded: rows.filter((row) => row.direction === "up").length,
    downgraded: rows.filter((row) => row.direction === "down").length,
    unchanged: rows.filter((row) => row.direction === "same").length,
    medalsToGrant: rows.reduce((sum, row) => sum + row.medalsToGrant, 0),
    byTransition: [...byTransitionMap.entries()].map(([key, count]) => {
      const [fromLevelId, toLevelId] = key.split("->");
      return { fromLevelId: fromLevelId as string, toLevelId: toLevelId as string, count };
    })
  };
}

function orderOf(levelId: string, levels: readonly GrowthLevel[]): number {
  const sorted = [...levels].sort((left, right) => left.minScore - right.minScore);
  const index = sorted.findIndex((row) => row.levelId === levelId);
  return index < 0 ? -1 : index;
}

function nameOfLevelId(levelId: string, levels: readonly GrowthLevel[]): string {
  const row = levels.find((item) => item.levelId === levelId);
  return row ? row.name : levelId;
}

export function parseGrowthPublishInput(data: Record<string, unknown>): {
  ok: true;
  levels: GrowthLevel[];
  reason: string;
  expectedConfigVersion: number;
} | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...GROWTH_PUBLISH_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const normalized = normalizeGrowthLevels(data.levels);
  if (!normalized.ok) issues.push(...normalized.issues);
  const reason = typeof data.reason === "string" ? data.reason.trim() : "";
  if (!reason) issues.push("reason required");
  const expected = data.expectedConfigVersion;
  if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 0) {
    issues.push("expectedConfigVersion must be a non-negative integer");
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    levels: (normalized as { ok: true; levels: GrowthLevel[] }).levels,
    reason,
    expectedConfigVersion: expected as number
  };
}

export function parseGrowthPreviewInput(data: Record<string, unknown>): {
  ok: true;
  levels: GrowthLevel[];
} | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, ["levels"]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const normalized = normalizeGrowthLevels(data.levels);
  if (!normalized.ok) issues.push(...normalized.issues);
  if (issues.length) return { ok: false, issues };
  return { ok: true, levels: (normalized as { ok: true; levels: GrowthLevel[] }).levels };
}

export function parseGrowthRecomputeInput(data: Record<string, unknown>): {
  ok: true;
  targetMemberId: string;
  limit: number;
} | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...GROWTH_RECOMPUTE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  const targetMemberId = typeof data.targetMemberId === "string" ? data.targetMemberId.trim() : "";
  const limit = data.limit === undefined ? 200 : data.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
    issues.push("limit must be an integer between 1 and 1000");
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, targetMemberId, limit: limit as number };
}

export function nextGrowthConfigVersion(current: number | undefined): number {
  return Number.isInteger(current) && (current as number) >= 0 ? (current as number) + 1 : 1;
}
