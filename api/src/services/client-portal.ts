import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { AgencyService } from "./agency";
import type { BillingsService } from "./billings";
import type { ClientsService } from "./clients";
import { sumByToken } from "./report-tokens";
import type { ReportsService } from "./reports";

type ClientScope = {
  client: {
    id: string;
    name: string;
    nearAccountId: string | null;
    orgId: string;
    agencyDaoAccountId: string | null;
  };
  projectIds: string[];
  orgAccountId: string | null;
};

export function getNearAccountFromContext(context: Record<string, unknown>): string {
  const nearAccountId = (context as { near?: { primaryAccountId?: string } }).near
    ?.primaryAccountId;
  if (!nearAccountId) {
    throw new ORPCError("FORBIDDEN", {
      message: "Sign in with your NEAR wallet to use the client portal.",
    });
  }
  return nearAccountId;
}

export function enrichContextForAgency(context: Record<string, unknown>, orgAccountId: string) {
  return {
    ...context,
    organization: {
      activeOrganizationId: orgAccountId,
      organization: {
        id: orgAccountId,
        name: orgAccountId,
        slug: orgAccountId,
        metadata: { daoAccountId: orgAccountId, type: "agency" as const },
      },
      member: { role: "admin" as const },
    },
  };
}

async function resolveClientScope(
  clientsService: ClientsService,
  nearAccountId: string,
  agencyDaoAccountId: string,
): Promise<ClientScope> {
  const lookup = await Effect.runPromise(
    clientsService.getByNearAndAgency(nearAccountId, agencyDaoAccountId),
  );
  if (!lookup) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "No client portal for this wallet at this agency. Ask your agency to add your NEAR account under Clients.",
    });
  }

  if (lookup.projectIds.length === 0) {
    return { ...lookup, orgAccountId: null };
  }

  const orgAccountId = lookup.client.agencyDaoAccountId;
  if (!orgAccountId) {
    throw new ORPCError("FORBIDDEN", {
      message: "Client projects could not be resolved. Contact your agency.",
    });
  }

  return { ...lookup, orgAccountId };
}

function assertLinkedProject(projectIds: string[], projectId: string) {
  if (!projectIds.includes(projectId)) {
    throw new ORPCError("NOT_FOUND", { message: "Project not found" });
  }
}

