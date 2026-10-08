import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const update = vi.fn();
const remove = vi.fn();

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    budgets: { update, delete: remove },
    agreements: { list: async () => ({ data: [], requiresAgreement: false }) },
  }),
}));

const { BudgetEntryActions, EditedLine } = await import(
  "../src/components/admin/budget-entry-actions"
);

afterEach(() => {
  cleanup();
  update.mockReset();
  remove.mockReset();
});

const near = {
  tokenId: "near",
  network: "mainnet",
  symbol: "NEAR",
  decimals: 24,
  name: "NEAR",
  icon: null,
};
const yocto = (n: number) => `${n}${"0".repeat(24)}`;

const entry = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "b1",
    projectId: "p1",
    tokenId: "near",
    amount: yocto(1000),
    note: "July 15 - August 15",
    actorAccountId: "james.near",
    relatedBudgetId: null,
    engagementId: null,
    fundingDaoAccountId: null,
    effectiveOn: null,
    createdAt: "2026-10-07T12:00:00.000Z",
    lastEdit: null,
    ...overrides,
  }) as never;

function renderActions(row: ReturnType<typeof entry>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <BudgetEntryActions entry={row} tokens={[near]} />
    </QueryClientProvider>,
  );
}

describe("BudgetEntryActions", () => {
  test("edits the amount, date and note, starting from the entry's values", async () => {
    update.mockResolvedValue({ budget: entry() });
    renderActions(entry());

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText("Amount (NEAR)") as HTMLInputElement).value).toBe("1000");
    expect((screen.getByLabelText("Budget date") as HTMLInputElement).value).toBe("2026-10-07");
    fireEvent.change(screen.getByLabelText("Amount (NEAR)"), { target: { value: "1250" } });
    fireEvent.change(screen.getByLabelText("Budget date"), { target: { value: "2026-07-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        id: "b1",
        amount: yocto(1250),
        note: "July 15 - August 15",
        effectiveOn: "2026-07-15",
      }),
    );
  });

  test("a deallocation is edited by its size, without the minus sign", () => {
    renderActions(entry({ amount: `-${yocto(300)}` }));

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByText("Edit deallocation")).toBeDefined();
    expect((screen.getByLabelText("Amount (NEAR)") as HTMLInputElement).value).toBe("300");
  });

  test("a transfer can only be deleted, and deleting asks first", async () => {
    remove.mockResolvedValue({ deleted: 2 });
    renderActions(entry({ relatedBudgetId: "b2" }));

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/Both sides of the transfer are deleted/)).toBeDefined();
    expect(remove).not.toHaveBeenCalled();

    const confirm = screen
      .getAllByRole("button", { name: "Delete" })
      .find((b) => b.closest("[role='dialog']"));
    fireEvent.click(confirm!);
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ id: "b1" }));
  });
});

describe("EditedLine", () => {
  test("says who edited the entry and what it was before", () => {
    render(
      <EditedLine
        entry={entry({
          lastEdit: {
            changedAt: "2026-10-08T09:00:00.000Z",
            changedBy: "james.near",
            previousAmount: yocto(750),
            previousNote: null,
            previousEffectiveOn: "2026-09-01",
          },
          effectiveOn: "2026-07-15",
        })}
      />,
    );

    expect(screen.getByText(/edited by james.near on 2026-10-08/)).toBeDefined();
    expect(screen.getByText(/was 750 NEAR/)).toBeDefined();
    expect(screen.getByText(/dated 2026-09-01/)).toBeDefined();
  });
});
