import { sha256Hex } from "@mw/shared";

const leftoverPaperIdSet = new Set<string>();

export function markLeftoverPaperId(paperId: string): boolean {
  const id = String(paperId || "").trim();
  if (!id) return false;
  leftoverPaperIdSet.add(id);
  return true;
}

export function leftoverPaperIdList(): string[] {
  return [...leftoverPaperIdSet];
}

export function resetLeftoverPaperIds(): void {
  leftoverPaperIdSet.clear();
}

export function knownIdPayload(): { papers: string[] } {
  return { papers: leftoverPaperIdList().map((id) => sha256Hex(id)) };
}

export function knownIdClipboardText(): string {
  return JSON.stringify(knownIdPayload());
}
