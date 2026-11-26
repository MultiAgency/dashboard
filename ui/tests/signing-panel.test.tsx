import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/api", () => ({ useApiClient: () => ({ workOrders: {} }) }));

const { SigningPanel } = await import("../src/components/work-orders/signing-panel");
type WorkOrderDetail = Parameters<typeof SigningPanel>[0]["workOrder"];

const offered = {
  id: "wo-1",
  status: "offered",
  offeredAt: "2026-11-26T04:09:00.000Z",
  acceptedAt: null,
  contractorName: null,
  contractorEmail: null,
  representativeName: "Admin",
  representativeEmail: "admin@example.com",
  documentSha: null,
  documentUrl: null,
  builder: {
    name: "Demo Builder",
    nearAccount: "builder.near",
    githubLogin: "builder-gh",
    profileGithubLogin: "builder-gh",
  },
  payee: { needsConfirmation: false },
  signing: { esign: null, awaitingRepresentative: false, documentSha: null },
  signature: {
    method: null,
    signedAt: null,
    signers: [],
    preparedDocumentUrl: null,
    documentWarning: null,
    driveUrl: null,
    driveError: null,
  },
} as unknown as WorkOrderDetail;

afterEach(cleanup);

describe("signing panel", () => {
  test("an offered work order gives the manager the builder's link to copy", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SigningPanel workOrder={offered} canManage onAttach={() => undefined} />
      </QueryClientProvider>,
    );
    const link = `${window.location.origin}/work-orders/wo-1`;
    expect(screen.getByText(link)).toBeTruthy();
    expect(screen.getByText(/signed in with builder\.near/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy the link" }));
    expect(writeText).toHaveBeenCalledWith(link);
  });
});
