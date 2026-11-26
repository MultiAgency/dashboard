import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { generateKey, verifyNep413Signature } from "near-kit";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AuthClient } from "../src/lib/auth";

const view = vi.fn();
const startConsent = vi.fn();
const setPayoutRoute = vi.fn();
const session = vi.fn(async () => ({ user: { role: "user" } }));

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    platformAgent: {
      view,
      startConsent,
      setPayoutRoute,
      overview: async () => {
        throw new Error("not connected");
      },
      unresolved: async () => [],
      held: async () => [],
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  useAuthClient: () => ({}),
  sessionQueryOptions: () => ({ queryKey: ["session"], queryFn: session }),
}));
vi.mock("@/hooks/use-me-roles", () => ({
  useMeRoles: () => ({ agencyDao: "studio.sputnik-dao.near", organizationId: "orgStudio" }),
}));

const { signPlatformText } = await import("../src/lib/platform-agent-signing");
const { SigningText } = await import("../src/components/platform-agent/signing-text");
const { PlatformAgentSection, PlatformAgentSettings } = await import(
  "../src/components/platform-agent/platform-agent-settings"
);

const HOST = "api.dev.multiagency.ai";
const CONSENT = JSON.stringify({
  type: "multiagency.app-consent",
  version: 1,
  host: HOST,
  deployment: "multiagency-dashboard",
  organization: "orgStudio",
  owner: "rita.near",
  agent: "own-abc",
  agentId: "agent-1",
  scopes: ["owner", "read"],
  expiresAt: "2027-02-23T12:00:00.000Z",
});
const NONCE = Buffer.alloc(32, 9).toString("base64");

function wallet(accountId: string) {
  const key = generateKey();
  const signMessage = vi.fn(
    async (params: { message: string; recipient: string; nonce: Uint8Array }) =>
      key.signNep413Message(accountId, params),
  );
  const authClient = {
    near: {
      ensureConnected: vi.fn(async () => true),
      getState: () => ({ accountId, publicKey: key.publicKey.toString(), networkId: "mainnet" }),
      getNearClient: () => ({ signMessage }),
    },
  } as unknown as AuthClient;
  return { authClient, signMessage, key };
}

afterEach(() => {
  cleanup();
  view.mockReset();
  startConsent.mockReset();
  setPayoutRoute.mockReset();
  session.mockImplementation(async () => ({ user: { role: "user" } }));
});

