import { readFileSync, writeFileSync } from "node:fs";

const DEPLOYMENT_FIELDS = new Set([
  "production",
  "integrity",
  "ssr",
  "ssrIntegrity",
  "baseUrl",
  "appOrigin",
]);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export class MergeConflict extends Error {}

const isObject = (value: unknown): value is { [key: string]: Json } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function mergeBosConfig(
  base: Json | undefined,
  ours: Json | undefined,
  theirs: Json | undefined,
  path: string[] = [],
): Json | undefined {
  if (DEPLOYMENT_FIELDS.has(path.at(-1) ?? "")) return ours;
  if (isObject(ours) && isObject(theirs)) {
    const baseObject = isObject(base) ? base : {};
    const merged: { [key: string]: Json } = {};
    for (const key of [...Object.keys(ours), ...Object.keys(theirs).filter((k) => !(k in ours))]) {
      const value = mergeBosConfig(baseObject[key], ours[key], theirs[key], [...path, key]);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  if (same(ours, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (same(base, theirs)) return ours;
  throw new MergeConflict(`both sides changed ${path.join(".") || "the file"} differently`);
}

if (import.meta.main) {
  const [basePath, oursPath, theirsPath] = process.argv.slice(2);
  if (!basePath || !oursPath || !theirsPath) {
    console.error("usage: bun scripts/merge-bos-config.ts <base> <ours> <theirs>");
    process.exit(2);
  }
  const read = (file: string): Json | undefined => {
    const text = readFileSync(file, "utf8");
    return text.trim() ? (JSON.parse(text) as Json) : undefined;
  };
  try {
    const merged = mergeBosConfig(read(basePath), read(oursPath), read(theirsPath));
    writeFileSync(oursPath, `${JSON.stringify(merged, null, 2)}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`bos.config.json: ${reason}; resolve it by hand.`);
    Bun.spawnSync(["git", "merge-file", "-L", "ours", "-L", "base", "-L", "theirs", oursPath, basePath, theirsPath]);
    process.exit(1);
  }
}
