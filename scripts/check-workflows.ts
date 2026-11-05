import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const NO_INHERIT = ["staging.yml", "ci.yml", "deploy.yml"];
const SHA = /^[0-9a-f]{40}$/;

function triggers(text: string): string[] {
  const block = /^on:[ \t]*(.*)\n((?:[ \t]+.*\n|[ \t]*\n)*)/m.exec(text);
  if (!block) return [];
  const inline = (block[1] ?? "").replace(/#.*/, "").trim();
  if (inline)
    return inline
      .replace(/[[\]]/g, "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  return [...(block[2] ?? "").matchAll(/^ {2}([\w-]+)\s*:/gm)].map((m) => m[1] ?? "");
}

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
    if (
      file === "staging.yml" &&
      /\bRAILWAY_API_TOKEN\b|secrets\.RAILWAY_\w*API_TOKEN\b/.test(text)
    ) {
      problems.push(
        `${file}: uses a workspace-scoped Railway token (RAILWAY_API_TOKEN), which reaches every project in the workspace, production included`,
      );
    }
    if (file === "deploy.yml") {
      const automatic = triggers(text).filter((trigger) => trigger !== "workflow_dispatch");
      if (automatic.length > 0) {
        problems.push(
          `${file}: deploys production on ${automatic.join(", ")}; production deploys run by hand (workflow_dispatch only)`,
        );
      }
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
    "Workflows keep staging on its own project token, deploy production only by hand, pass no inherited secrets, and pin by SHA.",
  );
}
