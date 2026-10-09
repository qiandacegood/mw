import { hashNamedFields, sha256Bytes, sha256Hex, toHex, utf8Bytes } from "./canonical.js";
import { IMPORT_MAX_BYTES } from "./media.js";
import type { Difficulty, PaperAccess } from "./types.js";
import { rejectUnknownKeys } from "./validate.js";
import { DEFAULT_POINTS_MAX, DEFAULT_POINTS_MIN, TRUE_FALSE_OPTIONS, type QuestionType } from "./question.js";
import { PAPER_MINUTES_MAX, PAPER_MINUTES_MIN, PAPER_QUESTION_MAX, PAPER_QUESTION_MIN } from "./paper.js";

export const IMPORT_SCHEMA_VERSION = 1;
export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_PURPOSE = "import" as const;
export const IMPORT_MIME = ["text/csv", "text/plain", "application/csv"] as const;
export const SOURCE_KEY_MAX = 64;
export const SOURCE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const IMPORT_STATES = ["uploaded", "validated", "staging", "committed", "failed"] as const;
export type ImportState = (typeof IMPORT_STATES)[number];

export const IMPORT_KINDS = ["question", "paper"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const SOURCE_KEY_STATES = ["staging", "committed", "failed"] as const;
export type SourceKeyState = (typeof SOURCE_KEY_STATES)[number];

export const QUESTION_CSV_HEADERS = [
  "导入来源键",
  "类目标识",
  "题型",
  "题干",
  "选项A",
  "选项B",
  "选项C",
  "选项D",
  "选项E",
  "选项F",
  "选项G",
  "选项H",
  "正确答案",
  "解析",
  "默认分值",
  "难度",
  "题干图片素材标识",
  "选项A图片素材标识",
  "选项B图片素材标识",
  "选项C图片素材标识",
  "选项D图片素材标识",
  "选项E图片素材标识",
  "选项F图片素材标识",
  "选项G图片素材标识",
  "选项H图片素材标识"
] as const;

export const PAPER_CSV_HEADERS = [
  "试卷来源键",
  "标题",
  "类目标识",
  "简介",
  "目标",
  "难度",
  "权限",
  "建议时长",
  "题目来源键",
  "题序",
  "该题分值"
] as const;

export const IMPORT_VALIDATE_FIELDS = ["kind", "ticketId"] as const;
export const IMPORT_PREVIEW_FIELDS = ["batchId"] as const;
export const IMPORT_COMMIT_FIELDS = ["batchId"] as const;
export const IMPORT_STATUS_FIELDS = ["batchId"] as const;

export const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

export type ImportIssue = {
  rowNo: number;
  field: string;
  reason: string;
  example: string;
  blocking: boolean;
};

export type ImportBatchRecord = {
  batchId: string;
  fileHash: string;
  kind: ImportKind;
  state: ImportState;
  rowCount: number;
  validationHash: string;
  catalogVersion: number;
  columnSpec: string;
  previewHash: string;
  ticketId: string;
  assetId: string;
  errorCount: number;
  warningCount: number;
  targetCount: number;
  leaseToken: string;
  createdBy: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  committedAt: string | null;
};

export type ImportRowRecord = {
  rowId: string;
  batchId: string;
  rowNo: number;
  sourceKey: string;
  targetId: string;
  normalizedData: Record<string, unknown>;
  errors: ImportIssue[];
  schemaVersion: number;
};

export type SourceKeyRecord = {
  sourceKeyId: string;
  kind: ImportKind;
  sourceKey: string;
  targetId: string;
  batchId: string;
  state: SourceKeyState;
  schemaVersion: number;
  createdAt: string;
};

export type NormalizedQuestionRow = {
  sourceKey: string;
  categoryId: string;
  type: QuestionType;
  stem: string;
  options: Array<{ optionId: string; text: string; assetId?: string }>;
  answerIds: string[];
  analysis: string;
  defaultPoints: number;
  difficulty: Difficulty;
  stemAssetId?: string;
};

export type NormalizedPaperItem = {
  paperSourceKey: string;
  title: string;
  categoryId: string;
  summary: string;
  goal: string;
  difficulty: Difficulty;
  access: PaperAccess;
  suggestedMinutes: number;
  questionSourceKey: string;
  ord: number;
  points: number;
};

export function importBatchId(kind: ImportKind, fileHash: string): string {
  return hashNamedFields({ kind: "import_batch", importKind: kind, fileHash }, ["kind", "importKind", "fileHash"]);
}

export function importRowId(batchId: string, rowNo: number): string {
  return hashNamedFields({ kind: "import_row", batchId, rowNo }, ["kind", "batchId", "rowNo"]);
}

export function sourceKeyDocId(kind: ImportKind, sourceKey: string): string {
  return hashNamedFields({ kind: "source_key", importKind: kind, sourceKey }, ["kind", "importKind", "sourceKey"]);
}

export function questionIdForSourceKey(sourceKey: string): string {
  return hashNamedFields({ kind: "question", sourceKey }, ["kind", "sourceKey"]);
}

export function paperIdForSourceKey(sourceKey: string): string {
  return hashNamedFields({ kind: "paper", sourceKey }, ["kind", "sourceKey"]);
}

export function importLeaseToken(batchId: string, actorId: string): string {
  return hashNamedFields({ kind: "import_lease", batchId, actorId }, ["kind", "batchId", "actorId"]);
}

export function isImportKind(value: unknown): value is ImportKind {
  return value === "question" || value === "paper";
}

export function isImportPurpose(value: unknown): value is typeof IMPORT_PURPOSE {
  return value === IMPORT_PURPOSE;
}

export function isImportVisible(record: { importBatchId?: string }, batch?: Pick<ImportBatchRecord, "state">): boolean {
  if (!record.importBatchId) return true;
  return batch?.state === "committed";
}

export function looksLikeRemoteUrl(text: string): boolean {
  return /https?:\/\//i.test(text) || /\bwww\./i.test(text);
}

export function looksLikeFormula(text: string): boolean {
  const trimmed = text.replace(/^\uFEFF/, "").trimStart();
  return /^[=+\-@\t\r]/.test(trimmed);
}

export function sanitizeSpreadsheetCell(value: string): string {
  const text = String(value ?? "");
  if (looksLikeFormula(text)) return `'${text}`;
  return text;
}

export function decodeUtf8Strict(bytes: Uint8Array): { ok: true; text: string } | { ok: false; reason: string } {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { ok: false, reason: "NOT_UTF8" };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { ok: false, reason: "NOT_UTF8" };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, text: text.replace(/^\uFEFF/, "") };
  } catch {
    return { ok: false, reason: "NOT_UTF8" };
  }
}

