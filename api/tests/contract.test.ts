import { describe, expect, test } from "vitest";
import { baseAmount, contract, proposalListItem, publicProject } from "../src/contract";

describe("publicProject shape — public surface stays narrow", () => {
  test("does not expose internal admin description field", () => {
    expect(publicProject.shape).not.toHaveProperty("description");
  });

  test("preserves identity + metadata fields needed by public list", () => {
    const shape = publicProject.shape;
    expect(shape).toHaveProperty("id");
    expect(shape).toHaveProperty("ownerId");
    expect(shape).toHaveProperty("slug");
    expect(shape).toHaveProperty("title");
    expect(shape).toHaveProperty("nearnListingId");
    expect(shape).toHaveProperty("status");
    expect(shape).toHaveProperty("visibility");
    expect(shape).toHaveProperty("createdAt");
    expect(shape).toHaveProperty("updatedAt");
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

describe("allocations contract — verb surface", () => {
  test("exposes adminCreate, adminDeallocate, adminTransfer", () => {
    expect(contract.allocations).toHaveProperty("adminCreate");
    expect(contract.allocations).toHaveProperty("adminDeallocate");
    expect(contract.allocations).toHaveProperty("adminTransfer");
  });
});

describe("proposals contract — inverse mapping surface", () => {
  test("exposes adminList", () => {
    expect(contract.proposals).toHaveProperty("adminList");
  });
});

describe("billings contract — registry surface", () => {
  test("exposes adminList and adminCreate; no adminUpdate (immutable registry)", () => {
    expect(contract.billings).toHaveProperty("adminList");
    expect(contract.billings).toHaveProperty("adminCreate");
    expect(contract.billings).not.toHaveProperty("adminUpdate");
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
      mapping: null,
    });
    expect(sampleUnmapped.mapping).toBeNull();
  });
});

describe("bootstrap contract — DAO claim surface", () => {
  test("exposes config", () => {
    expect(contract.bootstrap).toHaveProperty("config");
  });

  test("input requires daoAccountId; adminRoleName is optional", () => {
    const input = contract.bootstrap.config["~orpc"].inputSchema;
    expect(input).toBeDefined();
    expect(input?.safeParse({ daoAccountId: "agency.sputnik-dao.near" }).success).toBe(true);
    expect(
      input?.safeParse({ daoAccountId: "agency.sputnik-dao.near", adminRoleName: "council" })
        .success,
    ).toBe(true);
    expect(input?.safeParse({}).success).toBe(false);
    expect(input?.safeParse({ daoAccountId: "" }).success).toBe(false);
  });
});

describe("settings.getPublic — placeholder signal", () => {
  test("output includes isPlaceholder boolean for bootstrap UI detection", () => {
    const output = contract.settings.getPublic["~orpc"].outputSchema;
    expect(output).toBeDefined();
    const parsed = output?.safeParse({
      name: "MultiAgency",
      headline: null,
      tagline: null,
      description: null,
      contactEmail: null,
      nearnAccountId: null,
      websiteUrl: null,
      docsUrl: null,
      daoAccountId: "PLACEHOLDER.sputnik-dao.near",
      isPlaceholder: true,
    });
    expect(parsed?.success).toBe(true);
  });
});
