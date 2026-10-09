import { describe, expect, it } from "vitest";
import {
  applyPublishFault,
  assemblePaperSnapshot,
  assertSnapshotClosed,
  decodePaperListCursor,
  encodePaperListCursor,
  overlappingPaperIds,
  paperChunkId,
  paperListCursorMatches,
  paperNewStartGate,
  parseHomeGetInput,
  parsePaperListInput,
  parsePaperSaveInput
} from "./paper.js";
import type { QuestionVersionRecord } from "./question.js";

function version(id: string, questionId: string): QuestionVersionRecord {
  return {
    versionId: id,
    questionId,
    type: "single",
    stem: { text: `题干${questionId}`, assetIds: [] },
    options: [
      { optionId: "A", text: "甲", assetIds: [] },
      { optionId: "B", text: "乙", assetIds: [] }
    ],
    answer: { optionIds: ["A"] },
    analysis: { text: "解析", assetIds: [] },
    assetIds: [],
    defaultPoints: 5,
    difficulty: "beginner",
    categoryId: "cat",
    schemaVersion: 1,
    createdAt: "2026-10-09T00:00:00.000Z",
    createdBy: "admin"
  };
}

function items(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    questionId: `q${index + 1}`,
    versionId: `v${index + 1}`,
    points: 5,
    ord: index + 1
  }));
}

function versions(count: number) {
  return Array.from({ length: count }, (_, index) => version(`v${index + 1}`, `q${index + 1}`));
}

describe("MW11 paper snapshot rules", () => {
  it("assembles 1 and 21 questions across chunks and computes maxScore", () => {
    const one = assemblePaperSnapshot({
      paperId: "p1",
      revision: 1,
      items: items(1),
      versions: versions(1),
      categoryPathSnapshot: ["逻辑思维"],
      createdAt: "2026-10-09T00:00:00.000Z",
      createdBy: "admin"
    });
    expect(one.ok).toBe(true);
    if (one.ok) {
      expect(one.chunks).toHaveLength(1);
      expect(one.version.maxScore).toBe(5);
      expect(one.version.questionCount).toBe(1);
    }

    const many = assemblePaperSnapshot({
      paperId: "p21",
      revision: 2,
      items: items(21),
      versions: versions(21),
      categoryPathSnapshot: ["逻辑思维"],
      createdAt: "2026-10-09T00:00:00.000Z",
      createdBy: "admin"
    });
    expect(many.ok).toBe(true);
    if (many.ok) {
      expect(many.chunks).toHaveLength(2);
      expect(many.chunks[0]?.items).toHaveLength(20);
      expect(many.chunks[1]?.items).toHaveLength(1);
      expect(many.version.maxScore).toBe(105);
      expect(many.chunks[0]?.chunkId).toBe(paperChunkId(many.version.versionId, 1));
    }
  });

  it("rejects illegal question count, points and unknown fields", () => {
    expect(assemblePaperSnapshot({
      paperId: "p0",
      revision: 1,
      items: [],
      versions: [],
      categoryPathSnapshot: [],
      createdAt: "2026-10-09T00:00:00.000Z",
      createdBy: "admin"
    }).ok).toBe(false);

    expect(assemblePaperSnapshot({
      paperId: "pbad",
      revision: 1,
      items: [{ questionId: "q1", versionId: "v1", points: 0, ord: 1 }],
      versions: versions(1),
      categoryPathSnapshot: [],
      createdAt: "2026-10-09T00:00:00.000Z",
      createdBy: "admin"
    }).ok).toBe(false);

    const parsed = parsePaperSaveInput({
      expectedRevision: 0,
      title: "卷",
      summary: "简介",
      goal: "目标",
      categoryId: "c",
      access: "free",
      difficulty: "beginner",
      sort: 10,
      leak: true,
      items: [{ questionId: "q1", versionId: "v1", points: 5, extra: 1 }]
    });
    expect(parsed.ok).toBe(false);
  });

  it("refuses missing chunks and bad manifest", () => {
    const built = assemblePaperSnapshot({
      paperId: "p2",
      revision: 1,
      items: items(21),
      versions: versions(21),
      categoryPathSnapshot: ["逻辑思维"],
      createdAt: "2026-10-09T00:00:00.000Z",
      createdBy: "admin"
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const missing = applyPublishFault(built, "missingChunk");
    expect(assertSnapshotClosed(missing.version, missing.chunks, missing.answers).ok).toBe(false);
    const bad = applyPublishFault(built, "badManifest");
    expect(assertSnapshotClosed(bad.version, bad.chunks, bad.answers).ok).toBe(false);
  });

  it("treats unpublish and withdraw as different start gates", () => {
    expect(paperNewStartGate("unpublished")).toMatchObject({ blocked: true, reason: "PAPER_UNPUBLISHED" });
    expect(paperNewStartGate("withdrawn")).toMatchObject({ blocked: true, code: "PAPER_WITHDRAWN" });
    expect(paperNewStartGate("published")).toEqual({ blocked: false });
  });

  it("parses public list filters, opaque cursors and empty home.get", () => {
    const parsed = parsePaperListInput(
      {
        categoryId: "c1",
        includeDescendants: true,
        difficulty: "beginner",
        access: "free",
        progress: "undone",
        sort: "recommended",
        limit: 10
      },
      true
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const cursor = encodePaperListCursor({
      sort: parsed.sort,
      categoryId: parsed.categoryId || "",
      includeDescendants: parsed.includeDescendants,
      difficulty: parsed.difficulty || "",
      access: parsed.access || "",
      progress: parsed.progress || "",
      afterKey: "00000010",
      afterId: "p1",
      gen: 3
    });
    expect(cursor.includes(".")).toBe(true);
    const decoded = decodePaperListCursor(cursor);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(
        paperListCursorMatches(decoded.payload, {
          sort: parsed.sort,
          categoryId: parsed.categoryId || "",
          includeDescendants: parsed.includeDescendants,
          difficulty: parsed.difficulty || "",
          access: parsed.access || "",
          progress: parsed.progress || "",
          gen: 3
        })
      ).toBe(true);
    }
    expect(parsePaperListInput({ freeOnly: true }, true).ok).toBe(false);
    expect(parseHomeGetInput({}).ok).toBe(true);
    expect(parseHomeGetInput({ access: "free" }).ok).toBe(false);
  });

  it("flags highly overlapping question sets", () => {
    const hits = overlappingPaperIds(
      ["a", "b", "c", "d", "e"],
      [{ paperId: "other", questionIds: ["a", "b", "c", "d", "x"] }]
    );
    expect(hits).toEqual(["other"]);
  });
});