export function parseCsv(text: string): { headers: string[]; rows: string[][]; issues: string[] } {
  const issues: string[] = [];
  const lines: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const input = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim().length > 0)) lines.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  if (inQuotes) issues.push("CSV 引号未闭合");
  row.push(field);
  if (row.some((cell) => cell.trim().length > 0)) lines.push(row);
  if (!lines.length) return { headers: [], rows: [], issues: [...issues, "CSV 没有表头"] };
  return {
    headers: (lines[0] || []).map((item) => item.trim()),
    rows: lines.slice(1),
    issues
  };
}

export function questionTemplateCsv(): string {
  const sample = [
    "q_fict_mw12_single_01",
    "请填入已有类目标识",
    "单选",
    "虚构题干：条件甲成立时应选哪一项？",
    "选项甲",
    "选项乙",
    "选项丙",
    "",
    "",
    "",
    "",
    "",
    "A",
    "因为条件甲成立，所以选甲。本行是虚构样例。",
    "5",
    "入门",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ];
  const multi = [
    "q_fict_mw12_multi_01",
    "请填入已有类目标识",
    "多选",
    "虚构题干：下列哪些说法同时成立？",
    "说法甲",
    "说法乙",
    "说法丙",
    "说法丁",
    "",
    "",
    "",
    "",
    "A|C",
    "虚构解析：甲与丙同时成立，乙丁不成立。",
    "8",
    "进阶",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ];
  const judge = [
    "q_fict_mw12_tf_01",
    "请填入已有类目标识",
    "判断",
    "虚构题干：条件乙必然推出结论丙。",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "FALSE",
    "虚构解析：条件乙不足以推出结论丙。",
    "3",
    "入门",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ];
  return [QUESTION_CSV_HEADERS.join(","), sample.join(","), multi.join(","), judge.join(",")].join("\n") + "\n";
}

