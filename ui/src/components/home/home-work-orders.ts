import { type InboxItem, inboxCategory, sortInbox } from "@/lib/work-orders-inbox";

export const IN_PROGRESS_LIMIT = 5;

export function waitingOnYou<T extends Pick<InboxItem, "status" | "progress">>(items: T[]): T[] {
  return sortInbox(items.filter((item) => item.progress.needsYou));
}

export function activeWorkOrders<T extends Pick<InboxItem, "status" | "progress">>(
  items: T[],
  limit = IN_PROGRESS_LIMIT,
): T[] {
  return sortInbox(
    items.filter((item) => {
      const category = inboxCategory(item);
      return category === "in-progress" || category === "builder";
    }),
  ).slice(0, limit);
}
