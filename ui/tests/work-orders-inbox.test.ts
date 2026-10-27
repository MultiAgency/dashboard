import { describe, expect, test } from "vitest";
import {
  defaultInboxView,
  filterInbox,
  type InboxItem,
  type InboxWaiting,
  inboxCategory,
  inboxCounts,
  isInboxView,
  relativeSince,
  sortInbox,
  waitingPhrase,
} from "@/lib/work-orders-inbox";

function item(
  code: string,
  over: {
    status?: string;
    waitingOn?: InboxWaiting;
    since?: string | null;
    headline?: string;
    builder?: string;
  } = {},
): InboxItem {
  const waitingOn = over.waitingOn === undefined ? "builder" : over.waitingOn;
  return {
    code,
    title: `${code} title`,
    status: over.status ?? "active",
    projectTitle: "Atlas",
    builder: { name: over.builder ?? "Carol", nearAccount: "carol.near" },
    progress: {
      needsYou: waitingOn === "you",
      waitingOn,
      since: over.since === undefined ? "2026-09-10T00:00:00.000Z" : over.since,
      headline: over.headline ?? "Work in progress",
    },
  };
}

describe("inboxCategory", () => {
  test("puts each work order in the bucket of who it waits on", () => {
    expect(inboxCategory(item("A", { waitingOn: "you" }))).toBe("needs-you");
    expect(inboxCategory(item("B", { waitingOn: "builder" }))).toBe("builder");
    expect(inboxCategory(item("C", { waitingOn: "system" }))).toBe("in-progress");
    expect(inboxCategory(item("D", { waitingOn: "dao" }))).toBe("in-progress");
  });

  test("finished work orders with nothing pending are done, others stay in progress", () => {
    expect(inboxCategory(item("A", { status: "ended", waitingOn: null }))).toBe("done");
    expect(inboxCategory(item("B", { status: "exhausted", waitingOn: null }))).toBe("done");
    expect(inboxCategory(item("C", { status: "terminated", waitingOn: null }))).toBe("done");
    expect(inboxCategory(item("D", { status: "active", waitingOn: null }))).toBe("in-progress");
    expect(inboxCategory(item("E", { status: "ended", waitingOn: "you" }))).toBe("needs-you");
  });
});

describe("inboxCounts and defaultInboxView", () => {
  test("counts every bucket and the total", () => {
    const counts = inboxCounts([
      item("A", { waitingOn: "you" }),
      item("B", { waitingOn: "you" }),
      item("C"),
      item("D", { waitingOn: "system" }),
      item("E", { status: "ended", waitingOn: null }),
    ]);
    expect(counts).toEqual({ "needs-you": 2, builder: 1, "in-progress": 1, done: 1, all: 5 });
    expect(defaultInboxView(counts)).toBe("needs-you");
  });

  test("defaults to all when nothing needs you", () => {
    expect(defaultInboxView(inboxCounts([item("A")]))).toBe("all");
    expect(defaultInboxView(inboxCounts([]))).toBe("all");
  });
});

describe("sortInbox", () => {
  test("needs-you first, then the longest waiting, then the original order", () => {
    const sorted = sortInbox([
      item("new-builder", { since: "2026-09-15T00:00:00.000Z" }),
      item("no-since", { since: null }),
      item("you-recent", { waitingOn: "you", since: "2026-09-18T00:00:00.000Z" }),
      item("old-builder", { since: "2026-09-01T00:00:00.000Z" }),
      item("you-old", { waitingOn: "you", since: "2026-09-02T00:00:00.000Z" }),
      item("tie-1", { since: "2026-09-10T00:00:00.000Z" }),
      item("tie-2", { since: "2026-09-10T00:00:00.000Z" }),
    ]);
    expect(sorted.map((w) => w.code)).toEqual([
      "you-old",
      "you-recent",
      "old-builder",
      "tie-1",
      "tie-2",
      "new-builder",
      "no-since",
    ]);
  });
});

describe("filterInbox", () => {
  const items = [
    item("WO-1", { waitingOn: "you", headline: "Sign it to send it to Carol" }),
    item("WO-2", { builder: "Dave" }),
    item("WO-3", { status: "ended", waitingOn: null, builder: "Dave" }),
  ];

  test("keeps only the selected bucket", () => {
    expect(filterInbox(items, "needs-you").map((w) => w.code)).toEqual(["WO-1"]);
    expect(filterInbox(items, "done").map((w) => w.code)).toEqual(["WO-3"]);
    expect(filterInbox(items, "all")).toHaveLength(3);
  });

  test("the text filter combines with the bucket and searches the headline too", () => {
    expect(filterInbox(items, "all", "dave").map((w) => w.code)).toEqual(["WO-2", "WO-3"]);
    expect(filterInbox(items, "builder", "dave").map((w) => w.code)).toEqual(["WO-2"]);
    expect(filterInbox(items, "all", "sign carol").map((w) => w.code)).toEqual(["WO-1"]);
    expect(filterInbox(items, "needs-you", "dave")).toEqual([]);
  });
});

describe("waitingPhrase", () => {
  test("names who the next step waits on", () => {
    expect(waitingPhrase("you", "Carol")).toBe("Waiting on you");
    expect(waitingPhrase("builder", "Carol")).toBe("Waiting on Carol");
    expect(waitingPhrase("builder", null)).toBe("Waiting on the builder");
    expect(waitingPhrase("system", "Carol")).toBe("Automatic");
    expect(waitingPhrase("dao", "Carol")).toBe("Waiting on the DAO");
    expect(waitingPhrase(null, "Carol")).toBeNull();
  });
});

describe("relativeSince", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");

  test("formats how long it has waited compactly", () => {
    expect(relativeSince("2026-09-20T11:59:40.000Z", now)).toBe("now");
    expect(relativeSince("2026-09-20T11:15:00.000Z", now)).toBe("45m");
    expect(relativeSince("2026-09-20T10:00:00.000Z", now)).toBe("2h");
    expect(relativeSince("2026-09-17T12:00:00.000Z", now)).toBe("3d");
    expect(relativeSince("2026-06-20T12:00:00.000Z", now)).toBe("3mo");
    expect(relativeSince("2023-09-20T12:00:00.000Z", now)).toBe("3y");
  });

  test("returns null without a usable date and never goes negative", () => {
    expect(relativeSince(null, now)).toBeNull();
    expect(relativeSince("not a date", now)).toBeNull();
    expect(relativeSince("2026-09-21T12:00:00.000Z", now)).toBe("now");
  });
});

describe("isInboxView", () => {
  test("accepts only known views", () => {
    expect(isInboxView("needs-you")).toBe(true);
    expect(isInboxView("all")).toBe(true);
    expect(isInboxView("everything")).toBe(false);
    expect(isInboxView(undefined)).toBe(false);
  });
});
