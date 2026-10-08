import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();

const NEAR = {
  tokenId: "near",
  network: "mainnet",
  symbol: "NEAR",
  decimals: 24,
  name: "NEAR",
  icon: null,
};

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    agreements: { list, create, update, delete: remove },
    admin: { tokens: async () => ({ tokens: [NEAR] }) },
    tokens: { list: async () => ({ tokens: [NEAR] }) },
  }),
}));

vi.mock("@/lib/queries", async (original) => {
  const actual = await original<typeof import("../src/lib/queries")>();
  return {
    ...actual,
    adminTokensQueryOptions: () => ({
      queryKey: ["tokens"],
      queryFn: async () => ({ tokens: [NEAR] }),
    }),
  };
});

const { AgreementsPanel } = await import("../src/components/admin/agreements-panel");

afterEach(() => {
  cleanup();
  for (const fn of [list, create, update, remove]) fn.mockReset();
});

const yocto = (n: number) => `${n}${"0".repeat(24)}`;

const october = {
  id: "a1",
  engagementId: "e1",
  kind: "retainer" as const,
  title: "NF · October",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  tokenId: "near",
  agreedAmount: yocto(2500),
  note: null,
  allocated: yocto(2250),
  budgetCount: 2,
  createdBy: "james.near",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const engagement = {
  id: "e1",
  status: "active",
  kind: "client",
  client: { name: "NEAR Foundation" },
} as never;

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AgreementsPanel engagement={engagement} canManage />
    </QueryClientProvider>,
  );
}

describe("AgreementsPanel", () => {
  test("lists agreements with what is allocated of the agreed amount", async () => {
    list.mockResolvedValue({ data: [october], requiresAgreement: false });
    renderPanel();

    expect(await screen.findByText("NF · October")).toBeDefined();
    expect(screen.getByText("Retainer")).toBeDefined();
    expect(screen.getByText("2026-10-01 – 2026-10-31")).toBeDefined();
    expect(screen.getByText(/2,250 NEAR of 2,500 NEAR/)).toBeDefined();
  });

  test("renew fills in the next cycle with the same amount, and saves a new agreement", async () => {
    list.mockResolvedValue({ data: [october], requiresAgreement: false });
    create.mockResolvedValue({ ...october, id: "a2" });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Renew" }));

    expect(screen.getByText("Renew retainer")).toBeDefined();
    expect((screen.getByLabelText("Start date") as HTMLInputElement).value).toBe("2026-11-01");
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("2026-11-30");
    await waitFor(() =>
      expect((screen.getByLabelText("Agreed amount") as HTMLInputElement).value).toBe("2500"),
    );
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "NF · November" } });
    fireEvent.change(screen.getByLabelText("Agreed amount"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add agreement" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        engagementId: "e1",
        kind: "retainer",
        title: "NF · November",
        startDate: "2026-11-01",
        endDate: "2026-11-30",
        tokenId: "near",
        agreedAmount: yocto(2000),
        note: null,
      }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  test("an agreement in use explains why it can't be deleted", async () => {
    list.mockResolvedValue({ data: [october], requiresAgreement: false });
    renderPanel();

    fireEvent.keyDown(await screen.findByRole("button", { name: "Agreement actions" }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(screen.getByText(/has budget entries attached/)).toBeDefined();
  });
});
