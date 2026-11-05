import { afterEach, describe, expect, test, vi } from "vitest";
import type { Database } from "../../src/db";
import {
  findProposal,
  getProposal,
  getProposals,
  proposalsSince,
} from "../../src/services/sputnik";

const DAY_NS = 86_400_000_000_000n;
const POLICY = { roles: [], proposal_period: String(7n * DAY_NS) };

function proposal(status: string, submittedAgo = 0n) {
  return {
    proposer: "rita.near",
    description: "Pay Carol",
    kind: { Transfer: { token_id: "", receiver_id: "carol.near", amount: "1", msg: null } },
    status,
    submission_time: String(BigInt(Date.now()) * 1_000_000n - submittedAgo),
    votes: {},
  };
}

type Answer = { value?: unknown; error?: string };

function chain(answer: (method: string) => Answer) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const { params } = JSON.parse(String(init.body));
      const { value, error } = answer(params.method_name);
      return new Response(
        JSON.stringify({
          result: error
            ? { error }
            : { result: [...new TextEncoder().encode(JSON.stringify(value))] },
        }),
      );
    }),
  );
}

function database() {
  const saved: { status: string }[] = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({
      values: (rows: { status: string }[]) => ({
        onConflictDoNothing: async () => {
          saved.push(...rows);
        },
      }),
    }),
  } as unknown as Database;
  return { db, saved };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("reading a DAO proposal", () => {
  test("a proposal the DAO no longer has is null; a failed lookup throws", async () => {
    const { db } = database();
    chain(() => ({
      error:
        'wasm execution failed with error: HostError(GuestPanic { panic_msg: "ERR_NO_PROPOSAL" })',
    }));
    await expect(findProposal(db, "removed.sputnik-dao.near", 4)).resolves.toBeNull();
    chain(() => ({ error: "Server error" }));
    await expect(findProposal(db, "flaky.sputnik-dao.near", 4)).rejects.toThrow("Server error");
    await expect(getProposal(db, "flaky.sputnik-dao.near", 5)).resolves.toBeNull();
  });

  test("a failed proposal isn't final: it's read again from the chain and never saved", async () => {
    vi.useFakeTimers();
    const { db, saved } = database();
    let status = "Failed";
    chain((method) => ({ value: method === "get_policy" ? POLICY : proposal(status) }));
    const dao = "finalized.sputnik-dao.near";
    expect((await findProposal(db, dao, 7))?.status).toBe("Failed");
    expect(saved).toEqual([]);
    status = "Approved";
    vi.advanceTimersByTime(60_000);
    expect((await findProposal(db, dao, 7))?.status).toBe("Approved");
    expect(saved.map((row) => row.status)).toEqual(["Approved"]);
  });

  test("past the DAO's voting period an open or failed proposal can only expire, so it reads as expired", async () => {
    const { db, saved } = database();
    const late = 8n * DAY_NS;
    chain((method) => {
      if (method === "get_policy") return { value: POLICY };
      if (method === "get_proposals") {
        return {
          value: [
            { id: 0, ...proposal("InProgress", late) },
            { id: 1, ...proposal("Failed", late) },
            { id: 2, ...proposal("Failed", DAY_NS) },
            { id: 3, ...proposal("Rejected", late) },
            { id: 4, ...proposal("InProgress", 7n * DAY_NS + 60_000_000_000n) },
          ],
        };
      }
      return { value: proposal("Failed", late) };
    });
    expect((await findProposal(db, "late.sputnik-dao.near", 9))?.status).toBe("Expired");
    const listed = await getProposals(db, "listed.sputnik-dao.near", 0, 5);
    expect(listed.map((p) => p.status)).toEqual([
      "Expired",
      "Expired",
      "Failed",
      "Rejected",
      "InProgress",
    ]);
    expect(saved.map((row) => row.status)).toEqual(["Rejected"]);
  });

  test("an expiry read from the DAO's voting period isn't saved, so a longer period reopens it", async () => {
    vi.useFakeTimers();
    const { db, saved } = database();
    let policy = POLICY;
    chain((method) =>
      method === "get_policy" ? { value: policy } : { value: proposal("InProgress", 8n * DAY_NS) },
    );
    const dao = "extended.sputnik-dao.near";
    expect((await findProposal(db, dao, 11))?.status).toBe("Expired");
    expect(saved).toEqual([]);
    policy = { roles: [], proposal_period: String(30n * DAY_NS) };
    vi.advanceTimersByTime(61_000);
    expect((await findProposal(db, dao, 11))?.status).toBe("InProgress");
  });

  test("a lookup that fails with something other than an Error reports what failed", async () => {
    const { db } = database();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "socket hang up";
      }),
    );
    await expect(findProposal(db, "odd.sputnik-dao.near", 4)).rejects.toBe("socket hang up");
  });

  test("proposals since a moment are read page by page back past that moment", async () => {
    const { db } = database();
    const pages: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const { params } = JSON.parse(String(init.body));
        const args = JSON.parse(atob(params.args_base64));
        let value: unknown = POLICY;
        if (params.method_name === "get_last_proposal_id") value = 250;
        if (params.method_name === "get_proposals") {
          pages.push(args.from_index);
          value = Array.from({ length: args.limit }, (_, i) => {
            const id = args.from_index + i;
            return { id, ...proposal("Rejected", (BigInt(250 - id) * DAY_NS) / 100n) };
          });
        }
        return new Response(
          JSON.stringify({
            result: { result: [...new TextEncoder().encode(JSON.stringify(value))] },
          }),
        );
      }),
    );
    const since = new Date(Date.now() - 1.2 * 86_400_000);
    const found = await proposalsSince(db, "paged.sputnik-dao.near", since);
    expect(pages).toEqual([150, 50]);
    expect(found).toHaveLength(200);
  });

  test("without the DAO's policy the chain's status stands", async () => {
    const { db } = database();
    chain((method) =>
      method === "get_policy"
        ? { error: "Server error" }
        : { value: proposal("InProgress", 8n * DAY_NS) },
    );
    expect((await findProposal(db, "nopolicy.sputnik-dao.near", 3))?.status).toBe("InProgress");
  });
});
