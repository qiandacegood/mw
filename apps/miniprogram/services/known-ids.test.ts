import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "@mw/shared";
import { knownIdPayload, leftoverPaperIdList, markLeftoverPaperId, resetLeftoverPaperIds } from "./known-ids.js";

describe("MW13 leftover knownIds", () => {
  beforeEach(() => {
    resetLeftoverPaperIds();
  });

  it("defaults to empty papers until a paper is explicitly marked", () => {
    expect(knownIdPayload()).toEqual({ papers: [] });
    expect(leftoverPaperIdList()).toEqual([]);
  });

  it("copies SHA-256 of marked leftover paper ids and never the raw id", () => {
    expect(markLeftoverPaperId("paper_fict_mw13")).toBe(true);
    const payload = knownIdPayload();
    expect(payload.papers).toEqual([sha256Hex("paper_fict_mw13")]);
    expect(payload.papers.some((item) => item === "paper_fict_mw13")).toBe(false);
    expect(payload.papers.every((item) => /^[0-9a-f]{64}$/.test(item))).toBe(true);
  });

  it("ignores blank marks so browse cannot sneak an empty id into leftover", () => {
    expect(markLeftoverPaperId("   ")).toBe(false);
    expect(knownIdPayload()).toEqual({ papers: [] });
  });
});
