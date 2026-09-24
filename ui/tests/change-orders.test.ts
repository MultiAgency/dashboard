import { describe, expect, test } from "vitest";
import {
  awaitingCountFor,
  awaitingLink,
  failureMessage,
  planChangeItems,
  prepaidBalanceLegs,
  signedBaseAmount,
} from "../src/lib/change-orders";

const line = (projectId: string, amount: string, tokenId = "near") => ({
  projectId,
  tokenId,
  amount,
});

describe("planChangeItems", () => {
  test("turns an edited plan into plan-change deltas against the current plan", () => {
    expect(
      planChangeItems(
        [line("site", "300"), line("app", "200")],
        [line("site", "500"), line("app", "200"), line("docs", "100")],
      ),
    ).toEqual([
      { projectId: "site", tokenId: "near", kind: "plan_change", amount: "200" },
      { projectId: "docs", tokenId: "near", kind: "plan_change", amount: "100" },
    ]);
  });

  test("removing a line or setting it to zero takes it out of the plan", () => {
    expect(planChangeItems([line("site", "300"), line("app", "200")], [line("app", "0")])).toEqual([
      { projectId: "app", tokenId: "near", kind: "plan_change", amount: "-200" },
      { projectId: "site", tokenId: "near", kind: "plan_change", amount: "-300" },
    ]);
  });

  test("an unchanged plan proposes nothing", () => {
    expect(planChangeItems([line("site", "300")], [line("site", "300")])).toEqual([]);
  });
});

describe("prepaidBalanceLegs", () => {
  test("puts the opposite of what moves into Projects on the Prepaid balance, per token", () => {
    expect(
      prepaidBalanceLegs([
        { projectId: "site", tokenId: "near", kind: "one_off_move", amount: "400" },
        { projectId: "app", tokenId: "near", kind: "one_off_move", amount: "-100" },
        { projectId: "app", tokenId: "usdc", kind: "one_off_move", amount: "-5" },
      ]),
    ).toEqual([
      { projectId: null, tokenId: "near", kind: "one_off_move", amount: "-300" },
      { projectId: null, tokenId: "usdc", kind: "one_off_move", amount: "5" },
    ]);
  });

  test("a move between Projects leaves the Prepaid balance alone", () => {
    expect(
      prepaidBalanceLegs([
        { projectId: "site", tokenId: "near", kind: "one_off_move", amount: "-250" },
        { projectId: "app", tokenId: "near", kind: "one_off_move", amount: "250" },
      ]),
    ).toEqual([]);
  });
});

describe("signedBaseAmount", () => {
  test("reads signed decimal amounts for known decimals", () => {
    expect(signedBaseAmount("-1.5", 24)).toEqual({
      value: "-1500000000000000000000000",
      error: "",
    });
    expect(signedBaseAmount("2", 6)).toEqual({ value: "2000000", error: "" });
  });

  test("reads smallest units when decimals are unknown and refuses zero or garbage", () => {
    expect(signedBaseAmount("-42", undefined)).toEqual({ value: "-42", error: "" });
    expect(signedBaseAmount("0", 24).error).not.toBe("");
    expect(signedBaseAmount("1.5", undefined).error).not.toBe("");
    expect(signedBaseAmount("", 24)).toEqual({ value: "", error: "" });
  });
});

describe("failureMessage", () => {
  test("explains why a Change order could not be applied", () => {
    expect(failureMessage("PREPAID_BALANCE_EXCEEDED")).toMatch(/Prepaid balance/);
    expect(failureMessage("REMAINING_EXCEEDED")).toMatch(/Allocated, Committed or Paid/);
    expect(failureMessage("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("awaitingCountFor", () => {
  test("counts the Change orders awaiting the viewer on one Engagement", () => {
    const awaiting = [{ engagementId: "e1" }, { engagementId: "e2" }, { engagementId: "e1" }];
    expect(awaitingCountFor(awaiting, "e1")).toBe(2);
    expect(awaitingCountFor(awaiting, "e3")).toBe(0);
  });
});

describe("awaitingLink", () => {
  test("opens the viewer's own side of the Engagement", () => {
    expect(awaitingLink({ engagementId: "e1", proposedBy: { side: "agency" } })).toBe(
      "/client/e1/plan",
    );
    expect(awaitingLink({ engagementId: "e1", proposedBy: { side: "client" } })).toBe(
      "/admin/engagements/e1?tab=plan",
    );
  });
});
