import {
  IMAGE_MAX_BYTES,
  IMPORT_INLINE_MAX_BYTES,
  IMPORT_MAX_BYTES,
  MEDIA_SCHEMA_VERSION,
  UPLOAD_TICKET_TTL_MS,
  assetIdFor,
  auditDocId,
  buildAuditEntry,
  buildIdempotencyRecord,
  decodeUtf8Strict,
  detectImageMagic,
  fileIdForObject,
  hashUploadToken,
  mediaObjectKey,
  mimeToKind,
  parseUploadAuthorizeInput,
  parseUploadStatusInput,
  payloadHash,
  replayOrConflict,
  sha256OfBytes,
  ticketFailureReason,
  ticketIdFor,
  type MediaAssetRecord,
  type UploadTicketRecord
} from "@mw/shared";
import type { TxBudget } from "./job-stores.js";
import { newUploadToken, type UploadWorkStore } from "./upload-stores.js";

export type UploadActionFailure = {
  ok: false;
  code: string;
  reason: string;
  issues?: string[];
  details?: Record<string, unknown>;
};

export type UploadActionSuccess<T> = {
  ok: true;
  data: T;
  replayed?: boolean;
  budget: TxBudget;
};

function fail(code: string, reason: string, extra?: { issues?: string[]; details?: Record<string, unknown> }): UploadActionFailure {
  return { ok: false, code, reason, ...(extra?.issues ? { issues: extra.issues } : {}), ...(extra?.details ? { details: extra.details } : {}) };
}

function emptyBudget(): TxBudget {
  return { reads: 0, writes: 0, total: 0, elapsedMs: 0 };
}

export async function authorizeUpload(input: {
  store: UploadWorkStore;
  actorId: string;
  data: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string;
  now: Date;
}): Promise<
  UploadActionSuccess<{
    ticketId: string;
    assetId: string;
    objectKey: string;
    purpose: string;
    contentType: string;
    maxBytes: number;
    expiresAt: string;
    upload: { cloudPath: string; url?: string; authorization?: string; token?: string; fileId?: string };
    uploadTicket: string;
    idempotencyId: string;
  }> | UploadActionFailure
> {
  const parsed = parseUploadAuthorizeInput(input.data);
  if (!parsed.ok) {
    return fail("INVALID_ARGUMENT", parsed.reason || parsed.issues[0] || "INVALID_AUTHORIZE", {
      issues: parsed.issues,
      ...(parsed.reason ? { details: { reason: parsed.reason } } : {})
    });
  }
  const ticketId = ticketIdFor(input.actorId, input.requestId);
  const assetId = assetIdFor(ticketId);
  const objectKey = mediaObjectKey(parsed.purpose, assetId, parsed.kind);
  const token = newUploadToken();
  const tokenHash = hashUploadToken(token);
  const expiresAt = new Date(input.now.getTime() + UPLOAD_TICKET_TTL_MS).toISOString();
  const payload = {
    purpose: parsed.purpose,
    contentType: parsed.contentType,
    size: parsed.size,
    sha256: parsed.sha256,
    caption: parsed.caption
  };
  const idemRecord = buildIdempotencyRecord({
    actorId: input.actorId,
    action: "upload.authorize",
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId
  });
  const auth = await input.store.storage.issueUploadAuth({
    objectKey,
    contentType: parsed.contentType,
    maxBytes: parsed.size
  });
  const retried = await input.store.transactWrite({
    ticketId,
    assetId,
    idempotencyId: idemRecord.id,
    mutate: (snap) => {
      const replay = replayOrConflict(snap.idem, payloadHash(payload), () => null);
      if (!replay.ok) return { result: null as never, error: { code: replay.code, reason: "IDEMPOTENCY_CONFLICT" } };
      if (replay.replayed) {
        const view = replay.result as {
          ticketId: string;
          assetId: string;
          objectKey: string;
          purpose: string;
          contentType: string;
          maxBytes: number;
          expiresAt: string;
          upload: typeof auth;
          uploadTicket: string;
          idempotencyId: string;
        };
        if (view) return { result: { ...view, uploadTicket: "" } };
      }
      const ticket: UploadTicketRecord = {
        ticketId,
        tokenHash,
        adminUid: input.actorId,
        purpose: parsed.purpose,
        maxBytes: parsed.size,
        contentType: parsed.contentType,
        objectKey,
        sha256: parsed.sha256,
        caption: parsed.caption,
        assetId,
        expiresAt,
        state: "issued",
        schemaVersion: MEDIA_SCHEMA_VERSION,
        createdAt: input.now.toISOString()
      };
      const asset: MediaAssetRecord = {
        assetId,
        fileId: fileIdForObject(objectKey),
        objectKey,
        kind: parsed.purpose,
        mime: parsed.contentType,
        size: parsed.size,
        sha256: parsed.sha256,
        caption: parsed.caption,
        state: "pending",
        uploader: input.actorId,
        ticketId,
        schemaVersion: MEDIA_SCHEMA_VERSION,
        createdAt: input.now.toISOString(),
        updatedAt: input.now.toISOString()
      };
      const view = {
        ticketId,
        assetId,
        objectKey,
        purpose: parsed.purpose,
        contentType: parsed.contentType,
        maxBytes: parsed.size,
        expiresAt,
        upload: auth,
        uploadTicket: token,
        idempotencyId: idemRecord.id
      };
      const audit = buildAuditEntry({
        actorType: "admin",
        actorId: input.actorId,
        action: "upload.authorize",
        target: ticketId,
        reason: parsed.purpose,
        requestId: input.requestId,
        before: null,
        after: { ticketId, assetId, purpose: parsed.purpose, tokenHash },
        now: input.now
      });
      return {
        ticket,
        asset,
        idem: { ...idemRecord, status: "succeeded", resultRef: { ...view, uploadTicket: "" } },
        audit,
        result: { ...view, auditId: auditDocId(audit) }
      };
    }
  });
  if (retried.mutation.error) {
    const err = retried.mutation.error;
    return fail(err.code, err.reason, { issues: err.issues, details: err.details });
  }
  return { ok: true, data: retried.mutation.result, budget: retried.budget };
}

