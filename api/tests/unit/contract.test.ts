import { describe, expect, test } from "vitest";
import {
  baseAmount,
  contract,
  decimalAmount,
  httpUrl,
  nearAccountId,
  proposalListItem,
  publicProject,
  storageStatusOutput,
} from "../../src/contract";

describe("publicProject shape — public surface stays narrow", () => {
  test("does not expose internal admin fields", () => {
    expect(publicProject.shape).not.toHaveProperty("description");
    expect(publicProject.shape).not.toHaveProperty("nearnListingId");
  });

  test("preserves identity + metadata fields needed by public list", () => {
    const shape = publicProject.shape;
    expect(shape).toHaveProperty("id");
    expect(shape).toHaveProperty("ownerId");
    expect(shape).toHaveProperty("slug");
    expect(shape).toHaveProperty("title");
    expect(shape).toHaveProperty("status");
    expect(shape).toHaveProperty("visibility");
    expect(shape).toHaveProperty("createdAt");
    expect(shape).toHaveProperty("updatedAt");
  });
});

describe("nearAccountId validator — settings input safety", () => {
  test("accepts real NEAR account shapes", () => {
    expect(nearAccountId.safeParse("agency.testnet").success).toBe(true);
    expect(nearAccountId.safeParse("multiagency.sputnik-dao.near").success).toBe(true);
    expect(nearAccountId.safeParse("multiagency.sputnikv2.testnet").success).toBe(true);
    expect(nearAccountId.safeParse("alice").success).toBe(true);
    expect(nearAccountId.safeParse("a-b_c.d-e_f.near").success).toBe(true);
  });

  test("rejects non-NEAR strings — emoji, spaces, uppercase, leading/trailing separators", () => {
    expect(nearAccountId.safeParse("🦄").success).toBe(false);
    expect(nearAccountId.safeParse("foo bar").success).toBe(false);
    expect(nearAccountId.safeParse("Alice.near").success).toBe(false);
    expect(nearAccountId.safeParse(".starts-with-dot").success).toBe(false);
    expect(nearAccountId.safeParse("ends-with-dot.").success).toBe(false);
    expect(nearAccountId.safeParse("-starts-with-dash").success).toBe(false);
    expect(nearAccountId.safeParse("trailing-dash-").success).toBe(false);
    expect(nearAccountId.safeParse("double..dot").success).toBe(false);
    expect(nearAccountId.safeParse("foo--bar.near").success).toBe(false);
  });

  test("respects length bounds (2-64)", () => {
    expect(nearAccountId.safeParse("a").success).toBe(false);
    expect(nearAccountId.safeParse("ab").success).toBe(true);
    expect(nearAccountId.safeParse("a".repeat(64)).success).toBe(true);
    expect(nearAccountId.safeParse("a".repeat(65)).success).toBe(false);
  });
});

describe("httpUrl validator — XSS-safe URL scheme check", () => {
  test("accepts http and https URLs", () => {
    expect(httpUrl.safeParse("http://example.com").success).toBe(true);
    expect(httpUrl.safeParse("https://example.com").success).toBe(true);
    expect(httpUrl.safeParse("https://multiagency.ai/docs").success).toBe(true);
  });

  test("rejects javascript:, data:, file:, and other XSS-prone schemes", () => {
    expect(httpUrl.safeParse("javascript:alert(1)").success).toBe(false);
    expect(httpUrl.safeParse("JavaScript:alert(1)").success).toBe(false);
    expect(httpUrl.safeParse("data:text/html,<script>alert(1)</script>").success).toBe(false);
    expect(httpUrl.safeParse("file:///etc/passwd").success).toBe(false);
    expect(httpUrl.safeParse("vbscript:msgbox").success).toBe(false);
  });

  test("rejects malformed URLs", () => {
    expect(httpUrl.safeParse("not a url").success).toBe(false);
    expect(httpUrl.safeParse("multiagency.ai").success).toBe(false);
    expect(httpUrl.safeParse("").success).toBe(false);
  });

  test("rejects URLs exceeding the 500-char cap", () => {
    expect(httpUrl.safeParse(`https://example.com/${"a".repeat(500)}`).success).toBe(false);
  });
});

describe("baseAmount validator — positive-only smallest-unit integer", () => {
  test("accepts positive integer strings", () => {
    expect(baseAmount.safeParse("0").success).toBe(true);
    expect(baseAmount.safeParse("100").success).toBe(true);
    expect(baseAmount.safeParse("1000000000000000000000000").success).toBe(true);
  });

  test("rejects negative amounts — handlers do the signing for deallocate/transfer", () => {
    expect(baseAmount.safeParse("-1").success).toBe(false);
    expect(baseAmount.safeParse("-100").success).toBe(false);
  });

  test("rejects non-integer formats", () => {
    expect(baseAmount.safeParse("1.5").success).toBe(false);
    expect(baseAmount.safeParse("1e6").success).toBe(false);
    expect(baseAmount.safeParse("").success).toBe(false);
    expect(baseAmount.safeParse(" 100").success).toBe(false);
  });
});

