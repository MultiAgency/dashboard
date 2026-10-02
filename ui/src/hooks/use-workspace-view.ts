import { useSyncExternalStore } from "react";
import { useMeRoles } from "@/hooks/use-me-roles";
import { availableViews, resolveView, type WorkspaceView } from "@/lib/navigation";

const listeners = new Set<() => void>();

function storageKey(organizationId: string | null) {
  return `workspace-view-${organizationId ?? "none"}`;
}

function readView(organizationId: string | null): WorkspaceView | null {
  try {
    const stored = localStorage.getItem(storageKey(organizationId));
    return stored === "agency" || stored === "client" ? stored : null;
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function setWorkspaceView(organizationId: string | null, view: WorkspaceView) {
  try {
    localStorage.setItem(storageKey(organizationId), view);
  } catch {}
  for (const listener of listeners) listener();
}

export function useWorkspaceView() {
  const roles = useMeRoles();
  const access = {
    hasAgencySections: roles.hasAgencySections,
    hasClientSections: roles.hasClientSections,
  };
  const preferred = useSyncExternalStore(
    subscribe,
    () => readView(roles.organizationId),
    () => null,
  );
  return {
    ...roles,
    view: resolveView(access, preferred),
    views: availableViews(access),
    setView: (view: WorkspaceView) => setWorkspaceView(roles.organizationId, view),
  };
}