export async function readUploadStatus(input: {
  store: UploadWorkStore;
  data: Record<string, unknown>;
  actorId: string;
}): Promise<
  UploadActionSuccess<{
    ticketId: string;
    assetId: string;
    state: string;
    purpose: string;
    objectKey: string;
    expiresAt: string;
    assetState: string;
  }> | UploadActionFailure
> {
  const parsed = parseUploadStatusInput(input.data);
  if (!parsed.ok) return fail("INVALID_ARGUMENT", parsed.issues[0] || "INVALID_STATUS", { issues: parsed.issues });
  const ticket = parsed.ticketId
    ? await input.store.getTicket(parsed.ticketId)
    : parsed.assetId
      ? (await input.store.getAsset(parsed.assetId))
        ? await input.store.getTicket((await input.store.getAsset(parsed.assetId))!.ticketId)
        : undefined
      : undefined;
  if (!ticket || ticket.adminUid !== input.actorId) return fail("NOT_FOUND", "TICKET_NOT_FOUND");
  const asset = await input.store.getAsset(ticket.assetId);
  return {
    ok: true,
    data: {
      ticketId: ticket.ticketId,
      assetId: ticket.assetId,
      state: ticket.state,
      purpose: ticket.purpose,
      objectKey: ticket.objectKey,
      expiresAt: ticket.expiresAt,
      assetState: asset?.state || "pending"
    },
    budget: emptyBudget()
  };
}

export async function completeUpload(input: {
  store: UploadWorkStore;
  uploadTicket: string;
  sha256?: string;
  size?: number;
  bytes?: Uint8Array;
  adminUid?: string;
  now: Date;
}): Promise<
  UploadActionSuccess<{
    ticketId: string;
    assetId: string;
    state: "consumed";
    assetState: "ready";
    purpose: string;
    size: number;
    kind: string;
  }> | UploadActionFailure
