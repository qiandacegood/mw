import { describe, expect, it } from "vitest";
import { fetchPaperDetail } from "./mock-client.js";

describe("miniprogram mock client", () => {
  it("reads a free paper through the shared contract", () => {
    const res = fetchPaperDetail("paper_fict_logic_l1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.access).toBe("free");
      expect("correctOptionIds" in res.data).toBe(false);
    }
  });
});
