import type { ErrorCode } from "./errors.js";

export const API_VERSION = "1";

export type Difficulty = "beginner" | "intermediate" | "challenge";
export type PaperAccess = "free" | "vip";
export type PayState = "pending" | "confirming" | "paid" | "closed";
export type GrantState = "pending" | "processing" | "granted" | "error" | "revokedRemaining";
export type RefundState = "none" | "requested" | "processing" | "succeeded" | "failed";
export type RankingScope = "total" | "category" | "week" | "month";

export interface ApiRequest<T = Record<string, unknown>> {
  apiVersion: typeof API_VERSION;
  action: string;
  requestId: string;
  idempotencyKey?: string;
  data: T;
}

export interface ApiError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface ApiSuccess<T> {
  ok: true;
  requestId: string;
  serverTime: string;
  data: T;
  replayed?: boolean;
}

export interface ApiFailure {
  ok: false;
  requestId: string;
  error: ApiError;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface PaperDetailRequest {
  paperId: string;
}

export interface PaperDetailData {
  paperId: string;
  title: string;
  summary: string;
  goal: string;
  access: PaperAccess;
  difficulty: Difficulty;
  questionCount: number;
  maxScore: number;
  suggestedMinutes: number;
  categoryPath: string[];
}

export const UNANSWERED_FORBIDDEN_KEYS = [
  "answer",
  "analysis",
  "correctOptionIds",
  "analysisAssetIds",
  "analysisFileId",
  "question_versions"
] as const;
export const PAPER_DETAIL_FORBIDDEN_KEYS = UNANSWERED_FORBIDDEN_KEYS;

/** attempt.analysis 题目项：本人选择与正确答案分列，不用 optionIds 表示选择。 */
export interface AnalysisItem {
  questionId: string;
  selectedOptionIds: string[];
  correctOptionIds: string[];
  score: number;
  analysis: string;
}

export interface CategoryScoreNode {
  categoryId: string;
  directScore: number;
  inclusiveScore: number;
}

export interface SubmitResultData {
  attemptId: string;
  score: number;
  maxScore: number;
  correctCount: number;
  questionCount: number;
  bestScore: number;
  delta: number;
  totalScore: number;
  levelId: string;
  gradeRevision: number;
  submittedAt: string;
}

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
