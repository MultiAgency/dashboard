import { type AnyColumn, and, eq, lt, or } from "drizzle-orm";

export const parseCursor = (cursor: string | undefined): { ts: Date; id: string } | null => {
  if (!cursor) return null;
  const idx = cursor.indexOf("|");
  if (idx === -1) return null;
  const ts = new Date(cursor.slice(0, idx));
  const id = cursor.slice(idx + 1);
  if (!id || Number.isNaN(ts.getTime())) return null;
  return { ts, id };
};

export const cursorOf = (ts: Date, id: string) => `${ts.toISOString()}|${id}`;

export const cursorWhere = (timeCol: AnyColumn, idCol: AnyColumn, cursor: string | undefined) => {
  const c = parseCursor(cursor);
  return c ? or(lt(timeCol, c.ts), and(eq(timeCol, c.ts), lt(idCol, c.id))) : undefined;
};
