import {
  auditDocId,
  evaluateVipStatus,
  type AuditEntry,
  type IdempotencyRecord,
  type VipAccountRecord,
  type VipEventRecord,
  type VipGrantRecord,
  type VipReconcileState,
  type VipSourceType
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import {
  VIP_COLLECTIONS,
  type VipLedgerMutation,
  type VipLedgerSnapshot,
  type VipWorkStore
} from "./vip-stores.js";

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

function asIso(value: unknown, fallback: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return fallback;
}

export function asVipAccount(id: string, data: Record<string, unknown>): VipAccountRecord {
  const now = new Date().toISOString();
  const grantIds = Array.isArray(data.grantIds) ? data.grantIds.filter((item): item is string => typeof item === "string") : [];
  return {
    memberId: typeof data.memberId === "string" ? data.memberId : id,
    expiresAt: typeof data.expiresAt === "string" && data.expiresAt ? data.expiresAt : null,
    remainingSeconds: typeof data.remainingSeconds === "number" ? data.remainingSeconds : 0,
    settledAt: typeof data.settledAt === "string" && data.settledAt ? data.settledAt : null,
    grantIds,
    revision: typeof data.revision === "number" ? data.revision : 0,
    queueVersion: typeof data.queueVersion === "number" ? data.queueVersion : 0,
    reconcileState: (typeof data.reconcileState === "string" ? data.reconcileState : "idle") as VipReconcileState,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    updatedAt: asIso(data.updatedAt, now)
  };
}

export function asVipGrant(id: string, data: Record<string, unknown>): VipGrantRecord {
  return {
    grantId: typeof data.grantId === "string" ? data.grantId : id,
    memberId: typeof data.memberId === "string" ? data.memberId : "",
    sourceType: (data.sourceType === "order" ? "order" : "gift") as VipSourceType,
    sourceId: typeof data.sourceId === "string" ? data.sourceId : "",
    grantedSeconds: typeof data.grantedSeconds === "number" ? data.grantedSeconds : 0,
    remainingSeconds: typeof data.remainingSeconds === "number" ? data.remainingSeconds : 0,
    consumedSeconds: typeof data.consumedSeconds === "number" ? data.consumedSeconds : 0,
    revokedSeconds: typeof data.revokedSeconds === "number" ? data.revokedSeconds : 0,
    sequence: typeof data.sequence === "number" ? data.sequence : 0,
    grantedAt: asIso(data.grantedAt, new Date().toISOString()),
    reason: typeof data.reason === "string" ? data.reason : "",
    actorId: typeof data.actorId === "string" ? data.actorId : "",
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1
  };
}

function accountWrite(row: VipAccountRecord): Record<string, unknown> {
  return {
    memberId: row.memberId,
    expiresAt: row.expiresAt,
    remainingSeconds: row.remainingSeconds,
    settledAt: row.settledAt,
    grantIds: [...row.grantIds],
    revision: row.revision,
    queueVersion: row.queueVersion,
    reconcileState: row.reconcileState,
    schemaVersion: row.schemaVersion,
    updatedAt: row.updatedAt
  };
}

function grantWrite(row: VipGrantRecord): Record<string, unknown> {
  return {
    grantId: row.grantId,
    memberId: row.memberId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    grantedSeconds: row.grantedSeconds,
    remainingSeconds: row.remainingSeconds,
    consumedSeconds: row.consumedSeconds,
    revokedSeconds: row.revokedSeconds,
    sequence: row.sequence,
    grantedAt: row.grantedAt,
    reason: row.reason,
    actorId: row.actorId,
    schemaVersion: row.schemaVersion
  };
}

function eventWrite(row: VipEventRecord): Record<string, unknown> {
  return {
    eventId: row.eventId,
    memberId: row.memberId,
    sourceId: row.sourceId,
    type: row.type,
    effectiveAt: row.effectiveAt,
    seconds: row.seconds,
    accountRevision: row.accountRevision
  };
}

function idemWrite(row: IdempotencyRecord): Record<string, unknown> {
  return {
    id: row.id,
    actorId: row.actorId,
    action: row.action,
    idempotencyKey: row.idempotencyKey,
    payloadHash: row.payloadHash,
    status: row.status,
    resultRef: row.resultRef,
    requestId: row.requestId
  };
}

function auditWrite(row: AuditEntry): Record<string, unknown> {
  return { ...row };
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

export function cloudVipStore(): VipWorkStore {
  return {
    async getAccount(memberId) {
      const snap = await cloudApp().database().collection(VIP_COLLECTIONS.accounts).doc(memberId).get();
      const data = unwrapDoc(snap);
      return data ? asVipAccount(memberId, data) : undefined;
    },
    async listGrants(memberId) {
      const coll = cloudApp().database().collection(VIP_COLLECTIONS.grants);
      if (!coll.where) return [];
      const snap = await coll.where({ memberId }).orderBy("sequence", "asc").limit(100).get();
      return unwrapList(snap).map((row) => asVipGrant(String(row._id || row.grantId || ""), row));
    },
    async evaluate(memberId, now) {
      const account = await this.getAccount(memberId);
      const grants = await this.listGrants(memberId);
      return evaluateVipStatus({ account, grants, now });
    },
    async transactLedger<T>(input: {
      memberId: string;
      grantIds: string[];
      idempotencyId?: string;
      mutate: (snap: VipLedgerSnapshot) => VipLedgerMutation<T>;
    }) {
      const started = Date.now();
      let reads = 0;
      let writes = 0;
      const db = cloudApp().database();
      const mutation = await db.runTransaction(async (tx) => {
        reads += 1;
        const accountData = await txGet(tx, VIP_COLLECTIONS.accounts, input.memberId);
        const grantRows: VipGrantRecord[] = [];
        for (const grantId of input.grantIds) {
          reads += 1;
          const grantData = await txGet(tx, VIP_COLLECTIONS.grants, grantId);
          if (grantData) grantRows.push(asVipGrant(grantId, grantData));
        }
        let idemRow: IdempotencyRecord | undefined;
        if (input.idempotencyId) {
          reads += 1;
          const idemData = await txGet(tx, VIP_COLLECTIONS.idempotency, input.idempotencyId);
          if (idemData) idemRow = asIdem(input.idempotencyId, idemData);
        }
        const next = input.mutate({
          account: accountData ? asVipAccount(input.memberId, accountData) : undefined,
          grants: grantRows,
          idem: idemRow
        });
        if (next.error) return next;
        if (next.account) {
          writes += 1;
          await tx.collection(VIP_COLLECTIONS.accounts).doc(next.account.memberId).set(plain(accountWrite(next.account)));
        }
        for (const row of next.grants || []) {
          writes += 1;
          await tx.collection(VIP_COLLECTIONS.grants).doc(row.grantId).set(plain(grantWrite(row)));
        }
        for (const row of next.events || []) {
          writes += 1;
          await tx.collection(VIP_COLLECTIONS.events).doc(row.eventId).set(plain(eventWrite(row)));
        }
        if (next.idem) {
          writes += 1;
          const body = plain(idemWrite(next.idem));
          if (idemRow) {
            await tx.collection(VIP_COLLECTIONS.idempotency).doc(next.idem.id).update(body);
          } else {
            await tx.collection(VIP_COLLECTIONS.idempotency).doc(next.idem.id).set(body);
          }
        }
        if (next.audit) {
          writes += 1;
          const auditId = auditDocId({
            requestId: next.audit.requestId,
            action: next.audit.action,
            target: next.audit.target
          });
          await tx.collection(VIP_COLLECTIONS.auditLogs).doc(auditId).set(plain(auditWrite(next.audit)));
        }
        return next;
      });
      const budget: TxBudget = { reads, writes, total: reads + writes, elapsedMs: Date.now() - started };
      return { mutation, budget };
    }
  };
}
