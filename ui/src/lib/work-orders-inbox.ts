export const INBOX_VIEWS = ["needs-you", "builder", "in-progress", "done", "all"] as const;

export type InboxView = (typeof INBOX_VIEWS)[number];

export type InboxCategory = Exclude<InboxView, "all">;

export type InboxWaiting = "you" | "builder" | "system" | "dao" | null;

export type InboxItem = {
  code: string;
  title: string;
  status: string;
  projectTitle: string;
  builder: { name: string | null; nearAccount: string };
  progress: { needsYou: boolean; waitingOn: InboxWaiting; since: string | null; headline: string };
};

export const INBOX_VIEW_LABELS: Record<InboxView, string> = {
  "needs-you": "Needs you",
  builder: "Waiting on builder",
  "in-progress": "In progress",
  done: "Done",
  all: "All",
};

export const INBOX_EMPTY: Record<InboxView, { title: string; hint: string }> = {
  "needs-you": {
    title: "Nothing needs you right now",
    hint: "Work orders show up here when they need a signature, an approval or a decision from you.",
  },
  builder: {
    title: "No work orders are waiting on a builder",
    hint: "Offers to sign and payout requests to send show up here.",
  },
  "in-progress": {
    title: "Nothing is in progress",
    hint: "Signed work orders that start on their own and payouts on their way show up here.",
  },
  done: {
    title: "No finished work orders yet",
    hint: "Work orders land here once they end, use their budget or are terminated.",
  },
  all: {
    title: "No work orders yet",
    hint: "Create a work order to give a builder a period, a budget cap and repositories in scope.",
  },
};

const ENDED = new Set(["ended", "exhausted", "terminated"]);

export function isInboxView(value: unknown): value is InboxView {
  return typeof value === "string" && (INBOX_VIEWS as readonly string[]).includes(value);
}

export function inboxCategory(item: Pick<InboxItem, "status" | "progress">): InboxCategory {
  if (item.progress.needsYou) return "needs-you";
  if (item.progress.waitingOn === "builder") return "builder";
  if (item.progress.waitingOn === null && ENDED.has(item.status)) return "done";
  return "in-progress";
}

export function inboxCounts(items: Pick<InboxItem, "status" | "progress">[]) {
  const counts: Record<InboxView, number> = {
    "needs-you": 0,
    builder: 0,
    "in-progress": 0,
    done: 0,
    all: items.length,
  };
  for (const item of items) counts[inboxCategory(item)] += 1;
  return counts;
}

export function defaultInboxView(counts: Record<InboxView, number>): InboxView {
  return counts["needs-you"] > 0 ? "needs-you" : "all";
}

function sinceTime(since: string | null): number {
  if (!since) return Number.POSITIVE_INFINITY;
  const time = Date.parse(since);
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

export function sortInbox<T extends Pick<InboxItem, "progress">>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index, since: sinceTime(item.progress.since) }))
    .sort((a, b) => {
      if (a.item.progress.needsYou !== b.item.progress.needsYou) {
        return a.item.progress.needsYou ? -1 : 1;
      }
      if (a.since !== b.since) return a.since < b.since ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

function matches(item: InboxItem, query: string): boolean {
  const haystack = [
    item.code,
    item.title,
    item.projectTitle,
    item.builder.name ?? "",
    item.builder.nearAccount,
    item.progress.headline,
  ]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

export function filterInbox<T extends InboxItem>(items: T[], view: InboxView, query = ""): T[] {
  return sortInbox(
    items.filter(
      (item) => (view === "all" || inboxCategory(item) === view) && matches(item, query),
    ),
  );
}

export function waitingLabel(waitingOn: InboxWaiting, builderName: string | null): string {
  switch (waitingOn) {
    case "you":
      return "You";
    case "builder":
      return builderName ?? "Builder";
    case "system":
      return "Automatic";
    case "dao":
      return "DAO";
    default:
      return "—";
  }
}

export function relativeSince(since: string | null, now: Date = new Date()): string | null {
  if (!since) return null;
  const time = Date.parse(since);
  if (Number.isNaN(time)) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - time) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}
