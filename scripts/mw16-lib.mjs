import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand, redactMw06 } from "./mw06-lib.mjs";
import { leftoverResolveDecision, isSha256Hex } from "./mw13-lib.mjs";
import { INITIAL_ROOT_SEEDS } from "./mw09-lib.mjs";

/** 覆盖 MW16 成长等级与勋章：新增 medal_grants 集合，并重新部署会员与后台入口。 */
export const MW16_DEPLOY_ENTRIES = ["mw-member", "mw-admin"];
export const MW16_COLLECTIONS = ["medal_grants"];
export const MW16_KEEP_COLLECTIONS = [
  "papers",
  "paper_versions",
  "paper_chunks",
  "paper_answers",
  "categories",
  "members",
  "identities",
  "member_stats",
  "idempotency",
  "attempts",
  "active_attempts",
  "paper_bests",
  "score_events",
  "score_metrics"
];
export const FORBIDDEN_FUTURE_COLLECTIONS = [
  "orders",
  "vip_accounts",
  "vip_plans",
  "vip_grants",
  "vip_events"
];
export const MEDAL_GRANT_INDEXES = [
  {
    collection: "medal_grants",
    name: "idx_medal_grants_member_awarded",
    keys: [
      { name: "memberId", direction: 1 },
      { name: "awardedAt", direction: 1 }
    ]
  }
];

/**
 * 独立核查范围（不依赖 knownIds 推导出的 id，也不扫整表猜删）：
 * - byMember：按 memberId 点读该会员的相关文档，再用本轮卷 / 本轮 attempt 做精确过滤
 *   （attempts 按 paperId、active_attempts 按 attemptId、score_events / paper_bests 按 paperId）
 * - byMarkedPaper：只对「用户明确标记的本轮测试卷」删除 papers / paper_versions / paper_chunks / paper_answers
 * - byMarkedQuestion：只对「用户明确标记的本轮题目」删除 questions 及其按 questionId 关联的 question_versions
 * - medal_grants：只收 sourceId 属于本轮（register / growth@vN / 已标记的 attemptId）的授予
 *
 * 刻意按「本轮 papers / attempts / questions」过滤，避免误删 MW11—MW15 等非本轮残留。
 * score_metrics 没有 paperId 字段，只能按 memberId 精确读（mw-test 上该集合当前为 0 条）。
 */
export const MW16_SWEEP_SCOPE = {
  byMember: ["attempts", "active_attempts", "score_events", "paper_bests", "score_metrics", "medal_grants"],
  byMarkedPaper: ["papers", "paper_versions", "paper_chunks", "paper_answers"],
  byMarkedQuestion: ["questions", "question_versions"],
  byAsset: ["assets"]
};

/** 本轮产生的勋章授予来源：注册、重算，或某条被标记的本轮 attempt 交卷。 */
export const MEDAL_GRANT_ROUND_REGISTER_SOURCE = "member.register";
export const MEDAL_GRANT_ROUND_RECOMPUTE_PREFIX = "growth@v";

export function isRoundMedalGrant(doc, attemptIds) {
  const sourceId = typeof doc.sourceId === "string" ? doc.sourceId : "";
  const sourceType = typeof doc.sourceType === "string" ? doc.sourceType : "";
  if (sourceType === "register" && sourceId === MEDAL_GRANT_ROUND_REGISTER_SOURCE) return true;
  if (sourceType === "recompute" && sourceId.startsWith(MEDAL_GRANT_ROUND_RECOMPUTE_PREFIX)) return true;
  if (sourceType === "submit" && sourceId && attemptIds.has(sourceId)) return true;
  return false;
}

export const GROWTH_CONFIG_DOC_ID = "growth";

