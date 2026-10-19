import { OPS_STATS_SCAN_BUDGET, OPS_STATS_SCAN_LIMIT } from "@mw/shared";
import { MW08_COLLECTIONS } from "./cloud-member-stores.js";
import { MW14_COLLECTIONS } from "./cloud-attempt-stores.js";
import { VIP_COLLECTIONS } from "./vip-stores.js";
import { ORDER_COLLECTIONS } from "./order-stores.js";
import { FEEDBACK_COLLECTION } from "./feedback-stores.js";
import { OPS_STATS_SNAPSHOT_COLLECTION, type OpsStatsStore } from "./ops-stats.js";

function cloudApp() {
  const cloudbase = require("@cloudbase/node-sdk") as {
    init: (opts: { env: unknown }) => { database: () => CloudDb };
    SYMBOL_CURRENT_ENV: unknown;
  };
  return cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
}

type CloudQuery = {
  where?: (query: Record<string, unknown>) => CloudQuery;
  orderBy?: (field: string, direction: "asc" | "desc") => CloudQuery;
  skip?: (n: number) => CloudQuery;
  limit: (n: number) => CloudQuery;
  get: () => Promise<unknown>;
};
type CloudColl = {
  doc: (id: string) => {
    get: () => Promise<unknown>;
    set: (data: Record<string, unknown>) => Promise<unknown>;
  };
  where?: (query: Record<string, unknown>) => CloudQuery;
};
type CloudDb = {
  collection: (name: string) => CloudColl;
  command?: { gt: (value: unknown) => unknown };
};

function docsFromGet(snap: unknown): Record<string, unknown>[] {
  if (!snap || typeof snap !== "object") return [];
  const rec = snap as Record<string, unknown>;
  if (Array.isArray(rec.data)) {
    return rec.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (rec.data && typeof rec.data === "object") {
    const inner = rec.data as Record<string, unknown>;
    if (Array.isArray(inner.data)) {
      return inner.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    }
  }
  return [];
}

async function listDocs(collection: string, query: Record<string, unknown>, limit: number): Promise<Record<string, unknown>[]> {
  const max = Math.max(1, Math.min(limit, OPS_STATS_SCAN_BUDGET));
  const db = cloudApp().database();
  const coll = db.collection(collection);
  if (!coll.where) return [];
  const out: Record<string, unknown>[] = [];
  let lastId = "";
  const gt = db.command?.gt;
  while (out.length < max) {
    const take = Math.min(OPS_STATS_SCAN_LIMIT, max - out.length);
    const pageQuery: Record<string, unknown> = { ...query };
    if (lastId && gt) pageQuery._id = gt(lastId);
    let cursor: CloudQuery = coll.where(pageQuery);
    if (cursor.orderBy) cursor = cursor.orderBy("_id", "asc");
    else if (lastId && cursor.skip) cursor = cursor.skip(out.length);
    const snap = await cursor.limit(take).get();
    const rows = docsFromGet(snap);
    if (!rows.length) break;
    out.push(...rows);
    lastId = String(rows[rows.length - 1]?._id || "");
    if (!lastId || rows.length < take) break;
    if (!gt && out.length >= 1000) break;
  }
  return out;
}

export function cloudOpsStatsStore(): OpsStatsStore {
  return {
    async listMembers(limit) {
      const rows = await listDocs(MW08_COLLECTIONS.members, {}, limit);
      return rows.map((row) => ({
        memberId: String(row.memberId || row._id || ""),
        status: String(row.status || "")
      }));
    },
    async listSubmittedAttempts(limit) {
      const rows = await listDocs(MW14_COLLECTIONS.attempts, { state: "submitted" }, limit);
      return rows.map((row) => ({
        attemptId: String(row.attemptId || row._id || ""),
        memberId: String(row.memberId || ""),
        paperId: String(row.paperId || ""),
        paperTitle: typeof row.paperTitle === "string" ? row.paperTitle : undefined,
        score: typeof row.score === "number" ? row.score : null,
        state: String(row.state || ""),
        submittedAt: String(row.submittedAt || "")
      }));
    },
    async listVipAccounts(limit) {
      const rows = await listDocs(VIP_COLLECTIONS.accounts, {}, limit);
      return rows.map((row) => ({
        memberId: String(row.memberId || row._id || ""),
        expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : null
      }));
    },
    async listOrders(limit) {
      const rows = await listDocs(ORDER_COLLECTIONS.orders, {}, limit);
      return rows.map((row) => ({
        orderId: String(row.orderId || row._id || ""),
        payState: String(row.payState || ""),
        grantState: String(row.grantState || ""),
        amountFen: typeof row.amountFen === "number" ? row.amountFen : 0
      }));
    },
    async listRefunds(limit) {
      const rows = await listDocs(ORDER_COLLECTIONS.refunds, {}, limit);
      return rows.map((row) => ({
        refundId: String(row.refundId || row._id || ""),
        orderId: String(row.orderId || ""),
        state: String(row.state || ""),
        confirmedFen: typeof row.confirmedFen === "number" ? row.confirmedFen : null
      }));
    },
    async listOpenDiffs(limit) {
      const rows = await listDocs(ORDER_COLLECTIONS.diffs, { status: "open" }, limit);
      return rows.map((row) => ({
        diffId: String(row.diffId || row._id || ""),
        orderId: String(row.orderId || ""),
        diffKind: String(row.diffKind || ""),
        status: String(row.status || "")
      }));
    },
    async listOpenFeedbacks(limit) {
      const rows = await listDocs(FEEDBACK_COLLECTION, { status: "open" }, limit);
      return rows.map((row) => ({
        feedbackId: String(row.feedbackId || row._id || ""),
        status: String(row.status || "")
      }));
    },
    async saveSnapshot(id, payload) {
      if (Object.prototype.hasOwnProperty.call(payload, "_id")) {
        throw new Error("SNAPSHOT_ID_IN_PAYLOAD");
      }
      await cloudApp().database().collection(OPS_STATS_SNAPSHOT_COLLECTION).doc(id).set(payload);
    }
  };
}
