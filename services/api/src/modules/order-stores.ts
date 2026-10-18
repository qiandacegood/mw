import {
  evaluateVipStatus,
  refundDocId,
  type AuditEntry,
  type IdempotencyRecord,
  type OrderRecord,
  type PaymentReceiptRecord,
  type CallbackEventRecord,
  type RefundRecord,
  type ReconcileDiffRecord,
  type VipPlanRecord,
  planDocId
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { VipWorkStore } from "./vip-stores.js";

export const ORDER_COLLECTIONS = {
  plans: "vip_plans",
  orders: "orders",
  receipts: "payment_receipts",
  callbacks: "callback_events",
  refunds: "refunds",
  diffs: "reconcile_diffs",
  idempotency: "idempotency",
  auditLogs: "audit_logs"
} as const;

export type OrderSnapshot = {
  order?: OrderRecord;
  receipt?: PaymentReceiptRecord;
  callback?: CallbackEventRecord;
  refund?: RefundRecord;
  idem?: IdempotencyRecord;
};

export type OrderMutation<T> = {
  order?: OrderRecord;
  receipt?: PaymentReceiptRecord;
  callback?: CallbackEventRecord;
  refund?: RefundRecord;
  diffs?: ReconcileDiffRecord[];
  idem?: IdempotencyRecord;
  audit?: AuditEntry;
  result: T;
  error?: string;
  replayed?: boolean;
};

export interface OrderWorkStore {
  getPlan(planId: string, planVersion: number): Promise<VipPlanRecord | undefined>;
  listPlans(): Promise<VipPlanRecord[]>;
  savePlan(plan: VipPlanRecord): Promise<void>;
  getOrder(orderId: string): Promise<OrderRecord | undefined>;
  getOrderByBizNo(channelBizNo: string): Promise<OrderRecord | undefined>;
  listOrdersByMember(memberId: string, limit: number): Promise<OrderRecord[]>;
  getReceipt(receiptId: string): Promise<PaymentReceiptRecord | undefined>;
  getRefund(refundId: string): Promise<RefundRecord | undefined>;
  getRefundByOrder(orderId: string): Promise<RefundRecord | undefined>;
  listRefunds(limit: number): Promise<RefundRecord[]>;
  listDiffs(limit: number): Promise<ReconcileDiffRecord[]>;
  transactOrder<T>(input: {
    orderId: string;
    receiptId?: string;
    callbackId?: string;
    refundId?: string;
    idempotencyId?: string;
    mutate: (snap: OrderSnapshot) => OrderMutation<T>;
  }): Promise<{ mutation: OrderMutation<T>; budget: TxBudget }>;
}

export type MemoryOrderBundle = OrderWorkStore & {
  plans: Map<string, VipPlanRecord>;
  orders: Map<string, OrderRecord>;
  receipts: Map<string, PaymentReceiptRecord>;
  callbacks: Map<string, CallbackEventRecord>;
  refunds: Map<string, RefundRecord>;
  diffs: Map<string, ReconcileDiffRecord>;
  idem: Map<string, IdempotencyRecord>;
  audits: AuditEntry[];
};

function clonePlan(row: VipPlanRecord): VipPlanRecord {
  return { ...row, productIds: { ...row.productIds }, channels: [...row.channels] };
}

function cloneOrder(row: OrderRecord): OrderRecord {
  return { ...row, planSnapshot: { ...row.planSnapshot } };
}

function cloneRefund(row: RefundRecord): RefundRecord {
  return { ...row };
}

function cloneDiff(row: ReconcileDiffRecord): ReconcileDiffRecord {
  return { ...row };
}

function emptyBudget(): TxBudget {
  return { reads: 0, writes: 0, total: 0, elapsedMs: 0 };
}

export function memoryOrderStore(): MemoryOrderBundle {
  const plans = new Map<string, VipPlanRecord>();
  const orders = new Map<string, OrderRecord>();
  const receipts = new Map<string, PaymentReceiptRecord>();
  const callbacks = new Map<string, CallbackEventRecord>();
  const refunds = new Map<string, RefundRecord>();
  const diffs = new Map<string, ReconcileDiffRecord>();
  const idem = new Map<string, IdempotencyRecord>();
  const audits: AuditEntry[] = [];
  const locks = new Map<string, Promise<void>>();

  async function withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(
      key,
      prev.then(() => next)
    );
    await prev;
    try {
      return await run();
    } finally {
      release();
    }
  }

  return {
    plans,
    orders,
    receipts,
    callbacks,
    refunds,
    diffs,
    idem,
    audits,
    async getPlan(planId, planVersion) {
      const row = plans.get(planDocId(planId, planVersion));
      return row ? clonePlan(row) : undefined;
    },
    async listPlans() {
      return [...plans.values()].map(clonePlan);
    },
    async savePlan(plan) {
      plans.set(planDocId(plan.planId, plan.planVersion), clonePlan(plan));
    },
    async getOrder(orderId) {
      const row = orders.get(orderId);
      return row ? cloneOrder(row) : undefined;
    },
    async getOrderByBizNo(channelBizNo) {
      const row = [...orders.values()].find((item) => item.channelBizNo === channelBizNo);
      return row ? cloneOrder(row) : undefined;
    },
    async listOrdersByMember(memberId, limit) {
      return [...orders.values()]
        .filter((row) => row.memberId === memberId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.orderId.localeCompare(a.orderId))
        .slice(0, Math.max(1, Math.min(limit, 50)))
        .map(cloneOrder);
    },
    async getReceipt(receiptId) {
      const row = receipts.get(receiptId);
      return row ? { ...row } : undefined;
    },
    async getRefund(refundId) {
      const row = refunds.get(refundId);
      return row ? cloneRefund(row) : undefined;
    },
    async getRefundByOrder(orderId) {
      const row = refunds.get(refundDocId(orderId)) || [...refunds.values()].find((item) => item.orderId === orderId);
      return row ? cloneRefund(row) : undefined;
    },
    async listRefunds(limit) {
      return [...refunds.values()]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.refundId.localeCompare(a.refundId))
        .slice(0, Math.max(1, Math.min(limit, 50)))
        .map(cloneRefund);
    },
    async listDiffs(limit) {
      return [...diffs.values()]
        .filter((row) => row.status === "open")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.diffId.localeCompare(a.diffId))
        .slice(0, Math.max(1, Math.min(limit, 50)))
        .map(cloneDiff);
    },
    async transactOrder(input) {
      return withLock(input.orderId, async () => {
        const started = Date.now();
        let reads = 1;
        const order = orders.get(input.orderId);
        let receipt: PaymentReceiptRecord | undefined;
        if (input.receiptId) {
          reads += 1;
          receipt = receipts.get(input.receiptId);
        }
        let callback: CallbackEventRecord | undefined;
        if (input.callbackId) {
          reads += 1;
          callback = callbacks.get(input.callbackId);
        }
        let refundRow: RefundRecord | undefined;
        if (input.refundId) {
          reads += 1;
          refundRow = refunds.get(input.refundId);
        }
        let idemRow: IdempotencyRecord | undefined;
        if (input.idempotencyId) {
          reads += 1;
          idemRow = idem.get(input.idempotencyId);
        }
        const next = input.mutate({
          order: order ? cloneOrder(order) : undefined,
          receipt: receipt ? { ...receipt } : undefined,
          callback: callback ? { ...callback } : undefined,
          refund: refundRow ? cloneRefund(refundRow) : undefined,
          idem: idemRow ? { ...idemRow } : undefined
        });
        let writes = 0;
        if (!next.error) {
          if (next.order) {
            writes += 1;
            orders.set(next.order.orderId, cloneOrder(next.order));
          }
          if (next.receipt) {
            writes += 1;
            receipts.set(next.receipt.receiptId, { ...next.receipt });
          }
          if (next.callback) {
            writes += 1;
            callbacks.set(next.callback.eventId, { ...next.callback });
          }
          if (next.refund) {
            writes += 1;
            refunds.set(next.refund.refundId, cloneRefund(next.refund));
          }
          if (next.diffs) {
            for (const row of next.diffs) {
              writes += 1;
              diffs.set(row.diffId, cloneDiff(row));
            }
          }
          if (next.idem) {
            writes += 1;
            idem.set(next.idem.id, { ...next.idem });
          }
          if (next.audit) {
            writes += 1;
            audits.push({ ...next.audit });
          }
        }
        const budget: TxBudget = { reads, writes, total: reads + writes, elapsedMs: Date.now() - started };
        return { mutation: next, budget };
      });
    }
  };
}

export function emptyOrderBudget(): TxBudget {
  return emptyBudget();
}

export { evaluateVipStatus };
export type { VipWorkStore };