export function mw16Tmp() {
  const dir = join(projectRoot(), "tmp", "mw16");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw16(value) {
  return redactMw06(redact(value));
}

export function emptyMw16KnownIds() {
  return {
    members: [],
    attempts: [],
    activeAttempts: [],
    papers: [],
    versions: [],
    chunks: [],
    answers: [],
    questions: [],
    questionVersions: [],
    assets: [],
    bests: [],
    events: [],
    metrics: [],
    grants: [],
    objects: []
  };
}

export function knownIdCountOf(knownIds) {
  const ids = knownIds && typeof knownIds === "object" ? knownIds : emptyMw16KnownIds();
  return Object.keys(emptyMw16KnownIds()).reduce(
    (sum, key) => sum + (Array.isArray(ids[key]) ? ids[key].length : 0),
    0
  );
}

export function parseLeftoverHashes(incoming) {
  const source = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};
  const pick = (key) => (Array.isArray(source[key]) ? source[key] : []);
  const groups = {
    papers: pick("papers"),
    attempts: pick("attempts"),
    members: pick("members"),
    questions: pick("questions"),
    questionVersions: pick("questionVersions"),
    assets: pick("assets")
  };
  // 后台「题库脱敏证据」把题目版本放在 versions（其载荷里没有 papers）；
  // 「试卷 knownIds」用 questionVersions 表示题目版本、versions 表示试卷版本（由 paperId 关系覆盖，不按 id 处理）。
  if (!groups.questionVersions.length && !groups.papers.length && groups.questions.length) {
    groups.questionVersions = pick("versions");
  }
  const empty = { papers: [], attempts: [], members: [], questions: [], questionVersions: [], assets: [] };
  const importedHashCount = Object.values(groups).reduce((sum, list) => sum + list.length, 0);
  if (!importedHashCount) return { ok: false, reason: "EMPTY_HASHES", ...empty };
  const out = { papers: [], attempts: [], members: [], questions: [], questionVersions: [], assets: [] };
  for (const [key, list] of Object.entries(groups)) {
    for (const item of list) {
      if (!isSha256Hex(item)) return { ok: false, reason: "HASH_NOT_SHA256", ...empty };
      out[key].push(String(item).toLowerCase());
    }
  }
  return {
    ok: true,
    reason: "",
    importedHashCount,
    papers: [...new Set(out.papers)],
    attempts: [...new Set(out.attempts)],
    members: [...new Set(out.members)],
    questions: [...new Set(out.questions)],
    questionVersions: [...new Set(out.questionVersions)],
    assets: [...new Set(out.assets)]
  };
}

