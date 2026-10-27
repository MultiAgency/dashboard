import type { ApiClient } from "./api";

export type SetupCheck = Awaited<ReturnType<ApiClient["workOrders"]["setupStatus"]>>[number];

export type SetupState = SetupCheck["state"];

export function setupSummary(checks: SetupCheck[]) {
  const counted = checks.filter((c) => c.required || c.state !== "optional");
  const blocking = checks.filter((c) => c.required && c.state === "missing");
  return {
    done: counted.filter((c) => c.state === "ok").length,
    total: counted.length,
    blocking,
    attention: checks.filter((c) => c.state === "missing" || c.state === "warning"),
    ready: blocking.length === 0,
  };
}

export function fixTarget(href: string): { path: string; hash: string | null } {
  const at = href.indexOf("#");
  if (at === -1) return { path: href, hash: null };
  return { path: href.slice(0, at), hash: href.slice(at + 1) || null };
}

export function setupDismissKey(organizationId: string | null) {
  return `work-order-setup-dismissed-${organizationId ?? "none"}`;
}
