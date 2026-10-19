import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, readEnvFile, runTcb, writeJson } from "./mw04-lib.mjs";
import {
  MW26_FIXTURE_MARKER,
  MW26_FIXTURE_ROUND,
  MW26_TARGET,
  emptyMw26Counts,
  mw26ScaleBlockedReason,
  mw26Tmp,
  nosqlUpsertCommand,
  omitDocId,
  redactMw26
} from "./mw26-lib.mjs";

const root = projectRoot();
const tmp = mw26Tmp();
const ready = await assertMwTestReady();
if (ready.enableOverrun === true) throw new Error("EnableOverrun must stay false");
authorizedEnvId();

const shared = spawnSync(process.execPath, [join(root, "scripts", "ensure-shared-js.mjs")], { cwd: root, encoding: "utf8" });
if (shared.status !== 0) throw new Error("shared emit failed");

const {
  mw26AttemptId,
  mw26FixturePayload,
  mw26IdentityId,
  mw26MemberId,
  mw26MonthMetricId,
  mw26PaperId,
  mw26PaperVersionIdOf,
  mw26TotalMetricId,
  mw26WeekMetricId
} = await import("../packages/shared/dist/mw26-capacity.js");
const { seedCategoryIds } = await import("../packages/shared/dist/category.js");
const { weekKeyShanghai, monthKeyShanghai } = await import("../packages/shared/dist/clock.js");

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

const targetMembers = envInt("MW26_MEMBER_COUNT", MW26_TARGET.members);
const targetPapers = envInt("MW26_PAPER_COUNT", MW26_TARGET.papers);
const targetAttempts = envInt("MW26_ATTEMPT_COUNT", MW26_TARGET.attempts);
const budgetMs = envInt("MW26_WRITE_BUDGET_MS", 12 * 60 * 1000);
const now = new Date();
const nowIso = now.toISOString();
const categoryId = seedCategoryIds()[0];
const weekKey = weekKeyShanghai(now);
const monthKey = monthKeyShanghai(now);

const local = readEnvFile(join(root, ".env"));
const secretId = process.env.TENCENTCLOUD_SECRETID || local.TENCENTCLOUD_SECRETID || local.CLOUDBASE_SECRET_ID || "";
const secretKey = process.env.TENCENTCLOUD_SECRETKEY || local.TENCENTCLOUD_SECRETKEY || local.CLOUDBASE_SECRET_KEY || "";

let sdkDb;
let writer = "tcb-nosql";
if (secretId && secretKey) {
  try {
    const cloudbase = (await import("@cloudbase/node-sdk")).default;
    sdkDb = cloudbase.init({ env: authorizedEnvId(), secretId, secretKey }).database();
    writer = "node-sdk-secret";
  } catch {
    sdkDb = undefined;
    writer = "tcb-nosql";
  }
}

const started = Date.now();
const written = emptyMw26Counts();
let lastError = "";

function timedOut() {
  return Date.now() - started >= budgetMs;
}

async function upsertSdk(collection, id, payload) {
  const body = omitDocId(mw26FixturePayload(payload));
  await sdkDb.collection(collection).doc(id).set(body);
}

async function upsertTcbBatch(pairs) {
  const commands = pairs.map(([collection, id, payload]) => nosqlUpsertCommand(collection, id, mw26FixturePayload(payload)));
  const result = await runTcb(["db", "nosql", "execute", "--command", JSON.stringify(commands), "--json"], { timeoutMs: 120000 });
  if (result.code !== 0) throw new Error(result.stderr || "tcb upsert failed");
}

async function upsertMany(pairs) {
  if (timedOut()) return false;
  try {
    if (sdkDb) {
      const chunk = 20;
      for (let i = 0; i < pairs.length; i += chunk) {
        if (timedOut()) return false;
        const slice = pairs.slice(i, i + chunk);
        await Promise.all(slice.map(([collection, id, payload]) => upsertSdk(collection, id, payload)));
      }
      return true;
    }
    const chunk = 10;
    for (let i = 0; i < pairs.length; i += chunk) {
      if (timedOut()) return false;
      await upsertTcbBatch(pairs.slice(i, i + chunk));
    }
    return true;
  } catch (error) {
    lastError = String(error && error.message ? error.message : error);
    return false;
  }
}

const memberGoal = Math.max(0, targetMembers);
const paperGoal = Math.max(0, targetPapers);
const attemptGoal = Math.max(0, targetAttempts);

for (let index = 0; index < memberGoal; index += 20) {
  const batch = [];
  for (let offset = 0; offset < 20 && index + offset < memberGoal; offset += 1) {
    const i = index + offset;
    const memberId = mw26MemberId(i);
    const identityId = mw26IdentityId(i);
    batch.push([
      "identities",
      identityId,
      {
        identityId,
        memberId,
        provider: "wechat_mini",
        schemaVersion: 1,
        createdAt: nowIso,
        updatedAt: nowIso
      }
    ]);
    batch.push([
      "members",
      memberId,
      {
        memberId,
        nickname: `夹具学员${String(i).padStart(5, "0")}`,
        avatarKey: "avatar.builtin.01",
        status: "active",
        rankingOptIn: true,
        rankingBanned: false,
        revision: 1,
        schemaVersion: 1,
        createdAt: nowIso,
        updatedAt: nowIso
      }
    ]);
    batch.push([
      "member_stats",
      memberId,
      {
        memberId,
        totalScore: 10 + (i % 90),
        levelId: "L1",
        schemaVersion: 1,
        updatedAt: nowIso
      }
    ]);
  }
  const ok = await upsertMany(batch);
  if (!ok) break;
  written.identities += batch.filter((row) => row[0] === "identities").length;
  written.members += batch.filter((row) => row[0] === "members").length;
  written.member_stats += batch.filter((row) => row[0] === "member_stats").length;
}