function renderWith(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const baseView = {
  available: true,
  unavailableReason: null,
  host: HOST,
  ownerAccountId: "rita.near",
  agent: "own-abc",
  agentId: "agent-1",
  setupPublicKey: null,
  retryable: false,
  create: null,
  consent: null,
  consents: [],
  consentDays: [30, 90, 365],
  payoutRoute: "legacy",
  error: null,
};

describe("platform agent signing", () => {
  test("the wallet gets exactly the text, the platform host and the nonce, with no callback URL", async () => {
    const { authClient, signMessage, key } = wallet("rita.near");
    const signed = await signPlatformText(authClient, "rita.near", {
      message: CONSENT,
      recipient: HOST,
      nonce: NONCE,
    });
    expect(signMessage).toHaveBeenCalledTimes(1);
    const [params, options] = signMessage.mock.calls[0] as unknown as [
      Record<string, unknown>,
      unknown,
    ];
    expect(Object.keys(params).sort()).toEqual(["message", "nonce", "recipient"]);
    expect(params.message).toBe(CONSENT);
    expect(params.recipient).toBe(HOST);
    expect(Buffer.from(params.nonce as Uint8Array).toString("base64")).toBe(NONCE);
    expect(options).toEqual({ signerId: "rita.near" });
    expect(signed.publicKey).toBe(key.publicKey.toString());
    await expect(
      verifyNep413Signature(
        { accountId: "rita.near", publicKey: signed.publicKey, signature: signed.signature },
        { message: CONSENT, recipient: HOST, nonce: Buffer.from(NONCE, "base64") },
        { maxAge: Number.POSITIVE_INFINITY },
      ),
    ).resolves.toBe(true);
  });

  test.each([
    ["the platform's sign-in text", `Sign in to ${HOST}`],
    ["another JSON text", JSON.stringify({ type: "multiagency.wallet-stop", host: HOST })],
  ])("never signs %s", async (_name, message) => {
    const { authClient, signMessage } = wallet("rita.near");
    await expect(
      signPlatformText(authClient, "rita.near", { message, recipient: HOST, nonce: NONCE }),
    ).rejects.toThrow(/only asks your wallet to sign a platform setup or consent/);
    expect(signMessage).not.toHaveBeenCalled();
  });

  test("a wallet connected as someone else than the owner is refused before signing", async () => {
    const { authClient, signMessage } = wallet("mallory.near");
    await expect(
      signPlatformText(authClient, "rita.near", {
        message: CONSENT,
        recipient: HOST,
        nonce: NONCE,
      }),
    ).rejects.toThrow(/Connect rita.near/);
    expect(signMessage).not.toHaveBeenCalled();
  });

  test("the signing view shows the text verbatim, its recipient and what each scope allows", () => {
    renderWith(<SigningText message={CONSENT} recipient={HOST} expiresAt="2026-11-25T12:15:00Z" />);
    expect(screen.getByText(CONSENT)).toBeTruthy();
    expect(screen.getAllByText(HOST).length).toBeGreaterThan(0);
    expect(screen.getByText(/Read the agent/)).toBeTruthy();
    expect(screen.getByText(/Prepare owner actions/)).toBeTruthy();
  });
});

describe("platform agent settings", () => {
  test("with platform access off, the section isn't shown", async () => {
    view.mockResolvedValue({ ...baseView, available: false, state: "off", signing: null });
    const { container } = renderWith(<PlatformAgentSection />);
    await vi.waitFor(() => expect(view).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  test("a pending consent shows its text and the owner to sign with", async () => {
    view.mockResolvedValue({
      ...baseView,
      state: "consent_pending",
      signing: {
        kind: "consent",
        message: CONSENT,
        recipient: HOST,
        nonce: NONCE,
        expiresAt: "2026-11-25T12:15:00Z",
      },
    });
    renderWith(<PlatformAgentSettings />);
    expect(await screen.findByText(CONSENT)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign with rita.near" })).toBeTruthy();
    expect(screen.getByText(/that wallet alone sets the payees and caps/)).toBeTruthy();
  });

  test("an unanswered submission offers to send the kept signature again", async () => {
    view.mockResolvedValue({ ...baseView, state: "setup_pending", signing: null, retryable: true });
    renderWith(<PlatformAgentSettings />);
    expect(await screen.findByRole("button", { name: "Send again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sign with/ })).toBeNull();
  });

  test("creation through the confirm page links to the platform host only", async () => {
    view.mockResolvedValue({
      ...baseView,
      agentId: null,
      state: "creating",
      signing: null,
      create: {
        correlationId: "corr-1",
        confirmUrl: `https://${HOST}/confirm/token`,
        expiresAt: "2026-11-25T12:10:00Z",
        status: "prepared",
      },
    });
    renderWith(<PlatformAgentSettings />);
    const link = await screen.findByRole("link", { name: "Open the confirm page" });
    expect(link.getAttribute("href")).toBe(`https://${HOST}/confirm/token`);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  const connected = (scopes: string[]) => ({
    ...baseView,
    state: "connected",
    signing: null,
    consent: { id: "c1", scopes, expiresAt: "2027-02-23T12:00:00Z", expiringSoon: false },
  });

  test("a consent can include payouts, and only a site admin sees the switch", async () => {
    view.mockResolvedValue(connected(["owner", "read"]));
    startConsent.mockResolvedValue(connected(["owner", "read"]));
    renderWith(<PlatformAgentSettings />);
    expect(await screen.findByText(/pays through/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/request payouts/));
    fireEvent.click(screen.getByRole("button", { name: "Prepare a consent" }));
    await vi.waitFor(() => expect(startConsent).toHaveBeenCalledWith({ days: 90, payout: true }));
    expect(screen.queryByRole("button", { name: /Site admin/ })).toBeNull();
  });

  test("a site admin switches an Organization with a payout consent to the platform", async () => {
    session.mockImplementation(async () => ({ user: { role: "admin" } }));
    view.mockResolvedValue(connected(["owner", "payout", "read"]));
    setPayoutRoute.mockResolvedValue({ organizationId: "orgStudio", route: "platform" });
    renderWith(<PlatformAgentSettings />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Site admin: pay through this platform agent" }),
    );
    await vi.waitFor(() =>
      expect(setPayoutRoute).toHaveBeenCalledWith({
        organizationId: "orgStudio",
        route: "platform",
      }),
    );
  });
});
