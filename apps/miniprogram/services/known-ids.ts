import { sha256Hex } from "@mw/shared";

const leftoverPaperIdSet = new Set<string>();
const leftoverAttemptIdSet = new Set<string>();

export function markLeftoverPaperId(paperId: string): boolean {
  const id = String(paperId || "").trim();
  if (!id) return false;
  leftoverPaperIdSet.add(id);
  return true;
}

export function markLeftoverAttemptId(attemptId: string): boolean {
  const id = String(attemptId || "").trim();
  if (!id) return false;
  leftoverAttemptIdSet.add(id);
  return true;
}

export function leftoverPaperIdList(): string[] {
  return [...leftoverPaperIdSet];
}

export function leftoverAttemptIdList(): string[] {
  return [...leftoverAttemptIdSet];
}

export function resetLeftoverPaperIds(): void {
  leftoverPaperIdSet.clear();
}

export function resetLeftoverAttemptIds(): void {
  leftoverAttemptIdSet.clear();
}

export function knownIdPayload(): { papers: string[]; attempts: string[] } {
  return {
    papers: leftoverPaperIdList().map((id) => sha256Hex(id)),
    attempts: leftoverAttemptIdList().map((id) => sha256Hex(id))
  };
}

export function knownIdClipboardText(): string {
  return JSON.stringify(knownIdPayload());
}
