import { desc, eq } from "drizzle-orm";
import { Effect, Either } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { type Listing, projectContributors } from "../db/schema";
import type { AgencyScope } from "../lib/agency-scope";
import type { PluginsClient } from "../lib/plugins-types.gen";
import type { ProjectLedgers } from "./ledger";
import { type ListingsService, listingRowToNearnPayload } from "./listings";
import { isNearnAvailable } from "./nearn";
import type { Project, ProjectDirectory } from "./project-directory";
import { toProject } from "./project-directory";
import { deleteProjectCascade } from "./projects";

type ProjectKind = Project["kind"];
type ProjectStatus = Project["status"];
type ProjectVisibility = Project["visibility"];

const withListingId = (project: Project, nearnListingId: string | null) => ({
  ...project,
  nearnListingId,
});

const isPublicActive = (p: Project) => p.visibility === "public" && p.status === "active";

export function createAgencyService(
  db: Database,
  plugins: PluginsClient,
  directory: ProjectDirectory,
  listings: ListingsService,
  projectLedgers: ProjectLedgers,
) {
  return {
    listProjects: (scope: AgencyScope) =>
      Effect.gen(function* () {
        const all = yield* Effect.promise(() => directory.forAgency(scope).list());
        const projects = scope.canSeePrivate ? all : all.filter(isPublicActive);

        const linkByProjectId: Map<string, Listing> = isNearnAvailable(scope.agencyDao)
          ? yield* listings.forProjects(
              scope,
              projects.map((p) => p.id),
              "nearn",
              { skipRefresh: !scope.canSeePrivate },
            )
          : new Map();

        const data = projects
          .map((p) => {
            const link = linkByProjectId.get(p.id);
            return {
              ...withListingId(p, link?.externalId ?? null),
              nearnListing: link ? listingRowToNearnPayload(link) : null,
            };
          })
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        return { data };
      }),

    getProject: (scope: AgencyScope, slug: string) =>
      Effect.gen(function* () {
        const found = yield* Effect.either(
          Effect.tryPromise(() => directory.forAgency(scope).requireBySlug(slug)),
        );
        const match = Either.isRight(found) ? found.right : null;
        if (!match || !(scope.canSeePrivate || isPublicActive(match))) {
          return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Project not found" }));
        }

        if (!scope.canSeePrivate) {
          return {
            project: { ...withListingId(match, null), description: null },
            contributors: null,
          };
        }

        const link = yield* listings.nearnFor(scope, match.id, { skipRefresh: true });
        const [contributorRows, builders] = yield* Effect.promise(() =>
          Promise.all([
            db
              .select({
                nearAccount: projectContributors.nearAccount,
                role: projectContributors.role,
              })
              .from(projectContributors)
              .where(eq(projectContributors.projectId, match.id))
              .orderBy(desc(projectContributors.createdAt)),
            plugins.builders(scope.pluginContext).listBuilders({ limit: 100 }),
          ]),
        );
        const builderByNear = new Map(
          builders.data.map((b) => [b.nearAccount, b.name ?? b.nearAccount]),
        );

        return {
          project: withListingId(match, link?.externalId ?? null),
          contributors: contributorRows.map((r) => ({
            nearAccount: r.nearAccount,
            name: builderByNear.get(r.nearAccount) ?? r.nearAccount,
            role: r.role,
          })),
        };
      }),

    getBudget: (scope: AgencyScope, projectId: string) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => directory.forAgency(scope).require(projectId));
        const ledger = yield* Effect.promise(() => projectLedgers.load(scope, [projectId]));
        return { budgets: ledger.rollupsFor(projectId) };
      }),

    createProject: (
      scope: AgencyScope,
      input: {
        slug: string;
        title: string;
        description?: string;
        repository?: string;
        nearnListingId?: string;
        kind?: ProjectKind;
        parentSlug?: string;
        status?: string;
        visibility?: string;
      },
    ) =>
      Effect.gen(function* () {
        let content: string | undefined;
        if (input.kind === "idea") {
          content = input.description?.trim() || `# ${input.title.trim()}`;
        } else if (input.kind === "scope" || input.kind === "result") {
          const parentSlug = input.parentSlug?.trim();
          if (!parentSlug) {
            return yield* Effect.fail(
              new ORPCError("BAD_REQUEST", { message: "parentSlug is required for scope/result" }),
            );
          }
          const found = yield* Effect.either(
            Effect.tryPromise(() => directory.forAgency(scope).requireBySlug(parentSlug)),
          );
          if (Either.isLeft(found)) {
            return yield* Effect.fail(
              new ORPCError("BAD_REQUEST", { message: "Parent project not found in this agency" }),
            );
          }
          const parent = found.right;
          if (input.kind === "scope" && parent.kind !== "project") {
            return yield* Effect.fail(
              new ORPCError("BAD_REQUEST", { message: "Scope must mention a parent project" }),
            );
          }
          if (input.kind === "result" && parent.kind !== "scope") {
            return yield* Effect.fail(
              new ORPCError("BAD_REQUEST", { message: "Result must mention a parent scope" }),
            );
          }
          const mention = `@${scope.agencyDao}/${parentSlug}`;
          content = input.description?.trim()
            ? `${mention}\n\n${input.description.trim()}`
            : mention;
        }

        const projectsPlugin = plugins.projects(scope.pluginContext);
        const created = yield* Effect.promise(() =>
          projectsPlugin.createProject({
            kind: input.kind ?? "project",
            title: input.title,
            slug: input.slug,
            description: input.description,
            content,
            repository: input.repository,
            visibility: (input.visibility ?? "private") as ProjectVisibility,
            organizationId: scope.agencyDao,
          }),
        );

        const final =
          input.status && input.status !== created.status
            ? yield* Effect.promise(() =>
                projectsPlugin.updateProject({
                  id: created.id,
                  status: input.status as ProjectStatus,
                }),
              )
            : created;

        const attached = input.nearnListingId
          ? yield* listings.attachNearn(scope, created.id, input.nearnListingId)
          : null;

        return {
          project: withListingId(toProject(final, scope.agencyDao), attached?.externalId ?? null),
        };
      }),

    updateProject: (
      scope: AgencyScope,
      input: {
        id: string;
        title?: string;
        description?: string | null;
        repository?: string;
        nearnListingId?: string | null;
        status?: string;
        visibility?: string;
      },
    ) =>
      Effect.gen(function* () {
        const existing = yield* Effect.promise(() => directory.forAgency(scope).require(input.id));

        const { id, nearnListingId: _nearnListingId, ...projectPatch } = input;
        const hasProjectChanges = Object.values(projectPatch).some((v) => v !== undefined);

        const updated = hasProjectChanges
          ? toProject(
              yield* Effect.promise(() =>
                plugins.projects(scope.pluginContext).updateProject({
                  id,
                  title: projectPatch.title,
                  description: projectPatch.description === null ? "" : projectPatch.description,
                  repository: projectPatch.repository,
                  status: projectPatch.status as ProjectStatus | undefined,
                  visibility: projectPatch.visibility as ProjectVisibility | undefined,
                }),
              ),
              scope.agencyDao,
            )
          : existing;

        let finalListingId: string | null = null;
        if (input.nearnListingId === null) {
          yield* listings.detachNearn(id);
        } else if (input.nearnListingId !== undefined) {
          finalListingId = (yield* listings.attachNearn(scope, id, input.nearnListingId))
            .externalId;
        } else {
          const link = yield* listings.nearnFor(scope, id, { skipRefresh: true });
          finalListingId = link?.externalId ?? null;
        }

        yield* listings.followProjectStatus(id, input.status);

        return { project: withListingId(updated, finalListingId) };
      }),

    deleteProject: (scope: AgencyScope, input: { id: string }) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => directory.forAgency(scope).require(input.id));
        yield* Effect.promise(() => deleteProjectCascade(db, input.id));
        yield* Effect.promise(() =>
          plugins.projects(scope.pluginContext).deleteProject({ id: input.id }),
        );
        return { deleted: true as const };
      }),
  };
}

export type AgencyService = ReturnType<typeof createAgencyService>;
