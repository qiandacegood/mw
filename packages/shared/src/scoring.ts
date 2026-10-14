import { hashNamedFields } from "./canonical.js";
import { scoreObjectiveQuestion } from "./question.js";

export const METRIC_GENERATION_BASE = "base";
export const SCORE_EVENT_KIND_SUBMIT = "submit";
export const SCORE_METRIC_SCOPES = ["total", "week", "month", "category"] as const;
export type ScoreMetricScope = (typeof SCORE_METRIC_SCOPES)[number];

export const PAPER_BEST_ID_FIELDS = ["memberId", "paperId"] as const;
export const SCORE_EVENT_ID_FIELDS = ["attemptId", "gradeRevision"] as const;
export const SCORE_METRIC_ID_FIELDS = ["metricGeneration", "scope", "periodKey", "categoryId", "memberId"] as const;

export type PaperBestRecord = {
  memberId: string;
  paperId: string;
  bestScore: number;
  bestAttemptId: string;
  firstReachedAt: string;
  revision: number;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type ScoreEventRecord = {
  eventId: string;
  attemptId: string;
  gradeRevision: number;
  memberId: string;
  paperId: string;
  scoreSeq: number;
  score: number;
  delta: number;
  submittedAt: string;
  weekKey: string;
  monthKey: string;
  kind: typeof SCORE_EVENT_KIND_SUBMIT;
  schemaVersion: number;
  createdAt: string;
};

export type ScoreMetricRecord = {
  metricId: string;
  metricGeneration: string;
  scope: ScoreMetricScope;
  periodKey: string;
  categoryId: string;
  memberId: string;
  value: number;
  reachedAt: string;
  revision: number;
  schemaVersion: number;
  updatedAt: string;
};

export type GradeableQuestion = {
  questionId: string;
  points: number;
  optionIds: string[];
  correctOptionIds: string[];
  analysis: string;
};

export type GradedQuestion = {
  questionId: string;
  selectedOptionIds: string[];
  correctOptionIds: string[];
  score: number;
  analysis: string;
  unanswered: boolean;
};

export function paperBestId(memberId: string, paperId: string): string {
  return hashNamedFields({ memberId, paperId }, PAPER_BEST_ID_FIELDS);
}

export function scoreEventId(attemptId: string, gradeRevision: number): string {
  return hashNamedFields({ attemptId, gradeRevision }, SCORE_EVENT_ID_FIELDS);
}

export function scoreMetricId(input: {
  metricGeneration: string;
  scope: ScoreMetricScope;
  periodKey: string;
  categoryId: string;
  memberId: string;
}): string {
  return hashNamedFields(input, SCORE_METRIC_ID_FIELDS);
}

export function categoryMetricIdsOf(categoryId: string, ancestorIds: readonly string[]): string[] {
  const path = [...ancestorIds.filter(Boolean), categoryId].filter(Boolean);
  return [...new Set(path)].slice(-3);
}

export function applyScoreMetric(
  previous: { value: number; reachedAt: string } | undefined,
  delta: number,
  nowIso: string
): { value: number; reachedAt: string } {
  const value = (previous?.value ?? 0) + delta;
  if (delta === 0 && previous) {
    return { value, reachedAt: previous.reachedAt };
  }
  return { value, reachedAt: nowIso };
}

export function gradeSelectedAnswers(
  answers: Array<{ questionId: string; optionIds: string[] }>,
  questions: GradeableQuestion[]
): { score: number; correctCount: number; questionCount: number; items: GradedQuestion[] } {
  const selected = new Map(answers.map((row) => [row.questionId, row.optionIds]));
  const items = questions.map((question) => {
    const picked = selected.get(question.questionId) || [];
    const unanswered = picked.length === 0;
    const score = unanswered ? 0 : scoreObjectiveQuestion(picked, question.correctOptionIds, question.points);
    return {
      questionId: question.questionId,
      selectedOptionIds: [...picked],
      correctOptionIds: [...question.correctOptionIds],
      score,
      analysis: question.analysis,
      unanswered
    };
  });
  return {
    score: items.reduce((sum, item) => sum + item.score, 0),
    correctCount: items.filter((item) => item.score > 0).length,
    questionCount: questions.length,
    items
  };
}

export function paperDelta(previousBest: number, score: number): number {
  if (!Number.isInteger(previousBest) || !Number.isInteger(score)) {
    throw new Error("scores must be integers");
  }
  return Math.max(0, score - previousBest);
}

export function applyBestSequence(scores: number[]): { deltas: number[]; best: number } {
  let best = 0;
  const deltas = scores.map((score) => {
    const delta = paperDelta(best, score);
    best = Math.max(best, score);
    return delta;
  });
  return { deltas, best };
}

export interface PaperBest {
  paperId: string;
  categoryId: string;
  ancestorIds: string[];
  bestScore: number;
}

export function categoryScoreView(bests: PaperBest[]): {
  totalScore: number;
  nodes: { categoryId: string; directScore: number; inclusiveScore: number }[];
} {
  const ids = new Set<string>();
  for (const row of bests) {
    ids.add(row.categoryId);
    for (const ancestor of row.ancestorIds) ids.add(ancestor);
  }
  const nodes = [...ids].map((categoryId) => {
    const seen = new Set<string>();
    let directScore = 0;
    let inclusiveScore = 0;
    for (const row of bests) {
      if (seen.has(row.paperId)) continue;
      const inNode = row.categoryId === categoryId;
      const inTree = inNode || row.ancestorIds.includes(categoryId);
      if (inNode) {
        seen.add(row.paperId);
        directScore += row.bestScore;
        inclusiveScore += row.bestScore;
      } else if (inTree) {
        seen.add(row.paperId);
        inclusiveScore += row.bestScore;
      }
    }
    return { categoryId, directScore, inclusiveScore };
  });
  const totalSeen = new Set<string>();
  let totalScore = 0;
  for (const row of bests) {
    if (totalSeen.has(row.paperId)) continue;
    totalSeen.add(row.paperId);
    totalScore += row.bestScore;
  }
  return { totalScore, nodes };
}
