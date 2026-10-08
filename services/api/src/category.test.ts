import { describe, expect, it } from "vitest";
import {
  INITIAL_ROOT_NAMES,
  IN_USE_MIGRATION_NOTE,
  PARENT_CHANGE_NOTE,
  fictionalPapersOnEachLevel,
  paperMayHangOnCategory,
  seedCategoryId,
  setMaintenanceGate,
  defaultMaintenanceConfig
} from "@mw/shared";
import { handleOfficial, memoryAdminStore } from "./official.js";
import { memoryCategoryStore, memoryCategoryUsage } from "./modules/category-stores.js";
import { hangablePaperFixture, seedInitialCategories } from "./modules/category.js";
import { memoryMaintenanceStore } from "./modules/job-stores.js";

const allowedAppIds = ["wxmwallowedappid0001"];
const now = new Date("2026-10-09T02:00:00.000Z");
const contentUid = "uid_content_1";
const superUid = "uid_super_1";

function adminStore() {
  return memoryAdminStore([
    { uid: contentUid, roles: ["content"], enabled: true, authVersion: 1 },
    { uid: superUid, roles: ["super"], enabled: true, authVersion: 1 },
    { uid: "uid_ops", roles: ["operations"], enabled: true, authVersion: 1 },
    { uid: "uid_disabled", roles: ["content"], enabled: false, authVersion: 1 }
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

async function call(
  action: string,
  data: Record<string, unknown>,
  options: {
    uid?: string;
    categoryStore: ReturnType<typeof memoryCategoryStore>;
    usage?: ReturnType<typeof memoryCategoryUsage>;
    maintenance?: ReturnType<typeof memoryMaintenanceStore>;
    extra?: Record<string, unknown>;
    entry?: "mw-admin" | "mw-public" | "mw-member";
    fromAppId?: string;
    fromOpenId?: string;
  }
) {
  return handleOfficial({
    entry: options.entry || "mw-admin",
    event: req(action, data, {
      ...(action === "category.tree" || action === "admin.me" ? {} : { idempotencyKey: `key_${action}_${options.extra?.suffix || data.name || data.categoryId || "x"}` }),
      ...options.extra
    }),
    allowedAppIds,
    authUid: options.uid,
    adminStore: adminStore(),
    categoryStore: options.categoryStore,
    categoryUsage: options.usage,
    maintenanceStore: options.maintenance,
    fromAppId: options.fromAppId,
    fromOpenId: options.fromOpenId,
    now
  });
}

describe("MW09 category management", () => {
  it("seeds ten roots once and does not treat names as an enum", async () => {
    const store = memoryCategoryStore();
    const first = await seedInitialCategories({
      store,
      actorId: contentUid,
      requestId: "req_seed_1",
      idempotencyKey: "seed-1",
      now
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.created).toBe(10);
    expect(first.data.seedIds).toHaveLength(10);
    const second = await seedInitialCategories({
      store,
      actorId: contentUid,
      requestId: "req_seed_2",
      idempotencyKey: "seed-2",
      now
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.created).toBe(0);
    const logicId = seedCategoryId("logical");
    const renamed = await call("category.update", {
      categoryId: logicId,
      expectedTreeVersion: first.data.treeVersion,
      name: "逻辑思维·改名"
    }, { uid: contentUid, categoryStore: store, extra: { suffix: "rename-seed" } });
    expect(renamed).toMatchObject({ ok: true, data: { name: "逻辑思维·改名", categoryId: logicId } });
    const third = await seedInitialCategories({
      store,
      actorId: contentUid,
      requestId: "req_seed_3",
      idempotencyKey: "seed-3",
      now
    });
    expect(third.ok).toBe(true);
    const kept = await store.getCategory(logicId);
    expect(kept?.name).toBe("逻辑思维·改名");
    expect(INITIAL_ROOT_NAMES).toContain("逻辑思维");
    expect(kept?.name).not.toBe("逻辑思维");
  });

  it("creates depth 1/2/3 and allows fictional papers to hang on each level", async () => {
    const store = memoryCategoryStore();
    const seeded = await seedInitialCategories({
      store,
      actorId: contentUid,
      requestId: "req_seed_tree",
      idempotencyKey: "seed-tree",
      now
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const parent = seedCategoryId("logical");
    const l2 = await call("category.create", {
      name: "MW09测试二级",
      parentId: parent,
      sort: 10,
      expectedTreeVersion: seeded.data.treeVersion
    }, { uid: contentUid, categoryStore: store, extra: { suffix: "l2" } });
    expect(l2).toMatchObject({ ok: true, data: { depth: 2 } });
    const l2id = (l2 as { data: { categoryId: string; treeVersion: number } }).data.categoryId;
    const l3 = await call("category.create", {
      name: "MW09测试三级",
      parentId: l2id,
      sort: 10,
      expectedTreeVersion: (l2 as { data: { treeVersion: number } }).data.treeVersion
    }, { uid: contentUid, categoryStore: store, extra: { suffix: "l3" } });
    expect(l3).toMatchObject({ ok: true, data: { depth: 3 } });
    const active = await store.listActive();
    const hang = hangablePaperFixture(active);
    expect(hang.ok).toBe(true);
    if (!hang.ok) return;
    for (const paper of hang.papers) {
      const node = active.find((row) => row.categoryId === paper.categoryId);
      expect(node).toBeTruthy();
      expect(paperMayHangOnCategory(node!)).toBe(true);
    }
    const fixture = fictionalPapersOnEachLevel({
      depth1: parent,
      depth2: l2id,
      depth3: (l3 as { data: { categoryId: string } }).data.categoryId
    });
    expect(fixture).toHaveLength(3);
  });

  it("rejects fourth level, missing parent, duplicate names and unknown fields", async () => {
    const store = memoryCategoryStore();
    const seeded = await seedInitialCategories({
      store,
      actorId: contentUid,
      requestId: "req_seed_deny",
      idempotencyKey: "seed-deny",
      now
    });
    if (!seeded.ok) return;
    const parent = seedCategoryId("logical");
    const l2 = await call("category.create", {
      name: "MW09拒二级",
      parentId: parent,
      expectedTreeVersion: seeded.data.treeVersion
    }, { uid: contentUid, categoryStore: store, extra: { suffix: "deny-l2" } });
    const l2id = (l2 as { data: { categoryId: string; treeVersion: number } }).data.categoryId;
    const l3 = await call("category.create", {
      name: "MW09拒三级",
      parentId: l2id,
      expectedTreeVersion: (l2 as { data: { treeVersion: number } }).data.treeVersion
    }, { uid: contentUid, categoryStore: store, extra: { suffix: "deny-l3" } });
    const fourth = await call("category.create", {
      name: "第四级反例",
      parentId: (l3 as { data: { categoryId: string } }).data.categoryId,
      expectedTreeVersion: (l3 as { data: { treeVersion: number } }).data.treeVersion
    }, { uid: contentUid, categoryStore: store, extra: { suffix: "deny-l4" } });
    expect(fourth).toMatchObject({ ok: false, error: { code: "CATEGORY_DEPTH_LIMIT" } });
    const missing = await call("category.create", {
      name: "缺父",
      parentId: "missing-parent",
      expectedTreeVersion: (l3 as { data: { treeVersion: number } }).data.treeVersion
    }, { uid: contentUid, categoryStore: store, extra: { suffix: "missing" } });
    expect(missing).toMatchObject({ ok: false, error: { details: { reason: "PARENT_MISSING" } } });
    const dup = await call("category.create", {
      name: "MW09拒二级",
      parentId: parent,
      expectedTreeVersion: (l3 as { data: { treeVersion: number } }).data.treeVersion
    }, { uid: contentUid, categoryStore: store, extra: { suffix: "dup" } });
    expect(dup).toMatchObject({ ok: false, error: { details: { reason: "NAME_CONFLICT" } } });
    const unknown = await call("category.create", {
      name: "未知字段",
      expectedTreeVersion: (l3 as { data: { treeVersion: number } }).data.treeVersion,
      ancestorIds: ["x"],
      depth: 1
    }, { uid: contentUid, categoryStore: store, extra: { suffix: "unknown" } });
    expect(unknown).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  });

  it("renames, sorts, disables and enables, and reflects descendant visibility", async () => {
    const store = memoryCategoryStore();
    const seeded = await seedInitialCategories({
      store,
      actorId: superUid,
      requestId: "req_seed_upd",
      idempotencyKey: "seed-upd",
      now
    });
    if (!seeded.ok) return;
    const parent = seedCategoryId("reverse");
    const child = await call("category.create", {
      name: "MW09启停子",
      parentId: parent,
      expectedTreeVersion: seeded.data.treeVersion
    }, { uid: superUid, categoryStore: store, extra: { suffix: "child" } });
    const childId = (child as { data: { categoryId: string; treeVersion: number } }).data.categoryId;
    const renamed = await call("category.update", {
      categoryId: childId,
      expectedTreeVersion: (child as { data: { treeVersion: number } }).data.treeVersion,
      name: "MW09启停子-改名",
      sort: 30
    }, { uid: superUid, categoryStore: store, extra: { suffix: "rename" } });
    expect(renamed).toMatchObject({ ok: true, data: { name: "MW09启停子-改名", sort: 30 } });
    const disabled = await call("category.update", {
      categoryId: parent,
      expectedTreeVersion: (renamed as { data: { treeVersion: number } }).data.treeVersion,
      enabled: false
    }, { uid: superUid, categoryStore: store, extra: { suffix: "off" } });
    expect(disabled).toMatchObject({ ok: true, data: { enabled: false } });
    const publicTree = await call("category.tree", {}, { entry: "mw-public", categoryStore: store });
    const publicNodes = (publicTree as { data: { nodes: { id: string }[] } }).data.nodes;
    expect(publicNodes.some((row) => row.id === parent)).toBe(false);
    expect(publicNodes.some((row) => row.id === childId)).toBe(false);
    const enabled = await call("category.update", {
      categoryId: parent,
      expectedTreeVersion: (disabled as { data: { treeVersion: number } }).data.treeVersion,
      enabled: true
    }, { uid: superUid, categoryStore: store, extra: { suffix: "on" } });
    expect(enabled).toMatchObject({ ok: true, data: { enabled: true } });
  });

  it("logically deletes unused nodes and refuses occupied ones without changing the tree", async () => {
    const store = memoryCategoryStore();
    const usage = memoryCategoryUsage();
    const seeded = await seedInitialCategories({
      store,
      actorId: contentUid,
      requestId: "req_seed_del",
      idempotencyKey: "seed-del",
      now
    });
    if (!seeded.ok) return;
    const parent = seedCategoryId("game");
    const child = await call("category.create", {
      name: "MW09占用子",
      parentId: parent,
      expectedTreeVersion: seeded.data.treeVersion
    }, { uid: contentUid, categoryStore: store, extra: { suffix: "occ-child" } });
    const childId = (child as { data: { categoryId: string; treeVersion: number } }).data.categoryId;
    const occupied = await call("category.delete", {
      categoryId: parent,
      expectedTreeVersion: (child as { data: { treeVersion: number } }).data.treeVersion
    }, { uid: contentUid, categoryStore: store, usage, extra: { suffix: "occ-parent" } });
    expect(occupied).toMatchObject({
      ok: false,
      error: { code: "CATEGORY_IN_USE", details: { note: IN_USE_MIGRATION_NOTE, hasChildren: true } }
    });
    expect((await store.getCategory(parent))?.deletedAt).toBeNull();
    usage.setPaperRefs(childId, ["paper_fict_logic_l3"]);
    const paperUsed = await call("category.delete", {
      categoryId: childId,
      expectedTreeVersion: (child as { data: { treeVersion: number } }).data.treeVersion
    }, { uid: contentUid, categoryStore: store, usage, extra: { suffix: "occ-paper" } });
    expect(paperUsed).toMatchObject({ ok: false, error: { code: "CATEGORY_IN_USE" } });
    expect((await store.getCategory(childId))?.deletedAt).toBeNull();
    usage.setPaperRefs(childId, []);
    const deleted = await call("category.delete", {
      categoryId: childId,
      expectedTreeVersion: (child as { data: { treeVersion: number } }).data.treeVersion
    }, { uid: contentUid, categoryStore: store, usage, extra: { suffix: "free-child" } });
    expect(deleted).toMatchObject({ ok: true });
    expect((await store.getCategory(childId))?.deletedAt).toBeTruthy();
    const recreate = await call("category.create", {
      name: "MW09占用子",
      parentId: parent,
      expectedTreeVersion: (deleted as { data: { treeVersion: number } }).data.treeVersion
    }, { uid: contentUid, categoryStore: store, extra: { suffix: "recreate" } });
    expect(recreate).toMatchObject({ ok: true });
    expect((recreate as { data: { categoryId: string } }).data.categoryId).not.toBe(childId);
  });

  it("rejects parent changes on update and defers preview/commit to MW18", async () => {
    const store = memoryCategoryStore();
    const seeded = await seedInitialCategories({
      store,
      actorId: contentUid,
      requestId: "req_seed_mv",
      idempotencyKey: "seed-mv",
      now
    });
    if (!seeded.ok) return;
    const moved = await call("category.update", {
      categoryId: seedCategoryId("open"),
      expectedTreeVersion: seeded.data.treeVersion,
      parentId: seedCategoryId("logical"),
      name: "不应改父"
    }, { uid: contentUid, categoryStore: store, extra: { suffix: "move" } });
    expect(moved).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT", details: { reason: "PARENT_CHANGE_REQUIRES_MW18" } }
    });
    const preview = await call("category.change.preview", { expectedTreeVersion: 1 }, {
      uid: contentUid,
      categoryStore: store,
      extra: { suffix: "preview" }
    });
    expect(preview).toMatchObject({
      ok: false,
      error: { details: { reason: "PARENT_CHANGE_REQUIRES_MW18", note: PARENT_CHANGE_NOTE } }
    });
  });

  it("fails closed for missing login, forged admin and ordinary member writes", async () => {
    const store = memoryCategoryStore();
    const noLogin = await call("category.create", { name: "x", expectedTreeVersion: 0 }, {
      categoryStore: store,
      extra: { suffix: "nologin" }
    });
    expect(noLogin).toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });
    const forged = await call("category.create", { name: "x", expectedTreeVersion: 0, role: "super" }, {
      uid: contentUid,
      categoryStore: store,
      extra: { suffix: "forged" }
    });
    expect(forged).toMatchObject({ ok: false, error: { details: { reason: "CLIENT_IDENTITY_IGNORED" } } });
    const ops = await call("category.create", { name: "x", expectedTreeVersion: 0 }, {
      uid: "uid_ops",
      categoryStore: store,
      extra: { suffix: "ops" }
    });
    expect(ops).toMatchObject({ ok: false, error: { details: { reason: "CONTENT_ROLE_REQUIRED" } } });
    const member = await call("category.create", { name: "x", expectedTreeVersion: 0 }, {
      entry: "mw-member",
      categoryStore: store,
      fromAppId: allowedAppIds[0],
      fromOpenId: "member_openid",
      extra: { suffix: "member" }
    });
    expect(member).toMatchObject({ ok: false, error: { details: { reason: "ACTION_DENIED" } } });
  });

  it("does not let other maintenance gates block category reads; contentWrites blocks writes", async () => {
    const store = memoryCategoryStore();
    await seedInitialCategories({
      store,
      actorId: contentUid,
      requestId: "req_seed_mnt",
      idempotencyKey: "seed-mnt",
      now
    });
    const maintenance = memoryMaintenanceStore(
      setMaintenanceGate(defaultMaintenanceConfig(now), "attemptStart", { enabled: false, reason: "quiz pause", jobId: "job_x" }, now)
    );
    const tree = await call("category.tree", {}, { uid: contentUid, categoryStore: store, maintenance });
    expect(tree).toMatchObject({ ok: true });
    const closedWrites = memoryMaintenanceStore(
      setMaintenanceGate(defaultMaintenanceConfig(now), "contentWrites", { enabled: false, reason: "catalog pause", jobId: "job_y" }, now)
    );
    const write = await call("category.create", { name: "维护中", expectedTreeVersion: 1 }, {
      uid: contentUid,
      categoryStore: store,
      maintenance: closedWrites,
      extra: { suffix: "mnt-write" }
    });
    expect(write).toMatchObject({ ok: false, error: { code: "CONTENT_UPDATING" } });
  });
});
