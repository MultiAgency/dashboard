const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
export const UTC = "UTC";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterOf(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function partsOf(instant: number, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const part of formatterOf(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

function offsetOf(instant: number, timeZone: string): number {
  const p = partsOf(instant, timeZone);
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return local - Math.floor(instant / 1000) * 1000;
}

export function isTimeZone(value: string): boolean {
  try {
    formatterOf(value);
    return true;
  } catch {
    return false;
  }
}

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

export function startOfDay(date: string, timeZone: string = UTC): number {
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (timeZone === UTC) return midnight;
  const guess = midnight - offsetOf(midnight, timeZone);
  return midnight - offsetOf(guess, timeZone);
}

export function dateOf(instant: number | Date, timeZone: string = UTC): string {
  const ms = typeof instant === "number" ? instant : instant.getTime();
  if (timeZone === UTC) return new Date(ms).toISOString().slice(0, 10);
  const p = partsOf(ms, timeZone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function windowOf(scope: {
  periodStart: string;
  periodEnd: string;
  graceDays: number;
  timeZone?: string;
}): {
  from: string;
  to: string;
} {
  const from = startOfDay(scope.periodStart, scope.timeZone);
  const to = startOfDay(addDays(scope.periodEnd, scope.graceDays + 1), scope.timeZone) - 1;
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
