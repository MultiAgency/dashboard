import { afterEach, describe, expect, test, vi } from "vitest";
import { loggedFetch } from "../../src/services/platform/client";

const URL_OF = "https://platform.test/apps/v1/o/org/a/own-1/rpc/owner/status";

describe("calls to the MultiAgency platform", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  afterEach(() => warn.mockClear());

  test("a failed answer is logged with its procedure and HTTP status, and passed on unchanged", async () => {
    const answer = new Response("busy", { status: 503 });
    const response = await loggedFetch(async () => answer)(URL_OF);
    expect(response).toBe(answer);
    expect(warn).toHaveBeenCalledWith("[API] MultiAgency platform owner/status answered HTTP 503");
  });

  test("no answer at all is logged with its procedure and rethrown", async () => {
    const lost = new Error("socket hang up");
    await expect(
      loggedFetch(async () => {
        throw lost;
      })(new Request(URL_OF)),
    ).rejects.toBe(lost);
    expect(warn).toHaveBeenCalledWith(
      "[API] MultiAgency platform owner/status didn't answer",
      lost,
    );
  });

  test("a good answer logs nothing", async () => {
    await loggedFetch(async () => new Response("{}", { status: 200 }))(URL_OF);
    expect(warn).not.toHaveBeenCalled();
  });
});
