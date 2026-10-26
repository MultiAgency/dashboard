import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  reportPeriod,
  type SavedReportSummary,
  SavedReportsList,
} from "../src/components/saved-reports";

afterEach(cleanup);

const saved = (overrides: Partial<SavedReportSummary>): SavedReportSummary => ({
  id: "r1",
  engagementId: "e1",
  generatedByUserId: "u1",
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  note: null,
  projectTitle: null,
  sharedAt: null,
  fromAgency: false,
  canDelete: false,
  canShare: false,
  createdAt: new Date("2026-10-07T21:44:00.000Z"),
  ...overrides,
});

describe("reportPeriod", () => {
  test("names the period a report covers", () => {
    expect(reportPeriod({ startDate: "2026-09-01", endDate: "2026-09-30" })).toBe(
      "2026-09-01 – 2026-09-30",
    );
    expect(reportPeriod({ startDate: "2026-09-01", endDate: null })).toBe("from 2026-09-01");
    expect(reportPeriod({ startDate: null, endDate: "2026-09-30" })).toBe("through 2026-09-30");
    expect(reportPeriod({ startDate: null, endDate: null })).toBe("All time");
  });
});

describe("SavedReportsList", () => {
  const titleOf = (r: SavedReportSummary) => `NEAR Foundation · ${reportPeriod(r)}`;

  test("offers share and delete only where the report allows it", () => {
    render(
      <SavedReportsList
        reports={[saved({ id: "mine", canDelete: true, canShare: true }), saved({ id: "theirs" })]}
        selectedId={undefined}
        onOpen={() => {}}
        titleOf={titleOf}
        onToggleShare={async () => {}}
        onDelete={async () => {}}
      />,
    );

    expect(screen.getAllByRole("button", { name: "View" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Share with client" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
  });

  test("labels shared reports and reports from the agency", () => {
    render(
      <SavedReportsList
        reports={[
          saved({ id: "shared", sharedAt: new Date(), canShare: true }),
          saved({ id: "from-agency", fromAgency: true }),
        ]}
        selectedId={undefined}
        onOpen={() => {}}
        titleOf={titleOf}
        agencyName="MultiAgency"
        onToggleShare={async () => {}}
      />,
    );

    expect(screen.getByText("Shared")).toBeDefined();
    expect(screen.getByText("From MultiAgency")).toBeDefined();
    expect(screen.getByRole("button", { name: "Unshare" })).toBeDefined();
  });

  test("asks before deleting, and warns when the client loses a shared report", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <SavedReportsList
        reports={[saved({ canDelete: true, sharedAt: new Date() })]}
        selectedId={undefined}
        onOpen={() => {}}
        titleOf={titleOf}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/they lose it too/)).toBeDefined();

    const confirm = screen
      .getAllByRole("button", { name: "Delete" })
      .find((b) => b.closest("[role='dialog']"));
    fireEvent.click(confirm!);
    await Promise.resolve();
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }));
  });
});
