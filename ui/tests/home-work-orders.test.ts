import { describe, expect, it } from "vitest";
import { activeWorkOrders, waitingOnYou } from "../src/components/home/home-work-orders";

type Waiting = "you" | "builder" | "system" | "dao" | null;

const order = (
  code: string,
  status: string,
  needsYou: boolean,
  waitingOn: Waiting,
  since: string,
) => ({
  code,
  status,
  progress: { needsYou, waitingOn, since, headline: code },
});

const orders = [
  order("WO-1", "active", false, "system", "2026-01-03"),
  order("WO-2", "offered", true, "you", "2026-01-02"),
  order("WO-3", "offered", false, "builder", "2026-01-01"),
  order("WO-4", "ended", false, null, "2026-01-01"),
  order("WO-5", "active", true, "you", "2026-01-01"),
];

describe("home work orders", () => {
  it("lists only work orders waiting on you, oldest first", () => {
    expect(waitingOnYou(orders).map((o) => o.code)).toEqual(["WO-5", "WO-2"]);
  });

  it("lists a few active work orders, leaving out the ones waiting on you and the finished ones", () => {
    expect(activeWorkOrders(orders).map((o) => o.code)).toEqual(["WO-3", "WO-1"]);
    expect(activeWorkOrders(orders, 1).map((o) => o.code)).toEqual(["WO-3"]);
  });
});
