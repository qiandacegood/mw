import { describe, expect, it } from "vitest";
import {
  CATALOG_CHANGE_DRAIN_MS,
  defaultMaintenanceConfig,
  PARENT_CHANGE_NOTE,
  seedCategoryId
} from "@mw/shared";
import { handleOfficial, memoryAdminStore } from "./official.js";
import { memoryCategoryStore } from "./modules/category-stores.js";
import { memoryCatalogChangeStore } from "./modules/category-change-stores.js";
import { memoryJobStore, memoryMaintenanceStore } from "./modules/job-stores.js";
import { memoryRankingStore } from "./modules/ranking-stores.js";
import { seedInitialCategories } from "./modules/category.js";
import { processDueCatalogJobs } from "./modules/category-change-job.js";
import { signJobsInvoke } from "@mw/shared";

const allowedAppIds = ["wxmwallowedappid0001"];
const now = new Date("2026-10-15T02:00:00.000Z");
const superUid = "uid_super_1";
const contentUid = "uid_content_1";
const secret = "mw18-test-secret";

function adminStore() {
  return memoryAdminStore([
    { uid: superUid, roles: ["super"], enabled: true, authVersion: 1 },
    { uid: contentUid, roles: ["content"], enabled: true, authVersion: 1 }
  ]);
}

function req(action: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    apiVersion: "1",
    action,
    requestId: `req_${action}_${JSON.stringify(data).length}`,
    data,
    ...extra
  };
}

async function harness() {
  const categoryStore = memoryCategoryStore();
  const seeded = await seedInitialCategories({
    store: categoryStore,
    actorId: contentUid,
    requestId: "req_seed",
    idempotencyKey: "seed",
    now
  });
  if (!seeded.ok) throw new Error("seed failed");
  const created = await handleOfficial({
    entry: "mw-admin",
    event: req(
      "category.create",
      { name: "MW18子", parentId: seedCategoryId("logical"), expectedTreeVersion: seeded.data.treeVersion },
      { idempotencyKey: "create-child" }
    ),
    allowedAppIds,
    authUid: contentUid,
    adminStore: adminStore(),
    categoryStore,
    now
  }) as { data: { categoryId: string; treeVersion: number } };
  const maintenance = memoryMaintenanceStore(defaultMaintenanceConfig(now));
  const change = memoryCatalogChangeStore({
    catalog: await categoryStore.getCatalog(),
    maintenance: await maintenance.get()
  });
  const jobStore = memoryJobStore();
  const ranking = memoryRankingStore();
  ranking.seedCategory({
    categoryId: seedCategoryId("logical"),
    parentId: null,
    ancestorIds: [],
    enabled: true,
    deletedAt: null
  });
  return { categoryStore, change, jobStore, maintenance, ranking, treeVersion: created.data.treeVersion, childId: created.data.categoryId };
}

async function adminCall(
  action: string,
  data: Record<string, unknown>,
  ctx: Awaited<ReturnType<typeof harness>>,
  extra: { uid?: string; suffix?: string; now?: Date } = {}
) {
  return handleOfficial({
    entry: "mw-admin",
    event: req(action, data, action === "category.change.status" ? {} : { idempotencyKey: `mw18/${action}/${extra.suffix || "1"}` }),
    allowedAppIds,
    authUid: extra.uid || superUid,
    adminStore: adminStore(),
    categoryStore: ctx.categoryStore,
    catalogChangeStore: ctx.change,
    jobStore: ctx.jobStore,
    maintenanceStore: ctx.maintenance,
    rankingStore: ctx.ranking,
    now: extra.now || now
  });
}