export function paperTemplateCsv(): string {
  const row1 = [
    "paper_fict_mw12_01",
    "MW12虚构练习卷",
    "请填入已有类目标识",
    "虚构简介，只用于导入核验。",
    "练习条件判断",
    "入门",
    "免费",
    "20",
    "q_fict_mw12_single_01",
    "1",
    "5"
  ];
  const row2 = [
    "paper_fict_mw12_01",
    "MW12虚构练习卷",
    "请填入已有类目标识",
    "虚构简介，只用于导入核验。",
    "练习条件判断",
    "入门",
    "免费",
    "20",
    "q_fict_mw12_tf_01",
    "2",
    "3"
  ];
  return [PAPER_CSV_HEADERS.join(","), row1.join(","), row2.join(",")].join("\n") + "\n";
}

function cell(row: string[], headers: string[], name: string): string {
  const index = headers.indexOf(name);
  if (index < 0) return "";
  return (row[index] || "").trim();
}

function mapType(value: string): QuestionType | undefined {
  const raw = value.trim();
  if (raw === "单选" || raw === "single") return "single";
  if (raw === "多选" || raw === "multiple") return "multiple";
  if (raw === "判断" || raw === "trueFalse" || raw === "truefalse") return "trueFalse";
  return undefined;
}

function mapDifficulty(value: string): Difficulty | undefined {
  const raw = value.trim();
  if (raw === "入门" || raw === "beginner") return "beginner";
  if (raw === "进阶" || raw === "intermediate") return "intermediate";
  if (raw === "挑战" || raw === "challenge") return "challenge";
  return undefined;
}

function mapAccess(value: string): PaperAccess | undefined {
  const raw = value.trim();
  if (raw === "免费" || raw === "free") return "free";
  if (raw === "VIP" || raw === "vip") return "vip";
  return undefined;
}

function issue(
  rowNo: number,
  field: string,
  reason: string,
  example: string,
  blocking = true
): ImportIssue {
  return { rowNo, field, reason, example, blocking };
}

function rejectUnsafeText(value: string, rowNo: number, field: string, issues: ImportIssue[]): void {
  if (looksLikeRemoteUrl(value)) {
    issues.push(issue(rowNo, field, "按普通文本处理，不得包含远程 URL", "删除 http 链接，只保留文字"));
  }
}

export function validateSourceKey(value: string, rowNo: number, field: string): ImportIssue | undefined {
  if (!value) return issue(rowNo, field, "来源键必填", "q_fict_mw12_single_01");
  if (!SOURCE_KEY_RE.test(value) || value.length > SOURCE_KEY_MAX) {
    return issue(rowNo, field, "来源键须为 1—64 位字母数字、点、下划线或短横线", "q_fict_mw12_single_01");
  }
  return undefined;
}

export function headersMatch(actual: string[], expected: readonly string[]): string[] {
  const missing = expected.filter((name) => !actual.includes(name));
  const extra = actual.filter((name) => name && !expected.includes(name));
  const issues: string[] = [];
  if (missing.length) issues.push(`缺少列：${missing.join("、")}`);
  if (extra.length) issues.push(`未知列：${extra.join("、")}`);
  return issues;
}

export function inspectCsvLimits(bytes: Uint8Array): ImportIssue[] {
  if (bytes.length > IMPORT_MAX_BYTES) {
    return [issue(0, "file", `单文件不能超过 5 MB，当前 ${bytes.length} 字节`, "拆成不超过 5 MB 的 UTF-8 CSV")];
  }
  return [];
}

export type QuestionValidateContext = {
  categories: Map<string, { deletedAt: string | null; enabled: boolean }>;
  assets: Map<string, { state: string; kind: string }>;
  existingSourceKeys: Set<string>;
  existingStems: Set<string>;
};

