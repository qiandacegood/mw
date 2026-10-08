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
