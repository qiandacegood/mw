import {
  evaluateVipStatus,
  type AuditEntry,
  type IdempotencyRecord,
  type VipAccountRecord,
  type VipEventRecord,
  type VipGrantRecord,
  type VipStatusView
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";

export const VIP_COLLECTIONS = {
  accounts: "vip_accounts",
  grants: "vip_grants",
  events: "vip_events",
  idempotency: "idempotency",
  auditLogs: "audit_logs"
} as const;

export type VipLedgerSnapshot = {
  account?: VipAccountRecord;
  grants: VipGrantRecord[];
  idem?: IdempotencyRecord;
};

export type VipLedgerMutation<T> = {
  account?: VipAccountRecord;
  grants?: VipGrantRecord[];
  events?: VipEventRecord[];
  idem?: IdempotencyRecord;
  audit?: AuditEntry;
  result: T;
  error?: string;
  replayed?: boolean;
};

export interface VipReadStore {
  getAccount(memberId: string): Promise<VipAccountRecord | undefined>;
  listGrants(memberId: string): Promise<VipGrantRecord[]>;
  evaluate(memberId: string, now: Date): Promise<VipStatusView>;
}

export interface VipWorkStore extends VipReadStore {
  transactLedger<T>(input: {
    memberId: string;
    grantIds: string[];
    idempotencyId?: string;
    mutate: (snap: VipLedgerSnapshot) => VipLedgerMutation<T>;
  }): Promise<{ mutation: VipLedgerMutation<T>; budget: TxBudget }>;
}

export type MemoryVipBundle = VipWorkStore & {
  accounts: Map<string, VipAccountRecord>;
  grants: Map<string, VipGrantRecord>;
  events: Map<string, VipEventRecord>;
  idem: Map<string, IdempotencyRecord>;
  audits: AuditEntry[];
};

function cloneAccount(row: VipAccountRecord): VipAccountRecord {
  return { ...row, grantIds: [...row.grantIds] };
}

function cloneGrant(row: VipGrantRecord): VipGrantRecord {
  return { ...row };
}

function emptyBudget(): TxBudget {
  return { reads: 0, writes: 0, total: 0, elapsedMs: 0 };
}

export function memoryVipStore(): MemoryVipBundle {
  const accounts = new Map<string, VipAccountRecord>();
  const grants = new Map<string, VipGrantRecord>();
  const events = new Map<string, VipEventRecord>();
  const idem = new Map<string, IdempotencyRecord>();
  const audits: AuditEntry[] = [];
  const locks = new Map<string, Promise<void>>();

  async function withLock<T>(memberId: string, run: () => Promise<T>): Promise<T> {
    const prev = locks.get(memberId) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(
      memberId,
      prev.then(() => next)
    );
    await prev;
    try {
      return await run();
    } finally {
      release();
    }
  }

  async function getAccount(memberId: string) {
    const row = accounts.get(memberId);
    return row ? cloneAccount(row) : undefined;
  }

  async function listGrants(memberId: string) {
    return [...grants.values()].filter((row) => row.memberId === memberId).map(cloneGrant);
  }

  return {
    accounts,
    grants,
    events,
    idem,
    audits,
    getAccount,
    listGrants,
    async evaluate(memberId, now) {
      return evaluateVipStatus({
        account: await getAccount(memberId),
        grants: await listGrants(memberId),
        now
      });
    },
    async transactLedger(input) {
      return withLock(input.memberId, async () => {
        const started = Date.now();
        let reads = 1;
        const account = accounts.get(input.memberId);
        const grantRows: VipGrantRecord[] = [];
        for (const grantId of input.grantIds) {
          reads += 1;
          const row = grants.get(grantId);
          if (row) grantRows.push(cloneGrant(row));
        }
        for (const row of grants.values()) {
          if (row.memberId === input.memberId && !grantRows.some((item) => item.grantId === row.grantId)) {
            grantRows.push(cloneGrant(row));
          }
        }
        let idemRow: IdempotencyRecord | undefined;
        if (input.idempotencyId) {
          reads += 1;
          const existing = idem.get(input.idempotencyId);
          if (existing) idemRow = { ...existing };
        }
        const next = input.mutate({
          account: account ? cloneAccount(account) : undefined,
          grants: grantRows,
          idem: idemRow
        });
        let writes = 0;
        if (!next.error) {
          if (next.account) {
            writes += 1;
            accounts.set(next.account.memberId, cloneAccount(next.account));
          }
          for (const row of next.grants || []) {
            writes += 1;
            grants.set(row.grantId, cloneGrant(row));
          }
          for (const row of next.events || []) {
            writes += 1;
            events.set(row.eventId, { ...row });
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

export function ledgerEntitlementReaderFromStore(store: VipReadStore) {
  return {
    async evaluate(memberId: string, now: Date) {
      const status = await store.evaluate(memberId, now);
      return {
        vipActive: status.active === true,
        source: "ledger" as const,
        expiresAt: status.expiresAt,
        reconcileState: status.reconcileState
      };
    }
  };
}

export { emptyBudget };