export function validateQuestionCsv(
  text: string,
  ctx: QuestionValidateContext
): {
  issues: ImportIssue[];
  warnings: ImportIssue[];
  rows: NormalizedQuestionRow[];
  headerIssues: string[];
} {
  const parsed = parseCsv(text);
  const headerIssues = [...parsed.issues, ...headersMatch(parsed.headers, QUESTION_CSV_HEADERS)];
  const issues: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const rows: NormalizedQuestionRow[] = [];
  if (headerIssues.length) return { issues, warnings, rows, headerIssues };
  if (parsed.rows.length > IMPORT_MAX_ROWS) {
    issues.push(issue(0, "file", `最多 1000 个数据行，当前 ${parsed.rows.length} 行`, "拆成最多 1000 行"));
    return { issues, warnings, rows, headerIssues };
  }
  const seenKeys = new Map<string, number>();
  parsed.rows.forEach((raw, index) => {
    const rowNo = index + 2;
    const sourceKey = cell(raw, parsed.headers, "导入来源键");
    const categoryId = cell(raw, parsed.headers, "类目标识");
    const typeRaw = cell(raw, parsed.headers, "题型");
    const stem = cell(raw, parsed.headers, "题干");
    const answerRaw = cell(raw, parsed.headers, "正确答案");
    const analysis = cell(raw, parsed.headers, "解析");
    const pointsRaw = cell(raw, parsed.headers, "默认分值");
    const difficultyRaw = cell(raw, parsed.headers, "难度");
    const stemAssetId = cell(raw, parsed.headers, "题干图片素材标识");
    const keyIssue = validateSourceKey(sourceKey, rowNo, "导入来源键");
    if (keyIssue) issues.push(keyIssue);
    if (seenKeys.has(sourceKey)) {
      issues.push(issue(rowNo, "导入来源键", `与第 ${seenKeys.get(sourceKey)} 行来源键重复`, "每行使用不同来源键"));
    } else if (sourceKey) {
      seenKeys.set(sourceKey, rowNo);
    }
    if (ctx.existingSourceKeys.has(sourceKey)) {
      issues.push(issue(rowNo, "导入来源键", "来源键已存在，不覆盖原题", "换一个未用过的来源键，或到后台改原题"));
    }
    if (!categoryId) issues.push(issue(rowNo, "类目标识", "类目标识必填", "从类目树复制真实类目 ID"));
    const category = ctx.categories.get(categoryId);
    if (categoryId && (!category || category.deletedAt)) {
      issues.push(issue(rowNo, "类目标识", "类目不存在或已删除", "改用未删除的类目标识"));
    }
    const type = mapType(typeRaw);
    if (!type) issues.push(issue(rowNo, "题型", "题型只能是单选、多选或判断", "单选"));
    if (!stem) issues.push(issue(rowNo, "题干", "题干必填", "虚构题干：条件甲成立时应选哪一项？"));
    rejectUnsafeText(stem, rowNo, "题干", issues);
    if (!analysis) issues.push(issue(rowNo, "解析", "解析必填", "因为条件甲成立，所以选甲。"));
    rejectUnsafeText(analysis, rowNo, "解析", issues);
    const difficulty = mapDifficulty(difficultyRaw);
    if (!difficulty) issues.push(issue(rowNo, "难度", "难度只能是入门、进阶或挑战", "入门"));
    const points = Number(pointsRaw);
    if (!Number.isInteger(points) || points < DEFAULT_POINTS_MIN || points > DEFAULT_POINTS_MAX) {
      issues.push(issue(rowNo, "默认分值", "默认分值须为正整数", "5"));
    }
    const options: NormalizedQuestionRow["options"] = [];
    if (type === "trueFalse") {
      options.push({ optionId: "TRUE", text: TRUE_FALSE_OPTIONS[0].text }, { optionId: "FALSE", text: TRUE_FALSE_OPTIONS[1].text });
    } else {
      for (const letter of OPTION_LETTERS) {
        const text = cell(raw, parsed.headers, `选项${letter}`);
        const assetId = cell(raw, parsed.headers, `选项${letter}图片素材标识`);
        if (!text && !assetId) continue;
        if (!text) {
          issues.push(issue(rowNo, `选项${letter}`, "有图片时选项文字仍必填", "选项甲"));
          continue;
        }
        rejectUnsafeText(text, rowNo, `选项${letter}`, issues);
        if (assetId) {
          const asset = ctx.assets.get(assetId);
          if (!asset || asset.state !== "ready" || asset.kind !== "prompt") {
            issues.push(issue(rowNo, `选项${letter}图片素材标识`, "素材不存在或未 ready", "先上传题干/选项图并填真实素材标识"));
          }
        }
        options.push({ optionId: letter, text, ...(assetId ? { assetId } : {}) });
      }
      const min = type === "multiple" ? 3 : 2;
      if (options.length < min || options.length > 8) {
        issues.push(issue(rowNo, "选项A", type === "multiple" ? "多选至少 3 个选项" : "单选至少 2 个选项", "选项甲 / 选项乙 / 选项丙"));
      }
    }
    const answerIds =
      type === "trueFalse"
        ? [answerRaw === "FALSE" || answerRaw === "错误" ? "FALSE" : answerRaw === "TRUE" || answerRaw === "正确" ? "TRUE" : ""]
        : answerRaw
            .split("|")
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean);
    const optionIds = new Set(options.map((item) => item.optionId));
    if (!answerIds.length || answerIds.some((id) => !id)) {
      issues.push(issue(rowNo, "正确答案", type === "trueFalse" ? "判断答案须为 TRUE 或 FALSE" : "正确答案必填", type === "multiple" ? "A|C" : type === "trueFalse" ? "FALSE" : "A"));
    } else if (answerIds.some((id) => !optionIds.has(id))) {
      issues.push(issue(rowNo, "正确答案", "答案必须对应已填选项", type === "multiple" ? "A|C" : "A"));
    } else if (type === "single" && answerIds.length !== 1) {
      issues.push(issue(rowNo, "正确答案", "单选只能有一个答案", "A"));
    } else if (type === "multiple" && answerIds.length < 2) {
      issues.push(issue(rowNo, "正确答案", "多选至少两个答案，用 | 分隔", "A|C"));
    }
    if (stemAssetId) {
      const asset = ctx.assets.get(stemAssetId);
      if (!asset || asset.state !== "ready" || asset.kind !== "prompt") {
        issues.push(issue(rowNo, "题干图片素材标识", "素材不存在或未 ready", "先上传题干图并填真实素材标识"));
      }
    }
    if (stem && ctx.existingStems.has(stem)) {
      warnings.push(issue(rowNo, "题干", "题干与已有题目疑似重复，不阻断", "确认是否新题；首版不覆盖旧题", false));
    }
    if (issues.some((item) => item.rowNo === rowNo && item.blocking)) return;
    rows.push({
      sourceKey,
      categoryId,
      type: type as QuestionType,
      stem,
      options,
      answerIds,
      analysis,
      defaultPoints: points,
      difficulty: difficulty as Difficulty,
      ...(stemAssetId ? { stemAssetId } : {})
    });
  });
  return { issues, warnings, rows, headerIssues };
}

