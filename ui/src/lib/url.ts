// Browser anchors execute `javascript:` / `data:` hrefs on click — gate user-supplied URLs to http(s).
// Schemeless input ("drive.google.com/...", "x.com/...") gets `https://` prepended; common in NEARN
// submission links. Returns the safe URL, or null when the input can't be normalized to http(s).
export function safeHttpHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+\-.]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    return u.protocol === "http:" || u.protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const REPOSITORY_REQUIRED = "REPOSITORY_REQUIRED";

export function repositoryUrlError(
  value: string,
  options: { submitted: boolean; error?: unknown },
): string | null {
  const trimmed = value.trim();
  if (trimmed && !isHttpUrl(trimmed)) return "Enter a full http(s) URL";
  const refusal = options.error as { message?: string; data?: { reason?: unknown } } | null;
  if (refusal?.data?.reason === REPOSITORY_REQUIRED) {
    return refusal.message || "Enter the repository URL for the new Project";
  }
  if (!trimmed && options.submitted) return "Enter the repository URL for the new Project";
  return null;
}
