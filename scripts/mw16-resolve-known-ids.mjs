import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, writeJson } from "./mw04-lib.mjs";
import {
  emptyMw16KnownIds,
  isRoundMedalGrant,
  knownIdCountOf,
  leftoverResolveDecision,
  mw16Tmp,
  parseLeftoverHashes,
  redactMw16
} from "./mw16-lib.mjs";
import { findByHash, findAll } from "./mw16-sweep-lib.mjs";

const statePath = join(projectRoot(), "configs", "mw16-verify-state.json");
if (!existsSync(statePath)) {
  console.error("missing configs/mw16-verify-state.json");
  process.exit(1);
}
const state = JSON.parse(readFileSync(statePath, "utf8"));
const hashSource = {
  papers: Array.isArray(state.hashes?.papers) ? state.hashes.papers : [],
  attempts: Array.isArray(state.hashes?.attempts) ? state.hashes.attempts : [],
  members: Array.isArray(state.hashes?.members) ? state.hashes.members : []
};
const parsedHashes = parseLeftoverHashes(hashSource);
if (!parsedHashes.ok) {
  console.error(JSON.stringify({ ok: false, reason: parsedHashes.reason }, null, 2));
  process.exit(1);
}

const readyState = await assertMwTestReady();
authorizedEnvId();

const paperIds = parsedHashes.papers.length ? await findByHash("papers", parsedHashes.papers, { _id: 1 }) : [];
const memberIds = parsedHashes.members.length ? await findByHash("members", parsedHashes.members, { _id: 1 }) : [];
const attemptDocs = parsedHashes.attempts.length
  ? await findByHash("attempts", parsedHashes.attempts, { _id: 1, memberId: 1, paperId: 1 })
  : [];

const questionDocs = parsedHashes.questions.length ? await findByHash("questions", parsedHashes.questions, { _id: 1 }) : [];
const questionVersionDocs = parsedHashes.questionVersions.length
  ? await findByHash("question_versions", parsedHashes.questionVersions, { _id: 1 })
  : [];
const assetDocs = parsedHashes.assets.length ? await findByHash("assets", parsedHashes.assets, { _id: 1 }) : [];

const paperIdList = paperIds.map((row) => row.entryId).filter(Boolean);
const memberIdList = memberIds.map((row) => row.entryId).filter(Boolean);
const attemptIds = attemptDocs.map((row) => row.entryId).filter(Boolean);
const importedHashCount = [
  parsedHashes.papers,
  parsedHashes.attempts,
  parsedHashes.members,
  parsedHashes.questions,
  parsedHashes.questionVersions,
  parsedHashes.assets
].reduce((sum, list) => sum + list.length, 0);
const matchedIdCount =
  paperIds.length +
  attemptIds.length +
  memberIds.length +
  questionDocs.length +
  questionVersionDocs.length +
  assetDocs.length;
