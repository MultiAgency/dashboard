import { describe, expect, test } from "vitest";
import { nearToAtomic, topUpProposal, WNEAR_STORAGE } from "../../src/services/payouts/policy";

const DAO = "studio.sputnik-dao.near";
const DEPOSIT = "d49dd154a46c8f5d8f26efe0f8374a4daedca7b41a5ceaf3379e8356f3bd3b15";

function decoded(proposal: ReturnType<typeof topUpProposal>) {
  return proposal.kind.FunctionCall.actions.map((a) => ({
    method: a.method_name,
    args: JSON.parse(Buffer.from(a.args, "base64").toString("utf8")),
    deposit: BigInt(a.deposit),
  }));
}

describe("payout agent top-up proposal", () => {
  test("wraps the NEAR and sends it as wNEAR, the asset the deposit address watches", () => {
    const amount = BigInt(nearToAtomic("1.5"));
    const proposal = topUpProposal({
      daoAccountId: DAO,
      depositAddress: DEPOSIT,
      memo: null,
      amount,
      amountNear: "1.5",
    });
    expect(proposal.kind.FunctionCall.receiver_id).toBe("wrap.near");
    expect(decoded(proposal)).toEqual([
      {
        method: "storage_deposit",
        args: { account_id: DAO, registration_only: true },
        deposit: WNEAR_STORAGE,
      },
      { method: "near_deposit", args: {}, deposit: amount },
      {
        method: "storage_deposit",
        args: { account_id: DEPOSIT, registration_only: true },
        deposit: WNEAR_STORAGE,
      },
      {
        method: "ft_transfer",
        args: { receiver_id: DEPOSIT, amount: amount.toString() },
        deposit: 1n,
      },
    ]);
    expect(proposal.description).toMatch(
      /^Top up the MultiAgency payout agent with 1\.5 NEAR, wrapped as wNEAR/,
    );
    const gas = proposal.kind.FunctionCall.actions.reduce((total, a) => total + BigInt(a.gas), 0n);
    expect(gas).toBeLessThanOrEqual(60_000_000_000_000n);
  });

  test("passes the deposit's memo with the transfer", () => {
    const proposal = topUpProposal({
      daoAccountId: DAO,
      depositAddress: DEPOSIT,
      memo: "route-42",
      amount: 10n ** 24n,
      amountNear: "1",
    });
    expect(decoded(proposal).at(-1)?.args).toEqual({
      receiver_id: DEPOSIT,
      amount: (10n ** 24n).toString(),
      memo: "route-42",
    });
  });
});
