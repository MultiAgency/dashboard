import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

const oldPayoutPath = vi.fn();

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ platformAgent: { oldPayoutPath } }),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

const { Route } = await import("../src/routes/_authenticated/platform/old-payouts");
const OldPayouts = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component;

afterEach(() => {
  cleanup();
  oldPayoutPath.mockReset();
});

function renderPage() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <OldPayouts />
    </QueryClientProvider>,
  );
}

const organization = (extra: Record<string, unknown> = {}) => ({
  organizationId: "studio",
  name: "Studio",
  route: "legacy",
  oldAgentId: "agent-1",
  ownerAccountId: "rita.near",
  unsettledPayouts: 2,
  ownerActionsInFlight: 0,
  grantLiveUntil: null,
  blockers: [
    "2 old-path payouts aren't settled (held, processing, unknown or waiting for a check)",
  ],
  ...extra,
});

describe("the old payout path page", () => {
  test("says it isn't drained and lists what blocks each Organization", async () => {
    oldPayoutPath.mockResolvedValue({ drained: false, organizations: [organization()] });
    renderPage();
    expect(await screen.findByText("Not drained yet")).toBeTruthy();
    expect(screen.getByText("Studio")).toBeTruthy();
    expect(screen.getByText("pays through the old agent")).toBeTruthy();
    expect(screen.getByText(/2 old-path payouts aren't settled/)).toBeTruthy();
  });

  test("says it's drained, and still notes a live old permission", async () => {
    oldPayoutPath.mockResolvedValue({
      drained: true,
      organizations: [
        organization({
          route: "platform",
          unsettledPayouts: 0,
          blockers: [],
          grantLiveUntil: "2027-01-01T00:00:00.000Z",
        }),
      ],
    });
    renderPage();
    expect(await screen.findByText("Drained")).toBeTruthy();
    expect(screen.getByText(/old payout permission is live until/)).toBeTruthy();
  });
});
