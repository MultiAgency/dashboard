const PLACEHOLDERS = new Set(["test", "demo", "agency", "my agency", "untitled", "example"]);

export function isPlaceholderAgencyName(
  name: string | null | undefined,
  organizationId?: string | null,
): boolean {
  const value = name?.trim() ?? "";
  if (value.length < 3) return true;
  if (organizationId && value === organizationId) return true;
  return PLACEHOLDERS.has(value.toLowerCase().replace(/\s+/g, " "));
}