export type PaperValidateContext = {
  categories: Map<string, { deletedAt: string | null; enabled: boolean }>;
  usableQuestionKeys: Map<string, { questionId: string; status: string }>;
  existingPaperKeys: Set<string>;
};

export function validatePaperCsv(
  text: string,
  ctx: PaperValidateContext
): {
  issues: ImportIssue[];
  warnings: ImportIssue[];
  papers: Map<string, NormalizedPaperItem[]>;
  headerIssues: string[];
} {
  const parsed = parseCsv(text);
  const headerIssues = [...parsed.issues, ...headersMatch(parsed.headers, PAPER_CSV_HEADERS)];
  const issues: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const papers = new Map<string, NormalizedPaperItem[]>();
  if (headerIssues.length) return { issues, warnings, papers, headerIssues };
  if (parsed.rows.length > IMPORT_MAX_ROWS) {
    issues.push(issue(0, "file", `最多 1000 个数据行，当前 ${parsed.rows.length} 行`, "拆成最多 1000 行"));
    return { issues, warnings, papers, headerIssues };
  }
  const paperMeta = new Map<string, string>();
  parsed.rows.forEach((raw, index) => {
    const rowNo = index + 2;
    const paperSourceKey = cell(raw, parsed.headers, "试卷来源键");
    const title = cell(raw, parsed.headers, "标题");
    const categoryId = cell(raw, parsed.headers, "类目标识");
    const summary = cell(raw, parsed.headers, "简介");
    const goal = cell(raw, parsed.headers, "目标");
    const difficultyRaw = cell(raw, parsed.headers, "难度");
    const accessRaw = cell(raw, parsed.headers, "权限");
    const minutesRaw = cell(raw, parsed.headers, "建议时长");
    const questionSourceKey = cell(raw, parsed.headers, "题目来源键");
    const ordRaw = cell(raw, parsed.headers, "题序");
    const pointsRaw = cell(raw, parsed.headers, "该题分值");
    const keyIssue = validateSourceKey(paperSourceKey, rowNo, "试卷来源键");
    if (keyIssue) issues.push(keyIssue);
    if (ctx.existingPaperKeys.has(paperSourceKey)) {
      issues.push(issue(rowNo, "试卷来源键", "来源键已存在，不覆盖原卷", "换一个未用过的试卷来源键"));
    }
    if (!title) issues.push(issue(rowNo, "标题", "标题必填", "MW12虚构练习卷"));
    rejectUnsafeText(title, rowNo, "标题", issues);
    if (!categoryId) issues.push(issue(rowNo, "类目标识", "类目标识必填", "从类目树复制真实类目 ID"));
    const category = ctx.categories.get(categoryId);
    if (categoryId && (!category || category.deletedAt)) {
      issues.push(issue(rowNo, "类目标识", "类目不存在或已删除", "改用未删除的类目标识"));
    }
    if (!summary) issues.push(issue(rowNo, "简介", "简介必填", "虚构简介，只用于导入核验。"));
    rejectUnsafeText(summary, rowNo, "简介", issues);
    if (!goal) issues.push(issue(rowNo, "目标", "目标必填", "练习条件判断"));
    rejectUnsafeText(goal, rowNo, "目标", issues);
    const difficulty = mapDifficulty(difficultyRaw);
    if (!difficulty) issues.push(issue(rowNo, "难度", "难度只能是入门、进阶或挑战", "入门"));
    const access = mapAccess(accessRaw);
    if (!access) issues.push(issue(rowNo, "权限", "权限只能是免费或 VIP", "免费"));
    const minutes = Number(minutesRaw);
    if (!Number.isInteger(minutes) || minutes < PAPER_MINUTES_MIN || minutes > PAPER_MINUTES_MAX) {
      issues.push(issue(rowNo, "建议时长", "建议时长须为 1—300 的正整数", "20"));
    }
    const qKeyIssue = validateSourceKey(questionSourceKey, rowNo, "题目来源键");
    if (qKeyIssue) issues.push(qKeyIssue);
    const usable = ctx.usableQuestionKeys.get(questionSourceKey);
    if (questionSourceKey && (!usable || usable.status !== "active")) {
      issues.push(issue(rowNo, "题目来源键", "只能引用已存在且可用的题目来源键，须先导题库", "先提交题库批次，再填 q_fict_mw12_single_01"));
    }
    const ord = Number(ordRaw);
    if (!Number.isInteger(ord) || ord < 1) issues.push(issue(rowNo, "题序", "题序须为正整数且同一卷连续", "1"));
    const points = Number(pointsRaw);
    if (!Number.isInteger(points) || points < 1 || points > 100) {
      issues.push(issue(rowNo, "该题分值", "该题分值须为正整数", "5"));
    }
    const fingerprint = [title, categoryId, summary, goal, difficultyRaw, accessRaw, minutesRaw].join("\u0001");
    const prev = paperMeta.get(paperSourceKey);
    if (prev && prev !== fingerprint) {
      issues.push(issue(rowNo, "试卷来源键", "同一卷的卷级字段必须一致", "同一试卷来源键各行的标题/类目/权限保持相同"));
    } else if (paperSourceKey) {
      paperMeta.set(paperSourceKey, fingerprint);
    }
    if (issues.some((item) => item.rowNo === rowNo && item.blocking)) return;
    const item: NormalizedPaperItem = {
      paperSourceKey,
      title,
      categoryId,
      summary,
      goal,
      difficulty: difficulty as Difficulty,
      access: access as PaperAccess,
      suggestedMinutes: minutes,
      questionSourceKey,
      ord,
      points
    };
    const list = papers.get(paperSourceKey) || [];
    list.push(item);
    papers.set(paperSourceKey, list);
  });
  for (const [key, items] of papers) {
    const ords = items.map((item) => item.ord).sort((a, b) => a - b);
    if (items.length < PAPER_QUESTION_MIN || items.length > PAPER_QUESTION_MAX) {
      issues.push(issue(items[0]?.ord || 0, "题序", `每卷必须 1—100 题，来源键 ${key} 现有 ${items.length} 题`, "同一卷写 1 到 N 连续行"));
    }
    const seenOrd = new Set<number>();
    for (const item of items) {
      if (seenOrd.has(item.ord)) {
        issues.push(issue(item.ord, "题序", `试卷 ${key} 题序重复`, "题序改为连续不重复的 1、2、3"));
      }
      seenOrd.add(item.ord);
    }
    for (let i = 0; i < ords.length; i += 1) {
      if (ords[i] !== i + 1) {
        issues.push(issue(ords[i] || 0, "题序", `试卷 ${key} 题序必须从 1 连续递增`, "按 1、2、3 连续编号"));
        break;
      }
    }
  }
  return { issues, warnings, papers, headerIssues };
}

