import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

const list = vi.fn();
const uncoveredPayouts = vi.fn();
const create = vi.fn();
const update = vi.fn();

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    workOrders: { list, uncoveredPayouts, create, update, remove: vi.fn() },
    agency: {
      projects: {
        listOwned: async () => ({ data: [{ id: "site", title: "Website", kind: "project" }] }),
      },
    },
    tokens: {
      list: async () => ({ tokens: [{ tokenId: USDC, symbol: "USDC", decimals: 6 }] }),
    },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  redirect: vi.fn(),
}));

const { Route } = await import("../src/routes/_layout/_authenticated/admin/work-orders");
const WorkOrdersPage = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component;

afterEach(() => {
  cleanup();
  list.mockReset();
  uncoveredPayouts.mockReset();
  create.mockReset();
  update.mockReset();
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <WorkOrdersPage />
    </QueryClientProvider>,
  );
}

describe("Work orders page", () => {
  test("shows each work order with paid of amount and its warnings", async () => {
    list.mockResolvedValue({
      data: [
        {
          id: "wo-1",
          nearAccount: "ada.near",
          status: "signed",
          startsOn: "2026-10-01",
          endsOn: "2026-12-31",
          documentUrl: null,
          closedAt: null,
          lines: [
            {
              projectId: "site",
              projectTitle: "Website",
              tokenId: USDC,
              amount: "2000000000",
              paid: "1200000000",
              remaining: "800000000",
              warnings: [],
            },
          ],
          warnings: ["endingSoon", "noAgreement"],
        },
      ],
    });
    uncoveredPayouts.mockResolvedValue({ data: [] });
    renderPage();

    const row = (await screen.findByText("ada.near")).closest("tr") as HTMLElement;
    expect(within(row).getByText(/Website/)).toBeTruthy();
    expect(within(row).getByText(/1,200.*of.*2,000/)).toBeTruthy();
    expect(within(row).getByText("Ending soon")).toBeTruthy();
    expect(within(row).getByText("No agreement on file")).toBeTruthy();
    expect(screen.getByText("Every recent payout is covered.")).toBeTruthy();
  });

  test("lists payouts no work order covers", async () => {
    list.mockResolvedValue({ data: [] });
    uncoveredPayouts.mockResolvedValue({
      data: [
        {
          billingId: "b1",
          projectId: "site",
          projectTitle: "Website",
          nearAccount: "bob.near",
          tokenId: USDC,
          amount: "500000000",
          recordedAt: "2026-10-03T00:00:00.000Z",
        },
      ],
    });
    renderPage();

    expect(await screen.findByText(/bob\.near · Website/)).toBeTruthy();
  });

  test("a new work order can't be saved until it has a Project, token and amount", async () => {
    list.mockResolvedValue({ data: [] });
    uncoveredPayouts.mockResolvedValue({ data: [] });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /New work order/ }));
    fireEvent.change(await screen.findByLabelText("Contributor NEAR account"), {
      target: { value: "ada.near" },
    });
    fireEvent.change(screen.getByLabelText("Starts on"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Ends on"), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2000.5" } });

    expect(screen.getByRole("button", { name: "Save work order" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  test("editing shows amounts in tokens and saves them in base units", async () => {
    list.mockResolvedValue({
      data: [
        {
          id: "wo-1",
          nearAccount: "ada.near",
          status: "signed",
          startsOn: "2026-10-01",
          endsOn: "2026-12-31",
          documentUrl: null,
          closedAt: null,
          lines: [
            {
              projectId: "site",
              projectTitle: "Website",
              tokenId: USDC,
              amount: "2000000000",
              paid: "0",
              remaining: "2000000000",
              warnings: [],
            },
          ],
          warnings: [],
        },
      ],
    });
    uncoveredPayouts.mockResolvedValue({ data: [] });
    update.mockResolvedValue({ data: {} });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const amount = (await screen.findByLabelText("Amount")) as HTMLInputElement;
    expect(amount.value).toBe("2000");
    fireEvent.change(amount, { target: { value: "2000.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save work order" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        id: "wo-1",
        nearAccount: "ada.near",
        status: "signed",
        startsOn: "2026-10-01",
        endsOn: "2026-12-31",
        documentUrl: null,
        lines: [{ projectId: "site", tokenId: USDC, amount: "2000500000" }],
      }),
    );
  });
});