const resolveGate = leftoverResolveDecision({ importedHashCount, matchedIdCount, scanComplete: true });
if (!resolveGate.ok) {
  const summary = redactMw16({
    ok: false,
    reason: resolveGate.reason,
    importedHashCount,
    matchedPaperCount: paperIds.length,
    matchedAttemptCount: attemptIds.length,
    matchedMemberCount: memberIds.length,
    matchedQuestionCount: questionDocs.length,
    matchedQuestionVersionCount: questionVersionDocs.length,
    matchedAssetCount: assetDocs.length
  });
  writeJson(join(mw16Tmp(), "mw16-resolve.json"), summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

const discoveredMembers = new Set(memberIdList);
for (const doc of attemptDocs) {
  if (doc.memberId) discoveredMembers.add(doc.memberId);
}

const versions = [];
for (const paperId of paperIdList) {
  versions.push(...(await findAll("paper_versions", { paperId }, { _id: 1, chunkIds: 1, answerChunkIds: 1 })));
}
const versionIds = [...new Set(versions.map((row) => (typeof row._id === "string" ? row._id : "")).filter(Boolean))];
const chunkIds = [...new Set(versions.flatMap((doc) => (Array.isArray(doc.chunkIds) ? doc.chunkIds : [])).filter(Boolean))];
const answerIds = [
  ...new Set(versions.flatMap((doc) => (Array.isArray(doc.answerChunkIds) ? doc.answerChunkIds : [])).filter(Boolean))
];

const activeAttempts = [];
if (attemptIds.length) {
  const wanted = new Set(attemptIds);
  for (const doc of await findAll("active_attempts", {}, { _id: 1, attemptId: 1 })) {
    if (wanted.has(String(doc.attemptId || ""))) activeAttempts.push(String(doc._id || ""));
  }
}

/** 与关系核查一致：按 memberId / paperId 精确读出真实 _id，不做任何 id 推导。 */
const bests = [];
const events = [];
const metrics = [];
const grants = [];
const attemptIdSet = new Set(attemptIds);
for (const memberId of discoveredMembers) {
  for (const doc of await findAll("medal_grants", { memberId }, { _id: 1, sourceType: 1, sourceId: 1 })) {
    const id = typeof doc._id === "string" ? doc._id : "";
    // 只收本轮授予（注册 / 重算 / 已标记的本轮 attempt 交卷），不碰历史既得勋章。
    if (id && isRoundMedalGrant(doc, attemptIdSet)) grants.push(id);
  }
}
for (const doc of attemptDocs) {
  const memberId = String(doc.memberId || "");
  const paperId = String(doc.paperId || "");
  if (!memberId || !paperId) continue;
  for (const collection of ["paper_bests", "score_events"]) {
    const target = collection === "paper_bests" ? bests : events;
    for (const row of await findAll(collection, { memberId, paperId }, { _id: 1 })) {
      const id = typeof row._id === "string" ? row._id : "";
      if (id) target.push(id);
    }
  }
}
// score_metrics 没有 paperId 字段（按 memberId + 分类 + 周期聚合），只能按 memberId 精确读。
for (const memberId of discoveredMembers) {
  for (const row of await findAll("score_metrics", { memberId }, { _id: 1 })) {
    const id = typeof row._id === "string" ? row._id : "";
    if (id) metrics.push(id);
  }
}

/** 题目版本：标记的题目 + 直接标记的版本，按 questionId 关系读真实 _id。 */
const questionIds = questionDocs.map((row) => row.entryId).filter(Boolean);
const questionVersionIds = new Set(questionVersionDocs.map((row) => row.entryId).filter(Boolean));
for (const questionId of questionIds) {
  for (const row of await findAll("question_versions", { questionId }, { _id: 1 })) {
    const id = typeof row._id === "string" ? row._id : "";
    if (id) questionVersionIds.add(id);
  }
}

const knownIds = {
  ...emptyMw16KnownIds(),
  members: [...discoveredMembers],
  attempts: attemptIds,
  activeAttempts: [...new Set(activeAttempts.filter(Boolean))],
  papers: paperIdList,
  versions: versionIds,
  chunks: chunkIds,
  answers: answerIds,
  questions: questionIds,
  questionVersions: [...questionVersionIds],
  assets: assetDocs.map((row) => row.entryId).filter(Boolean),
  bests: [...new Set(bests)],
  events: [...new Set(events)],
  metrics: [...new Set(metrics)],
  grants: [...new Set(grants)],
  objects: []
};
const next = {
  wroteDocs: true,
  resolved: true,
  hashesOnly: true,
  hashes: {
    papers: parsedHashes.papers,
    attempts: parsedHashes.attempts,
    members: parsedHashes.members,
    questions: parsedHashes.questions,
    questionVersions: parsedHashes.questionVersions,
    assets: parsedHashes.assets
  },
  knownIds,
  resolvedAt: new Date().toISOString(),
  matchedPaperCount: paperIds.length,
  matchedAttemptCount: attemptIds.length,
  matchedMemberCount: memberIds.length,
  matchedQuestionCount: questionIds.length,
  matchedQuestionVersionCount: questionVersionIds.size,
  matchedAssetCount: assetDocs.length,
  enableOverrun: readyState.enableOverrun
};
writeJson(statePath, next);
const summary = {
  ok: true,
  importedHashCount,
  matchedPaperCount: paperIds.length,
  matchedAttemptCount: attemptIds.length,
  matchedMemberCount: memberIds.length,
  matchedQuestionCount: questionIds.length,
  matchedQuestionVersionCount: questionVersionIds.size,
  matchedAssetCount: assetDocs.length,
  knownIdCount: knownIdCountOf(knownIds),
  counts: {
    members: knownIds.members.length,
    attempts: knownIds.attempts.length,
    activeAttempts: knownIds.activeAttempts.length,
    papers: knownIds.papers.length,
    versions: knownIds.versions.length,
    chunks: knownIds.chunks.length,
    answers: knownIds.answers.length,
    questions: knownIds.questions.length,
    questionVersions: knownIds.questionVersions.length,
    assets: knownIds.assets.length,
    bests: knownIds.bests.length,
    events: knownIds.events.length,
    metrics: knownIds.metrics.length,
    grants: knownIds.grants.length,
    objects: knownIds.objects.length
  }
};
writeJson(join(mw16Tmp(), "mw16-resolve.json"), redactMw16(summary));
console.log(JSON.stringify(summary, null, 2));
