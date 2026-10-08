export function toUtcIso(date: Date): string {
  return date.toISOString();
}

export function beijingOffsetMs(): number {
  return 8 * 60 * 60 * 1000;
}

export function weekKeyShanghai(utc: Date): string {
  const shifted = new Date(utc.getTime() + beijingOffsetMs());
  const day = shifted.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + mondayOffset));
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const d = String(monday.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
