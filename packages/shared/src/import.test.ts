import { describe, expect, it } from "vitest";
import { utf8Bytes } from "./canonical.js";
import { IMPORT_MAX_BYTES } from "./media.js";
import {
  IMPORT_MAX_ROWS,
  decodeUtf8Strict,
  errorListForExport,
  fileHashOf,
  importBatchId,
  inspectCsvLimits,
  isImportVisible,
  looksLikeFormula,
  looksLikeRemoteUrl,
  paperTemplateCsv,
  parseCsv,
  questionTemplateCsv,
  sanitizeSpreadsheetCell,
  validatePaperCsv,
  validateQuestionCsv
} from "./import.js";

const categoryId = "cat_fict_logic";

function questionCtx() {
  return {
    categories: new Map([[categoryId, { deletedAt: null, enabled: true }]]),
    assets: new Map<string, { state: string; kind: string }>(),
    existingSourceKeys: new Set<string>(),
    existingStems: new Set<string>()
  };
}

function validQuestionCsv(extra = ""): string {
  return (
    questionTemplateCsv().replace(/请填入已有类目标识/g, categoryId) + extra
  );
}

describe("MW12 import csv and visibility", () => {
  it("parses utf8 templates and fictional samples", () => {
    const q = parseCsv(validQuestionCsv());
    expect(q.headers[0]).toBe("导入来源键");
    expect(q.rows).toHaveLength(3);
    const p = parseCsv(paperTemplateCsv().replace(/请填入已有类目标识/g, categoryId));
    expect(p.rows).toHaveLength(2);
  });

  it("rejects over 5 MB and over 1000 rows", () => {
    const over = new Uint8Array(IMPORT_MAX_BYTES + 1);
    expect(inspectCsvLimits(over)[0]?.reason).toMatch(/5 MB/);
    const lines = [questionTemplateCsv().trim().split("\n")[0]];
    for (let i = 0; i < IMPORT_MAX_ROWS + 1; i += 1) {
      lines.push(`q_fict_${i},${categoryId},单选,题干${i},甲,乙,,,,,,A,解析,5,入门,,,,,,,,,`);
    }
    const result = validateQuestionCsv(lines.join("\n"), questionCtx());
    expect(result.issues.some((item) => item.reason.includes("1000"))).toBe(true);
  });

  it("rejects last-row blocking error for the whole batch", () => {
    const good = validQuestionCsv().trim();
    const bad = `\nq_fict_mw12_bad,${categoryId},单选,题干,甲,乙,,,,,,Z,解析,5,入门,,,,,,,,,`;
    const result = validateQuestionCsv(good + bad, questionCtx());
    expect(result.issues.some((item) => item.field === "正确答案")).toBe(true);
    expect(result.rows.length).toBeLessThan(4);
  });

  it("rejects remote url and does not treat formulas as executable", () => {
    expect(looksLikeRemoteUrl("见 https://evil.example")).toBe(true);
    expect(looksLikeFormula("=cmd|' /C calc'!A0")).toBe(true);
    expect(sanitizeSpreadsheetCell("=1+1")).toBe("'=1+1");
    const exported = errorListForExport([
      { rowNo: 2, field: "题干", reason: "=HYPERLINK(\"http://x\")", example: "+cmd", blocking: true }
    ]);
    expect(exported[0]?.reason.startsWith("'")).toBe(true);
    expect(exported[0]?.example.startsWith("'")).toBe(true);
  });

  it("rejects existing source keys and paper without usable question keys", () => {
    const q = validateQuestionCsv(validQuestionCsv(), {
      ...questionCtx(),
      existingSourceKeys: new Set(["q_fict_mw12_single_01"])
    });
    expect(q.issues.some((item) => item.reason.includes("不覆盖"))).toBe(true);
    const paper = validatePaperCsv(paperTemplateCsv().replace(/请填入已有类目标识/g, categoryId), {
      categories: new Map([[categoryId, { deletedAt: null, enabled: true }]]),
      usableQuestionKeys: new Map(),
      existingPaperKeys: new Set()
    });
    expect(paper.issues.some((item) => item.field === "题目来源键")).toBe(true);
  });

  it("same file hash yields the same batch id", () => {
    const bytes = utf8Bytes(validQuestionCsv());
    const hash = fileHashOf(bytes);
    expect(importBatchId("question", hash)).toBe(importBatchId("question", hash));
    expect(importBatchId("question", hash)).not.toBe(importBatchId("paper", hash));
  });

  it("uncommitted import drafts are invisible even by id", () => {
    expect(isImportVisible({ importBatchId: "batch1" }, { state: "staging" })).toBe(false);
    expect(isImportVisible({ importBatchId: "batch1" }, { state: "validated" })).toBe(false);
    expect(isImportVisible({ importBatchId: "batch1" }, { state: "committed" })).toBe(true);
    expect(isImportVisible({})).toBe(true);
  });

  it("rejects non utf-8 bytes", () => {
    expect(decodeUtf8Strict(Uint8Array.from([0xff, 0xfe, 0x41, 0x00]))).toMatchObject({ ok: false, reason: "NOT_UTF8" });
    expect(decodeUtf8Strict(utf8Bytes("题干"))).toMatchObject({ ok: true });
  });
});
