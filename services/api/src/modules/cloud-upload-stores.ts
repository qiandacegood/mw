import {
  asUploadPurpose,
  auditDocId,
  fileIdForObject,
  type AuditEntry,
  type IdempotencyRecord,
  type MediaAssetRecord,
  type UploadTicketRecord
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import type { ObjectStorage, UploadWorkStore, UploadWriteSnapshot } from "./upload-stores.js";
import { MW10_COLLECTIONS } from "./cloud-question-stores.js";

function cloudApp() {
  const cloudbase = require("@cloudbase/node-sdk") as {
    init: (opts: { env: unknown }) => CloudApp;
    SYMBOL_CURRENT_ENV: unknown;
  };
  return cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
}

type CloudApp = {
  database: () => CloudDb;
  getUploadMetadata?: (input: { cloudPath: string }) => Promise<unknown>;
  getTempFileURL?: (input: { fileList: string[] }) => Promise<unknown>;
  uploadFile?: (input: { cloudPath: string; fileContent: Buffer }) => Promise<unknown>;
  downloadFile?: (input: { fileID: string }) => Promise<unknown>;
};

type CloudColl = {
  doc: (id: string) => {
    get: () => Promise<unknown>;
    set: (data: Record<string, unknown>) => Promise<unknown>;
    update: (data: Record<string, unknown>) => Promise<unknown>;
  };
  where?: (query: Record<string, unknown>) => { limit: (n: number) => { get: () => Promise<unknown> } };
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

function asIso(value: unknown, fallback: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return fallback;
}

function asTicket(id: string, data: Record<string, unknown>): UploadTicketRecord {
  const now = new Date().toISOString();
  return {
    ticketId: typeof data.ticketId === "string" ? data.ticketId : id,
    tokenHash: typeof data.tokenHash === "string" ? data.tokenHash : "",
    adminUid: typeof data.adminUid === "string" ? data.adminUid : "",
    purpose: asUploadPurpose(data.purpose),
    maxBytes: typeof data.maxBytes === "number" ? data.maxBytes : 0,
    contentType: typeof data.contentType === "string" ? data.contentType : "",
    objectKey: typeof data.objectKey === "string" ? data.objectKey : "",
    sha256: typeof data.sha256 === "string" ? data.sha256 : "",
    caption: typeof data.caption === "string" ? data.caption : "",
    assetId: typeof data.assetId === "string" ? data.assetId : "",
    expiresAt: asIso(data.expiresAt, now),
    state: data.state === "consumed" || data.state === "expired" ? data.state : "issued",
    consumedAt: typeof data.consumedAt === "string" ? data.consumedAt : undefined,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now)
  };
}

function asAsset(id: string, data: Record<string, unknown>): MediaAssetRecord {
  const now = new Date().toISOString();
  return {
    assetId: typeof data.assetId === "string" ? data.assetId : id,
    fileId: typeof data.fileId === "string" ? data.fileId : "",
    objectKey: typeof data.objectKey === "string" ? data.objectKey : "",
    kind: asUploadPurpose(data.kind),
    mime: typeof data.mime === "string" ? data.mime : "",
    size: typeof data.size === "number" ? data.size : 0,
    sha256: typeof data.sha256 === "string" ? data.sha256 : "",
    caption: typeof data.caption === "string" ? data.caption : "",
    state: data.state === "ready" || data.state === "failed" ? data.state : "pending",
    uploader: typeof data.uploader === "string" ? data.uploader : "",
    ticketId: typeof data.ticketId === "string" ? data.ticketId : "",
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
    createdAt: asIso(data.createdAt, now),
    updatedAt: asIso(data.updatedAt, now),
    ...(typeof data.inlineUtf8 === "string" ? { inlineUtf8: data.inlineUtf8 } : {})
  };
}

function asIdem(id: string, data: Record<string, unknown>): IdempotencyRecord {
  return {
    id,
    actorId: typeof data.actorId === "string" ? data.actorId : "",
    action: typeof data.action === "string" ? data.action : "",
    idempotencyKey: typeof data.idempotencyKey === "string" ? data.idempotencyKey : "",
    payloadHash: typeof data.payloadHash === "string" ? data.payloadHash : "",
    status:
      data.status === "succeeded" || data.status === "conflict" || data.status === "pending" || data.status === "failed"
        ? data.status
        : "pending",
    resultRef: data.resultRef ?? null,
    requestId: typeof data.requestId === "string" ? data.requestId : ""
  };
}

function ticketWrite(row: UploadTicketRecord): Record<string, unknown> {
  return { ...row };
}

function assetWrite(row: MediaAssetRecord): Record<string, unknown> {
  return { ...row };
}

function idemWrite(record: IdempotencyRecord): Record<string, unknown> {
  return {
    actorId: record.actorId,
    action: record.action,
    idempotencyKey: record.idempotencyKey,
    payloadHash: record.payloadHash,
    status: record.status,
    resultRef: record.resultRef,
    requestId: record.requestId
  };
}

function auditWrite(entry: AuditEntry): Record<string, unknown> {
  return {
    actorType: entry.actorType,
    actorId: entry.actorId,
    action: entry.action,
    target: entry.target,
    reason: entry.reason,
    requestId: entry.requestId,
    beforeHash: entry.beforeHash,
    afterHash: entry.afterHash,
    createdAt: entry.createdAt,
    schemaVersion: entry.schemaVersion
  };
}

export function cloudObjectStorage(): ObjectStorage {
  return {
    async issueUploadAuth(input) {
      const app = cloudApp();
      if (typeof app.getUploadMetadata === "function") {
        const raw = await app.getUploadMetadata({ cloudPath: input.objectKey });
        const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
        const data = rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : rec;
        return {
          cloudPath: input.objectKey,
          url: typeof data.url === "string" ? data.url : undefined,
          authorization: typeof data.authorization === "string" ? data.authorization : undefined,
          token: typeof data.token === "string" ? data.token : undefined,
          fileId: typeof data.fileId === "string" ? data.fileId : typeof data.fileID === "string" ? data.fileID : undefined
        };
      }
      return { cloudPath: input.objectKey };
    },
    async putObject(objectKey, bytes, _contentType) {
      const app = cloudApp();
      if (typeof app.uploadFile === "function") {
        const raw = await app.uploadFile({ cloudPath: objectKey, fileContent: Buffer.from(bytes) });
        const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
        const nested = rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : {};
        const fileId =
          typeof rec.fileID === "string"
            ? rec.fileID
            : typeof rec.fileId === "string"
              ? rec.fileId
              : typeof nested.fileID === "string"
                ? nested.fileID
                : typeof nested.fileId === "string"
                  ? nested.fileId
                  : fileIdForObject(objectKey);
        return { fileId };
      }
      return { fileId: fileIdForObject(objectKey) };
    },
    async getObject(objectKey, fileId) {
      const app = cloudApp();
      if (typeof app.downloadFile !== "function") return undefined;
      const id = typeof fileId === "string" && fileId.length > 0 ? fileId : fileIdForObject(objectKey);
      try {
        const raw = await app.downloadFile({ fileID: id });
        const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
        const fileContent = rec.fileContent || rec.data;
        if (Buffer.isBuffer(fileContent)) {
          return { bytes: Uint8Array.from(fileContent), size: fileContent.length };
        }
        if (fileContent instanceof Uint8Array) {
          return { bytes: fileContent, size: fileContent.length };
        }
        return undefined;
      } catch {
        return undefined;
      }
    },
    async getTempReadUrl(objectKey, _ttlSeconds) {
      const app = cloudApp();
      if (typeof app.getTempFileURL !== "function") return undefined;
      const raw = await app.getTempFileURL({ fileList: [fileIdForObject(objectKey)] });
      const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const list = Array.isArray(rec.fileList) ? rec.fileList : [];
      const first = list[0] && typeof list[0] === "object" ? (list[0] as Record<string, unknown>) : undefined;
      return typeof first?.tempFileURL === "string" ? first.tempFileURL : typeof first?.download_url === "string" ? first.download_url : undefined;
    }
  };
}

export function cloudUploadWorkStore(storage: ObjectStorage = cloudObjectStorage()): UploadWorkStore {
  return {
    storage,
    async getTicket(ticketId) {
      const snap = await cloudApp().database().collection(MW10_COLLECTIONS.uploadTickets).doc(ticketId).get();
      const data = unwrapDoc(snap);
      return data ? asTicket(ticketId, data) : undefined;
    },
    async getTicketByHash(tokenHash) {
      const coll = cloudApp().database().collection(MW10_COLLECTIONS.uploadTickets);
      if (!coll.where) return undefined;
      const snap = await coll.where({ tokenHash }).limit(1).get();
      const first = unwrapList(snap)[0];
      return first ? asTicket(typeof first._id === "string" ? first._id : String(first.ticketId || ""), first) : undefined;
    },
    async getAsset(assetId) {
      const snap = await cloudApp().database().collection(MW10_COLLECTIONS.mediaAssets).doc(assetId).get();
      const data = unwrapDoc(snap);
      return data ? asAsset(assetId, data) : undefined;
    },
    async transactWrite(input) {
      const started = Date.now();
      let reads = 0;
      let writes = 0;
      const mutation = await cloudApp().database().runTransaction(async (tx) => {
        let ticketData: Record<string, unknown> | undefined;
        let ticketId = input.ticketId;
        if (ticketId) {
          ticketData = unwrapDoc(await tx.collection(MW10_COLLECTIONS.uploadTickets).doc(ticketId).get());
          reads += 1;
        }
        const assetId = input.assetId || (ticketData && typeof ticketData.assetId === "string" ? ticketData.assetId : undefined);
        const assetData = assetId
          ? unwrapDoc(await tx.collection(MW10_COLLECTIONS.mediaAssets).doc(assetId).get())
          : undefined;
        if (assetId) reads += 1;
        const idemSnap = await tx.collection(MW10_COLLECTIONS.idempotency).doc(input.idempotencyId).get();
        reads += 1;
        const snap: UploadWriteSnapshot = {
          ticket: ticketData && ticketId ? asTicket(ticketId, ticketData) : undefined,
          asset: assetData && assetId ? asAsset(assetId, assetData) : undefined,
          idem: unwrapDoc(idemSnap) ? asIdem(input.idempotencyId, unwrapDoc(idemSnap)!) : undefined
        };
        const next = input.mutate(snap);
        if (next.ticket) {
          writes += 1;
          await tx.collection(MW10_COLLECTIONS.uploadTickets).doc(next.ticket.ticketId).set(ticketWrite(next.ticket));
        }
        if (next.asset) {
          writes += 1;
          await tx.collection(MW10_COLLECTIONS.mediaAssets).doc(next.asset.assetId).set(assetWrite(next.asset));
        }
        if (next.idem) {
          writes += 1;
          await tx.collection(MW10_COLLECTIONS.idempotency).doc(input.idempotencyId).set(idemWrite(next.idem));
        }
        if (next.audit) {
          writes += 1;
          await tx.collection(MW10_COLLECTIONS.auditLogs).doc(auditDocId(next.audit)).set(auditWrite(next.audit));
        }
        return next;
      });
      return { mutation, budget: { reads, writes, total: reads + writes, elapsedMs: Date.now() - started } satisfies TxBudget };
    }
  };
}
