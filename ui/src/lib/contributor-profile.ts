export function parseSkillsInput(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function formatSkillsInput(skills: string[]): string {
  return skills.join(", ");
}

export function buildContributorLinks(
  github: string,
  website: string,
): Record<string, string> | undefined {
  const links: Record<string, string> = {};
  const gh = github.trim();
  const site = website.trim();
  if (gh) links.github = gh;
  if (site) links.website = site;
  return Object.keys(links).length > 0 ? links : undefined;
}

export function splitContributorLinks(links: Record<string, string> | null | undefined): {
  github: string;
  website: string;
} {
  if (!links) return { github: "", website: "" };
  return {
    github: links.github ?? links.GitHub ?? "",
    website: links.website ?? links.Website ?? "",
  };
}
