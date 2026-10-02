export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
};

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const headerLine = columns.map((c) => escapeCell(c.header)).join(",");
  const bodyLines = rows.map((row) => columns.map((c) => escapeCell(c.value(row) ?? "")).join(","));
  return [headerLine, ...bodyLines].join("\n");
}

const FORMULA_START = /^[=+\-@\t\r]/;

function escapeCell(value: string | number): string {
  const raw = String(value);
  if (raw === "") return "";
  const s = typeof value === "string" && FORMULA_START.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]): void {
  const csv = toCsv(rows, columns);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function csvTimestamp(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
