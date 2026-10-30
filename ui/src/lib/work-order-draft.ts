export type StoredWorkOrderDraft<T> = { draft: T; custom: Record<string, string> };

export type WorkOrderDraftScope = {
  userId: string;
  network: string;
  organizationId: string | null;
};

const PREFIX = "work-order-draft:";

export function workOrderDraftKey(scope: WorkOrderDraftScope): string {
  return `${PREFIX}${scope.network}:${scope.userId}:${scope.organizationId ?? "personal"}`;
}

export function readWorkOrderDraft<T extends object>(
  scope: WorkOrderDraftScope,
): StoredWorkOrderDraft<T> | null {
  try {
    const raw = localStorage.getItem(workOrderDraftKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredWorkOrderDraft<T>> | null;
    if (!parsed || typeof parsed.draft !== "object" || parsed.draft === null) return null;
    const custom =
      parsed.custom && typeof parsed.custom === "object"
        ? Object.fromEntries(
            Object.entries(parsed.custom).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : {};
    return { draft: parsed.draft, custom };
  } catch {
    return null;
  }
}

export function writeWorkOrderDraft<T>(
  scope: WorkOrderDraftScope,
  value: StoredWorkOrderDraft<T>,
): void {
  try {
    localStorage.setItem(workOrderDraftKey(scope), JSON.stringify(value));
  } catch {}
}

export function clearWorkOrderDraft(scope: WorkOrderDraftScope): void {
  try {
    localStorage.removeItem(workOrderDraftKey(scope));
  } catch {}
}

export function clearAllWorkOrderDrafts(): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const key of keys) {
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {}
}

export function mergeStoredDraft<T extends Record<string, unknown>>(fresh: T, stored: object): T {
  const merged: Record<string, unknown> = { ...fresh };
  for (const [key, value] of Object.entries(stored)) {
    if (key in fresh && typeof value === typeof fresh[key]) merged[key] = value;
  }
  return merged as T;
}
