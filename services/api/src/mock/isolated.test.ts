import { describe, expect, it } from "vitest";
import { handleIsolatedAction } from "./isolated.js";
import { notWired } from "../cloudbase-guard.js";

describe("isolated api adapter", () => {
  it("serves paper.detail without CloudBase", () => {
    const res = handleIsolatedAction({
      apiVersion: "1",
      action: "paper.detail",
      requestId: "req_fict_api_001",
      data: { paperId: "paper_fict_logic_l1" }
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toMatchObject({ paperId: "paper_fict_logic_l1", access: "free" });
      expect(JSON.stringify(res)).not.toContain("correctOptionIds");
    }
  });

  it("refuses to pretend CloudBase is wired", () => {
    expect(() => notWired("mw-public")).toThrow(/not connected to CloudBase/);
  });
});