export function createClientPortalService(
  clientsService: ClientsService,
  agency: AgencyService,
  billings: BillingsService,
  reports: ReportsService,
) {
  return {
    listProjects: (
      nearAccountId: string,
      agencyDaoAccountId: string,
      context: Record<string, unknown>,
    ) =>
      Effect.gen(function* () {
        const scope = yield* Effect.promise(() =>
          resolveClientScope(clientsService, nearAccountId, agencyDaoAccountId),
        );
        if (!scope.orgAccountId) return { data: [] };

        const enriched = enrichContextForAgency(context, scope.orgAccountId);
        const all = yield* Effect.promise(() =>
          agency.fetchOrgProjects(scope.orgAccountId!, enriched),
        );
        const allowed = new Set(scope.projectIds);
        const data = all
          .filter((p) => allowed.has(p.id))
          .map((p) => ({
            id: p.id,
            ownerId: p.ownerId,
            organizationId: p.organizationId ?? scope.orgAccountId!,
            slug: p.slug,
            title: p.title,
            description: p.description,
            repository: p.repository ?? null,
            nearnListingId: null as string | null,
            kind: ((p as { kind?: string }).kind ?? "project") as
              | "project"
              | "idea"
              | "scope"
              | "result",
            status: p.status as "active" | "paused" | "archived",
            visibility: p.visibility as "public" | "unlisted" | "private",
            createdAt: new Date(p.createdAt),
            updatedAt: new Date(p.updatedAt),
          }));

        return { data };
      }),

    getProject: (
      nearAccountId: string,
      agencyDaoAccountId: string,
      slug: string,
      context: Record<string, unknown>,
    ) =>
      Effect.gen(function* () {
        const scope = yield* Effect.promise(() =>
          resolveClientScope(clientsService, nearAccountId, agencyDaoAccountId),
        );
        if (!scope.orgAccountId) {
          return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Project not found" }));
        }

        const enriched = enrichContextForAgency(context, scope.orgAccountId);
        const detail = yield* agency.getProject(enriched, slug);
        assertLinkedProject(scope.projectIds, detail.project.id);
        return detail;
      }),

    getBudget: (
      nearAccountId: string,
      agencyDaoAccountId: string,
      projectId: string,
      context: Record<string, unknown>,
    ) =>
      Effect.gen(function* () {
        const scope = yield* Effect.promise(() =>
          resolveClientScope(clientsService, nearAccountId, agencyDaoAccountId),
        );
        if (!scope.orgAccountId) {
          return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Project not found" }));
        }
        assertLinkedProject(scope.projectIds, projectId);
        const enriched = enrichContextForAgency(context, scope.orgAccountId);
        return yield* agency.getBudget(enriched, projectId);
      }),

    listBillings: (
      nearAccountId: string,
      agencyDaoAccountId: string,
      input: { projectId?: string; cursor?: string; limit: number },
      context: Record<string, unknown>,
    ) =>
      Effect.gen(function* () {
        const scope = yield* Effect.promise(() =>
          resolveClientScope(clientsService, nearAccountId, agencyDaoAccountId),
        );
        if (!scope.orgAccountId) return { data: [], nextCursor: null };
        if (input.projectId) assertLinkedProject(scope.projectIds, input.projectId);

        const enriched = enrichContextForAgency(context, scope.orgAccountId);
        return yield* billings.list(
          {
            projectId: input.projectId,
            clientId: scope.client.id,
            cursor: input.cursor,
            limit: input.limit,
          },
          scope.orgAccountId,
          enriched,
        );
      }),

    generateReport: (
      nearAccountId: string,
      agencyDaoAccountId: string,
      input: { note?: string; startDate?: string; endDate?: string },
      context: Record<string, unknown>,
    ) =>
      Effect.gen(function* () {
        const scope = yield* Effect.promise(() =>
          resolveClientScope(clientsService, nearAccountId, agencyDaoAccountId),
        );
        if (!scope.orgAccountId) {
          return yield* Effect.fail(
            new ORPCError("NOT_FOUND", { message: "No projects linked to this client account." }),
          );
        }
        const enriched = enrichContextForAgency(context, scope.orgAccountId);
        return yield* reports.generate(enriched, scope.orgAccountId, {
          clientId: scope.client.id,
          note: input.note,
          startDate: input.startDate,
          endDate: input.endDate,
        });
      }),

    dashboardSummary: (
      nearAccountId: string,
      agencyDaoAccountId: string,
      context: Record<string, unknown>,
    ) =>
      Effect.gen(function* () {
        const scope = yield* Effect.promise(() =>
          resolveClientScope(clientsService, nearAccountId, agencyDaoAccountId),
        );
        if (!scope.orgAccountId || scope.projectIds.length === 0) {
          return { projectCount: 0, remainingByToken: [] };
        }

        const enriched = enrichContextForAgency(context, scope.orgAccountId);
        const remainingRows: Array<{ tokenId: string; amount: string }> = [];

        for (const projectId of scope.projectIds) {
          const budget = yield* agency.getBudget(enriched, projectId);
          for (const row of budget.budgets) {
            try {
              const remaining = BigInt(row.remaining);
              if (remaining > 0n) {
                remainingRows.push({ tokenId: row.tokenId, amount: remaining.toString() });
              }
            } catch {
              // skip invalid amounts
            }
          }
        }

        return {
          projectCount: scope.projectIds.length,
          remainingByToken: sumByToken(remainingRows),
        };
      }),
  };
}

export type ClientPortalService = ReturnType<typeof createClientPortalService>;
