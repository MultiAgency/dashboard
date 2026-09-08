import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function ensureAuthTypes(configDir: string) {
  const directory = resolve(configDir, ".bos/generated/auth");
  const exportPath = resolve(directory, "auth-export.d.ts");
  if (
    existsSync(exportPath) &&
    !readFileSync(exportPath, "utf8").includes("export type Auth = any;")
  ) {
    return;
  }
  if (!existsSync(resolve(directory, "contract.d.ts"))) {
    throw new Error("Auth contract types are missing. Run bos types gen successfully first.");
  }
  writeFileSync(
    exportPath,
    `import type { InferOutput } from "./contract";

export type AuthOrganizationContext = InferOutput<"getContext">["organization"];
export type AuthOrganizationSummary = NonNullable<AuthOrganizationContext["organization"]>;
`,
  );
}

if (import.meta.main) ensureAuthTypes(process.cwd());
