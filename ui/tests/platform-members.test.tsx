import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

const list = vi.fn();
const recordAgreement = vi.fn();

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ members: { list, recordAgreement } }),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

const { Route } = await import("../src/routes/_layout/_authenticated/platform/members");
const PlatformMembers = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component;

afterEach(() => {
  cleanup();
  list.mockReset();
  recordAgreement.mockReset();
});

const member = (githubLogin: string, extra: Record<string, unknown> = {}) => ({
  githubLogin,
  kind: "human",
  operatorGithubLogin: null,
  name: null,
  skills: [],
  nearAccount: null,
  accounts: [],
  admissions: [{ network: "testnet", status: "admitted", proofUrl: null, admittedAt: null }],
  agreement: null,
  ...extra,
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlatformMembers />
    </QueryClientProvider>,
  );
}

describe("Platform members", () => {
  test("lists every member with their admissions and agreement on file", async () => {
    list.mockResolvedValue({
      data: [
        member("ada", {
          agreement: {
            version: "2026-09",
            attestedAt: "2026-10-01T00:00:00.000Z",
            recordedBy: "platform",
            recordedAt: "2026-10-02T00:00:00.000Z",
          },
        }),
        member("ada-bot", { kind: "agent", operatorGithubLogin: "ada" }),
      ],
    });
    renderPage();

    const adaRow = (
      await screen.findByRole("link", { name: /verified github account @ada$/i })
    ).closest("tr") as HTMLElement;
    expect(within(adaRow).getByText("2026-09")).toBeTruthy();
    expect(within(adaRow).getByRole("button", { name: "Update agreement" })).toBeTruthy();

    const botRow = screen
      .getByRole("link", { name: /verified github account @ada-bot/i })
      .closest("tr") as HTMLElement;
    expect(within(botRow).getByText("None")).toBeTruthy();
    expect(within(botRow).getByText("@ada")).toBeTruthy();
  });

  test("records an agreement for a member", async () => {
    list.mockResolvedValue({ data: [member("grace")] });
    recordAgreement.mockResolvedValue({ recorded: true });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Record agreement" }));
    fireEvent.change(screen.getByLabelText("Agreement version"), { target: { value: "2026-09" } });
    fireEvent.change(screen.getByLabelText("Signed on"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Proof"), { target: { value: "signed copy in drive" } });
    const [submit] = screen.getAllByRole("button", { name: "Record agreement" });
    fireEvent.click(submit as HTMLElement);

    await waitFor(() =>
      expect(recordAgreement).toHaveBeenCalledWith({
        githubLogin: "grace",
        version: "2026-09",
        attestedAt: "2026-10-01T00:00:00.000Z",
        proof: "signed copy in drive",
      }),
    );
  });
});