describe("MW18 category.change", () => {
  it("rejects parentId on update and requires super for preview", async () => {
    const ctx = await harness();
    const moved = await adminCall(
      "category.update",
      { categoryId: ctx.childId, expectedTreeVersion: ctx.treeVersion, parentId: seedCategoryId("game"), name: "x" },
      ctx,
      { uid: contentUid, suffix: "upd" }
    );
    expect(moved).toMatchObject({
      ok: false,
      error: { details: { reason: "PARENT_CHANGE_REQUIRES_MW18" } }
    });
    expect((moved as { error?: { details?: { note?: string } } }).error?.details?.note).toBe(PARENT_CHANGE_NOTE);
    const preview = await adminCall(
      "category.change.preview",
      {
        expectedTreeVersion: ctx.treeVersion,
        operations: [{ type: "move", categoryId: ctx.childId, parentId: seedCategoryId("game") }]
      },
      ctx,
      { uid: contentUid, suffix: "prev-content" }
    );
    expect(preview).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("previews a legal move, rejects expired preview, and does not advance before 35s", async () => {
    const ctx = await harness();
    const preview = (await adminCall(
      "category.change.preview",
      {
        expectedTreeVersion: ctx.treeVersion,
        operations: [{ type: "move", categoryId: ctx.childId, parentId: seedCategoryId("game") }]
      },
      ctx,
      { suffix: "prev" }
    )) as { ok: boolean; data: { previewId: string; planHash: string; expiresAt: string } };
    expect(preview.ok).toBe(true);
    expect(preview.data.planHash).toBeTruthy();

    const expired = await adminCall(
      "category.change.commit",
      { previewId: preview.data.previewId, planHash: preview.data.planHash, reason: "late", confirmed: true },
      ctx,
      { suffix: "expired", now: new Date(now.getTime() + 11 * 60 * 1000) }
    );
    expect(expired).toMatchObject({ ok: false, error: { details: { reason: "PREVIEW_EXPIRED" } } });

    const preview2 = (await adminCall(
      "category.change.preview",
      {
        expectedTreeVersion: ctx.treeVersion,
        operations: [{ type: "move", categoryId: ctx.childId, parentId: seedCategoryId("game") }]
      },
      ctx,
      { suffix: "prev2" }
    )) as { ok: boolean; data: { previewId: string; planHash: string } };
    const committed = (await adminCall(
      "category.change.commit",
      { previewId: preview2.data.previewId, planHash: preview2.data.planHash, reason: "move subtree", confirmed: true },
      ctx,
      { suffix: "commit" }
    )) as { ok: boolean; data: { jobId: string; notBefore: string; nextRunAt: string } };
    expect(committed.ok).toBe(true);
    expect(Date.parse(committed.data.notBefore) - now.getTime()).toBe(CATALOG_CHANGE_DRAIN_MS);

    const hidden = await handleOfficial({
      entry: "mw-public",
      event: req("category.tree", {}),
      allowedAppIds,
      categoryStore: ctx.categoryStore,
      now
    });
    expect(hidden).toMatchObject({ ok: true, data: { updating: true, nodes: [] } });

    const early = await processDueCatalogJobs({
      jobStore: ctx.jobStore,
      change: ctx.change,
      category: ctx.categoryStore,
      maintenance: ctx.maintenance,
      ranking: ctx.ranking,
      now,
      requestId: "tick-early"
    });
    expect(early.processed[0]?.reason === "DRAIN_PENDING" || early.processed.length === 0).toBe(true);

    const later = new Date(now.getTime() + CATALOG_CHANGE_DRAIN_MS);
    const advanced = await processDueCatalogJobs({
      jobStore: ctx.jobStore,
      change: ctx.change,
      category: ctx.categoryStore,
      maintenance: ctx.maintenance,
      ranking: ctx.ranking,
      now: later,
      requestId: "tick-ready"
    });
    expect(advanced.processed.some((row) => row.ok)).toBe(true);
  });

  it("refuses delete while papers remain and accepts relocate-then-delete", async () => {
    const ctx = await harness();
    ctx.change.seedPaper({ id: "paper_mw18", title: "专用卷", categoryId: ctx.childId });
    const blocked = await adminCall(
      "category.change.preview",
      { expectedTreeVersion: ctx.treeVersion, operations: [{ type: "delete", categoryId: ctx.childId }] },
      ctx,
      { suffix: "del-block" }
    );
    expect(blocked).toMatchObject({ ok: false, error: { code: "CATEGORY_IN_USE" } });

    const dest = seedCategoryId("game");
    const preview = (await adminCall(
      "category.change.preview",
      {
        expectedTreeVersion: ctx.treeVersion,
        operations: [
          { type: "relocatePapers", fromCategoryId: ctx.childId, toCategoryId: dest },
          { type: "delete", categoryId: ctx.childId }
        ]
      },
      ctx,
      { suffix: "del-ok" }
    )) as { ok: boolean; data: { relocatedPapers: unknown[] } };
    expect(preview.ok).toBe(true);
    expect(preview.data.relocatedPapers).toHaveLength(1);
  });

  it("jobs.tick is the normal scheduler and unsigned timer stays denied", async () => {
    const ctx = await harness();
    const forged = await handleOfficial({
      entry: "mw-jobs",
      event: { Type: "Timer", TriggerName: "mw-jobs-tick" },
      allowedAppIds,
      jobsSecret: secret,
      jobStore: ctx.jobStore,
      catalogChangeStore: ctx.change,
      categoryStore: ctx.categoryStore,
      maintenanceStore: ctx.maintenance,
      now
    });
    expect(forged).toMatchObject({ ok: false, reason: "FORGED_TIMER_DENIED" });

    const signed = await handleOfficial({
      entry: "mw-jobs",
      event: {
        serverInvoke: signJobsInvoke(secret, {
          action: "jobs.tick",
          issuedAt: now.toISOString(),
          nonce: "tick-1"
        })
      },
      allowedAppIds,
      jobsSecret: secret,
      jobStore: ctx.jobStore,
      catalogChangeStore: ctx.change,
      categoryStore: ctx.categoryStore,
      maintenanceStore: ctx.maintenance,
      rankingStore: ctx.ranking,
      now
    });
    expect(signed).toMatchObject({ ok: true, reason: "JOBS_TICK" });
  });
});
