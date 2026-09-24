import { beforeAll, describe, expect, test } from "vitest";
import { runEffect } from "../../src/lib/context";
import type { PluginContext } from "../../src/lib/organizations";
import { createAgencyService } from "../../src/services/agency";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { inMemoryAccess, seedAgencyDaos, signedIn } from "../fakes/organizations";
import { inMemoryProjectsPlugin, project } from "../fakes/projects";
import { migratedDatabase } from "./_pg";

const DEFAULT_DAO = "multiagency.sputnik-dao.testnet";
const OTHER_DAO = "other.sputnik-dao.testnet";

const organizations = [
  { id: "multiagency", daoAccountId: DEFAULT_DAO },
  { id: "other", daoAccountId: OTHER_DAO },
  { id: "no-dao" },
];

const publicProject = (id: string, organizationId: string) => ({
  ...project(id, organizationId),
  visibility: "public" as const,
});

describe("public pages", () => {
  const state = migratedDatabase();

  beforeAll(() => seedAgencyDaos(state.db, organizations));

  function setup() {
    const { db } = state;
    const { plugins, directory } = inMemoryProjectsPlugin([
      publicProject("default-public", "multiagency"),
      project("default-private", "multiagency"),
      publicProject("other-public", "other"),
      project("other-private", "other"),
      publicProject("no-dao-public", "no-dao"),
    ]);
    const access = inMemoryAccess(
      db,
      {
        organizations,
        members: [
          { userId: "staff", organizationId: "multiagency", role: "admin" },
          { userId: "other-admin", organizationId: "other", role: "admin" },
          { userId: "founder", organizationId: "no-dao", role: "owner" },
        ],
      },
      DEFAULT_DAO,
    );
    const listings = createListingsService(db, directory);
    const agency = createAgencyService(
      db,
      plugins,
      directory,
      listings,
      createProjectLedgers(db, listings),
    );
    const publicProjectIds = async (context: PluginContext) =>
      (await runEffect(agency.listProjects(await access.publicScope(context)))).data.map(
        (p) => p.id,
      );
    return { access, publicProjectIds };
  }

  const callers: Array<[string, PluginContext]> = [
    ["an anonymous visitor", {}],
    ["a member of another Organization", signedIn("other-admin", "other", "other.near")],
    ["a member of an Organization without an Agency DAO", signedIn("founder", "no-dao")],
    ["staff of the default Organization", signedIn("staff", "multiagency", "staff.near")],
  ];

  test.each(callers)("%s sees the default Organization's public data", async (_, context) => {
    const { access, publicProjectIds } = setup();

    expect(await access.publicScope(context)).toMatchObject({
      organizationId: "multiagency",
      agencyDao: DEFAULT_DAO,
      network: "testnet",
      role: null,
      canSeePrivate: false,
    });
    expect(await publicProjectIds(context)).toEqual(["default-public"]);
  });

  test.each<[string, PluginContext, Record<string, unknown>]>([
    [
      "stay available to staff of the default Organization",
      signedIn("staff", "multiagency", "staff.near"),
      { role: "admin", canSeePrivate: true },
    ],
    [
      "are not granted to staff of other Organizations",
      signedIn("other-admin", "other", "other.near"),
      { role: null, canSeePrivate: false },
    ],
  ])("treasury staff tools %s", async (_, context, expected) => {
    const { access } = setup();

    expect(await access.publicTreasuryScope(context)).toMatchObject({
      organizationId: "multiagency",
      agencyDao: DEFAULT_DAO,
      ...expected,
    });
  });
});