describe("decimalAmount validator — positive display-unit amount for internal listings", () => {
  test("accepts positive integers and decimals", () => {
    expect(decimalAmount.safeParse("100").success).toBe(true);
    expect(decimalAmount.safeParse("100.5").success).toBe(true);
    expect(decimalAmount.safeParse("0.001").success).toBe(true);
  });

  test("rejects zero — a zero-reward listing has no rollup meaning", () => {
    expect(decimalAmount.safeParse("0").success).toBe(false);
    expect(decimalAmount.safeParse("0.0").success).toBe(false);
    expect(decimalAmount.safeParse("0.000").success).toBe(false);
  });

  test("rejects negatives and malformed strings", () => {
    expect(decimalAmount.safeParse("-100").success).toBe(false);
    expect(decimalAmount.safeParse("100.5.5").success).toBe(false);
    expect(decimalAmount.safeParse("").success).toBe(false);
    expect(decimalAmount.safeParse("1e3").success).toBe(false);
  });
});

describe("agency.listings contract — internal-listing CRUD surface", () => {
  test("exposes get, create, update, delete", () => {
    expect(contract.agency.listings).toHaveProperty("get");
    expect(contract.agency.listings).toHaveProperty("create");
    expect(contract.agency.listings).toHaveProperty("update");
    expect(contract.agency.listings).toHaveProperty("delete");
  });
});

describe("budgets contract — verb surface", () => {
  test("exposes create, deallocate, transfer", () => {
    expect(contract.budgets).toHaveProperty("create");
    expect(contract.budgets).toHaveProperty("deallocate");
    expect(contract.budgets).toHaveProperty("transfer");
  });
});

describe("proposals contract — inverse mapping surface", () => {
  test("exposes list", () => {
    expect(contract.proposals).toHaveProperty("list");
  });
});

describe("billings contract — registry surface", () => {
  test("exposes list and create; no update (immutable registry)", () => {
    expect(contract.billings).toHaveProperty("list");
    expect(contract.billings).toHaveProperty("create");
    expect(contract.billings).not.toHaveProperty("update");
  });
});

describe("assignments contract — org-wide list", () => {
  test("exposes listAll alongside per-project list", () => {
    expect(contract.assignments).toHaveProperty("list");
    expect(contract.assignments).toHaveProperty("listAll");
  });
});

describe("proposalListItem shape — inverse mapping payload", () => {
  test("includes the chain-derived Transfer fields", () => {
    const shape = proposalListItem.shape;
    expect(shape).toHaveProperty("proposalId");
    expect(shape).toHaveProperty("status");
    expect(shape).toHaveProperty("tokenId");
    expect(shape).toHaveProperty("receiverId");
    expect(shape).toHaveProperty("amount");
    expect(shape).toHaveProperty("submissionTime");
  });

  test("mapping field is nullable and carries enough project context for deep-linking", () => {
    const sampleMapped = proposalListItem.parse({
      proposalId: "42",
      proposer: "alice.near",
      description: "",
      status: "InProgress",
      tokenId: "near",
      receiverId: "bob.near",
      amount: "1000000000000000000000000",
      submissionTime: "1700000000000000000",
      votes: {},
      mapping: {
        billingId: "abc",
        projectId: "p1",
        projectSlug: "build-x",
        projectTitle: "Build X",
      },
    });
    expect(sampleMapped.mapping?.projectSlug).toBe("build-x");

    const sampleUnmapped = proposalListItem.parse({
      proposalId: "43",
      proposer: "alice.near",
      description: "",
      status: "Approved",
      tokenId: "usdc.near",
      receiverId: "carol.near",
      amount: "1000000",
      submissionTime: "1700000000000000001",
      votes: { "alice.near": "Approve" },
      mapping: null,
    });
    expect(sampleUnmapped.mapping).toBeNull();
  });

  test("votes record accepts Approve/Reject/Remove per voter; empty {} is valid for cache-served terminal proposals", () => {
    const withVotes = proposalListItem.parse({
      proposalId: "44",
      proposer: "alice.near",
      description: "",
      status: "Approved",
      tokenId: "near",
      receiverId: "bob.near",
      amount: "1",
      submissionTime: "1700000000000000002",
      votes: { "alice.near": "Approve", "bob.near": "Reject", "carol.near": "Remove" },
      mapping: null,
    });
    expect(Object.keys(withVotes.votes).length).toBe(3);
    expect(withVotes.votes["alice.near"]).toBe("Approve");

    const bogus = proposalListItem.safeParse({
      proposalId: "46",
      proposer: "alice.near",
      description: "",
      status: "Approved",
      tokenId: "near",
      receiverId: "bob.near",
      amount: "1",
      submissionTime: "1700000000000000004",
      votes: { "alice.near": "Maybe" },
      mapping: null,
    });
    expect(bogus.success).toBe(false);
  });
});

describe("tokens.getStorageStatus output — NEP-145 registration shape", () => {
  test("accepts registered status with total + available strings", () => {
    const parsed = storageStatusOutput.parse({
      tokenId: "usdt.tether-token.near",
      status: { total: "1250000000000000000000", available: "0" },
    });
    expect(parsed.status?.total).toBe("1250000000000000000000");
    expect(parsed.status?.available).toBe("0");
  });

  test("accepts null status for unregistered/native tokens", () => {
    const parsed = storageStatusOutput.parse({ tokenId: "near", status: null });
    expect(parsed.status).toBeNull();
  });

  test("contract surface exposes getStorageStatus alongside list", () => {
    expect(contract.tokens).toHaveProperty("list");
    expect(contract.tokens).toHaveProperty("getStorageStatus");
  });
});
