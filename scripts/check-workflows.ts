import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const NO_INHERIT = ["staging.yml", "ci.yml"];
const SHA = /^[0-9a-f]{40}$/;

export function checkWorkflows(directory: string): string[] {
  const problems: string[] = [];
  const files = readdirSync(directory)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort();
  for (const file of files) {
    const text = readFileSync(join(directory, file), "utf8");
    if (NO_INHERIT.includes(file) && /^\s*secrets:\s*inherit\s*$/m.test(text)) {
      problems.push(`${file}: passes every repository secret (secrets: inherit)`);
    }
    if (file === "staging.yml" && /secrets\.RAILWAY_TOKEN\b/.test(text)) {
      problems.push(`${file}: reads secrets.RAILWAY_TOKEN, production's Railway token`);
    }
    for (const match of text.matchAll(
      /^\s*uses:\s*([^\s#]+\/\.github\/workflows\/[^\s#@]+)@([^\s#]+)/gm,
    )) {
      if (!SHA.test(match[2] ?? "")) {
        problems.push(`${file}: ${match[1]} is pinned to "${match[2]}", not a commit SHA`);
      }
    }
  }
  return problems;
}

if (import.meta.url === `file://${resolve(process.argv[1] ?? "")}`) {
  const problems = checkWorkflows(process.argv[2] ?? ".github/workflows");
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log(
    "Workflows keep staging on its own token, pass no inherited secrets, and pin by SHA.",
  );
}
