import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { generateKey } from "near-kit";
import { afterEach, describe, expect, test, vi } from "vitest";

const ownerView = vi.fn();
const prepareAction = vi.fn();
const submitAction = vi.fn();
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
      saveRules: vi.fn(),
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
  rules: { asset: "wnear", maxPerPayout: "50", monthlyBudgetUsd: "500" },
  pending: ["Pay dave.near by withdrawal to their NEAR account"],
  applied: true,
  frozen: false,
  grant: null,
  actions: [],
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
  for (const fn of [ownerView, prepareAction, submitAction, signMessage]) fn.mockClear();
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

  test("rules can't be prepared while the agent's current rules aren't applied", async () => {
    ownerView.mockResolvedValue({ ...view, applied: false });
    renderActions();
    const button = await screen.findByRole("button", { name: "Prepare the updated rules" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
