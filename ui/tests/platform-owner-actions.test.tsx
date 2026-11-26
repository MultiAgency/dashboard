import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { generateKey } from "near-kit";
import { afterEach, describe, expect, test, vi } from "vitest";

const ownerView = vi.fn();
const prepareAction = vi.fn();
const submitAction = vi.fn();
const saveRules = vi.fn();
const deposit = vi.fn(async () => null as unknown);
const fundAgent = vi.fn();
const key = generateKey();
const signMessage = vi.fn(
  async (params: { message: string; recipient: string; nonce: Uint8Array }) =>
    key.signNep413Message("rita.near", params),
);

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    platformAgent: {
      ownerView,
      prepareAction,
      submitAction,
      saveRules,
      deposit,
      fundAgent,
      followAction: vi.fn(),
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  useAuthClient: () => ({
    near: {
      ensureConnected: async () => true,
      getState: () => ({ accountId: "rita.near", publicKey: key.publicKey.toString() }),
      getNearClient: () => ({ signMessage }),
    },
  }),
}));

const { PlatformOwnerActions } = await import(
  "../src/components/platform-agent/platform-owner-actions"
);

const HOST = "api.dev.multiagency.ai";
const view = {
  rules: { asset: "wnear", maxPerPayout: "50", monthlyBudgetUsd: "500", ownerApproval: false },
  pending: ["Pay dave.near by withdrawal to their NEAR account"],
  applied: true,
  frozen: false,
  grant: null,
  held: [],
  actions: [],
};
const heldPayout = {
  approvalId: "appr-1",
  correlationId: "held-1",
  at: "2026-11-25T10:00:00Z",
  recipient: "dave.near",
  amount: "2000000000000000000000000",
  asset: "nep141:wrap.near",
  chain: "near",
  terms: {
    compensationRequestId: "req-1",
    workOrderId: "wo-1",
    workOrderTitle: "Site build",
    approvedAmount: "10000000",
    tokenId: "usd",
    priceUsd: "5",
  },
};
const action = (overrides: Record<string, unknown>) => ({
  correlationId: "corr-1",
  kind: "rules",
  summary: "Pay dave.near by withdrawal to their NEAR account",
  status: "prepared",
  open: true,
  confirmUrl: null,
  expiresAt: "2026-11-25T12:10:00Z",
  createdAt: "2026-11-25T12:00:00Z",
  ...overrides,
});

function renderActions() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PlatformOwnerActions owner="rita.near" host={HOST} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  for (const fn of [ownerView, prepareAction, submitAction, signMessage, saveRules, fundAgent]) {
    fn.mockClear();
  }
  deposit.mockReset();
  deposit.mockResolvedValue(null);
});