for (let index = 0; index < paperGoal; index += 20) {
  const batch = [];
  for (let offset = 0; offset < 20 && index + offset < paperGoal; offset += 1) {
    const i = index + offset;
    const paperId = mw26PaperId(i);
    const versionId = mw26PaperVersionIdOf(i);
    batch.push([
      "papers",
      paperId,
      {
        paperId,
        title: `MW26夹具卷${String(i).padStart(4, "0")}`,
        summary: "虚构负载卷",
        goal: "容量夹具",
        categoryId,
        access: "free",
        difficulty: "beginner",
        sort: i,
        suggestedMinutes: 10,
        publishedAt: nowIso,
        status: "published",
        activeVersionId: versionId,
        revision: 1,
        draftItems: [],
        draftQuestionCount: 1,
        draftMaxScore: 10,
        accessLocked: false,
        schemaVersion: 1,
        createdAt: nowIso,
        updatedAt: nowIso
      }
    ]);
    batch.push([
      "paper_versions",
      versionId,
      {
        versionId,
        paperId,
        revision: 1,
        questionCount: 1,
        maxScore: 10,
        schemaVersion: 1,
        createdAt: nowIso
      }
    ]);
  }
  const ok = await upsertMany(batch);
  if (!ok) break;
  written.papers += batch.filter((row) => row[0] === "papers").length;
  written.paper_versions += batch.filter((row) => row[0] === "paper_versions").length;
}

const membersWritten = written.members;
const papersWritten = written.papers;
const attemptCap = membersWritten > 0 && papersWritten > 0 ? attemptGoal : 0;
for (let n = 0; n < attemptCap; n += 20) {
  const batch = [];
  for (let offset = 0; offset < 20 && n + offset < attemptCap; offset += 1) {
    const seq = n + offset;
    const memberIndex = seq % membersWritten;
    const paperIndex = seq % papersWritten;
    const memberId = mw26MemberId(memberIndex);
    const paperId = mw26PaperId(paperIndex);
    const attemptId = mw26AttemptId(memberIndex, paperIndex, seq);
    batch.push([
      "attempts",
      attemptId,
      {
        attemptId,
        memberId,
        paperId,
        paperTitle: `MW26夹具卷${String(paperIndex).padStart(4, "0")}`,
        state: "submitted",
        score: 10 + (seq % 90),
        submittedAt: nowIso,
        schemaVersion: 1,
        updatedAt: nowIso
      }
    ]);
  }
  const ok = await upsertMany(batch);
  if (!ok) break;
  written.attempts += batch.length;
}

for (let index = 0; index < membersWritten; index += 10) {
  const batch = [];
  for (let offset = 0; offset < 10 && index + offset < membersWritten; offset += 1) {
    const i = index + offset;
    const memberId = mw26MemberId(i);
    const value = 10 + (i % 90);
    batch.push([
      "score_metrics",
      mw26TotalMetricId(i),
      {
        metricId: mw26TotalMetricId(i),
        metricGeneration: "base",
        scope: "total",
        periodKey: "all",
        categoryId: "",
        memberId,
        value,
        reachedAt: nowIso
      }
    ]);
    batch.push([
      "score_metrics",
      mw26WeekMetricId(i, now),
      {
        metricId: mw26WeekMetricId(i, now),
        metricGeneration: "base",
        scope: "week",
        periodKey: weekKey,
        categoryId: "",
        memberId,
        value,
        reachedAt: nowIso
      }
    ]);
    batch.push([
      "score_metrics",
      mw26MonthMetricId(i, now),
      {
        metricId: mw26MonthMetricId(i, now),
        metricGeneration: "base",
        scope: "month",
        periodKey: monthKey,
        categoryId: "",
        memberId,
        value,
        reachedAt: nowIso
      }
    ]);
  }
  const ok = await upsertMany(batch);
  if (!ok) break;
  written.score_metrics += batch.length;
}

const elapsedMs = Date.now() - started;
const actual = { members: written.members, papers: written.papers, attempts: written.attempts };
const wroteDocs = written.members > 0 || written.papers > 0 || written.attempts > 0;
const scaleReason = mw26ScaleBlockedReason(actual);
const state = {
  wroteDocs,
  resolved: false,
  fixtureRound: MW26_FIXTURE_ROUND,
  fixtureMarker: MW26_FIXTURE_MARKER,
  seededAt: nowIso,
  weekKeyShanghai: weekKey,
  monthKeyShanghai: monthKey,
  counts: written,
  writer,
  elapsedMs,
  timedOut: timedOut(),
  lastError: lastError || undefined,
  scaleReason,
  enableOverrun: ready.enableOverrun,
  note: "只写本轮夹具。载荷不含 _id。不写 orders/refunds/vip_*/审计。清理 score_metrics 必须用本文件周/月键，禁止 new Date()。"
};
writeFileSync(join(projectRoot(), "configs", "mw26-verify-state.json"), `${JSON.stringify(state, null, 2)}\n`);
writeJson(join(tmp, "mw26-seed.json"), redactMw26(state));
console.log(JSON.stringify(redactMw26({ ok: wroteDocs, ...state }), null, 2));
process.exit(wroteDocs ? 0 : 1);
