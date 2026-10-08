import { describe, expect, it } from "vitest";
import { sharedCloudReady } from "./shared-cloud.js";

describe("shared cloud client", () => {
  it("fails closed when local shared config is absent in tests", () => {
    const ready = sharedCloudReady();
    expect(ready.ready).toBe(false);
    expect(ready.reason).toBe("LOCAL_SHARED_CONFIG_MISSING");
  });
});
