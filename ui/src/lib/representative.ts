type Person = { name?: string | null; email?: string | null } | null | undefined;

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  const value = email?.trim().toLowerCase() ?? "";
  return value === "" || value.endsWith("@near.email");
}

export function defaultRepresentative(
  organizationDefault: Person,
  me: Person,
): { name: string; email: string } {
  const orgEmail = organizationDefault?.email?.trim() ?? "";
  const orgName = organizationDefault?.name?.trim() ?? "";
  if (orgEmail || orgName) return { name: orgName, email: orgEmail };
  const myEmail = me?.email?.trim() ?? "";
  return {
    name: me?.name?.trim() ?? "",
    email: isPlaceholderEmail(myEmail) ? "" : myEmail,
  };
}
