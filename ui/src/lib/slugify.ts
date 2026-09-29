export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isValidSlug(slug: string): boolean {
  return slug.length >= 1 && slug.length <= 80 && SLUG_PATTERN.test(slug);
}

export function suggestSlug(slug: string): string {
  const match = slug.match(/^(.*[^\d-])-(\d+)$/);
  const base = match ? match[1]! : slug;
  const suffix = `-${match ? Number(match[2]) + 1 : 2}`;
  return `${base.slice(0, 80 - suffix.length).replace(/-+$/, "")}${suffix}`;
}

export async function availableSlug(
  slug: string,
  isTaken: (candidate: string) => Promise<boolean>,
  attempts = 5,
): Promise<string | null> {
  let candidate = slug;
  for (let i = 0; i < attempts; i++) {
    candidate = suggestSlug(candidate);
    if (!(await isTaken(candidate))) return candidate;
  }
  return null;
}

export function isSlugTakenError(error: unknown): boolean {
  const data = (error as { data?: { validationErrors?: Array<{ code?: string }> } } | null)?.data;
  return data?.validationErrors?.some((e) => e.code === "SLUG_TAKEN") ?? false;
}

const ORGANIZATION_SLUG_TAKEN = ["ORGANIZATION_ALREADY_EXISTS", "ORGANIZATION_SLUG_ALREADY_TAKEN"];

export function isOrganizationSlugTaken(code: string | undefined): boolean {
  return !!code && ORGANIZATION_SLUG_TAKEN.includes(code);
}
