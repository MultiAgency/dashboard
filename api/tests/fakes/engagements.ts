import type { Database } from "../../src/db";
import { createEngagementsService } from "../../src/services/engagements";
import { createNotifications } from "../../src/services/notifications";
import type { EmailMessage } from "../../src/services/notify";
import { createOrganizationAccess, ROLE_MATRIX } from "../../src/services/organization-access";
import type { PluginProject } from "../../src/services/project-directory";
import { createProjectDirectory } from "../../src/services/project-directory";
import {
  type FakeMember,
  type FakeOrganization,
  type FakeUser,
  inMemoryOrganizations,
  seedAgencyDaos,
  signedIn,
} from "./organizations";
import { inMemoryProjects } from "./projects";

export const ORIGIN = "https://app.example";
export const SPOOFED_ORIGIN = "https://spoofed.example";

export async function engagementWorld(
  db: Database,
  seed: {
    organizations: FakeOrganization[];
    members: FakeMember[];
    users: FakeUser[];
    projects: PluginProject[];
  },
) {
  await seedAgencyDaos(db, seed.organizations);
  const organizations = inMemoryOrganizations(seed);
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

  return {
    organizations,
    access,
    directory,
    notifications,
    engagements,
    emails,
    ended,
    context,
    manager: (userId: string, organizationId: string) =>
      access.agencyScope(context(userId, organizationId), ROLE_MATRIX.manage),
    member: (userId: string, organizationId: string) =>
      access.agencyScope(context(userId, organizationId), ROLE_MATRIX.work),
  };
}
