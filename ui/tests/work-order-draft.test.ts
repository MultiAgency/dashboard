import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearAllWorkOrderDrafts,
  clearWorkOrderDraft,
  mergeStoredDraft,
  readWorkOrderDraft,
  withLivePeriod,
  workOrderDraftKey,
  writeWorkOrderDraft,
} from "../src/lib/work-order-draft";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    key: (index: number) => [...items.keys()][index] ?? null,
    get length() {
      return items.size;
    },
  };
}

const orgA = { userId: "user-1", network: "mainnet", organizationId: "org-a" };
const orgB = { ...orgA, organizationId: "org-b" };

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("work order draft storage", () => {
  test("keeps one draft per organization", () => {
    writeWorkOrderDraft(orgA, { draft: { title: "A" }, custom: { client: "Acme" } });
    writeWorkOrderDraft(orgB, { draft: { title: "B" }, custom: {} });
    expect(readWorkOrderDraft(orgA)).toEqual({
      draft: { title: "A" },
      custom: { client: "Acme" },
    });
    expect(readWorkOrderDraft<{ title: string }>(orgB)?.draft.title).toBe("B");
    expect(readWorkOrderDraft({ ...orgA, organizationId: null })).toBeNull();
  });

  test("never shows one user's or network's draft to another", () => {
    writeWorkOrderDraft(orgA, { draft: { title: "A" }, custom: {} });
    expect(readWorkOrderDraft({ ...orgA, userId: "user-2" })).toBeNull();
    expect(readWorkOrderDraft({ ...orgA, network: "testnet" })).toBeNull();
  });

  test("clears a draft", () => {
    writeWorkOrderDraft(orgA, { draft: { title: "A" }, custom: {} });
    clearWorkOrderDraft(orgA);
    expect(readWorkOrderDraft(orgA)).toBeNull();
  });

  test("clears every draft on sign-out and leaves other keys", () => {
    writeWorkOrderDraft(orgA, { draft: { title: "A" }, custom: {} });
    writeWorkOrderDraft(orgB, { draft: { title: "B" }, custom: {} });
    localStorage.setItem("theme", "dark");
    clearAllWorkOrderDrafts();
    expect(readWorkOrderDraft(orgA)).toBeNull();
    expect(readWorkOrderDraft(orgB)).toBeNull();
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  test("ignores broken storage", () => {
    localStorage.setItem(workOrderDraftKey(orgA), "{not json");
    expect(readWorkOrderDraft(orgA)).toBeNull();
    vi.stubGlobal("localStorage", {
      ...memoryStorage(),
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(() => writeWorkOrderDraft(orgA, { draft: {}, custom: {} })).not.toThrow();
  });
});

describe("mergeStoredDraft", () => {
  test("takes stored values of the right type for known fields only", () => {
    const fresh = { title: "", graceDays: "2", autoRenew: false };
    expect(
      mergeStoredDraft(fresh, { title: "Build", graceDays: 5, autoRenew: true, extra: "x" }),
    ).toEqual({ title: "Build", graceDays: "2", autoRenew: true });
  });
});

describe("withLivePeriod", () => {
  const fresh = { title: "", periodStart: "2026-11-01", periodEnd: "2026-11-30" };

  test("replaces a stored period that has already ended", () => {
    const stored = { title: "Build", periodStart: "2026-09-01", periodEnd: "2026-09-30" };
    expect(withLivePeriod(stored, fresh, "2026-10-30")).toEqual({
      title: "Build",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
    });
  });

  test("keeps a stored period that ends today or later", () => {
    const stored = { title: "Build", periodStart: "2026-10-01", periodEnd: "2026-10-30" };
    expect(withLivePeriod(stored, fresh, "2026-10-30")).toBe(stored);
  });
});
