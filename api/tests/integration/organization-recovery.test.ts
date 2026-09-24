import { describe, expect, test } from "vitest";
import { createOrganizationRecovery } from "../../src/services/organization-recovery";
import { type FakeMember, inMemoryOrganizations } from "../fakes/organizations";

function recoveryWith(members: FakeMember[]) {
  const fake = inMemoryOrganizations({
    organizations: [{ id: "client" }, { id: "personal", isPersonal: true }],
    members,
    users: [
      { id: "alice", email: "alice@example.com" },
      { id: "staff", email: "staff@example.com" },
    ],
  });
  return { recovery: createOrganizationRecovery({ members: fake.members }), fake };
}

describe("assigning an owner to an Organization", () => {
  test("makes a person found by email the owner of an owner-less Organization", async () => {
    const { recovery, fake } = recoveryWith([
      { userId: "staff", organizationId: "client", role: "member" },
    ]);

    const result = await recovery.assignOwner({
      organizationId: "client",
      user: "Alice@Example.com",
    });

    expect(result).toMatchObject({ userId: "alice", action: "added", applied: true });
    expect(fake.roleOf("alice", "client")).toBe("owner");
    expect(fake.roleOf("staff", "client")).toBe("member");
  });

  test("promotes an existing member found by user id", async () => {
    const { recovery, fake } = recoveryWith([
      { userId: "alice", organizationId: "client", role: "admin" },
    ]);

    const result = await recovery.assignOwner({ organizationId: "client", user: "alice" });

    expect(result.action).toBe("promoted");
    expect(fake.roleOf("alice", "client")).toBe("owner");
  });

  test("a dry run reports the change without making it", async () => {
    const { recovery, fake } = recoveryWith([
      { userId: "alice", organizationId: "client", role: "admin" },
    ]);

    const result = await recovery.assignOwner({
      organizationId: "client",
      user: "alice",
      dryRun: true,
    });

    expect(result).toMatchObject({ action: "promoted", applied: false });
    expect(fake.roleOf("alice", "client")).toBe("admin");
  });

  test("is refused when the Organization still has an owner", async () => {
    const { recovery, fake } = recoveryWith([
      { userId: "staff", organizationId: "client", role: "owner" },
    ]);

    await expect(
      recovery.assignOwner({ organizationId: "client", user: "alice" }),
    ).rejects.toMatchObject({ code: "HAS_OWNER" });
    expect(fake.roleOf("alice", "client")).toBeNull();
  });

  test("is refused for personal Organizations", async () => {
    const { recovery } = recoveryWith([]);

    await expect(
      recovery.assignOwner({ organizationId: "personal", user: "alice" }),
    ).rejects.toMatchObject({ code: "PERSONAL_ORGANIZATION" });
  });

  test("reports an unknown Organization or user", async () => {
    const { recovery } = recoveryWith([]);

    await expect(
      recovery.assignOwner({ organizationId: "missing", user: "alice" }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_NOT_FOUND" });
    await expect(
      recovery.assignOwner({ organizationId: "client", user: "nobody@example.com" }),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });
});
