import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { budgets, type EngagementRow, engagementProjects, engagements } from "../db/schema";
import {
  type Invitation,
  type Organization,
  type OrganizationDirectory,
  SlugTakenError,
} from "../lib/organizations";
import type { NotificationKind, NotificationsService } from "./notifications";
import { appUrl, type EmailSender, escapeHtml } from "./notify";
import type { OrganizationScope } from "./organization-access";
import type { ProjectDirectory } from "./project-directory";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type EngagementSide = "agency" | "client";

export type InvitationView = {
  email: string;
  status: "pending" | "expired" | "accepted" | "rejected" | "canceled";
  expiresAt: Date;
  link: string;
};

export type EngagementView = {
  id: string;
  kind: EngagementRow["kind"];
  status: EngagementRow["status"];
  side: EngagementSide;
  agency: { id: string; name: string; slug: string };
  client: { id: string; name: string; slug: string };
  projectIds: string[];
  invitation: InvitationView | null;
  createdAt: Date;
  updatedAt: Date;
  decidedAt: Date | null;
  endedAt: Date | null;
};

function badRequest(reason: string, message: string) {
  return new ORPCError("BAD_REQUEST", { message, data: { reason } });
}

const notFound = () => new ORPCError("NOT_FOUND", { message: "Engagement not found" });

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  while (current && typeof current === "object") {
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function invitationLink(invitation: Pick<Invitation, "id" | "email">): string {
  return `/accept-invitation/${invitation.id}?email=${encodeURIComponent(invitation.email)}`;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function unshareBlockers(
  db: Database,
  engagementId: string,
  projectId: string,
): Promise<string[]> {
  const rows = await db
    .select({ tokenId: budgets.tokenId, amount: budgets.amount })
    .from(budgets)
    .where(and(eq(budgets.engagementId, engagementId), eq(budgets.projectId, projectId)));
  const byToken = new Map<string, bigint>();
  for (const row of rows) {
    byToken.set(row.tokenId, (byToken.get(row.tokenId) ?? 0n) + BigInt(row.amount));
  }
  return [...byToken.values()].some((total) => total !== 0n) ? ["ATTRIBUTED_BUDGET"] : [];
}

export function createEngagementsService(deps: {
  db: Database;
  organizations: OrganizationDirectory;
  projects: ProjectDirectory;
  notifications: NotificationsService;
  sendEmail: EmailSender | null;
  appOrigin: string;
  onEnded?: (engagement: EngagementRow) => Promise<void>;
  now?: () => Date;
}) {
  const { db, organizations, projects, notifications, sendEmail } = deps;
  const now = deps.now ?? (() => new Date());

  const userIdOf = (scope: OrganizationScope) => scope.pluginContext.userId ?? scope.actorId;

  async function load(id: string): Promise<EngagementRow | null> {
    const [row] = await db.select().from(engagements).where(eq(engagements.id, id)).limit(1);
    return row ?? null;
  }

  function sideOf(scope: OrganizationScope, row: EngagementRow): EngagementSide | null {
    if (row.agencyOrganizationId === scope.organizationId) return "agency";
    if (row.clientOrganizationId === scope.organizationId) return "client";
    return null;
  }

  async function requireSide(scope: OrganizationScope, id: string, side?: EngagementSide) {
    const row = await load(id);
    const actual = row ? sideOf(scope, row) : null;
    if (!row || !actual || (side && actual !== side)) throw notFound();
    return { row, side: actual };
  }

  async function update(id: string, patch: Partial<EngagementRow>): Promise<EngagementRow> {
    const [row] = await db
      .update(engagements)
      .set({ ...patch, updatedAt: now() })
      .where(eq(engagements.id, id))
      .returning();
    if (!row) throw notFound();
    return row;
  }

  async function namesOf(ids: string[]): Promise<Map<string, Organization>> {
    const found = await Promise.all([...new Set(ids)].map((id) => organizations.get(id)));
    return new Map(found.flatMap((o) => (o ? [[o.id, o] as const] : [])));
  }

  async function projectIdsOf(ids: string[]): Promise<Map<string, string[]>> {
    const byEngagement = new Map<string, string[]>();
    if (ids.length === 0) return byEngagement;
    const rows = await db
      .select()
      .from(engagementProjects)
      .where(inArray(engagementProjects.engagementId, ids))
      .orderBy(asc(engagementProjects.createdAt));
    for (const row of rows) {
      byEngagement.set(row.engagementId, [
        ...(byEngagement.get(row.engagementId) ?? []),
        row.projectId,
      ]);
    }
    return byEngagement;
  }

  async function invitationOf(row: EngagementRow): Promise<InvitationView | null> {
    if (!row.invitationId) return null;
    const invitation = await organizations.invitation(row.invitationId);
    if (!invitation) return null;
    const expired = invitation.status === "pending" && invitation.expiresAt < now();
    return {
      email: invitation.email,
      status: expired ? "expired" : invitation.status,
      expiresAt: invitation.expiresAt,
      link: invitationLink(invitation),
    };
  }

  function party(org: Organization | undefined, id: string) {
    return { id, name: org?.name ?? id, slug: org?.slug ?? id };
  }

  async function views(scope: OrganizationScope, rows: EngagementRow[]): Promise<EngagementView[]> {
    const [names, shared] = await Promise.all([
      namesOf(rows.flatMap((r) => [r.agencyOrganizationId, r.clientOrganizationId])),
      projectIdsOf(rows.map((r) => r.id)),
    ]);
    return Promise.all(
      rows.map(async (row) => {
        const side = sideOf(scope, row) ?? "agency";
        return {
          id: row.id,
          kind: row.kind,
          status: row.status,
          side,
          agency: party(names.get(row.agencyOrganizationId), row.agencyOrganizationId),
          client: party(names.get(row.clientOrganizationId), row.clientOrganizationId),
          projectIds: shared.get(row.id) ?? [],
          invitation: side === "agency" ? await invitationOf(row) : null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          decidedAt: row.decidedAt,
          endedAt: row.endedAt,
        };
      }),
    );
  }

  async function view(scope: OrganizationScope, row: EngagementRow): Promise<EngagementView> {
    const [result] = await views(scope, [row]);
    return result!;
  }

  async function partyNames(row: EngagementRow) {
    const names = await namesOf([row.agencyOrganizationId, row.clientOrganizationId]);
    return {
      agencyName: names.get(row.agencyOrganizationId)?.name ?? row.agencyOrganizationId,
      clientName: names.get(row.clientOrganizationId)?.name ?? row.clientOrganizationId,
    };
  }

  async function tell(
    scope: OrganizationScope,
    row: EngagementRow,
    to: EngagementSide,
    kind: NotificationKind,
    extra: Record<string, string> = {},
  ) {
    const organizationId = to === "agency" ? row.agencyOrganizationId : row.clientOrganizationId;
    const link =
      to === "agency"
        ? `/admin/engagements/${row.id}`
        : row.status === "proposed"
          ? "/client"
          : `/client/${row.id}`;
    try {
      await notifications.notify({
        organizationId,
        kind,
        payload: { ...(await partyNames(row)), engagementId: row.id, ...extra },
        link,
        excludeUserId: userIdOf(scope),
      });
    } catch (err) {
      console.warn("[API] notification failed:", err instanceof Error ? err.message : err);
    }
  }

  async function sendInvitation(row: EngagementRow, invitation: Invitation) {
    const url = appUrl(deps.appOrigin, invitationLink(invitation));
    if (!sendEmail || !url) return;
    const { agencyName, clientName } = await partyNames(row);
    try {
      await sendEmail({
        to: invitation.email,
        subject: `${agencyName} invited you to ${clientName} on MultiAgency`,
        html: `<p>${escapeHtml(agencyName)} set up ${escapeHtml(clientName)} on MultiAgency and invited you as its first admin. You will own ${escapeHtml(clientName)} and manage its team.</p><p><a href="${escapeHtml(url)}">Accept the invitation</a></p>`,
      });
    } catch (err) {
      console.warn("[API] invitation email failed:", err instanceof Error ? err.message : err);
    }
  }

  async function syncInvitation(scope: OrganizationScope, row: EngagementRow) {
    if (!row.invitationId || row.invitationAcceptedAt) return row;
    const invitation = await organizations.invitation(row.invitationId);
    if (invitation?.status !== "accepted") return row;
    const updated = await update(row.id, { invitationAcceptedAt: now() });
    await tell(scope, updated, "agency", "client_invite_accepted", { email: invitation.email });
    return updated;
  }

  async function requireOwnedProjects(scope: OrganizationScope, projectIds: string[]) {
    const owned = projects.forAgency(scope);
    return Promise.all([...new Set(projectIds)].map((id) => owned.require(id)));
  }

  async function requirePendingInvitation(scope: OrganizationScope, id: string) {
    const { row } = await requireSide(scope, id, "agency");
    if (row.status !== "active") {
      throw badRequest(
        "NOT_ACTIVE",
        "The invitation can only change while the Engagement is active.",
      );
    }
    const synced = await syncInvitation(scope, row);
    if (!synced.invitationId) {
      throw badRequest("NO_INVITATION", "This Engagement has no first-admin invitation.");
    }
    const invitation = await organizations.invitation(synced.invitationId);
    if (!invitation) throw badRequest("NO_INVITATION", "The first-admin invitation is gone.");
    if (invitation.status === "accepted" || synced.invitationAcceptedAt) {
      throw badRequest(
        "INVITATION_ACCEPTED",
        "The first admin already joined. The Client now manages its own team.",
      );
    }
    return { row: synced, invitation };
  }

  async function invite(scope: OrganizationScope, row: EngagementRow, email: string) {
    const invitation = await organizations.invite({
      organizationId: row.clientOrganizationId,
      email,
      role: "owner",
      inviterId: userIdOf(scope),
      expiresAt: new Date(now().getTime() + INVITATION_TTL_MS),
    });
    const updated = await update(row.id, {
      invitationId: invitation.id,
      invitationEmail: invitation.email,
    });
    await sendInvitation(updated, invitation);
    await tell(scope, updated, "agency", "client_invite_sent", { email: invitation.email });
    return updated;
  }

  async function insertEngagement(values: typeof engagements.$inferInsert) {
    try {
      const [row] = await db.insert(engagements).values(values).returning();
      if (!row) throw new Error("engagements insert returned no row");
      return row;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw badRequest(
          "ENGAGEMENT_EXISTS",
          "There is already an active or pending Engagement with this Organization.",
        );
      }
      throw err;
    }
  }

  async function shareProjects(engagementId: string, projectIds: string[]) {
    const unique = [...new Set(projectIds)];
    if (unique.length === 0) return [];
    return db
      .insert(engagementProjects)
      .values(unique.map((projectId) => ({ engagementId, projectId })))
      .onConflictDoNothing()
      .returning();
  }

  return {
    list: async (scope: OrganizationScope) => {
      const rows = await db
        .select()
        .from(engagements)
        .where(
          or(
            eq(engagements.agencyOrganizationId, scope.organizationId),
            eq(engagements.clientOrganizationId, scope.organizationId),
          ),
        )
        .orderBy(desc(engagements.updatedAt));
      const synced = await Promise.all(rows.map((row) => syncInvitation(scope, row)));
      return { data: await views(scope, synced) };
    },

    get: async (scope: OrganizationScope, id: string) => {
      const { row } = await requireSide(scope, id);
      return view(scope, await syncInvitation(scope, row));
    },

    createWithClient: async (
      scope: OrganizationScope,
      input: { name: string; slug: string; adminEmail: string; projectIds?: string[] },
    ) => {
      await requireOwnedProjects(scope, input.projectIds ?? []);
      let client: Organization;
      try {
        client = await organizations.create({ name: input.name.trim(), slug: input.slug });
      } catch (err) {
        if (err instanceof SlugTakenError) {
          throw badRequest("SLUG_TAKEN", "This slug is taken. Choose another one.");
        }
        throw err;
      }
      const row = await insertEngagement({
        id: crypto.randomUUID(),
        agencyOrganizationId: scope.organizationId,
        clientOrganizationId: client.id,
        kind: "client",
        status: "active",
        proposedBy: userIdOf(scope),
        decidedAt: now(),
      });
      await shareProjects(row.id, input.projectIds ?? []);
      return view(scope, await invite(scope, row, input.adminEmail));
    },

    propose: async (
      scope: OrganizationScope,
      input: { slug: string; name: string; kind?: EngagementRow["kind"] },
    ) => {
      const client = await organizations.findBySlug(input.slug);
      if (!client || client.isPersonal || !sameName(client.name, input.name)) {
        throw new ORPCError("NOT_FOUND", {
          message: "No Organization matches this slug and name.",
        });
      }
      if (client.id === scope.organizationId) {
        throw badRequest("SELF_ENGAGEMENT", "An Organization cannot engage itself.");
      }
      const [active] = await db
        .select({ id: engagements.id })
        .from(engagements)
        .where(
          and(
            eq(engagements.agencyOrganizationId, scope.organizationId),
            eq(engagements.clientOrganizationId, client.id),
            eq(engagements.status, "active"),
          ),
        )
        .limit(1);
      if (active) {
        throw badRequest(
          "ENGAGEMENT_EXISTS",
          "There is already an active Engagement with this Organization.",
        );
      }
      const row = await insertEngagement({
        id: crypto.randomUUID(),
        agencyOrganizationId: scope.organizationId,
        clientOrganizationId: client.id,
        kind: input.kind ?? "client",
        status: "proposed",
        proposedBy: userIdOf(scope),
      });
      await tell(scope, row, "client", "engagement_proposed");
      return view(scope, row);
    },

    accept: async (scope: OrganizationScope, id: string) => {
      const { row } = await requireSide(scope, id, "client");
      if (row.status !== "proposed") {
        throw badRequest("NOT_PROPOSED", "Only a proposed Engagement can be accepted.");
      }
      let accepted: EngagementRow;
      try {
        accepted = await update(id, { status: "active", decidedAt: now() });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw badRequest(
            "ENGAGEMENT_EXISTS",
            "There is already an active Engagement with this Agency.",
          );
        }
        throw err;
      }
      await tell(scope, accepted, "agency", "engagement_accepted");
      return view(scope, accepted);
    },

    decline: async (scope: OrganizationScope, id: string) => {
      const { row } = await requireSide(scope, id, "client");
      if (row.status !== "proposed") {
        throw badRequest("NOT_PROPOSED", "Only a proposed Engagement can be declined.");
      }
      const declined = await update(id, { status: "declined", decidedAt: now() });
      await tell(scope, declined, "agency", "engagement_declined");
      return view(scope, declined);
    },

    end: async (scope: OrganizationScope, id: string) => {
      const { row, side } = await requireSide(scope, id);
      const withdrawable = row.status === "proposed" && side === "agency";
      if (row.status !== "active" && !withdrawable) {
        throw badRequest("NOT_ACTIVE", "Only an active Engagement can be ended.");
      }
      const ended = await update(id, { status: "ended", endedAt: now() });
      await deps.onEnded?.(ended);
      const names = await partyNames(ended);
      await tell(scope, ended, side === "agency" ? "client" : "agency", "engagement_ended", {
        endedBy: side === "agency" ? names.agencyName : names.clientName,
      });
      return view(scope, ended);
    },

    share: async (scope: OrganizationScope, input: { engagementId: string; projectId: string }) => {
      const { row } = await requireSide(scope, input.engagementId, "agency");
      if (row.status !== "active") {
        throw badRequest("NOT_ACTIVE", "Projects can only be shared through an active Engagement.");
      }
      const [project] = await requireOwnedProjects(scope, [input.projectId]);
      const inserted = await shareProjects(row.id, [input.projectId]);
      if (inserted.length > 0) {
        await tell(scope, row, "client", "project_shared", {
          projectTitle: project!.title,
          projectId: project!.id,
        });
      }
      return view(scope, row);
    },

    unshare: async (
      scope: OrganizationScope,
      input: { engagementId: string; projectId: string },
    ) => {
      const { row } = await requireSide(scope, input.engagementId, "agency");
      if (row.status !== "active") {
        throw badRequest(
          "NOT_ACTIVE",
          "An ended Engagement is read-only history; its Projects stay shared.",
        );
      }
      const [link] = await db
        .select()
        .from(engagementProjects)
        .where(
          and(
            eq(engagementProjects.engagementId, row.id),
            eq(engagementProjects.projectId, input.projectId),
          ),
        )
        .limit(1);
      if (!link) throw new ORPCError("NOT_FOUND", { message: "Project is not shared" });
      const blockers = await unshareBlockers(db, row.id, input.projectId);
      if (blockers.length > 0) {
        throw badRequest(
          blockers[0]!,
          "This Project has budget attributed to this Engagement. Pull it back through a Change order before unsharing.",
        );
      }
      await db
        .delete(engagementProjects)
        .where(
          and(
            eq(engagementProjects.engagementId, row.id),
            eq(engagementProjects.projectId, input.projectId),
          ),
        );
      const title = await projects
        .forAgency(scope)
        .require(input.projectId)
        .then((p) => p.title)
        .catch(() => input.projectId);
      await tell(scope, row, "client", "project_unshared", {
        projectTitle: title,
        projectId: input.projectId,
      });
      return view(scope, row);
    },

    resendInvitation: async (scope: OrganizationScope, id: string) => {
      const { row, invitation } = await requirePendingInvitation(scope, id);
      const expiresAt = new Date(now().getTime() + INVITATION_TTL_MS);
      await organizations.updateInvitation(invitation.id, { status: "pending", expiresAt });
      await sendInvitation(row, { ...invitation, status: "pending", expiresAt });
      return view(scope, row);
    },

    cancelInvitation: async (scope: OrganizationScope, id: string) => {
      const { row, invitation } = await requirePendingInvitation(scope, id);
      await organizations.updateInvitation(invitation.id, { status: "canceled" });
      return view(scope, row);
    },

    changeInvitationEmail: async (scope: OrganizationScope, id: string, email: string) => {
      const { row, invitation } = await requirePendingInvitation(scope, id);
      await organizations.updateInvitation(invitation.id, { status: "canceled" });
      return view(scope, await invite(scope, row, email));
    },
  };
}

export type EngagementsService = ReturnType<typeof createEngagementsService>;
