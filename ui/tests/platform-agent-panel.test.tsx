import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const overview = vi.fn();
const held = vi.fn();

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    platformAgent: {
      overview,
      held,
      unresolved: async () => [],
      activity: async () => [],
      ledger: async () => [],
      policyHistory: async () => [],
      ownerActions: async () => [],
    },
  }),
}));

const { PlatformAgentPanel } = await import(
  "../src/components/platform-agent/platform-agent-panel"
);

const ETH = "nep141:eth.omft.near";
const WNEAR = "nep141:wrap.near";
const report = {
  agentId: "own-1",
  revision: 4,
  status: "SUCCESS",
  synced: true,
  notInForce: null,
  frozen: false,
  ownerApproval: false,
  assets: [WNEAR],
  perTransaction: { [WNEAR]: "1000000000000000000000000" },
  budget: { dailyUsd: null, weeklyUsd: null, monthlyUsd: "10" },
  monthly: {
    limitUsd: "10",
    spentUsd: "0.4567",
    remainingUsd: "9.5433",
    resetsAt: null,
  },
  destinations: [],
  agreed: [],
  policyChangeAvailableAt: null,
  book: [
    {
      asset: ETH,
      symbol: "ETH",
      decimals: 18,
      public: "1500000000000000000",
      confidential: "0",
      usd: null,
    },
  ],
  grants: [],
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PlatformAgentPanel />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  overview.mockReset();
  held.mockReset();
});

describe("platform agent panel", () => {
  test("the month's spending is in dollars and cents, and held tokens use the platform's units", async () => {
    overview.mockResolvedValue(report);
    held.mockResolvedValue([
      {
        correlationId: "h1",
        amount: "250000000000000000",
        asset: ETH,
        recipient: "dave.near",
        chain: null,
        at: null,
      },
    ]);
    renderPanel();

    expect(await screen.findByText(/\$0\.46 of \$10\.00 this month/)).toBeTruthy();
    expect(screen.getByText("Holds: 1.5 ETH")).toBeTruthy();
    expect(screen.getByText("Per payout at most: 1 wNEAR.")).toBeTruthy();
    expect(await screen.findByText(/0\.25 ETH to dave\.near/)).toBeTruthy();
  });

  test("a month without a limit says so", async () => {
    overview.mockResolvedValue({
      ...report,
      monthly: { ...report.monthly, limitUsd: null, spentUsd: "3" },
    });
    held.mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByText(/\$3\.00 of no limit this month/)).toBeTruthy();
  });
});