describe("platform owner actions", () => {
  test("a readable edit is shown, signed by the owner's wallet exactly as prepared, and submitted once", async () => {
    ownerView.mockResolvedValue(view);
    const intent = {
      standard: "nep413" as const,
      payload: {
        message: "policy text",
        recipient: "outlayer.near",
        nonce: Buffer.alloc(32, 3).toString("base64"),
      },
    };
    prepareAction.mockResolvedValue({
      action: action({}),
      intent,
      preview: { summary: "Update the payees", before: null, after: { owner_approval: false } },
    });
    submitAction.mockResolvedValue(action({ status: "SUCCESS", open: false }));
    renderActions();

    expect(
      await screen.findByText("Pay dave.near by withdrawal to their NEAR account"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Prepare the updated rules" }));
    await vi.waitFor(() => expect(prepareAction).toHaveBeenCalledWith({ kind: "rules" }));
    expect(await screen.findByText("The platform prepared: Update the payees")).toBeTruthy();
    expect(screen.getByText("policy text")).toBeTruthy();
    expect(screen.getByText("outlayer.near")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Sign with rita.near" }));
    await vi.waitFor(() => expect(submitAction).toHaveBeenCalledTimes(1));
    const [params] = signMessage.mock.calls[0] as unknown as [
      { message: string; recipient: string },
    ];
    expect(params.message).toBe("policy text");
    expect(params.recipient).toBe("outlayer.near");
    expect(submitAction.mock.calls[0]?.[0]).toMatchObject({
      correlationId: "corr-1",
      signedData: { standard: "nep413", public_key: key.publicKey.toString() },
    });
  });

  test("an action signed on the confirm page links there and offers no wallet signature here", async () => {
    ownerView.mockResolvedValue({
      ...view,
      pending: [],
      actions: [
        action({
          kind: "freeze",
          summary: "Freeze the agent",
          confirmUrl: `https://${HOST}/confirm/t`,
        }),
      ],
    });
    renderActions();
    const link = await screen.findByRole("link", { name: "Sign on the confirm page" });
    expect(link.getAttribute("href")).toBe(`https://${HOST}/confirm/t`);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByRole("button", { name: /Sign with/ })).toBeNull();
  });

  test("while an action is open the view is read again every 15 seconds, and not once none is", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      ownerView.mockResolvedValue({ ...view, pending: [], actions: [action({})] });
      renderActions();
      await screen.findByText("Pay dave.near by withdrawal to their NEAR account");
      expect(ownerView).toHaveBeenCalledTimes(1);

      ownerView.mockResolvedValue({
        ...view,
        pending: [],
        actions: [action({ status: "SUCCESS", open: false })],
      });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(ownerView).toHaveBeenCalledTimes(2);
      expect(await screen.findByText("success")).toBeTruthy();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(ownerView).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a held payout shows its payee, amount and work order beside the owner's vote", async () => {
    ownerView.mockResolvedValue({ ...view, pending: [], held: [heldPayout] });
    prepareAction.mockResolvedValue({
      action: action({ kind: "payout_vote", summary: "Approve paying 2 wNEAR to dave.near" }),
      intent: null,
      preview: null,
    });
    renderActions();

    expect(
      await screen.findByText(/2 wNEAR to dave\.near by withdrawal to their NEAR account/),
    ).toBeTruthy();
    expect(
      screen.getByText(/"Site build": \$10 approved, converted at 5 USD per wNEAR/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reject it" }));
    await vi.waitFor(() =>
      expect(prepareAction).toHaveBeenCalledWith({
        kind: "payout_vote",
        approvalId: "appr-1",
        verdict: "reject",
      }),
    );
  });

  test("a held payout that isn't one of the dashboard's says so", async () => {
    ownerView.mockResolvedValue({ ...view, pending: [], held: [{ ...heldPayout, terms: null }] });
    renderActions();
    expect(await screen.findByText(/Not one of this dashboard's work-order payouts/)).toBeTruthy();
  });

  test("the owner's vote on each payout is saved with the rules", async () => {
    ownerView.mockResolvedValue({ ...view, pending: [] });
    saveRules.mockResolvedValue({ ...view, pending: [] });
    renderActions();
    fireEvent.click(await screen.findByRole("checkbox", { name: /waits for the owner's vote/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save the rules" }));
    await vi.waitFor(() =>
      expect(saveRules).toHaveBeenCalledWith({ ...view.rules, ownerApproval: true }),
    );
  });

  test("funding asks for a deposit address and shows it with its minimum and expiry", async () => {
    ownerView.mockResolvedValue({ ...view, pending: [] });
    const ready = {
      requestId: "deposit-1",
      asset: "nep141:wrap.near",
      symbol: "wNEAR",
      decimals: 24,
      state: "ready",
      usable: true,
      address: "deposit-address-1",
      memo: null,
      minAmount: "100000000000000000000000",
      expiresAt: "2026-11-25T13:00:00Z",
      code: null,
    };
    fundAgent.mockResolvedValue(ready);
    renderActions();
    const ask = await screen.findByRole("button", { name: "Get a deposit address" });
    deposit.mockResolvedValue(ready);
    fireEvent.click(ask);
    await vi.waitFor(() => expect(fundAgent).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("deposit-address-1")).toBeTruthy();
    expect(screen.getByText("At least 0.1 wNEAR.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Get a deposit address" })).toBeNull();
  });

  test("rules can't be prepared while the agent's current rules aren't applied", async () => {
    ownerView.mockResolvedValue({ ...view, applied: false });
    renderActions();
    const button = await screen.findByRole("button", { name: "Prepare the updated rules" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
