import { describe, expect, it } from "vitest";
import { hasForbiddenAnswerKeys } from "../validate.js";
import { handlePaperDetail } from "./paper-detail.js";

describe("isolated paper.detail mock", () => {
  it("returns public fields without answers", () => {
    const res = handlePaperDetail({
      apiVersion: "1",
      action: "paper.detail",
      requestId: "req_fict_local_001",
      data: { paperId: "paper_fict_logic_l3" }
    }, new Date("2026-10-03T02:00:00.000Z"));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.access).toBe("vip");
      expect(res.data.maxScore).toBe(80);
      expect(hasForbiddenAnswerKeys(res)).toEqual([]);
    }
  });

  it("rejects unknown fields and missing papers", () => {
    const bad = handlePaperDetail({
      apiVersion: "1",
      action: "paper.detail",
      requestId: "req_fict_local_002",
      data: { paperId: "paper_fict_logic_l3", score: 100 }
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("INVALID_ARGUMENT");
    const missing = handlePaperDetail({
      apiVersion: "1",
      action: "paper.detail",
      requestId: "req_fict_local_003",
      data: { paperId: "paper_missing" }
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("NOT_FOUND");
  });
});
