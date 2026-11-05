import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ConfirmDialog } from "../src/components/confirm-dialog";

afterEach(cleanup);

describe("ConfirmDialog — destructive confirm flow", () => {
  test("renders title + description; both buttons present", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete this thing?"
        description="It can be re-created afterwards."
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText("Delete this thing?")).toBeDefined();
    expect(screen.getByText("It can be re-created afterwards.")).toBeDefined();
    // Default labels
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDefined();
  });

  test("clicking confirm fires onConfirm and closes via onOpenChange(false)", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Confirm action"
        onConfirm={onConfirm}
        confirmLabel="delete"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    // Mutation resolves async; await microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("clicking cancel fires onOpenChange(false) and does NOT fire onConfirm", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Confirm action"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("confirm button shows 'working...' while onConfirm is pending; remains disabled until resolved", async () => {
    let resolveConfirm: (() => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Slow confirm"
        onConfirm={onConfirm}
        confirmLabel="ok"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ok" }));
    await Promise.resolve();
    const pending = screen.getByRole("button", { name: "working..." });
    expect(pending).toBeDefined();
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    resolveConfirm?.();
  });

  test("destructive variant routes confirm button to destructive style", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete"
        destructive
        onConfirm={() => {}}
        confirmLabel="delete"
      />,
    );
    const btn = screen.getByRole("button", { name: "delete" }) as HTMLButtonElement;
    // shadcn Button's destructive variant applies a class containing "destructive"
    expect(btn.className).toMatch(/destructive/);
  });
});