/** 部署/负向核验阶段的门禁，与 MW13—MW15 同构。 */
export function mw16LeftoverDecision(state) {
  const collectionNames = Array.isArray(state.collectionNames) ? state.collectionNames : null;
  const leftoverDocs =
    typeof state.testDocCount === "number" && Number.isFinite(state.testDocCount) ? state.testDocCount : null;
  const leftoverObjectsConfirmed = state.leftoverObjectsConfirmed === true;
  const leftoverObjects =
    leftoverObjectsConfirmed && typeof state.leftoverObjects === "number" && Number.isFinite(state.leftoverObjects)
      ? state.leftoverObjects
      : null;
  const seedPresent = state.seedPresent === true;
  const seedCount = typeof state.seedCount === "number" ? state.seedCount : 0;
  const collectionsConfirmed = state.collectionsConfirmed === true && collectionNames !== null;
  const testDocsConfirmed = state.testDocsConfirmed === true && leftoverDocs !== null;
  const enableOverrunConfirmed = state.enableOverrunConfirmed === true && typeof state.enableOverrun === "boolean";
  const overrun = state.enableOverrun === true;
  const wroteDocs = state.wroteDocs === true;
  const knownIdCount =
    typeof state.knownIdCount === "number" && Number.isFinite(state.knownIdCount)
      ? state.knownIdCount
      : knownIdCountOf(state.knownIds);
  const futureCreated = state.futureCollectionsCreated === true;
  const indexConfirmed = state.indexConfirmed === true;
  const independent = state.independent || {};
  const independentConfirmed = independent.confirmed === true;
  const independentTotal = independentConfirmed && typeof independent.total === "number" ? independent.total : null;
  const reasons = [];
  if (!wroteDocs) reasons.push("WROTE_DOCS_FALSE");
  if (wroteDocs && knownIdCount === 0) reasons.push("KNOWN_IDS_MISSING_AFTER_WRITE");
  if (wroteDocs && !testDocsConfirmed) reasons.push("TEST_DOCS_NOT_CONFIRMED");
  if (wroteDocs && testDocsConfirmed && leftoverDocs !== 0) reasons.push("TEST_DOCS_LEFT");
  if (!leftoverObjectsConfirmed || leftoverObjects === null) reasons.push("TEST_OBJECTS_NOT_CONFIRMED");
  if (leftoverObjectsConfirmed && leftoverObjects !== 0) reasons.push("TEST_OBJECTS_LEFT");
  if (state.clientDenied !== true) reasons.push("CLIENT_WRITE_NOT_DENIED");
  if (!collectionsConfirmed) reasons.push("COLLECTIONS_MISSING");
  if (collectionsConfirmed && collectionNames && MW16_COLLECTIONS.some((name) => !collectionNames.includes(name))) {
    reasons.push("COLLECTIONS_MISSING");
  }
  if (!indexConfirmed) reasons.push("INDEX_NOT_CONFIRMED");
  if (!seedPresent || seedCount !== 10) reasons.push("SEED_ROOTS_MISSING");
  if (!enableOverrunConfirmed) reasons.push("OVERRUN_NOT_CONFIRMED");
  if (enableOverrunConfirmed && overrun) reasons.push("OVERRUN_ENABLED");
  if (state.otherEnvChanged === true) reasons.push("OTHER_ENV_CHANGED");
  if (futureCreated) reasons.push("FUTURE_COLLECTIONS_CREATED");
  if (!independentConfirmed) reasons.push("INDEPENDENT_CHECK_NOT_CONFIRMED");
  if (independentConfirmed && independentTotal !== 0) reasons.push("INDEPENDENT_SWEEP_LEFT");
  return {
    ok: reasons.length === 0,
    exitCode: reasons.length === 0 ? 0 : 1,
    reasons,
    leftoverDocs: leftoverDocs === null ? -1 : leftoverDocs,
    leftoverObjects: leftoverObjects === null ? -1 : leftoverObjects,
    leftoverObjectsConfirmed,
    seedPresent,
    seedCount,
    enableOverrun: Boolean(state.enableOverrun),
    collectionsConfirmed,
    testDocsConfirmed,
    enableOverrunConfirmed,
    wroteDocs,
    cloudWriteClaimed: wroteDocs,
    exactIdSweepOnly: true,
    knownIdCount,
    indexConfirmed,
    independentConfirmed,
    independentTotal: independentTotal === null ? -1 : independentTotal
  };
}

/**
 * leftover 收口门禁：knownIds 计数与「按 member/paper 关系精确核查」必须同时为 0。
 * 后者不依赖 resolve 推导出的 id（MW15 已发现推导 id 与云端真实 _id 不一致）。
 */
export function mw16VerifyDecision({
  wroteDocs,
  cloudWriteClaimed,
  exactIdSweepOnly,
  knownIdLeftoverDocs,
  independentTotal,
  independentConfirmed,
  seedPresent,
  forbiddenPresent,
  dirtyReason
} = {}) {
  const reasons = [];
  if (dirtyReason) reasons.push(String(dirtyReason));
  if (wroteDocs !== true) reasons.push("WROTE_DOCS_FALSE");
  if (cloudWriteClaimed !== true) reasons.push("CLOUD_WRITE_NOT_CLAIMED");
  if (exactIdSweepOnly !== true) reasons.push("EXACT_ID_SWEEP_REQUIRED");
  if (typeof knownIdLeftoverDocs !== "number" || !Number.isFinite(knownIdLeftoverDocs)) {
    reasons.push("TEST_DOCS_NOT_CONFIRMED");
  } else if (knownIdLeftoverDocs !== 0) {
    reasons.push("TEST_DOCS_LEFT");
  }
  if (independentConfirmed !== true) reasons.push("INDEPENDENT_CHECK_NOT_CONFIRMED");
  if (independentConfirmed === true && independentTotal !== 0) reasons.push("INDEPENDENT_SWEEP_LEFT");
  if (seedPresent !== true) reasons.push("SEED_ROOTS_MISSING");
  if (forbiddenPresent === true) reasons.push("FORBIDDEN_COLLECTIONS_PRESENT");
  const unique = [...new Set(reasons)];
  return {
    ok: unique.length === 0,
    exitCode: unique.length === 0 ? 0 : 1,
    reasons: unique,
    independentRequired: true
  };
}

