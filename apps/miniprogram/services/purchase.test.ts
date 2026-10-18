import { describe, expect, it } from "vitest";
import { checkoutParamsOf, daysLabel, fenLabel } from "./purchase";

describe("purchase helpers", () => {
  it("labels test prices and never treats a client success envelope as checkout params", () => {
    expect(fenLabel(9900)).toContain("测试价");
    expect(daysLabel(30)).toBe("30 天");
    expect(checkoutParamsOf({ ok: true, data: { clientSuccess: true, paid: true } })).toBeUndefined();
    expect(
      checkoutParamsOf({
        ok: true,
        data: { signData: "{}", paySig: "aa", signature: "bb", session_key: "must-not-be-used" }
      })
    ).toMatchObject({ signData: "{}", paySig: "aa", signature: "bb" });
  });
});
