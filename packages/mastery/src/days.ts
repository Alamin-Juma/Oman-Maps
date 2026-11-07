const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

/** Local calendar day (YYYY-MM-DD) for a UTC instant at a fixed offset. */
export function localDay(isoUtc: string, utcOffsetMinutes: number): string {
  const t = Date.parse(isoUtc);
  if (Number.isNaN(t)) throw new Error(`invalid timestamp: ${isoUtc}`);
  return new Date(t + utcOffsetMinutes * MS_PER_MIN).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_PER_DAY);
}