/** 独立核查（按 member/paper 关系精确统计）自身的判定，不依赖 knownIds。 */
export function mw16IndependentDecision({
  wroteDocs,
  resolved,
  independentTotal,
  seedPresent,
  forbiddenPresent
} = {}) {
  const reasons = [];
  if (wroteDocs !== true) reasons.push("WROTE_DOCS_FALSE");
  if (resolved !== true) reasons.push("KNOWN_IDS_NOT_RESOLVED");
  if (typeof independentTotal !== "number" || !Number.isFinite(independentTotal)) {
    reasons.push("INDEPENDENT_CHECK_NOT_CONFIRMED");
  } else if (independentTotal !== 0) {
    reasons.push("INDEPENDENT_SWEEP_LEFT");
  }
  if (seedPresent !== true) reasons.push("SEED_ROOTS_MISSING");
  if (forbiddenPresent === true) reasons.push("FORBIDDEN_COLLECTIONS_PRESENT");
  const unique = [...new Set(reasons)];
  return { ok: unique.length === 0, exitCode: unique.length === 0 ? 0 : 1, reasons: unique, derivedIdsUsed: false };
}

export function sweepTotal(counts) {
  if (!counts || typeof counts !== "object") return 0;
  let total = 0;
  for (const value of Object.values(counts)) {
    if (value && typeof value === "object") total += sweepTotal(value);
    else if (typeof value === "number" && Number.isFinite(value)) total += value;
  }
  return total;
}

/** 初始建议门槛（与产品说明书 V1.1 第 9.2 节一致；最终门槛在 MW28 冻结）。 */
export function growthSeedLevels() {
  return [
    { levelId: "L1", name: "思维新芽", minScore: 0, medalId: "medal.L1", medalName: "新芽" },
    { levelId: "L2", name: "思维学徒", minScore: 100, medalId: "medal.L2", medalName: "启程" },
    { levelId: "L3", name: "思维探索者", minScore: 300, medalId: "medal.L3", medalName: "探索" },
    { levelId: "L4", name: "思维进阶者", minScore: 800, medalId: "medal.L4", medalName: "进阶" },
    { levelId: "L5", name: "思维实践者", minScore: 1500, medalId: "medal.L5", medalName: "实践" },
    { levelId: "L6", name: "思维领航者", minScore: 3000, medalId: "medal.L6", medalName: "领航" }
  ];
}

export function growthSeedDoc(now) {
  const at = new Date(now).toISOString();
  return {
    _id: GROWTH_CONFIG_DOC_ID,
    kind: "growth",
    configVersion: 1,
    levels: growthSeedLevels(),
    publishedAt: at,
    publishedBy: "mw16-deploy",
    reason: "初始建议门槛",
    note: "初始建议门槛，不是已确认的最终运营门槛；上线门槛在 MW28 冻结。",
    placeholder: true,
    schemaVersion: 1,
    createdAt: at,
    updatedAt: at
  };
}

export {
  INITIAL_ROOT_SEEDS,
  leftoverResolveDecision,
  isSha256Hex,
  createCollectionCommand,
  createIndexCommand,
  listIndexCommand
};
