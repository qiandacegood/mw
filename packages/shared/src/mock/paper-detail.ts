import { errorMessage, type ErrorCode } from "../errors.js";
import { hasForbiddenAnswerKeys, parseApiRequest } from "../validate.js";
import type { ApiRequest, ApiResponse, PaperDetailData } from "../types.js";

const CATALOG: Record<string, PaperDetailData> = {
  paper_fict_logic_l3: {
    paperId: "paper_fict_logic_l3",
    title: "条件判断练习（虚构）",
    summary: "识别充分条件与反例（虚构简介）",
    goal: "练习条件判断",
    access: "vip",
    difficulty: "challenge",
    questionCount: 20,
    maxScore: 80,
    suggestedMinutes: 25,
    categoryPath: ["逻辑思维", "演绎推理", "条件判断"]
  },
  paper_fict_logic_l1: {
    paperId: "paper_fict_logic_l1",
    title: "逻辑入门练习（虚构）",
    summary: "入门卷（虚构）",
    goal: "熟悉题型",
    access: "free",
    difficulty: "beginner",
    questionCount: 10,
    maxScore: 50,
    suggestedMinutes: 15,
    categoryPath: ["逻辑思维"]
  }
};

export function isoNow(now = new Date()): string {
  return now.toISOString();
}

export function fail(requestId: string, code: ErrorCode, retryable = false, details?: Record<string, unknown>): ApiResponse<never> {
  return {
    ok: false,
    requestId,
    error: { code, message: errorMessage(code), retryable, details }
  };
}

export function handlePaperDetail(input: unknown, now = new Date()): ApiResponse<PaperDetailData> {
  const parsed = parseApiRequest(input);
  const requestId = typeof (input as { requestId?: string } | null)?.requestId === "string"
    ? (input as ApiRequest).requestId
    : "missing";
  if (parsed.issues.length || !parsed.request) {
    return fail(requestId, "INVALID_ARGUMENT", false, { issues: parsed.issues });
  }
  const req = parsed.request;
  if (req.action !== "paper.detail") {
    return fail(req.requestId, "INVALID_ARGUMENT", false, { action: req.action });
  }
  const extra = Object.keys(req.data).filter((key) => key !== "paperId");
  if (extra.length) return fail(req.requestId, "INVALID_ARGUMENT", false, { unknown: extra });
  const paperId = req.data.paperId;
  if (typeof paperId !== "string" || paperId.length === 0) {
    return fail(req.requestId, "INVALID_ARGUMENT", false, { field: "paperId" });
  }
  const paper = CATALOG[paperId];
  if (!paper) return fail(req.requestId, "NOT_FOUND");
  const leaked = hasForbiddenAnswerKeys(paper);
  if (leaked.length) return fail(req.requestId, "INTERNAL_ERROR", false, { leaked });
  return {
    ok: true,
    requestId: req.requestId,
    serverTime: isoNow(now),
    data: paper
  };
}
