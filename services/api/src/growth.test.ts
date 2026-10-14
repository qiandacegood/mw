import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY_VERSIONS,
  cloneGrowthLevels,
  defaultGrowthConfig,
  seedCategoryId,
  type CategoryRecord,
  type GrowthConfigRecord,
  type GrowthLevel,
  type PaperAnswerRecord,
  type PaperChunkRecord,
  type PaperRecord,
  type PaperVersionRecord
} from "@mw/shared";
import { handleOfficial, type AdminUserRecord, type OfficialContext } from "./official.js";
import { memoryMaintenanceStore } from "./modules/job-stores.js";
import { memoryMemberBundle, memoryPolicyStore } from "./modules/member-stores.js";
import { memoryAttemptStore } from "./modules/attempt-stores.js";
import { memoryCategoryStore } from "./modules/category-stores.js";
import { memoryGrowthStore } from "./modules/growth-stores.js";

const allowedAppIds = ["wxmwallowedappid0001"];
const now = new Date("2026-10-14T02:00:00.000Z");
const fromA = { fromAppId: allowedAppIds[0], fromOpenId: "mw16_openid_a" };
const rootId = seedCategoryId("logical");

const TEST_LEVELS: GrowthLevel[] = [
  { levelId: "L1", name: "思维新芽", minScore: 0, medalId: "medal.test.L1", medalName: "新芽" },
  { levelId: "L2", name: "思维学徒", minScore: 5, medalId: "medal.test.L2", medalName: "启程" },
  { levelId: "L3", name: "思维探索者", minScore: 10, medalId: "medal.test.L3", medalName: "探索" }
];

function testConfig(configVersion = 0, levels: GrowthLevel[] = TEST_LEVELS): GrowthConfigRecord {
  return { ...defaultGrowthConfig(now, { configVersion }), levels: cloneGrowthLevels(levels) };
}

function req(action: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    apiVersion: "1",
    action,
    requestId: extra.requestId || `req_${action.replace(".", "_")}`,
    data,
    ...extra
  };
}

