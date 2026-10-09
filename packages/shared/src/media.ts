import { hashNamedFields, sha256Bytes, sha256Hex, toHex } from "./canonical.js";
import { rejectUnknownKeys } from "./validate.js";

export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const UPLOAD_TICKET_TTL_MS = 10 * 60 * 1000;
export const MEDIA_SCHEMA_VERSION = 1;
export const MEDIA_OBJECT_PREFIX = "mw-test/media";

export const IMAGE_PURPOSES = ["prompt", "analysis"] as const;
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number];

export const IMAGE_KINDS = ["jpeg", "png", "webp"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

export const IMAGE_MIME = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
} as const;

export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

export const ASSET_STATES = ["pending", "ready", "failed"] as const;
export type AssetState = (typeof ASSET_STATES)[number];

export const TICKET_STATES = ["issued", "consumed", "expired"] as const;
export type TicketState = (typeof TICKET_STATES)[number];

export const UPLOAD_AUTHORIZE_FIELDS = ["purpose", "contentType", "size", "sha256", "caption"] as const;
export const UPLOAD_STATUS_FIELDS = ["ticketId", "assetId"] as const;
export const UPLOAD_COMPLETE_FIELDS = ["uploadTicket", "sha256", "size", "fileBase64"] as const;

export const CAPTION_MAX_CHARS = 80;
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

export type MediaAssetRecord = {
  assetId: string;
  fileId: string;
  objectKey: string;
  kind: ImagePurpose;
  mime: string;
  size: number;
  sha256: string;
  caption: string;
  state: AssetState;
  uploader: string;
  ticketId: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type UploadTicketRecord = {
  ticketId: string;
  tokenHash: string;
  adminUid: string;
  purpose: ImagePurpose;
  maxBytes: number;
  contentType: string;
  objectKey: string;
  sha256: string;
  caption: string;
  assetId: string;
  expiresAt: string;
  state: TicketState;
  consumedAt?: string;
  schemaVersion: number;
  createdAt: string;
};

export type UploadAuthView = {
  cloudPath: string;
  url?: string;
  authorization?: string;
  token?: string;
  fileId?: string;
};

export function isImagePurpose(value: unknown): value is ImagePurpose {
  return value === "prompt" || value === "analysis";
}

export function mimeToKind(mime: string): ImageKind | undefined {
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return undefined;
}

export function extForKind(kind: ImageKind): string {
  if (kind === "jpeg") return "jpg";
  if (kind === "png") return "png";
  return "webp";
}

function latinHead(bytes: Uint8Array, max: number): string {
  const n = Math.min(bytes.length, max);
  let out = "";
  for (let i = 0; i < n; i += 1) {
    out += String.fromCharCode(bytes[i] as number);
  }
  return out;
}

export function looksLikeForbiddenMarkup(bytes: Uint8Array): boolean {
  const head = latinHead(bytes, 256).toLowerCase();
  const trimmed = head.replace(/^\uFEFF/, "").trimStart();
  return (
    trimmed.startsWith("<svg") ||
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<!doctype") ||
    trimmed.includes("<script") ||
    trimmed.includes("<svg")
  );
}

export function detectImageMagic(
  bytes: Uint8Array
): { ok: true; kind: ImageKind; mime: string } | { ok: false; reason: string } {
  if (!bytes || bytes.length === 0) {
    return { ok: false, reason: "EMPTY_FILE" };
  }
  if (bytes.length > IMAGE_MAX_BYTES) {
    return { ok: false, reason: "IMAGE_TOO_LARGE" };
  }
  if (looksLikeForbiddenMarkup(bytes)) {
    return { ok: false, reason: "FORBIDDEN_FORMAT" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ok: true, kind: "jpeg", mime: IMAGE_MIME.jpeg };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { ok: true, kind: "png", mime: IMAGE_MIME.png };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { ok: true, kind: "webp", mime: IMAGE_MIME.webp };
  }
  return { ok: false, reason: "UNSUPPORTED_IMAGE" };
}

export function sha256OfBytes(bytes: Uint8Array): string {
  return toHex(sha256Bytes(bytes));
}

export function assetIdFor(ticketId: string): string {
  return hashNamedFields({ kind: "media_asset", ticketId }, ["kind", "ticketId"]);
}

export function ticketIdFor(adminUid: string, requestId: string): string {
  return hashNamedFields({ kind: "upload_ticket", adminUid, requestId }, ["kind", "adminUid", "requestId"]);
}

export function hashUploadToken(token: string): string {
  return sha256Hex(token);
}

export function mediaObjectKey(purpose: ImagePurpose, assetId: string, kind: ImageKind): string {
  return `${MEDIA_OBJECT_PREFIX}/${purpose}/${assetId}.${extForKind(kind)}`;
}

export function fileIdForObject(objectKey: string): string {
  return `cloud://${objectKey}`;
}

export function validateCaption(value: unknown): { ok: true; caption: string } | { ok: false; issues: string[] } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, issues: ["caption required"] };
  }
  const caption = value.trim();
  if (caption.length > CAPTION_MAX_CHARS) {
    return { ok: false, issues: ["caption too long"] };
  }
  if (/https?:\/\//i.test(caption) || /<script|<svg|<html/i.test(caption)) {
    return { ok: false, issues: ["caption must not contain url or markup"] };
  }
  return { ok: true, caption };
}

