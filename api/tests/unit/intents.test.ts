import { describe, expect, test, vi } from "vitest";
import { readAgentHeld } from "../../src/services/intents";

const DAO = "multiagency.sputnik-dao.near";

describe("readAgentHeld", () => {
  test("no source configured → unavailable, not an empty list", async () => {
    expect(await readAgentHeld(null, DAO)).toEqual({
      status: "unavailable",
      reason: "not-configured",
    });
  });

  test("a source that throws → unavailable, never zero balances", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const source = async () => {
      throw new Error("upstream 503");
    };
    expect(await readAgentHeld(source, DAO)).toEqual({
      status: "unavailable",
      reason: "read-failed",
    });
  });

  test("a successful read passes balances and time through unchanged", async () => {
    const source = async (dao: string) => {
      expect(dao).toBe(DAO);
      return {
        balances: [{ tokenId: "usdc", balance: "1500000" }],
        updatedAt: "2026-10-22T10:00:00.000Z",
      };
    };
    expect(await readAgentHeld(source, DAO)).toEqual({
      status: "available",
      balances: [{ tokenId: "usdc", balance: "1500000" }],
      updatedAt: "2026-10-22T10:00:00.000Z",
    });
  });

  test("a reading with no balances is available and empty, distinct from unavailable", async () => {
    const source = async () => ({ balances: [], updatedAt: "2026-10-22T10:00:00.000Z" });
    const result = await readAgentHeld(source, DAO);
    expect(result.status).toBe("available");
  });
});
