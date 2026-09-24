import type { Database } from "../../src/db";
import type { PluginsClient } from "../../src/lib/plugins-types.gen";
import { createAgencyService } from "../../src/services/agency";
import { createBillingsService } from "../../src/services/billings";
import { createClientPortalService } from "../../src/services/client-portal";
import { createEngagementsService } from "../../src/services/engagements";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { createNotifications } from "../../src/services/notifications";
import type { EmailMessage } from "../../src/services/notify";
import { createOrganizationAccess, ROLE_MATRIX } from "../../src/services/organization-access";
import type { PluginProject } from "../../src/services/project-directory";
import { createProjectDirectory } from "../../src/services/project-directory";
import { createReportsService } from "../../src/services/reports";
import {
  type FakeMember,
  type FakeOrganization,
  type FakeUser,
  inMemoryOrganizations,
  seedAgencyDaos,
  signedIn,
} from "./organizations";
import { inMemoryProjects, project } from "./projects";

export const ORIGIN = "https://app.example";
export const SPOOFED_ORIGIN = "https://spoofed.example";

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

export async function engagementWorld(db: Database, seed: Seed = STUDIO_SEED) {
  await seedAgencyDaos(db, seed.organizations);
  const organizations = inMemoryOrganizations({
    ...seed,
    members: seed.members.map((m) => ({ ...m })),
  });
  const projects = inMemoryProjects(seed.projects);
  const directory = createProjectDirectory(() => projects.client);
  const access = createOrganizationAccess({ db, organizations: organizations.port });
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
  const ended: string[] = [];
  const engagements = createEngagementsService({
    db,
    organizations: organizations.directory,
    projects: directory,
    notifications,
    sendEmail,
    appOrigin: ORIGIN,
    onEnded: async (engagement) => {
      ended.push(engagement.id);
    },
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
    access,
    directory,
    notifications,
    engagements,
    emails,
    ended,
    context,
    manager,
    activeEngagement,
  };
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
    createBillingsService(db, world.directory),
    createReportsService(db, world.directory, plugins, world.organizations.directory),
    world.directory,
    ledgers,
  );
}
