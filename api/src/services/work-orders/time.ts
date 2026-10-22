const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return day.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export function startOfDay(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function dateOf(instant: number | Date): string {
  return new Date(instant).toISOString().slice(0, 10);
}

export function windowOf(scope: { periodStart: string; periodEnd: string; graceDays: number }): {
  from: string;
  to: string;
} {
  const from = startOfDay(scope.periodStart);
  const to = startOfDay(addDays(scope.periodEnd, scope.graceDays + 1)) - 1;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

export function nextPeriod(periodEnd: string): { periodStart: string; periodEnd: string } {
  const periodStart = addDays(periodEnd, 1);
  const [year, month, day] = periodStart.split("-").map(Number) as [number, number, number];
  const lastOfNext = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const sameDayNext = new Date(Date.UTC(year, month, Math.min(day, lastOfNext)))
    .toISOString()
    .slice(0, 10);
  return { periodStart, periodEnd: addDays(sameDayNext, -1) };
}
