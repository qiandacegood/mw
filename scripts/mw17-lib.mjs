import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand, redactMw06 } from "./mw06-lib.mjs";
import { leftoverResolveDecision, isSha256Hex } from "./mw13-lib.mjs";
import { INITIAL_ROOT_SEEDS } from "./mw09-lib.mjs";
import { MW16_SWEEP_SCOPE, isRoundMedalGrant } from "./mw16-lib.mjs";

/**
 * MW17 四维排行榜：新增 ranking_heads / ranking_rows 快照集合，并重新部署
 * mw-public（ranking.list）、mw-member（ranking.me / member.setRanking）、
 * mw-admin（ranking.status / ranking.rebuild）三个入口。
 */
export const MW17_DEPLOY_ENTRIES = ["mw-member", "mw-admin", "mw-public"];
export const MW17_COLLECTIONS = ["ranking_heads", "ranking_rows"];
export const MW17_KEEP_COLLECTIONS = [
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
  "score_metrics",
  "medal_grants"
];
export const FORBIDDEN_FUTURE_COLLECTIONS = [
  "orders",
  "vip_accounts",
  "vip_plans",
  "vip_grants",
  "vip_events"
];

/**
 * 榜单快照（派生、可重建、跨用户共享）：**不计入 leftover，也永不删除**。
 * 删除 ranking_heads / ranking_rows / app_config/ranking 会让全站榜单空白，属
 * "删共享聚合凑 leftover=0"，明确禁止。收口时改用"重建一次快照"让测试身份的行自然消失。
 */
export const MW17_SNAPSHOT_COLLECTIONS = ["ranking_heads", "ranking_rows"];
export const MW17_RUNTIME_DOC = { collection: "app_config", id: "ranking" };

/** 榜单游标分页索引（docs/architecture/data-model-v1.0.md 第 4 节索引表）。 */
export const MW17_INDEXES = [
  {
    collection: "ranking_rows",
    name: "idx_ranking_rows_board_generation_ordinal",
    keys: [
      { name: "boardId", direction: 1 },
      { name: "generation", direction: 1 },
      { name: "sortOrdinal", direction: 1 }
    ]
  }
];

/**
 * 独立核查范围（不依赖 knownIds 推导 id，也不扫整表猜删）：与 MW16 同构。
 * - byMember：按 memberId 点读该会员相关文档，再用本轮卷 / 本轮 attempt 做精确过滤
 * - byMarkedPaper：只对「用户明确标记的本轮测试卷」删 papers / paper_versions / paper_chunks / paper_answers
 * - byMarkedQuestion：只对「用户明确标记的本轮题目」删 questions 及其按 questionId 关联的 question_versions
 * - medal_grants：只收 sourceId 属于本轮（register / growth@vN / 已标记的 attemptId）的授予
 *
 * 比 MW17 任务书第 45—53 行的 leftover 表多一项 medal_grants：MW17 手点若注册了新测试身份，
 * `member.register` 会按 MW16 规则授予首枚勋章，属本轮产生的真实写入；只按本轮来源过滤，
 * 不会碰历史既得勋章。
 */
export const MW17_SWEEP_SCOPE = MW16_SWEEP_SCOPE;

export function mw17Tmp() {
  const dir = join(projectRoot(), "tmp", "mw17");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw17(value) {
  return redactMw06(redact(value));
}

export function emptyMw17KnownIds() {
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
  const ids = knownIds && typeof knownIds === "object" ? knownIds : emptyMw17KnownIds();
  return Object.keys(emptyMw17KnownIds()).reduce(
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

/** 部署/负向核验阶段的门禁，与 MW13—MW16 同构（多一项快照残留核查）。 */
export function mw17LeftoverDecision(state) {
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
  const snapshotResidual =
    typeof state.snapshotResidual === "number" && Number.isFinite(state.snapshotResidual) ? state.snapshotResidual : null;
  const reasons = [];
  if (!wroteDocs) reasons.push("WROTE_DOCS_FALSE");
  if (wroteDocs && knownIdCount === 0) reasons.push("KNOWN_IDS_MISSING_AFTER_WRITE");
  if (wroteDocs && !testDocsConfirmed) reasons.push("TEST_DOCS_NOT_CONFIRMED");
  if (wroteDocs && testDocsConfirmed && leftoverDocs !== 0) reasons.push("TEST_DOCS_LEFT");
  if (!leftoverObjectsConfirmed || leftoverObjects === null) reasons.push("TEST_OBJECTS_NOT_CONFIRMED");
  if (leftoverObjectsConfirmed && leftoverObjects !== 0) reasons.push("TEST_OBJECTS_LEFT");
  if (state.clientDenied !== true) reasons.push("CLIENT_WRITE_NOT_DENIED");
  if (!collectionsConfirmed) reasons.push("COLLECTIONS_MISSING");
  if (collectionsConfirmed && collectionNames && MW17_COLLECTIONS.some((name) => !collectionNames.includes(name))) {
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
  if (snapshotResidual !== null && snapshotResidual !== 0) reasons.push("SNAPSHOT_RESIDUAL_MEMBERS");
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
    independentTotal: independentTotal === null ? -1 : independentTotal,
    snapshotResidual: snapshotResidual === null ? -1 : snapshotResidual
  };
}

/**
 * leftover 收口门禁：knownIds 计数、按 member/paper 关系精确核查、以及本轮标记身份在榜单快照中的残留
 * 必须同时为 0。后两者不依赖 resolve 推导出的 id（MW15 已发现推导 id 与云端真实 _id 不一致）。
 */
export function mw17VerifyDecision({
  wroteDocs,
  cloudWriteClaimed,
  exactIdSweepOnly,
  knownIdLeftoverDocs,
  independentTotal,
  independentConfirmed,
  snapshotResidual,
  snapshotConfirmed,
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
  if (snapshotConfirmed !== true || typeof snapshotResidual !== "number" || !Number.isFinite(snapshotResidual)) {
    reasons.push("SNAPSHOT_CHECK_NOT_CONFIRMED");
  } else if (snapshotResidual !== 0) {
    reasons.push("SNAPSHOT_RESIDUAL_MEMBERS");
  }
  if (seedPresent !== true) reasons.push("SEED_ROOTS_MISSING");
  if (forbiddenPresent === true) reasons.push("FORBIDDEN_COLLECTIONS_PRESENT");
  const unique = [...new Set(reasons)];
  return {
    ok: unique.length === 0,
    exitCode: unique.length === 0 ? 0 : 1,
    reasons: unique,
    independentRequired: true,
    snapshotRequired: true
  };
}

/** 独立核查（按 member/paper 关系精确统计）自身的判定，不依赖 knownIds。 */
export function mw17IndependentDecision({
  wroteDocs,
  resolved,
  independentTotal,
  snapshotResidual,
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
  if (typeof snapshotResidual === "number" && Number.isFinite(snapshotResidual) && snapshotResidual !== 0) {
    reasons.push("SNAPSHOT_RESIDUAL_MEMBERS");
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

export {
  INITIAL_ROOT_SEEDS,
  isRoundMedalGrant,
  leftoverResolveDecision,
  isSha256Hex,
  createCollectionCommand,
  createIndexCommand,
  listIndexCommand
};
