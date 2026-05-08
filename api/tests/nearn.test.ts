import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { listNearnBountiesForSponsor } from "../src/services/nearn";

const ok = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("listNearnBountiesForSponsor — response-shape regression", () => {
  const originalFetch = globalThis.fetch;
  let calls: Array<[string | URL | Request, RequestInit | undefined]>;
  let queue: Array<() => Promise<Response>>;

  beforeEach(() => {
    calls = [];
    queue = [];
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      calls.push([url, init]);
      const next = queue.shift();
      if (!next) throw new Error("unexpected fetch call (queue empty)");
      return next();
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const enqueue = (body: unknown) => queue.push(async () => ok(body));

  test("extracts bounties from { bounties: [...] } envelope", async () => {
    enqueue({
      bounties: [
        {
          slug: "alpha",
          title: "Alpha bounty",
          type: "bounty",
          status: "OPEN",
          token: "USDC",
          rewardAmount: 100,
          deadline: "2026-01-01T00:00:00Z",
          isPublished: true,
          isFeatured: false,
          isWinnersAnnounced: false,
        },
      ],
    });

    const result = await listNearnBountiesForSponsor("sponsor-envelope");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      slug: "alpha",
      title: "Alpha bounty",
      rewardAmount: 100,
    });
  });

  test("returns [] when bounties array is empty", async () => {
    enqueue({ bounties: [] });
    const result = await listNearnBountiesForSponsor("sponsor-empty");
    expect(result).toEqual([]);
  });

  test("returns [] when response shape lacks the bounties key (defensive)", async () => {
    enqueue({ unexpected: "shape" });
    const result = await listNearnBountiesForSponsor("sponsor-malformed");
    expect(result).toEqual([]);
  });

  test("filters out bounties without a slug", async () => {
    enqueue({
      bounties: [
        { slug: "valid", title: "Has slug" },
        { title: "No slug" },
        { slug: "", title: "Empty slug" },
      ],
    });
    const result = await listNearnBountiesForSponsor("sponsor-mixed");
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("valid");
  });

  test("calls the trailing-slash URL (avoids 308 redirect)", async () => {
    enqueue({ bounties: [] });
    await listNearnBountiesForSponsor("sponsor-url-check");

    expect(calls[0][0]).toBe("https://nearn.io/api/listings/sponsor/");
  });
});
