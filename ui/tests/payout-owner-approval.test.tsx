import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const payoutAgent = vi.fn();

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    workOrders: {
      payoutAgent,
      payoutFunding: async () => ({ items: [], neededNear: "0", topUpNear: "0" }),
    },
  }),
}));

vi.mock("@/lib/auth", () => ({ useAuthClient: () => ({}) }));
vi.mock("@/hooks/use-me-roles", () => ({ useMeRoles: () => ({ agencyDao: null }) }));

const { PayoutAgentSettings } = await import("../src/components/work-orders/payout-agent-settings");

afterEach(() => {
  cleanup();
  payoutAgent.mockReset();
});

const view = (ownerApproval: boolean) => ({
  available: true,
  unavailableReason: null,
  settings: { ownerAccountId: "rita.near", monthlyBudgetUsd: "5000", maxPayoutNear: "500" },
  agentId: "agent-1",
  grantExpiresAt: null,
  grantValid: true,
  grantExpiringSoon: false,
  policy: {
    status: "APPLIED",
    frozen: false,
    ownerApproval,
    payees: ["carol.near"],
    monthlyLimitUsd: "5000",
    monthlySpentUsd: null,
    monthlyRemainingUsd: null,
    monthlyResetsAt: null,
    policyChangeAvailableAt: null,
  },
  changes: [],
  balance: null,
  ready: true,
  blockers: [],
  error: null,
});

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PayoutAgentSettings />
    </QueryClientProvider>,
  );
}

describe("owner approval in payout settings", () => {
  test.each([
    [true, "on. Each payout waits for the owner's vote."],
    [false, "off. Approved payouts are sent without another signature."],
  ])("shows owner approval %s read-only", async (ownerApproval, text) => {
    payoutAgent.mockResolvedValue(view(ownerApproval));
    renderSettings();

    expect(await screen.findByText(new RegExp(`Owner approval:\\s*${text}`))).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /owner approval/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /owner approval/i })).toBeNull();
  });
});
