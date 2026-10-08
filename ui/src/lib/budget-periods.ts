const DAY_MS = 86_400_000;

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  return formatDay(new Date(parseDay(day).getTime() + days * DAY_MS));
}

function addMonths(day: string, months: number): string {
  const date = parseDay(day);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return formatDay(target);
}

function isLastDayOfMonth(day: string): boolean {
  return parseDay(addDays(day, 1)).getUTCDate() === 1;
}

export function nextCycle(start: string, end: string): { start: string; end: string } {
  const nextStart = addDays(end, 1);
  for (let months = 1; months <= 12; months++) {
    if (addDays(addMonths(start, months), -1) === end) {
      return { start: nextStart, end: addDays(addMonths(nextStart, months), -1) };
    }
  }
  if (isLastDayOfMonth(end)) {
    return { start: nextStart, end: addDays(addMonths(nextStart, 1), -1) };
  }
  const days = Math.round((parseDay(end).getTime() - parseDay(start).getTime()) / DAY_MS);
  return { start: nextStart, end: addDays(nextStart, days) };
}

export function formatPeriod(start: string, end: string | null): string {
  return end && end !== start ? `${start} – ${end}` : start;
}

export function periodError(start: string, end: string): string | null {
  if (!end) return null;
  if (!start) return "Set a start date before an end date";
  if (end < start) return "The end date must be on or after the start date";
  return null;
}
