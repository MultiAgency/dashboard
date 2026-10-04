import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

const list = vi.fn();

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ contributors: { list } }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => (
    <a href="/" aria-label={(props as { "aria-label"?: string })["aria-label"]}>
      {children}
    </a>
  ),
}));

const { ContributorsAdminSection } = await import("../src/components/admin/contributors-section");

afterEach(() => {
  cleanup();
  list.mockReset();
});

const contributor = (nearAccount: string, name: string, githubLogin: string | null) => ({
  nearAccount,
  name,
  bio: null,
  skills: [],
  location: null,
  links: null,
  githubLogin,
  registered: true,
  claimed: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ContributorsAdminSection />
    </QueryClientProvider>,
  );
}

describe("ContributorsAdminSection", () => {
  test("shows a board member's verified GitHub login and offers no removal", async () => {
    list.mockResolvedValue({
      data: [contributor("ada.near", "Ada", "ada"), contributor("bob.near", "Bob", null)],
      manageable: ["ada.near", "bob.near"],
    });
    renderSection();

    const verified = await screen.findByRole("link", { name: /verified github account @ada/i });
    expect(verified.getAttribute("href")).toBe("https://github.com/ada");

    const adaRow = verified.closest("tr") as HTMLElement;
    const bobRow = screen.getByText("Bob").closest("tr") as HTMLElement;
    expect(within(adaRow).queryByRole("button", { name: /remove/i })).toBeNull();
    expect(within(bobRow).getByRole("button", { name: /remove/i })).toBeTruthy();
  });
});
