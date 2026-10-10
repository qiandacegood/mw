import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "@mw/shared";
import {
  knownIdPayload,
  leftoverAttemptIdList,
  leftoverPaperIdList,
  markLeftoverAttemptId,
  markLeftoverPaperId,
  resetLeftoverAttemptIds,
  resetLeftoverPaperIds
} from "./known-ids.js";

describe("MW13 leftover knownIds", () => {
  beforeEach(() => {
    resetLeftoverPaperIds();
    resetLeftoverAttemptIds();
  });

  it("defaults to empty papers and attempts until something is explicitly marked", () => {
    expect(knownIdPayload()).toEqual({ papers: [], attempts: [] });
    expect(leftoverPaperIdList()).toEqual([]);
    expect(leftoverAttemptIdList()).toEqual([]);
  });

  it("does not record leftover on browse or automatic page enter", () => {
    expect(knownIdPayload()).toEqual({ papers: [], attempts: [] });
    expect(markLeftoverPaperId("paper_fict_mw13")).toBe(true);
    expect(markLeftoverAttemptId("attempt_fict_mw14")).toBe(true);
    const payload = knownIdPayload();
    expect(payload.papers).toEqual([sha256Hex("paper_fict_mw13")]);
    expect(payload.attempts).toEqual([sha256Hex("attempt_fict_mw14")]);
    expect(payload.papers.includes("paper_fict_mw13")).toBe(false);
    expect(payload.attempts.includes("attempt_fict_mw14")).toBe(false);
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
    expect(markLeftoverAttemptId("")).toBe(false);
    expect(knownIdPayload()).toEqual({ papers: [], attempts: [] });
  });
});
