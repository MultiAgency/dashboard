export function isoDate(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function monthRange(year: number, month: number) {
  return { start: isoDate(new Date(year, month, 1)), end: isoDate(new Date(year, month + 1, 0)) };
}

export const MONTH_PRESETS = [
  { label: "This month", range: (now: Date) => monthRange(now.getFullYear(), now.getMonth()) },
  { label: "Last month", range: (now: Date) => monthRange(now.getFullYear(), now.getMonth() - 1) },
];
