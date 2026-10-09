import { randomBytes } from "node:crypto";
import type { AuditEntry, IdempotencyRecord, MediaAssetRecord, UploadAuthView, UploadTicketRecord } from "@mw/shared";
import type { TxBudget } from "./job-stores.js";

export type UploadWriteSnapshot = {
  ticket?: UploadTicketRecord;
  asset?: MediaAssetRecord;
  idem?: IdempotencyRecord;
};

export type UploadWriteMutation<T> = {
  ticket?: UploadTicketRecord;
  asset?: MediaAssetRecord;
  idem?: IdempotencyRecord;
  audit?: AuditEntry;
  result: T;
  error?: { code: string; reason: string; issues?: string[]; details?: Record<string, unknown> };
};

export interface ObjectStorage {
  issueUploadAuth(input: { objectKey: string; contentType: string; maxBytes: number }): Promise<UploadAuthView>;
  putObject(objectKey: string, bytes: Uint8Array, contentType: string): Promise<{ fileId: string }>;
  getObject(objectKey: string): Promise<{ bytes: Uint8Array; size: number } | undefined>;
  getTempReadUrl(objectKey: string, ttlSeconds: number): Promise<string | undefined>;
}

export interface UploadWorkStore {
  getTicket(ticketId: string): Promise<UploadTicketRecord | undefined>;
  getTicketByHash(tokenHash: string): Promise<UploadTicketRecord | undefined>;
  getAsset(assetId: string): Promise<MediaAssetRecord | undefined>;
  storage: ObjectStorage;
  transactWrite<T>(input: {
    ticketId?: string;
    tokenHash?: string;
    assetId?: string;
    idempotencyId: string;
    mutate: (snap: UploadWriteSnapshot) => UploadWriteMutation<T>;
  }): Promise<{ mutation: UploadWriteMutation<T>; budget: TxBudget }>;
}

export function newUploadToken(): string {
  return `tkt_${randomBytes(24).toString("hex")}`;
}

export function memoryObjectStorage(): ObjectStorage & { objects: Map<string, { bytes: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    async issueUploadAuth(input) {
      return { cloudPath: input.objectKey };
    },
    async putObject(objectKey, bytes, contentType) {
      objects.set(objectKey, { bytes: Uint8Array.from(bytes), contentType });
      return { fileId: `cloud://${objectKey}` };
    },
    async getObject(objectKey) {
      const row = objects.get(objectKey);
      return row ? { bytes: Uint8Array.from(row.bytes), size: row.bytes.length } : undefined;
    },
    async getTempReadUrl(objectKey, ttlSeconds) {
      if (!objects.has(objectKey)) return undefined;
      return `memory://read/${objectKey}?ttl=${ttlSeconds}`;
    }
  };
}

export function memoryUploadStore(
  storage: ObjectStorage = memoryObjectStorage()
): UploadWorkStore & {
  tickets: Map<string, UploadTicketRecord>;
  assets: Map<string, MediaAssetRecord>;
  idem: Map<string, IdempotencyRecord>;
  audits: AuditEntry[];
  storage: ObjectStorage;
} {
  const tickets = new Map<string, UploadTicketRecord>();
  const assets = new Map<string, MediaAssetRecord>();
  const idem = new Map<string, IdempotencyRecord>();
  const audits: AuditEntry[] = [];
  let queue: Promise<unknown> = Promise.resolve();

  const store: UploadWorkStore & {
    tickets: Map<string, UploadTicketRecord>;
    assets: Map<string, MediaAssetRecord>;
    idem: Map<string, IdempotencyRecord>;
    audits: AuditEntry[];
    storage: ObjectStorage;
  } = {
    tickets,
    assets,
    idem,
    audits,
    storage,
    async getTicket(ticketId) {
      const row = tickets.get(ticketId);
      return row ? { ...row } : undefined;
    },
    async getTicketByHash(tokenHash) {
      const row = [...tickets.values()].find((item) => item.tokenHash === tokenHash);
      return row ? { ...row } : undefined;
    },
    async getAsset(assetId) {
      const row = assets.get(assetId);
      return row ? { ...row } : undefined;
    },
    transactWrite(input) {
      const run = queue.then(() => {
        const started = Date.now();
        const byId = input.ticketId ? tickets.get(input.ticketId) : undefined;
        const byHash = input.tokenHash
          ? [...tickets.values()].find((item) => item.tokenHash === input.tokenHash)
          : undefined;
        const ticket = byId || byHash;
        const asset = input.assetId ? assets.get(input.assetId) : ticket ? assets.get(ticket.assetId) : undefined;
        const mutation = input.mutate({
          ticket: ticket ? { ...ticket } : undefined,
          asset: asset ? { ...asset } : undefined,
          idem: input.idempotencyId && idem.has(input.idempotencyId) ? { ...idem.get(input.idempotencyId)! } : undefined
        });
        let writes = 0;
        if (mutation.ticket) {
          tickets.set(mutation.ticket.ticketId, { ...mutation.ticket });
          writes += 1;
        }
        if (mutation.asset) {
          assets.set(mutation.asset.assetId, { ...mutation.asset });
          writes += 1;
        }
        if (mutation.idem) {
          idem.set(mutation.idem.id, { ...mutation.idem });
          writes += 1;
        }
        if (mutation.audit) {
          audits.push(mutation.audit);
          writes += 1;
        }
        return {
          mutation,
          budget: { reads: 3, writes, total: 3 + writes, elapsedMs: Date.now() - started }
        };
      });
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  };
  return store;
}