export function previewSummaryOf(input: {
  kind: ImportKind;
  rowCount: number;
  targetCount: number;
  warningCount: number;
  fileHash: string;
  catalogVersion: number;
  columnSpec: string;
}): string {
  return sha256Hex(
    JSON.stringify({
      kind: input.kind,
      rowCount: input.rowCount,
      targetCount: input.targetCount,
      warningCount: input.warningCount,
      fileHash: input.fileHash,
      catalogVersion: input.catalogVersion,
      columnSpec: input.columnSpec
    })
  );
}

export function validationHashOf(input: {
  fileHash: string;
  kind: ImportKind;
  catalogVersion: number;
  columnSpec: string;
  issues: ImportIssue[];
}): string {
  return sha256Hex(
    JSON.stringify({
      fileHash: input.fileHash,
      kind: input.kind,
      catalogVersion: input.catalogVersion,
      columnSpec: input.columnSpec,
      issues: input.issues
    })
  );
}

export function columnSpecOf(kind: ImportKind): string {
  return kind === "question" ? QUESTION_CSV_HEADERS.join(",") : PAPER_CSV_HEADERS.join(",");
}

export function fileHashOf(bytes: Uint8Array): string {
  return toHex(sha256Bytes(bytes.length ? bytes : utf8Bytes("")));
}

