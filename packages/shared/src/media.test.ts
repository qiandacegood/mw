import { describe, expect, it } from "vitest";
import {
  IMAGE_MAX_BYTES,
  MINIMAL_JPEG,
  MINIMAL_PNG,
  MINIMAL_WEBP,
  asUploadPurpose,
  detectImageMagic,
  fakePngNamedHtml,
  fakePngNamedSvg,
  hashUploadToken,
  looksLikeForbiddenMarkup,
  oversizedImageBytes,
  parseUploadAuthorizeInput,
  ticketFailureReason
} from "./media.js";

describe("MW10 image magic and tickets", () => {
  it("accepts jpeg png webp by header not extension", () => {
    expect(detectImageMagic(MINIMAL_JPEG)).toMatchObject({ ok: true, kind: "jpeg" });
    expect(detectImageMagic(MINIMAL_PNG)).toMatchObject({ ok: true, kind: "png" });
    expect(detectImageMagic(MINIMAL_WEBP)).toMatchObject({ ok: true, kind: "webp" });
  });

  it("rejects html or svg pretending to be png", () => {
    expect(detectImageMagic(fakePngNamedHtml())).toMatchObject({ ok: false, reason: "FORBIDDEN_FORMAT" });
    expect(detectImageMagic(fakePngNamedSvg())).toMatchObject({ ok: false, reason: "FORBIDDEN_FORMAT" });
    expect(looksLikeForbiddenMarkup(fakePngNamedHtml())).toBe(true);
  });

  it("rejects images over 2 MB", () => {
    expect(oversizedImageBytes().length).toBe(IMAGE_MAX_BYTES + 1);
    expect(detectImageMagic(oversizedImageBytes())).toMatchObject({ ok: false, reason: "IMAGE_TOO_LARGE" });
  });

  it("accepts import purpose for csv and rejects bare csv purpose", () => {
    const csv = parseUploadAuthorizeInput({
      purpose: "csv",
      contentType: "text/csv",
      size: 10,
      sha256: "a".repeat(64),
      caption: "batch"
    });
    expect(csv).toMatchObject({ ok: false, reason: "CSV_PURPOSE_MUST_BE_IMPORT" });
    const imported = parseUploadAuthorizeInput({
      purpose: "import",
      contentType: "text/csv",
      size: 12,
      sha256: "a".repeat(64),
      caption: "csv-import"
    });
    expect(imported).toMatchObject({ ok: true, purpose: "import", kind: "csv" });
    expect(asUploadPurpose("import")).toBe("import");
    expect(asUploadPurpose("analysis")).toBe("analysis");
    expect(asUploadPurpose("prompt")).toBe("prompt");
    expect(asUploadPurpose("csv")).toBe("prompt");
    const extra = parseUploadAuthorizeInput({
      purpose: "prompt",
      contentType: "image/png",
      size: 12,
      sha256: "b".repeat(64),
      caption: "图",
      url: "https://evil.example"
    });
    expect(extra.ok).toBe(false);
  });

  it("detects replay expire sha256 and purpose mismatches", () => {
    const now = new Date("2026-10-09T03:00:00.000Z");
    const ticket = {
      ticketId: "t1",
      tokenHash: hashUploadToken("plain-ticket"),
      adminUid: "uid_a",
      purpose: "prompt" as const,
      maxBytes: 12,
      contentType: "image/png",
      objectKey: "mw-test/media/prompt/a.png",
      sha256: "c".repeat(64),
      caption: "题干图",
      assetId: "asset1",
      expiresAt: "2026-10-09T03:10:00.000Z",
      state: "issued" as const,
      schemaVersion: 1,
      createdAt: now.toISOString()
    };
    expect(ticketFailureReason({ ticket, now, sha256: ticket.sha256 })).toBeUndefined();
    expect(ticketFailureReason({ ticket: { ...ticket, state: "consumed" }, now })).toBe("TICKET_REPLAY");
    expect(ticketFailureReason({ ticket, now: new Date("2026-10-09T03:11:00.000Z") })).toBe("TICKET_EXPIRED");
    expect(ticketFailureReason({ ticket, now, sha256: "d".repeat(64) })).toBe("TICKET_SHA256_MISMATCH");
    expect(ticketFailureReason({ ticket, now, purpose: "analysis" })).toBe("TICKET_PURPOSE_MISMATCH");
    expect(ticketFailureReason({ ticket, now, adminUid: "uid_other" })).toBe("TICKET_ADMIN_MISMATCH");
  });
});
