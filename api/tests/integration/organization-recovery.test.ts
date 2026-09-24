import { describe, expect, test } from "vitest";
import type { PluginContext } from "../../src/lib/organizations";
import { createOrganizationRecovery } from "../../src/services/organization-recovery";
import { type FakeMember, inMemoryOrganizations, signedIn } from "../fakes/organizations";

const PLATFORM_ADMIN: PluginContext = { ...signedIn("root", null), user: { role: "admin" } };

function recoveryWith(members: FakeMember[]) {
  const fake = inMemoryOrganizations({
    organizations: [{ id: "client" }, { id: "personal", isPersonal: true }],
    members,
  });
  return { recovery: createOrganizationRecovery({ members: fake.members }), fake };
}

describe("assigning an owner to an Organization", () => {
  test("a platform admin makes a new person the owner of an owner-less Organization", async () => {
    const { recovery, fake } = recoveryWith([
      { userId: "staff", organizationId: "client", role: "member" },
    ]);

    await recovery.assignOwner(PLATFORM_ADMIN, { organizationId: "client", userId: "alice" });

    expect(fake.roleOf("alice", "client")).toBe("owner");
    expect(fake.roleOf("staff", "client")).toBe("member");
  });

  test("a platform admin promotes an existing member of an owner-less Organization", async () => {
    const { recovery, fake } = recoveryWith([
      { userId: "alice", organizationId: "client", role: "admin" },
    ]);

    await recovery.assignOwner(PLATFORM_ADMIN, { organizationId: "client", userId: "alice" });

    expect(fake.roleOf("alice", "client")).toBe("owner");
  });

  test("is refused when the Organization still has an owner", async () => {
    const { recovery, fake } = recoveryWith([
      { userId: "boss", organizationId: "client", role: "owner" },
    ]);

    await expect(
      recovery.assignOwner(PLATFORM_ADMIN, { organizationId: "client", userId: "alice" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fake.roleOf("alice", "client")).toBeNull();
  });

  test("is refused to anyone who is not a platform admin, even an Organization owner", async () => {
    const { recovery, fake } = recoveryWith([
      { userId: "boss", organizationId: "personal", role: "owner" },
    ]);

    await expect(
      recovery.assignOwner(signedIn("boss", "personal"), {
        organizationId: "client",
        userId: "boss",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fake.roleOf("boss", "client")).toBeNull();
  });

  test("is refused for personal Organizations", async () => {
    const { recovery } = recoveryWith([]);

    await expect(
      recovery.assignOwner(PLATFORM_ADMIN, { organizationId: "personal", userId: "alice" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("answers not found for an unknown Organization", async () => {
    const { recovery } = recoveryWith([]);

    await expect(
      recovery.assignOwner(PLATFORM_ADMIN, { organizationId: "missing", userId: "alice" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
