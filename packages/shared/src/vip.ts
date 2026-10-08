export const SECONDS_PER_DAY = 86400;

export function durationSecondsFromDays(days: number): number {
  if (!Number.isInteger(days) || days <= 0) throw new Error("days must be a positive integer");
  return days * SECONDS_PER_DAY;
}

export function nextExpiresAt(input: {
  grantedAtMs: number;
  durationSeconds: number;
  currentExpiresAtMs: number | null;
}): number {
  const base =
    input.currentExpiresAtMs !== null && input.currentExpiresAtMs > input.grantedAtMs
      ? input.currentExpiresAtMs
      : input.grantedAtMs;
  return base + input.durationSeconds * 1000;
}

export function isVipActive(expiresAtMs: number, nowMs: number): boolean {
  return nowMs < expiresAtMs;
}
