import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const list = vi.fn();

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ applications: { list } }),
}));

const { ApplicationsAdminSection } = await import("../src/components/admin/applications-section");

afterEach(() => {
  cleanup();
  list.mockReset();
});

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ApplicationsAdminSection />
    </QueryClientProvider>,
  );
}

describe("ApplicationsAdminSection", () => {
  test("a caller outside the MultiAgency team sees who reviews applications", async () => {
    list.mockRejectedValue(Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" }));
    renderSection();
    expect(
      await screen.findByText("Applications are reviewed by the MultiAgency team."),
    ).toBeTruthy();
  });

  test("a loaded list shows its applications", async () => {
    list.mockResolvedValue({
      data: [
        {
          id: "app-1",
          name: "Ada Lovelace",
          email: "ada@example.com",
          nearAccountId: null,
          message: null,
          kind: "founder",
          status: "new",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    renderSection();
    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
  });
});
