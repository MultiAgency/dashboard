import { describe, expect, test, vi } from "vitest";
import { announceWorkspace, onWorkspaceChange } from "../src/lib/workspace";

describe("tabs sharing one session", () => {
  test("hear a switch announced by another tab", async () => {
    const heard = vi.fn();
    const stop = onWorkspaceChange(heard);
    const otherTab = new BroadcastChannel("workspace");
    otherTab.postMessage("client");
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    otherTab.close();
    stop();
  });

  test("never hear their own announcement", async () => {
    const heard = vi.fn();
    const stop = onWorkspaceChange(heard);
    const otherTab = new BroadcastChannel("workspace");
    const received = new Promise((resolve) => {
      otherTab.onmessage = (event) => resolve(event.data);
    });
    announceWorkspace("client");
    await expect(received).resolves.toBe("client");
    expect(heard).not.toHaveBeenCalled();
    otherTab.close();
    stop();
  });

  test("re-check when they become visible again", () => {
    const heard = vi.fn();
    const stop = onWorkspaceChange(heard);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
