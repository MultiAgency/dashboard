import { beforeEach, expect } from "vitest";
import type { Database } from "../../src/db";
import type { PluginsClient } from "../../src/lib/plugins-types.gen";
import { createAgencyService } from "../../src/services/agency";
import { createBillingsService } from "../../src/services/billings";
import { createChangeOrdersService } from "../../src/services/change-orders";
import { createClientPortalService } from "../../src/services/client-portal";
import { createEngagementsService } from "../../src/services/engagements";
import { type ChainStatusFetcher, createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { createNotifications } from "../../src/services/notifications";
import type { EmailMessage } from "../../src/services/notify";
import { createOrganizationAccess, ROLE_MATRIX } from "../../src/services/organization-access";
import { createPrepaymentsService } from "../../src/services/prepayments";
import type { PluginProject } from "../../src/services/project-directory";
import { createReportsService } from "../../src/services/reports";
import { migratedDatabase } from "../integration/_pg";
import {
  type FakeMember,
  type FakeOrganization,
  type FakeUser,
  inMemoryOrganizations,
  seedAgencyDaos,
  signedIn,
} from "./organizations";
import { inMemoryProjectsPlugin, project } from "./projects";

export const ORIGIN = "https://app.example";
export const SPOOFED_ORIGIN = "https://spoofed.example";

export const refused = (promise: Promise<unknown>, reason: string) =>
  expect(promise).rejects.toMatchObject(
    reason === "NOT_FOUND" ? { code: reason } : { data: { reason } },
  );

type Seed = {
  organizations: FakeOrganization[];
  members: FakeMember[];
  users: FakeUser[];
  projects: PluginProject[];
};

const STUDIO_MEMBERS: FakeMember[] = [
  { userId: "studio-admin", organizationId: "studio", role: "admin" },
  { userId: "studio-owner", organizationId: "studio", role: "owner" },
  { userId: "rival-admin", organizationId: "rival", role: "owner" },
  { userId: "acme-owner", organizationId: "acme", role: "owner" },
  { userId: "acme-member", organizationId: "acme", role: "member" },
  { userId: "globex-owner", organizationId: "globex", role: "owner" },
  { userId: "alice", organizationId: "alice-personal", role: "owner" },
];

export const STUDIO_SEED: Seed = {
  organizations: [
    { id: "studio", name: "Studio", slug: "studio", daoAccountId: "studio.sputnik-dao.testnet" },
    { id: "rival", name: "Rival", slug: "rival" },
    { id: "acme", name: "Acme Corp", slug: "acme" },
    { id: "globex", name: "Globex", slug: "globex" },
    { id: "alice-personal", name: "Alice", slug: "alice", isPersonal: true },
  ],
  members: STUDIO_MEMBERS,
  users: [
    { id: "studio-admin", email: "admin@studio.example" },
    { id: "studio-owner", email: "studio-owner.near@near.email" },
    { id: "rival-admin", email: "rival@rival.example" },
    { id: "acme-owner", email: "owner@acme.example" },
    { id: "acme-member", email: "member@acme.example" },
    { id: "globex-owner", email: "owner@globex.example" },
    { id: "alice", email: "alice@example.com" },
    { id: "newco-boss", email: "boss@newco.example" },
  ],
  projects: [
    project("p1", "studio"),
    project("p2", "studio"),
    project("r1", "rival"),
    { ...project("shared", "studio"), slug: "shared", title: "Shared work" },
    { ...project("internal", "studio"), slug: "internal", title: "Internal work" },
  ],
};

export async function engagementWorld(
  db: Database,
  seed: Seed = STUDIO_SEED,
  options: { now?: () => Date; chainStatus?: ChainStatusFetcher } = {},
) {
  await seedAgencyDaos(db, seed.organizations);
  const organizations = inMemoryOrganizations({
    ...seed,
    members: seed.members.map((m) => ({ ...m })),
  });
  const projectsPlugin = inMemoryProjectsPlugin(seed.projects);
  const directory = projectsPlugin.directory;
  const access = createOrganizationAccess({ db, organizations: organizations.port, directory });
  const emails: EmailMessage[] = [];
  const sendEmail = async (message: EmailMessage) => {
    emails.push(message);
  };
  const notifications = createNotifications({
    db,
    directory: organizations.directory,
    sendEmail,
    appOrigin: ORIGIN,
  });
  const changeOrders = createChangeOrdersService({
    db,
    organizations: organizations.directory,
    notifications,
    chainStatus: options.chainStatus,
    now: options.now,
  });
  const ended: string[] = [];
  const engagements = createEngagementsService({
    db,
    organizations: organizations.directory,
    projects: directory,
    notifications,
    sendEmail,
    appOrigin: ORIGIN,
    subcontracted: access.subcontractedProjects,
    onEnded: async (engagement) => {
      ended.push(engagement.id);
      await changeOrders.withdrawPending(engagement);
    },
  });

  const prepayments = createPrepaymentsService({
    db,
    organizations: organizations.directory,
    notifications,
    onPlanApplied: changeOrders.notifyPlanApplied,
    chainStatus: options.chainStatus,
    now: options.now,
  });

  const context = (userId: string, organizationId: string, near?: string) => ({
    ...signedIn(userId, organizationId, near),
    reqHeaders: new Headers({ origin: SPOOFED_ORIGIN, "x-forwarded-host": "spoofed.example" }),
  });
  const manager = (userId: string, organizationId: string) =>
    access.agencyScope(context(userId, organizationId), ROLE_MATRIX.manage);

  async function activeEngagement(clientId: string, projectIds: string[] = []) {
    const client = seed.organizations.find((o) => o.id === clientId)!;
    const owner = seed.members.find((m) => m.organizationId === clientId && m.role === "owner")!;
    const studio = await manager("studio-admin", "studio");
    const proposed = await engagements.propose(studio, { slug: client.slug!, name: client.name! });
    const accepted = await engagements.accept(await manager(owner.userId, clientId), proposed.id);
    for (const projectId of projectIds) {
      await engagements.share(studio, { engagementId: proposed.id, projectId });
    }
    return accepted;
  }

  return {
    organizations,
    plugins: projectsPlugin.plugins,
    upstreamProjects: projectsPlugin.projects,
    access,
    directory,
    notifications,
    engagements,
    prepayments,
    changeOrders,
    emails,
    ended,
    context,
    manager,
    member: (userId: string, organizationId: string) =>
      access.agencyScope(context(userId, organizationId), ROLE_MATRIX.work),
    activeEngagement,
  };
}

export type EngagementWorld = Awaited<ReturnType<typeof engagementWorld>>;

export const STUDIO_DAO = "studio-work.sputnik-dao.near";
export const CREW_DAO = "crew-work.sputnik-dao.near";

const CLIENT_WORK_MEMBERS: FakeMember[] = [
  { userId: "studio-admin", organizationId: "studio", role: "admin" },
  { userId: "studio-member", organizationId: "studio", role: "member" },
  { userId: "acme-owner", organizationId: "acme", role: "owner" },
  { userId: "acme-member", organizationId: "acme", role: "member" },
  { userId: "globex-owner", organizationId: "globex", role: "owner" },
  { userId: "crew-owner", organizationId: "crew", role: "owner" },
  { userId: "rival-admin", organizationId: "rival", role: "owner" },
];

export const CLIENT_WORK_SEED: Seed = {
  organizations: [
    { id: "studio", name: "Studio", slug: "studio", daoAccountId: STUDIO_DAO },
    { id: "acme", name: "Acme Corp", slug: "acme" },
    { id: "globex", name: "Globex", slug: "globex" },
    { id: "crew", name: "Crew", slug: "crew", daoAccountId: CREW_DAO },
    { id: "rival", name: "Rival", slug: "rival" },
  ],
  members: CLIENT_WORK_MEMBERS,
  users: CLIENT_WORK_MEMBERS.map((m) => ({ id: m.userId, email: `${m.userId}@example.com` })),
  projects: [{ ...project("site", "studio"), slug: "site", title: "Website" }],
};

export function clientWorkWorld() {
  const database = migratedDatabase({ perTest: true });
  const state = {} as { db: Database; world: EngagementWorld };
  beforeEach(async () => {
    state.db = database.db;
    state.world = await engagementWorld(database.db, CLIENT_WORK_SEED);
  });
  return state;
}

export function clientPortalOf(db: Database, world: Awaited<ReturnType<typeof engagementWorld>>) {
  const plugins = {
    builders: () => ({
      listBuilders: async () => ({ data: [{ nearAccount: "builder.near", name: "Builder" }] }),
    }),
  } as unknown as PluginsClient;
  const listings = createListingsService(db, world.directory);
  const ledgers = createProjectLedgers(db, listings);
  return createClientPortalService(
    world.access,
    createAgencyService(db, plugins, world.directory, listings, ledgers),
    createBillingsService(db, world.directory, world.access),
    createReportsService(db, world.directory, plugins, world.organizations.directory),
    world.directory,
    ledgers,
  );
}