function cat(id: string): CategoryRecord {
  return {
    categoryId: id,
    parentId: null,
    depth: 1,
    ancestorIds: [],
    name: "逻辑思维",
    normalizedName: "逻辑思维",
    sort: 10,
    enabled: true,
    deletedAt: null,
    revision: 1,
    treeVersion: 3,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function paper(id: string): PaperRecord {
  return {
    paperId: id,
    title: `虚构卷${id}`,
    summary: "虚构简介",
    goal: "虚构目标",
    categoryId: rootId,
    access: "free",
    difficulty: "beginner",
    sort: 10,
    suggestedMinutes: 20,
    publishedAt: "2026-10-09T06:00:00.000Z",
    status: "published",
    activeVersionId: `${id}_v`,
    revision: 2,
    draftItems: [],
    draftQuestionCount: 2,
    draftMaxScore: 10,
    accessLocked: false,
    withdrawReason: null,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function version(paperId: string): PaperVersionRecord {
  return {
    versionId: `${paperId}_v`,
    paperId,
    questionCount: 2,
    maxScore: 10,
    chunkIds: [`${paperId}_c1`],
    answerChunkIds: [`${paperId}_a1`],
    chunkDigests: ["d1"],
    answerDigests: ["d2"],
    categoryPathSnapshot: ["逻辑思维"],
    manifestHash: "m1",
    questionIds: ["q1", "q2"],
    questionVersionIds: ["qv1", "qv2"],
    schemaVersion: 1,
    createdAt: now.toISOString(),
    createdBy: "uid_content_1"
  };
}

function chunk(paperId: string): PaperChunkRecord {
  return {
    chunkId: `${paperId}_c1`,
    versionId: `${paperId}_v`,
    chunkNo: 1,
    items: [
      {
        ord: 1,
        questionId: "q1",
        questionVersionId: "qv1",
        type: "single",
        stem: { text: "虚构题干一", assetIds: [] },
        options: [
          { optionId: "A", text: "甲", assetIds: [] },
          { optionId: "B", text: "乙", assetIds: [] }
        ],
        points: 5
      },
      {
        ord: 2,
        questionId: "q2",
        questionVersionId: "qv2",
        type: "single",
        stem: { text: "虚构题干二", assetIds: [] },
        options: [
          { optionId: "A", text: "丙", assetIds: [] },
          { optionId: "B", text: "丁", assetIds: [] }
        ],
        points: 5
      }
    ],
    digest: "d1",
    schemaVersion: 1
  };
}

function answer(paperId: string): PaperAnswerRecord {
  return {
    chunkId: `${paperId}_a1`,
    versionId: `${paperId}_v`,
    chunkNo: 1,
    items: [
      {
        ord: 1,
        questionId: "q1",
        questionVersionId: "qv1",
        answer: { optionIds: ["A"] },
        analysis: { text: "虚构解析一", assetIds: [] }
      },
      {
        ord: 2,
        questionId: "q2",
        questionVersionId: "qv2",
        answer: { optionIds: ["B"] },
        analysis: { text: "虚构解析二", assetIds: [] }
      }
    ],
    digest: "d2",
    schemaVersion: 1
  };
}

function seededAttempts() {
  const papers = [paper("p_free"), paper("p_free_b")];
  return memoryAttemptStore({
    papers,
    versions: papers.map((row) => version(row.paperId)),
    chunks: papers.map((row) => chunk(row.paperId)),
    answers: papers.map((row) => answer(row.paperId)),
    categories: [cat(rootId)]
  });
}

/**
 * 本地 bundle 之间共享 member_stats / medal_grants（云端是同一集合）。
 */
function bundles(config: GrowthConfigRecord = testConfig(0)) {
  const stores = memoryMemberBundle();
  const attempts = seededAttempts();
  const growth = memoryGrowthStore({ config });
  attempts.linkMemberStats(stores.stats);
  attempts.linkMedalGrants(stores.medalGrants);
  growth.linkMemberStats(stores.stats);
  growth.linkGrants(stores.medalGrants);
  return { stores, attempts, growth };
}

function memberCtx(
  event: unknown,
  stores: ReturnType<typeof memoryMemberBundle>,
  attempts: ReturnType<typeof seededAttempts>,
  growth: ReturnType<typeof memoryGrowthStore>,
  extra: Record<string, unknown> = {}
) {
  return {
    entry: "mw-member" as const,
    event,
    allowedAppIds,
    now,
    policyStore: memoryPolicyStore(),
    memberStore: stores,
    attemptStore: attempts,
    growthStore: growth,
    maintenanceStore: memoryMaintenanceStore(),
    ...fromA,
    ...extra
  };
}

function adminCtx(
  event: unknown,
  growth: ReturnType<typeof memoryGrowthStore>,
  roles: string[],
  extra: Record<string, unknown> = {}
): OfficialContext {
  return {
    entry: "mw-admin",
    event,
    allowedAppIds,
    now,
    adminStore: {
      async getByUid(uid: string) {
        return { uid, roles: roles as AdminUserRecord["roles"], enabled: true, authVersion: 1 };
      }
    },
    authUid: "uid_mw16_admin",
    growthStore: growth,
    ...extra
  };
}

async function register(
  stores: ReturnType<typeof memoryMemberBundle>,
  attempts: ReturnType<typeof seededAttempts>,
  growth: ReturnType<typeof memoryGrowthStore>
) {
  const res = (await handleOfficial(
    memberCtx(
      req(
        "member.register",
        {
          agreementVersion: DEFAULT_POLICY_VERSIONS.agreementVersion,
          privacyVersion: DEFAULT_POLICY_VERSIONS.privacyVersion,
          accepted: true
        },
        { idempotencyKey: "reg-mw16", requestId: "req_reg_mw16" }
      ),
      stores,
      attempts,
      growth
    )
  )) as { ok: true; data: { memberId: string } };
  const memberId = res.data.memberId;
  const member = stores.members.get(memberId);
  if (member) attempts.members.set(memberId, member);
  attempts.linkMemberStats(stores.stats);
  return memberId;
}

async function startAndSave(
  stores: ReturnType<typeof memoryMemberBundle>,
  attempts: ReturnType<typeof seededAttempts>,
  growth: ReturnType<typeof memoryGrowthStore>,
  paperId: string,
  answers: { questionId: string; optionIds: string[] }[]
) {
  const started = (await handleOfficial(
    memberCtx(
      req(
        "attempt.start",
        { paperId },
        { idempotencyKey: `start-${paperId}-${answers.length}`, requestId: `req_start_${paperId}_${answers.length}` }
      ),
      stores,
      attempts,
      growth
    )
  )) as { ok: true; data: { attemptId: string } };
  // note: attempt.save 以 requestId 作为幂等键，每次必须唯一。
  const saved = (await handleOfficial(
    memberCtx(
      req(
        "attempt.save",
        { attemptId: started.data.attemptId, expectedRevision: 0, answers },
        {
          idempotencyKey: `save-${started.data.attemptId}`,
          requestId: `req_save_${started.data.attemptId}`
        }
      ),
      stores,
      attempts,
      growth
    )
  )) as { ok: true; data: { revision: number } };
  expect(saved.data.revision).toBe(1);
  return { attemptId: started.data.attemptId };
}

async function submit(
  stores: ReturnType<typeof memoryMemberBundle>,
  attempts: ReturnType<typeof seededAttempts>,
  growth: ReturnType<typeof memoryGrowthStore>,
  attemptId: string,
  answers: { questionId: string; optionIds: string[] }[],
  key: string
) {
  return (await handleOfficial(
    memberCtx(
      req(
        "attempt.submit",
        { attemptId, expectedRevision: 1, answers, confirmUnanswered: true },
        { idempotencyKey: key, requestId: `req_${key}` }
      ),
      stores,
      attempts,
      growth
    )
  )) as { ok: true; data: { score: number; delta: number; totalScore: number; levelId: string } };
}

async function readGrowth(
  stores: ReturnType<typeof memoryMemberBundle>,
  attempts: ReturnType<typeof seededAttempts>,
  growth: ReturnType<typeof memoryGrowthStore>
) {
  return (await handleOfficial(memberCtx(req("member.growth"), stores, attempts, growth))) as {
    ok: true;
    data: {
      levelId: string;
      levelName: string;
      totalScore: number;
      earnedCount: number;
      remaining: number;
      nextLevelId: string | null;
      medals: { medalId: string; earned: boolean; awardedAt: string | null }[];
    };
  };
}

describe("MW16 growth levels and medals", () => {
  it("grants the first medal at register and exposes the growth block", async () => {
    const { stores, attempts, growth } = bundles();
    const memberId = await register(stores, attempts, growth);

    expect(stores.medalGrants.size).toBe(1);
    expect([...stores.medalGrants.values()][0]?.medalId).toBe("medal.test.L1");
    expect(stores.stats.get(memberId)?.levelId).toBe("L1");
    expect(stores.stats.get(memberId)?.growthVersion).toBe(0);

    const view = await readGrowth(stores, attempts, growth);
    expect(view.data.levelId).toBe("L1");
    expect(view.data.levelName).toBe("思维新芽");
    expect(view.data.nextLevelId).toBe("L2");
    expect(view.data.remaining).toBe(5);
    expect(view.data.earnedCount).toBe(1);
    expect(view.data.medals.map((row) => row.medalId)).toEqual(["medal.test.L1", "medal.test.L2", "medal.test.L3"]);
    expect(view.data.medals.filter((row) => row.earned).length).toBe(1);
  });

  it("backfills every crossed level in one submit and never grants twice", async () => {
    const { stores, attempts, growth } = bundles();
    const memberId = await register(stores, attempts, growth);

    const first = await startAndSave(stores, attempts, growth, "p_free", [
      { questionId: "q1", optionIds: ["A"] },
      { questionId: "q2", optionIds: ["B"] }
    ]);
    const submitted = await submit(
      stores,
      attempts,
      growth,
      first.attemptId,
      [
        { questionId: "q1", optionIds: ["A"] },
        { questionId: "q2", optionIds: ["B"] }
      ],
      "mw16-sub-1"
    );
    expect(submitted.data).toMatchObject({ score: 10, delta: 10, totalScore: 10, levelId: "L3" });
    expect(stores.stats.get(memberId)?.levelId).toBe("L3");
    expect([...stores.medalGrants.values()].map((row) => row.medalId).sort()).toEqual([
      "medal.test.L1",
      "medal.test.L2",
      "medal.test.L3"
    ]);

    // 第二次交卷（另一份卷）得 0 分增量，不重复授予。
    const second = await startAndSave(stores, attempts, growth, "p_free_b", [{ questionId: "q1", optionIds: ["B"] }]);
    const again = await submit(
      stores,
      attempts,
      growth,
      second.attemptId,
      [{ questionId: "q1", optionIds: ["B"] }],
      "mw16-sub-2"
    );
    expect(again.data).toMatchObject({ score: 0, delta: 0, totalScore: 10 });
    expect(stores.medalGrants.size).toBe(3);

    const view = await readGrowth(stores, attempts, growth);
    expect(view.data.earnedCount).toBe(3);
    expect(view.data.remaining).toBe(0);
    expect(view.data.nextLevelId).toBeNull();
  });

  it("previews a threshold change without writing, then publishes and recomputes", async () => {
    const { stores, attempts, growth } = bundles();
    const memberId = await register(stores, attempts, growth);
    const first = await startAndSave(stores, attempts, growth, "p_free", [
      { questionId: "q1", optionIds: ["A"] },
      { questionId: "q2", optionIds: ["B"] }
    ]);
    await submit(
      stores,
      attempts,
      growth,
      first.attemptId,
      [
        { questionId: "q1", optionIds: ["A"] },
        { questionId: "q2", optionIds: ["B"] }
      ],
      "mw16-sub-3"
    );
    expect(stores.stats.get(memberId)?.levelId).toBe("L3");

    const stricter: GrowthLevel[] = [
      { levelId: "L1", name: "思维新芽", minScore: 0, medalId: "medal.test.L1", medalName: "新芽" },
      { levelId: "L2", name: "思维学徒", minScore: 100, medalId: "medal.test.L2", medalName: "启程" },
      { levelId: "L3", name: "思维探索者", minScore: 200, medalId: "medal.test.L3", medalName: "探索" }
    ];
    const preview = (await handleOfficial(
      adminCtx(req("growth.preview", { levels: stricter.map((row) => ({ ...row })) }), growth, ["content"])
    )) as { ok: true; data: { affected: number; downgraded: number; wroteDocs: boolean; medalsToGrant: number } };
    expect(preview.data.wroteDocs).toBe(false);
    expect(preview.data.affected).toBe(1);
    expect(preview.data.downgraded).toBe(1);
    expect(preview.data.medalsToGrant).toBe(0);
    expect(growth.config?.configVersion).toBe(0);

    const published = (await handleOfficial(
      adminCtx(
        req(
          "growth.publish",
          { levels: stricter.map((row) => ({ ...row })), reason: "MW16 提高门槛", expectedConfigVersion: 0 },
          { idempotencyKey: "mw16-pub-1" }
        ),
        growth,
        ["super"]
      )
    )) as {
      ok: true;
      data: { config: GrowthConfigRecord; recompute: { recomputed: number; levelChanged: number; medalsGranted: number } };
    };
    expect(published.ok).toBe(true);
    expect(published.data.config.configVersion).toBe(1);
    expect(published.data.recompute).toMatchObject({ recomputed: 1, levelChanged: 1, medalsGranted: 0 });

    // 等级按新门槛回落，但既得勋章一枚都不删除。
    expect(stores.stats.get(memberId)?.levelId).toBe("L1");
    expect(stores.stats.get(memberId)?.growthVersion).toBe(1);
    expect(stores.medalGrants.size).toBe(3);
    const view = await readGrowth(stores, attempts, growth);
    expect(view.data.levelId).toBe("L1");
    expect(view.data.earnedCount).toBe(3);
    expect(view.data.nextLevelId).toBe("L2");
    expect(view.data.remaining).toBe(90);
  });

  it("requires super to publish, rejects version mismatch, and keeps preview read-only for content", async () => {
    const growth = memoryGrowthStore({ config: testConfig(0) });
    const denied = await handleOfficial(
      adminCtx(
        req(
          "growth.publish",
          { levels: TEST_LEVELS.map((row) => ({ ...row })), reason: "content 不能发布", expectedConfigVersion: 0 },
          { idempotencyKey: "mw16-pub-denied" }
        ),
        growth,
        ["content"]
      )
    );
    expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN", details: { reason: "SUPER_REQUIRED" } } });
    expect(growth.config?.configVersion).toBe(0);

    const stale = await handleOfficial(
      adminCtx(
        req(
          "growth.publish",
          { levels: TEST_LEVELS.map((row) => ({ ...row })), reason: "版本过期", expectedConfigVersion: 7 },
          { idempotencyKey: "mw16-pub-stale" }
        ),
        growth,
        ["super"]
      )
    );
    expect(stale).toMatchObject({ ok: false, error: { code: "VERSION_CONFLICT" } });

    const badLevels = await handleOfficial(
      adminCtx(
        req(
          "growth.publish",
          {
            levels: [
              { levelId: "L1", name: "新芽", minScore: 10, medalId: "m1", medalName: "芽" },
              { levelId: "L2", name: "学徒", minScore: 5, medalId: "m2", medalName: "启" }
            ],
            reason: "门槛不是从 0 起严格递增",
            expectedConfigVersion: 0
          },
          { idempotencyKey: "mw16-pub-bad" }
        ),
        growth,
        ["super"]
      )
    );
    expect(badLevels).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });

    const configRead = (await handleOfficial(adminCtx(req("growth.config"), growth, ["operations"]))) as {
      ok: true;
      data: { config: GrowthConfigRecord; source: string };
    };
    expect(configRead.data.source).toBe("stored");
    expect(configRead.data.config.configVersion).toBe(0);
  });

  it("recomputes the current level on demand and keeps the growth view consistent", async () => {
    const { stores, attempts, growth } = bundles();
    const memberId = await register(stores, attempts, growth);
    // 直接改本地点数模拟历史数据：总分 10 但等级仍停在 L1。
    const stats = stores.stats.get(memberId);
    if (stats) stores.stats.set(memberId, { ...stats, totalScore: 10, levelId: "L1" });

    const recomputed = (await handleOfficial(
      adminCtx(req("growth.recompute", { targetMemberId: memberId }), growth, ["super"])
    )) as {
      ok: true;
      data: { configVersion: number; recompute: { recomputed: number; levelChanged: number; medalsGranted: number } };
    };
    expect(recomputed.data.configVersion).toBe(0);
    expect(recomputed.data.recompute).toMatchObject({ recomputed: 1, levelChanged: 1, medalsGranted: 2 });
    expect(stores.stats.get(memberId)?.levelId).toBe("L3");
    expect(stores.medalGrants.size).toBe(3);

    const again = (await handleOfficial(adminCtx(req("growth.recompute", { targetMemberId: memberId }), growth, ["super"]))) as {
      ok: true;
      data: { recompute: { levelChanged: number; medalsGranted: number } };
    };
    expect(again.data.recompute).toMatchObject({ levelChanged: 0, medalsGranted: 0 });
    expect(stores.medalGrants.size).toBe(3);
  });

  it("requires registration for the member growth read and blocks public entry", async () => {
    const { stores, attempts, growth } = bundles();
    const guest = await handleOfficial(memberCtx(req("member.growth"), stores, attempts, growth));
    expect(guest).toMatchObject({ ok: false, error: { code: "MEMBER_REQUIRED" } });

    const viaPublic = await handleOfficial({
      ...memberCtx(req("member.growth"), stores, attempts, growth),
      entry: "mw-public" as const
    });
    expect(viaPublic).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});
