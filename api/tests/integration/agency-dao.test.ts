import { beforeEach, describe, expect, test } from "vitest";
import { billings, budgets, engagements, organizationDaos, prepayments } from "../../src/db/schema";
import { createAgencyDaoService } from "../../src/services/agency-dao";
import { ROLE_MATRIX } from "../../src/services/organization-access";
import type { DaoRole } from "../../src/services/sputnik";
import { inMemoryAccess, signedIn } from "../fakes/organizations";
import { inMemoryProjectsPlugin, project } from "../fakes/projects";
import { migratedDatabase } from "./_pg";

const TREZU = "studio.sputnik-dao.near";
const OTHER_TREZU = "studio-two.sputnik-dao.near";
const TESTNET_DAO = "studio.sputnikv2.testnet";

const councilOf = (...members: string[]): DaoRole[] => [
  { name: "all", isEveryone: true, members: [], permissions: ["*:AddProposal"] },
  { name: "council", isEveryone: false, members, permissions: ["*:*"] },
];

const daos: Record<string, DaoRole[]> = {
  [TREZU]: councilOf("founder.near"),
  [OTHER_TREZU]: councilOf("founder.near"),
  [TESTNET_DAO]: councilOf("founder.testnet"),
};

describe("connecting an Agency DAO", () => {
  const state = migratedDatabase();

  beforeEach(async () => {
    await state.pg.query(
      "TRUNCATE organization_daos, budgets, billings, prepayments, engagements CASCADE",
    );
  });

  function setup() {
    const { db } = state;
    const { directory } = inMemoryProjectsPlugin([project("site", "studio")]);
    const access = inMemoryAccess(db, {
      organizations: [{ id: "studio" }, { id: "rival" }],
      members: [
        { userId: "founder", organizationId: "studio", role: "owner" },
        { userId: "rival-owner", organizationId: "rival", role: "owner" },
      ],
    });
    const service = createAgencyDaoService({
      db,
      directory,
      daoRoles: async (dao) => {
        const roles = daos[dao];
        if (!roles) throw new Error("account does not exist");
        return roles;
      },
    });
    const founderScope = () =>
      access.agencyScope(signedIn("founder", "studio", "founder.near"), ROLE_MATRIX.manage);
    const connect = async (daoAccountId: string, walletAccounts = ["founder.near"]) =>
      service.connectForMember(await founderScope(), {
        daoAccountId,
        network: "mainnet",
        walletAccounts,
      });
    return { access, service, founderScope, connect };
  }

  test("an owner whose wallet holds a DAO role connects it and unlocks money features", async () => {
    const { access, connect } = setup();

    await connect(TREZU);

    const resolved = await access.resolve(signedIn("founder", "studio", "founder.near"));
    expect(resolved.agencyDao).toBe(TREZU);
    expect(resolved.capabilities.canUseMoney).toBe(true);
  });

  test("refuses a wallet without a role in the DAO, even though anyone may propose", async () => {
    const { connect } = setup();

    await expect(connect(TREZU, ["stranger.near"])).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("refuses accounts that are not Sputnik DAOs, DAOs that do not exist and other networks", async () => {
    const { connect } = setup();

    await expect(connect("founder.near")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(connect("missing.sputnik-dao.near")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("was found"),
    });
    await expect(connect(TESTNET_DAO, ["founder.testnet"])).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("testnet"),
    });
  });

  test("refuses a DAO already connected to another Organization", async () => {
    const { connect } = setup();
    await state.db
      .insert(organizationDaos)
      .values({ organizationId: "rival", daoAccountId: TREZU });

    await expect(connect(TREZU)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("another Organization"),
    });
  });

  test("changes and disconnects while no Budget entry or Billing references it", async () => {
    const { access, service, connect, founderScope } = setup();
    await connect(TREZU);

    await connect(OTHER_TREZU);
    expect((await founderScope()).agencyDao).toBe(OTHER_TREZU);

    await service.disconnect(await founderScope());
    expect((await access.resolve(signedIn("founder", "studio"))).agencyDao).toBeNull();
  });

  test.each([
    [
      "funds Budget entries",
      () =>
        state.db.insert(budgets).values({
          id: crypto.randomUUID(),
          projectId: "site",
          tokenId: "near",
          amount: "10",
          actorAccountId: "founder.near",
        }),
    ],
    [
      "paid Billings",
      () =>
        state.db.insert(billings).values({
          id: crypto.randomUUID(),
          projectId: "site",
          tokenId: "near",
          amount: "5",
          proposalId: "7",
          nearAccount: "dev.near",
        }),
    ],
    [
      "holds Prepayments",
      async () => {
        await state.db.insert(engagements).values({
          id: "e1",
          agencyOrganizationId: "studio",
          clientOrganizationId: "rival",
          status: "active",
          proposedBy: "founder",
        });
        await state.db.insert(prepayments).values({
          id: "p1",
          engagementId: "e1",
          daoAccountId: TREZU,
          tokenId: "near",
          amount: "10",
          period: "2026-09",
          actorAccountId: "founder.near",
        });
      },
    ],
  ])("refuses to change or disconnect a DAO that %s", async (_, reference) => {
    const { service, connect, founderScope } = setup();
    await connect(TREZU);
    await reference();

    expect((await service.status(await founderScope())).inUse).toBe(true);
    await expect(connect(OTHER_TREZU)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.disconnect(await founderScope())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await founderScope()).agencyDao).toBe(TREZU);
  });

  test("refuses to disconnect a DAO that paid Billings as a Subcontractor, but not another DAO's", async () => {
    const { service, connect, founderScope } = setup();
    await connect(TREZU);
    await state.db.insert(billings).values({
      id: crypto.randomUUID(),
      projectId: "someone-elses-project",
      tokenId: "near",
      amount: "5",
      proposalId: "7",
      payingDaoAccountId: TREZU,
    });
    await expect(service.disconnect(await founderScope())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await state.db.update(billings).set({ payingDaoAccountId: "crew.sputnik-dao.near" });
    await state.db.update(billings).set({ projectId: "site" });

    await service.disconnect(await founderScope());
    expect((await founderScope()).agencyDao).toBeNull();
  });

  test("platform admins connect a DAO to a new Organization without holding a DAO role", async () => {
    const { access, service } = setup();

    await service.connectAsPlatformAdmin("rival", TREZU, "mainnet");

    expect((await access.resolve(signedIn("rival-owner", "rival"))).agencyDao).toBe(TREZU);
    await expect(
      service.connectAsPlatformAdmin("rival", OTHER_TREZU, "mainnet"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
