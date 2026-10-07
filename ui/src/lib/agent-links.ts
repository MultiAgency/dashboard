// Agent links are suppressed for now. The screens and API stay in the code; set this to true to
// show them again.
export const agentLinksEnabled: boolean = false;

export function moveLink(ids: string[], id: string, offset: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