export function parseImportKindInput(data: Record<string, unknown>, fields: readonly string[]):
  | { ok: true; kind?: ImportKind; ticketId?: string; batchId?: string }
  | { ok: false; issues: string[] } {
  const extra = rejectUnknownKeys(data, [...fields]);
  const issues = extra.length ? [`unknown fields: ${extra.join(",")}`] : [];
  if (data.kind !== undefined && !isImportKind(data.kind)) issues.push("kind must be question or paper");
  if (data.ticketId !== undefined && (typeof data.ticketId !== "string" || !data.ticketId.trim())) {
    issues.push("ticketId must be a non-empty string");
  }
  if (data.batchId !== undefined && (typeof data.batchId !== "string" || !data.batchId.trim())) {
    issues.push("batchId must be a non-empty string");
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    kind: isImportKind(data.kind) ? data.kind : undefined,
    ticketId: typeof data.ticketId === "string" ? data.ticketId.trim() : undefined,
    batchId: typeof data.batchId === "string" ? data.batchId.trim() : undefined
  };
}

export function errorListForExport(issues: ImportIssue[]): Array<ImportIssue & { field: string; reason: string; example: string }> {
  return issues.map((item) => ({
    ...item,
    field: sanitizeSpreadsheetCell(item.field),
    reason: sanitizeSpreadsheetCell(item.reason),
    example: sanitizeSpreadsheetCell(item.example)
  }));
}

export function importCorrectionExamples(): Record<string, string> {
  return {
    multiAnswer: "A|C",
    trueFalse: "FALSE",
    type: "单选",
    difficulty: "入门",
    access: "免费"
  };
}