> {
  if (!input.uploadTicket || typeof input.uploadTicket !== "string") {
    return fail("FORBIDDEN", "TICKET_REQUIRED");
  }
  const tokenHash = hashUploadToken(input.uploadTicket);
  const ticket = await input.store.getTicketByHash(tokenHash);
  const failReason = ticketFailureReason({
    ticket,
    now: input.now,
    adminUid: input.adminUid,
    sha256: input.sha256,
    size: input.size
  });
  if (failReason) {
    const code = failReason === "TICKET_NOT_FOUND" ? "FORBIDDEN" : "INVALID_ARGUMENT";
    return fail(code, failReason);
  }
  const current = ticket as UploadTicketRecord;
  let bytes = input.bytes;
  if (!bytes) {
    const stored = await input.store.storage.getObject(current.objectKey);
    if (!stored) return fail("INVALID_ARGUMENT", "OBJECT_NOT_FOUND");
    bytes = stored.bytes;
  }
  const isImport = current.purpose === "import";
  if (bytes.length > (isImport ? IMPORT_MAX_BYTES : IMAGE_MAX_BYTES)) {
    return fail("INVALID_ARGUMENT", isImport ? "CSV_TOO_LARGE" : "IMAGE_TOO_LARGE");
  }
  if (typeof input.size === "number" && input.size !== bytes.length) {
    return fail("INVALID_ARGUMENT", "TICKET_SIZE_MISMATCH");
  }
  if (bytes.length !== current.maxBytes && input.bytes) {
    /* declared size from authorize is the bound max; actual may equal it */
  }
  if (bytes.length > current.maxBytes) return fail("INVALID_ARGUMENT", "TICKET_SIZE_MISMATCH");
  const digest = sha256OfBytes(bytes);
  if (digest !== current.sha256) return fail("INVALID_ARGUMENT", "TICKET_SHA256_MISMATCH");
  let storedMime = current.contentType;
  let storedKind = "csv";
  let inlineUtf8: string | undefined;
  if (isImport) {
    const decoded = decodeUtf8Strict(bytes);
    if (!decoded.ok) return fail("INVALID_ARGUMENT", decoded.reason);
    storedMime = "text/csv";
    storedKind = "csv";
    if (bytes.length <= IMPORT_INLINE_MAX_BYTES) inlineUtf8 = decoded.text;
  } else {
    if (bytes.length > IMAGE_MAX_BYTES) return fail("INVALID_ARGUMENT", "IMAGE_TOO_LARGE");
    const magic = detectImageMagic(bytes);
    if (!magic.ok) return fail("INVALID_ARGUMENT", magic.reason);
    const expectedKind = mimeToKind(current.contentType);
    if (!expectedKind || expectedKind !== magic.kind) {
      return fail("INVALID_ARGUMENT", "CONTENT_TYPE_MISMATCH");
    }
    storedMime = magic.mime;
    storedKind = magic.kind;
  }
  const uploaded = await input.store.storage.putObject(current.objectKey, bytes, storedMime);
  const retried = await input.store.transactWrite({
    ticketId: current.ticketId,
    tokenHash,
    assetId: current.assetId,
    idempotencyId: `upload.complete/${current.ticketId}`,
    mutate: (snap) => {
      if (!snap.ticket) return { result: null as never, error: { code: "FORBIDDEN", reason: "TICKET_NOT_FOUND" } };
      if (snap.ticket.state === "consumed") {
        return { result: null as never, error: { code: "INVALID_ARGUMENT", reason: "TICKET_REPLAY" } };
      }
      if (new Date(snap.ticket.expiresAt).getTime() <= input.now.getTime()) {
        return { result: null as never, error: { code: "INVALID_ARGUMENT", reason: "TICKET_EXPIRED" } };
      }
      const nextTicket: UploadTicketRecord = {
        ...snap.ticket,
        state: "consumed",
        consumedAt: input.now.toISOString()
      };
      const nextAsset: MediaAssetRecord = {
        ...(snap.asset || {
          assetId: current.assetId,
          fileId: uploaded.fileId || fileIdForObject(current.objectKey),
          objectKey: current.objectKey,
          kind: current.purpose,
          mime: storedMime,
          size: bytes.length,
          sha256: digest,
          caption: current.caption,
          state: "pending",
          uploader: current.adminUid,
          ticketId: current.ticketId,
          schemaVersion: MEDIA_SCHEMA_VERSION,
          createdAt: current.createdAt,
          updatedAt: input.now.toISOString()
        }),
        fileId: uploaded.fileId || snap.asset?.fileId || fileIdForObject(current.objectKey),
        state: "ready",
        mime: storedMime,
        size: bytes.length,
        sha256: digest,
        updatedAt: input.now.toISOString(),
        ...(inlineUtf8 ? { inlineUtf8 } : {})
      };
      const view = {
        ticketId: nextTicket.ticketId,
        assetId: nextAsset.assetId,
        state: "consumed" as const,
        assetState: "ready" as const,
        purpose: nextTicket.purpose,
        size: bytes.length,
        kind: storedKind
      };
      return { ticket: nextTicket, asset: nextAsset, result: view };
    }
  });
  if (retried.mutation.error) {
    const err = retried.mutation.error;
    return fail(err.code, err.reason, { details: err.details });
  }
  return { ok: true, data: retried.mutation.result, budget: retried.budget };
}
