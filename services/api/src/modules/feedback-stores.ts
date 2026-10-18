import type { FeedbackRecord } from "@mw/shared";

export const FEEDBACK_COLLECTION = "feedbacks";

export interface FeedbackStore {
  get(feedbackId: string): Promise<FeedbackRecord | undefined>;
  save(record: FeedbackRecord): Promise<void>;
  list(input: { status?: string; limit: number }): Promise<FeedbackRecord[]>;
  listByMember?(memberId: string): Promise<FeedbackRecord[]>;
}

function cloneFeedback(row: FeedbackRecord): FeedbackRecord {
  return { ...row };
}

export function memoryFeedbackStore(seed: FeedbackRecord[] = []): FeedbackStore & {
  rows: Map<string, FeedbackRecord>;
} {
  const rows = new Map(seed.map((row) => [row.feedbackId, cloneFeedback(row)]));
  return {
    rows,
    async get(feedbackId) {
      const row = rows.get(feedbackId);
      return row ? cloneFeedback(row) : undefined;
    },
    async save(record) {
      rows.set(record.feedbackId, cloneFeedback(record));
    },
    async list(input) {
      return [...rows.values()]
        .filter((row) => (input.status ? row.status === input.status : true))
        .sort((left, right) => {
          if (left.createdAt === right.createdAt) return left.feedbackId.localeCompare(right.feedbackId);
          return right.createdAt.localeCompare(left.createdAt);
        })
        .slice(0, input.limit)
        .map(cloneFeedback);
    },
    async listByMember(memberId) {
      return [...rows.values()].filter((row) => row.memberId === memberId).map(cloneFeedback);
    }
  };
}
