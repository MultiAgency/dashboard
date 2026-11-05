import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { ProgressStepper, type WorkOrderProgress } from "@/components/work-orders/progress-stepper";

afterEach(cleanup);

const step = (
  key: WorkOrderProgress["steps"][number]["key"],
  label: string,
  state: WorkOrderProgress["steps"][number]["state"],
  extra: Partial<WorkOrderProgress["steps"][number]> = {},
): WorkOrderProgress["steps"][number] => ({
  key,
  label,
  state,
  at: null,
  detail: null,
  ...extra,
});

const progress: WorkOrderProgress = {
  stage: "active",
  waitingOn: "builder",
  needsYou: false,
  headline: "Work in progress",
  since: null,
  next: null,
  attention: [],
  steps: [
    step("draft", "Draft", "done", { at: "2026-10-23T10:00:00.000Z" }),
    step("active", "Active", "current", { detail: "2026-10-24 → 2026-11-23" }),
    step("request", "Payout request", "upcoming", { detail: "DM-001-M2-R1 · $1" }),
  ],
};

describe("ProgressStepper", () => {
  test("shows the active period as short dates, with the full range on hover", () => {
    render(<ProgressStepper progress={progress} />);
    const period = screen.getByText("Oct 24 – Nov 23");
    expect(period.getAttribute("title")).toBe("2026-10-24 → 2026-11-23");
    expect(screen.queryByText("2026-10-24 → 2026-11-23")).toBeNull();
    expect(screen.queryByText("DM-001-M2-R1 · $1")).toBeNull();
    expect(screen.getByText("Oct 23")).toBeTruthy();
  });
});
