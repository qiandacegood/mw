import {
  auditDocId,
  orderDocId,
  planDocId,
  refundDocId,
  type AuditEntry,
  type CallbackEventRecord,
  type IdempotencyRecord,
  type OrderRecord,
  type PaymentReceiptRecord,
  type ReconcileDiffRecord,
  type RefundRecord,
  type VipChannel,
  type VipPlanRecord
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import {
  ORDER_COLLECTIONS,
  type OrderMutation,
  type OrderSnapshot,
  type OrderWorkStore
} from "./order-stores.js";

function cloudApp() {
  const cloudbase = require("@cloudbase/node-sdk") as {
    init: (opts: { env: unknown }) => { database: () => CloudDb };
    SYMBOL_CURRENT_ENV: unknown;
  };
  return cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
}

type CloudSnap = unknown;
type CloudQuery = {
  where: (query: Record<string, unknown>) => CloudQuery;
  orderBy: (field: string, direction: "asc" | "desc") => CloudQuery;
  limit: (n: number) => CloudQuery;
  get: () => Promise<CloudSnap>;
};
type CloudColl = {
  doc: (id: string) => {
    get: () => Promise<CloudSnap>;
    set: (data: Record<string, unknown>) => Promise<unknown>;
    update: (data: Record<string, unknown>) => Promise<unknown>;
  };
  where?: (query: Record<string, unknown>) => CloudQuery;
};
type CloudDb = {
  collection: (name: string) => CloudColl;
  runTransaction: <T>(fn: (tx: CloudDb) => Promise<T>) => Promise<T>;
};

function unwrapDoc(snap: unknown): Record<string, unknown> | undefined {
  if (!snap || typeof snap !== "object") return undefined;
  const rec = snap as Record<string, unknown>;
  if (rec.data && typeof rec.data === "object" && !Array.isArray(rec.data)) {
    const inner = rec.data as Record<string, unknown>;
    if (Array.isArray(inner.data)) {
      const first = inner.data[0];
      return first && typeof first === "object" ? (first as Record<string, unknown>) : undefined;
    }
    if (Object.keys(inner).length === 0) return undefined;
    return inner;
  }
  if (Array.isArray(rec.data)) {
    const first = rec.data[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : undefined;
  }
  return undefined;
}

function unwrapList(snap: unknown): Record<string, unknown>[] {
  if (!snap || typeof snap !== "object") return [];
  const rec = snap as Record<string, unknown>;
  const data = rec.data;
  if (Array.isArray(data)) return data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  if (data && typeof data === "object") {
    const inner = data as Record<string, unknown>;
    if (Array.isArray(inner.data)) {
      return inner.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    }
  }
  return [];
}

function plain(value: unknown): Record<string, unknown> {
  const rec = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete rec._id;
  return rec;
}

function asPlan(id: string, data: Record<string, unknown>): VipPlanRecord {
  const productIds = data.productIds && typeof data.productIds === "object" && !Array.isArray(data.productIds)
    ? (data.productIds as VipPlanRecord["productIds"])
    : {};
  const channels = Array.isArray(data.channels)
    ? data.channels.filter((item): item is VipChannel => item === "android" || item === "ios" || item === "harmony" || item === "windows")
    : [];
  return {
    planId: typeof data.planId === "string" ? data.planId : id,
    planVersion: typeof data.planVersion === "number" ? data.planVersion : 1,
    title: typeof data.title === "string" ? data.title : "",
    durationDays: typeof data.durationDays === "number" ? data.durationDays : 0,
    durationSeconds: typeof data.durationSeconds === "number" ? data.durationSeconds : 0,
    priceFen: typeof data.priceFen === "number" ? data.priceFen : 0,
    productIds,
    channels,
    enabled: data.enabled === true,
    testOnly: data.testOnly === true,
    sort: typeof data.sort === "number" ? data.sort : 10,
    priceNote: data.priceNote === "PLACEHOLDER_PRICE" ? "PLACEHOLDER_PRICE" : "TEST_PRICE",
    schemaVersion: 1,
    publishedAt: typeof data.publishedAt === "string" ? data.publishedAt : null,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString()
  };
}

function asOrder(id: string, data: Record<string, unknown>): OrderRecord {
  const snap = data.planSnapshot && typeof data.planSnapshot === "object" ? (data.planSnapshot as OrderRecord["planSnapshot"]) : undefined;
  return {
    orderId: typeof data.orderId === "string" ? data.orderId : id,
    channelBizNo: typeof data.channelBizNo === "string" ? data.channelBizNo : "",
    memberId: typeof data.memberId === "string" ? data.memberId : "",
    openId: typeof data.openId === "string" ? data.openId : "",
    planSnapshot: snap || {
      planId: "",
      planVersion: 1,
      title: "",
      durationDays: 0,
      durationSeconds: 0,
      priceFen: 0,
      productId: "",
      channel: "android",
      environment: 1,
      testOnly: true
    },
    amountFen: typeof data.amountFen === "number" ? data.amountFen : 0,
    channel: data.channel === "ios" || data.channel === "harmony" || data.channel === "windows" ? data.channel : "android",
    environment: data.environment === 0 ? 0 : 1,
    payState: (typeof data.payState === "string" ? data.payState : "pending") as OrderRecord["payState"],
    grantState: (typeof data.grantState === "string" ? data.grantState : "pending") as OrderRecord["grantState"],
    refundState: (typeof data.refundState === "string" ? data.refundState : "none") as OrderRecord["refundState"],
    payDeadlineAt: typeof data.payDeadlineAt === "string" ? data.payDeadlineAt : "",
    paidAt: typeof data.paidAt === "string" ? data.paidAt : null,
    grantedAt: typeof data.grantedAt === "string" ? data.grantedAt : null,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
    nextCheckAt: typeof data.nextCheckAt === "string" ? data.nextCheckAt : "",
    lastQueryAt: typeof data.lastQueryAt === "string" ? data.lastQueryAt : null,
    needsReview: data.needsReview === true,
    reviewReason: typeof data.reviewReason === "string" ? data.reviewReason : "",
    goodsNotified: data.goodsNotified === true,
    fixtureLedger: data.fixtureLedger === true,
    schemaVersion: 1
  };
}

function asRefund(id: string, data: Record<string, unknown>): RefundRecord {
  return {
    refundId: typeof data.refundId === "string" ? data.refundId : id,
    channelRefundNo: typeof data.channelRefundNo === "string" ? data.channelRefundNo : "",
    orderId: typeof data.orderId === "string" ? data.orderId : "",
    memberId: typeof data.memberId === "string" ? data.memberId : "",
    requestedFen: typeof data.requestedFen === "number" ? data.requestedFen : 0,
    confirmedFen: typeof data.confirmedFen === "number" ? data.confirmedFen : null,
    state: (typeof data.state === "string" ? data.state : "requested") as RefundRecord["state"],
    kind: (typeof data.kind === "string" ? data.kind : "whole") as RefundRecord["kind"],
    channel: data.channel === "ios" || data.channel === "harmony" || data.channel === "windows" ? data.channel : "android",
    channelRef: typeof data.channelRef === "string" ? data.channelRef : "",
    reason: typeof data.reason === "string" ? data.reason : "",
    reviewAdvice: typeof data.reviewAdvice === "string" ? data.reviewAdvice : "",
    reviewActorId: typeof data.reviewActorId === "string" ? data.reviewActorId : "",
    executeActorId: typeof data.executeActorId === "string" ? data.executeActorId : "",
    unknownResult: data.unknownResult === true,
    appleGuidance: data.appleGuidance === true,
    fixture: data.fixture === true,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
    schemaVersion: 1
  };
}

function asDiff(id: string, data: Record<string, unknown>): ReconcileDiffRecord {
  return {
    diffId: typeof data.diffId === "string" ? data.diffId : id,
    orderId: typeof data.orderId === "string" ? data.orderId : "",
    diffKind: (typeof data.diffKind === "string" ? data.diffKind : "paid_ungranted") as ReconcileDiffRecord["diffKind"],
    status: data.status === "resolved" ? "resolved" : "open",
    localAmountFen: typeof data.localAmountFen === "number" ? data.localAmountFen : 0,
    channelAmountFen: typeof data.channelAmountFen === "number" ? data.channelAmountFen : null,
    localPayState: typeof data.localPayState === "string" ? data.localPayState : "",
    localGrantState: typeof data.localGrantState === "string" ? data.localGrantState : "",
    localRefundState: typeof data.localRefundState === "string" ? data.localRefundState : "",
    note: typeof data.note === "string" ? data.note : "",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : ""
  };
}

function asReceipt(id: string, data: Record<string, unknown>): PaymentReceiptRecord {
  return {
    receiptId: typeof data.receiptId === "string" ? data.receiptId : id,
    orderId: typeof data.orderId === "string" ? data.orderId : "",
    provider: typeof data.provider === "string" ? data.provider : "",
    environment: data.environment === 0 ? 0 : 1,
    transactionId: typeof data.transactionId === "string" ? data.transactionId : "",
    amountFen: typeof data.amountFen === "number" ? data.amountFen : 0,
    verifiedAt: typeof data.verifiedAt === "string" ? data.verifiedAt : "",
    eventDigest: typeof data.eventDigest === "string" ? data.eventDigest : ""
  };
}

function asCallback(id: string, data: Record<string, unknown>): CallbackEventRecord {
  return {
    eventId: typeof data.eventId === "string" ? data.eventId : id,
    provider: typeof data.provider === "string" ? data.provider : "",
    type: typeof data.type === "string" ? data.type : "",
    orderId: typeof data.orderId === "string" ? data.orderId : "",
    payloadDigest: typeof data.payloadDigest === "string" ? data.payloadDigest : "",
    status: (typeof data.status === "string" ? data.status : "received") as CallbackEventRecord["status"],
    createdAt: typeof data.createdAt === "string" ? data.createdAt : ""
  };
}

function asIdem(id: string, data: Record<string, unknown>): IdempotencyRecord {
  return {
    id: typeof data.id === "string" ? data.id : id,
    actorId: typeof data.actorId === "string" ? data.actorId : "",
    action: typeof data.action === "string" ? data.action : "",
    idempotencyKey: typeof data.idempotencyKey === "string" ? data.idempotencyKey : "",
    payloadHash: typeof data.payloadHash === "string" ? data.payloadHash : "",
    status: (typeof data.status === "string" ? data.status : "succeeded") as IdempotencyRecord["status"],
    resultRef: data.resultRef,
    requestId: typeof data.requestId === "string" ? data.requestId : ""
  };
}

async function txGet(db: CloudDb, collection: string, id: string): Promise<Record<string, unknown> | undefined> {
  try {
    return unwrapDoc(await db.collection(collection).doc(id).get());
  } catch {
    return undefined;
  }
}

export function cloudOrderStore(): OrderWorkStore {
  return {
    async getPlan(planId, planVersion) {
      const id = planDocId(planId, planVersion);
      const data = unwrapDoc(await cloudApp().database().collection(ORDER_COLLECTIONS.plans).doc(id).get());
      return data ? asPlan(id, data) : undefined;
    },
    async listPlans() {
      const coll = cloudApp().database().collection(ORDER_COLLECTIONS.plans);
      if (!coll.where) return [];
      const snap = await coll.where({}).limit(100).get();
      return unwrapList(snap).map((row) => asPlan(String(row._id || ""), row));
    },
    async savePlan(plan) {
      const id = planDocId(plan.planId, plan.planVersion);
      await cloudApp().database().collection(ORDER_COLLECTIONS.plans).doc(id).set(plain(plan));
    },
    async getOrder(orderId) {
      const data = unwrapDoc(await cloudApp().database().collection(ORDER_COLLECTIONS.orders).doc(orderId).get());
      return data ? asOrder(orderId, data) : undefined;
    },
    async getOrderByBizNo(channelBizNo) {
      return this.getOrder(orderDocId(channelBizNo));
    },
    async listOrdersByMember(memberId, limit) {
      const coll = cloudApp().database().collection(ORDER_COLLECTIONS.orders);
      if (!coll.where) return [];
      const snap = await coll.where({ memberId }).orderBy("createdAt", "desc").limit(Math.max(1, Math.min(limit, 50))).get();
      return unwrapList(snap).map((row) => asOrder(String(row._id || row.orderId || ""), row));
    },
    async getReceipt(receiptId) {
      const data = unwrapDoc(await cloudApp().database().collection(ORDER_COLLECTIONS.receipts).doc(receiptId).get());
      return data ? asReceipt(receiptId, data) : undefined;
    },
    async getRefund(refundId) {
      const data = unwrapDoc(await cloudApp().database().collection(ORDER_COLLECTIONS.refunds).doc(refundId).get());
      return data ? asRefund(refundId, data) : undefined;
    },
    async getRefundByOrder(orderId) {
      return this.getRefund(refundDocId(orderId));
    },
    async listRefunds(limit) {
      const coll = cloudApp().database().collection(ORDER_COLLECTIONS.refunds);
      if (!coll.where) return [];
      const snap = await coll.where({}).orderBy("updatedAt", "desc").limit(Math.max(1, Math.min(limit, 50))).get();
      return unwrapList(snap).map((row) => asRefund(String(row._id || row.refundId || ""), row));
    },
    async listDiffs(limit) {
      const coll = cloudApp().database().collection(ORDER_COLLECTIONS.diffs);
      if (!coll.where) return [];
      const snap = await coll.where({ status: "open" }).orderBy("updatedAt", "desc").limit(Math.max(1, Math.min(limit, 50))).get();
      return unwrapList(snap).map((row) => asDiff(String(row._id || row.diffId || ""), row));
    },
    async transactOrder<T>(input: {
      orderId: string;
      receiptId?: string;
      callbackId?: string;
      refundId?: string;
      idempotencyId?: string;
      mutate: (snap: OrderSnapshot) => OrderMutation<T>;
    }) {
      const started = Date.now();
      let reads = 0;
      let writes = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        reads += 1;
        const orderData = await txGet(tx, ORDER_COLLECTIONS.orders, input.orderId);
        let receipt: PaymentReceiptRecord | undefined;
        if (input.receiptId) {
          reads += 1;
          const receiptData = await txGet(tx, ORDER_COLLECTIONS.receipts, input.receiptId);
          if (receiptData) receipt = asReceipt(input.receiptId, receiptData);
        }
        let callback: CallbackEventRecord | undefined;
        if (input.callbackId) {
          reads += 1;
          const callbackData = await txGet(tx, ORDER_COLLECTIONS.callbacks, input.callbackId);
          if (callbackData) callback = asCallback(input.callbackId, callbackData);
        }
        let refundRow: RefundRecord | undefined;
        if (input.refundId) {
          reads += 1;
          const refundData = await txGet(tx, ORDER_COLLECTIONS.refunds, input.refundId);
          if (refundData) refundRow = asRefund(input.refundId, refundData);
        }
        let idemRow: IdempotencyRecord | undefined;
        if (input.idempotencyId) {
          reads += 1;
          const idemData = await txGet(tx, ORDER_COLLECTIONS.idempotency, input.idempotencyId);
          if (idemData) idemRow = asIdem(input.idempotencyId, idemData);
        }
        const next = input.mutate({
          order: orderData ? asOrder(input.orderId, orderData) : undefined,
          receipt,
          callback,
          refund: refundRow,
          idem: idemRow
        });
        if (next.error) return next;
        if (next.order) {
          writes += 1;
          await tx.collection(ORDER_COLLECTIONS.orders).doc(next.order.orderId).set(plain(next.order));
        }
        if (next.receipt) {
          writes += 1;
          await tx.collection(ORDER_COLLECTIONS.receipts).doc(next.receipt.receiptId).set(plain(next.receipt));
        }
        if (next.callback) {
          writes += 1;
          await tx.collection(ORDER_COLLECTIONS.callbacks).doc(next.callback.eventId).set(plain(next.callback));
        }
        if (next.refund) {
          writes += 1;
          await tx.collection(ORDER_COLLECTIONS.refunds).doc(next.refund.refundId).set(plain(next.refund));
        }
        if (next.diffs) {
          for (const row of next.diffs) {
            writes += 1;
            await tx.collection(ORDER_COLLECTIONS.diffs).doc(row.diffId).set(plain(row));
          }
        }
        if (next.idem) {
          writes += 1;
          const body = plain(next.idem);
          if (idemRow) await tx.collection(ORDER_COLLECTIONS.idempotency).doc(next.idem.id).update(body);
          else await tx.collection(ORDER_COLLECTIONS.idempotency).doc(next.idem.id).set(body);
        }
        if (next.audit) {
          writes += 1;
          const auditId = auditDocId({
            requestId: next.audit.requestId,
            action: next.audit.action,
            target: next.audit.target
          });
          await tx.collection(ORDER_COLLECTIONS.auditLogs).doc(auditId).set(plain(next.audit));
        }
        return next;
      });
      const budget: TxBudget = { reads, writes, total: reads + writes, elapsedMs: Date.now() - started };
      return { mutation, budget };
    }
  };
}

export type { AuditEntry };
