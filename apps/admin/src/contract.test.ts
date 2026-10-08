import { handleIsolatedAction } from "@mw/api";
import { describe, expect, it } from "vitest";

describe("admin uses isolated contract", () => {
  it("loads the fictional VIP paper", () => {
    const res = handleIsolatedAction({
      apiVersion: "1",
      action: "paper.detail",
      requestId: "req_admin_test",
      data: { paperId: "paper_fict_logic_l3" }
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toMatchObject({ access: "vip", questionCount: 20 });
  });
});