export function parseUploadAuthorizeInput(data: Record<string, unknown>):
  | {
      ok: true;
      purpose: ImagePurpose;
      contentType: string;
      kind: ImageKind;
      size: number;
      sha256: string;
      caption: string;
    }
  | { ok: false; issues: string[]; reason?: string } {
  const extra = rejectUnknownKeys(data, [...UPLOAD_AUTHORIZE_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (data.purpose === "csv" || data.purpose === "import") {
    return { ok: false, issues: ["CSV import is MW12"], reason: "CSV_PURPOSE_MW12" };
  }
  if (!isImagePurpose(data.purpose)) {
    issues.push("purpose must be prompt or analysis");
  }
  const contentType = typeof data.contentType === "string" ? data.contentType.toLowerCase() : "";
  const kind = mimeToKind(contentType);
  if (!kind) {
    issues.push("contentType must be image/jpeg, image/png or image/webp");
  }
  if (typeof data.size !== "number" || !Number.isInteger(data.size) || data.size <= 0) {
    issues.push("size must be a positive integer");
  } else if (data.size > IMAGE_MAX_BYTES) {
    issues.push("size exceeds 2 MB");
  }
  if (typeof data.sha256 !== "string" || !SHA256_HEX_RE.test(data.sha256)) {
    issues.push("sha256 must be 64 hex chars");
  }
  const caption = validateCaption(data.caption);
  if (!caption.ok) issues.push(...caption.issues);
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    purpose: data.purpose as ImagePurpose,
    contentType,
    kind: kind as ImageKind,
    size: data.size as number,
    sha256: String(data.sha256).toLowerCase(),
    caption: caption.ok ? caption.caption : ""
  };
}

export function parseUploadStatusInput(data: Record<string, unknown>):
  | { ok: true; ticketId?: string; assetId?: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...UPLOAD_STATUS_FIELDS]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (data.ticketId !== undefined && typeof data.ticketId !== "string") issues.push("ticketId must be string");
  if (data.assetId !== undefined && typeof data.assetId !== "string") issues.push("assetId must be string");
  if (!data.ticketId && !data.assetId) issues.push("ticketId or assetId required");
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    ticketId: typeof data.ticketId === "string" ? data.ticketId : undefined,
    assetId: typeof data.assetId === "string" ? data.assetId : undefined
  };
}

export function ticketFailureReason(input: {
  ticket?: UploadTicketRecord;
  now: Date;
  adminUid?: string;
  purpose?: ImagePurpose;
  sha256?: string;
  size?: number;
  consumed?: boolean;
}): string | undefined {
  if (!input.ticket) return "TICKET_NOT_FOUND";
  if (input.ticket.state === "consumed" || input.consumed) return "TICKET_REPLAY";
  if (input.ticket.state === "expired" || new Date(input.ticket.expiresAt).getTime() <= input.now.getTime()) {
    return "TICKET_EXPIRED";
  }
  if (input.adminUid && input.adminUid !== input.ticket.adminUid) return "TICKET_ADMIN_MISMATCH";
  if (input.purpose && input.purpose !== input.ticket.purpose) return "TICKET_PURPOSE_MISMATCH";
  if (input.sha256 && input.sha256.toLowerCase() !== input.ticket.sha256) return "TICKET_SHA256_MISMATCH";
  if (typeof input.size === "number" && input.size !== input.ticket.maxBytes) return "TICKET_SIZE_MISMATCH";
  return undefined;
}

export function redactUploadSecrets<T>(value: T): T {
  return redactDeep(value, ["uploadTicket", "ticket", "token", "authorization", "fileId"]) as T;
}

function redactDeep(value: unknown, keys: string[]): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, keys));
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (keys.includes(key)) {
      out[key] = typeof child === "string" && child.length > 0 ? "[redacted]" : child;
      continue;
    }
    out[key] = redactDeep(child, keys);
  }
  return out;
}

export const MINIMAL_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
  0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

export const MINIMAL_JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08,
  0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a,
  0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34,
  0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
  0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00,
  0x3f, 0x00, 0x7f, 0xff, 0xd9
]);

export const MINIMAL_WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 0x0e, 0x00, 0x00,
  0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00, 0x34, 0x25, 0xa4, 0x00, 0x03, 0x70,
  0x00, 0xfe, 0xfb, 0x94, 0x00
]);

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

export function fakePngNamedHtml(): Uint8Array {
  return asciiBytes("<html><script>alert(1)</script></html>");
}

export function fakePngNamedSvg(): Uint8Array {
  return asciiBytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
}

export function oversizedImageBytes(): Uint8Array {
  const bytes = new Uint8Array(IMAGE_MAX_BYTES + 1);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return bytes;
}
