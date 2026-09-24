import { ORPCError } from "every-plugin/orpc";
import type { PluginContext } from "../lib/organizations";
import type { PluginsClient } from "../lib/plugins-types.gen";
import type { AgencyScope } from "./organization-access";

type PluginProjectsClient = ReturnType<PluginsClient["projects"]>;

export type ProjectsClient = Pick<
  PluginProjectsClient,
  "listProjects" | "getProject" | "getProjectBySlug"
>;

export type PluginProject = Awaited<ReturnType<ProjectsClient["listProjects"]>>["data"][number];

export type Project = {
  id: string;
  ownerId: string;
  organizationId: string;
  slug: string;
  title: string;
  description: string | null;
  repository: string | null;
  kind: PluginProject["kind"];
  status: PluginProject["status"];
  visibility: PluginProject["visibility"];
  createdAt: Date;
  updatedAt: Date;
};

export type AgencyProjects = {
  list(): Promise<Project[]>;
  require(projectId: string): Promise<Project>;
  requireBySlug(slug: string): Promise<Project>;
};

export function toProject(p: PluginProject): Project {
  return {
    id: p.id,
    ownerId: p.ownerId,
    organizationId: p.organizationId ?? "",
    slug: p.slug,
    title: p.title,
    description: p.description,
    repository: p.repository ?? null,
    kind: p.kind ?? "project",
    status: p.status,
    visibility: p.visibility,
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.updatedAt),
  };
}

function ownerKeys(scope: AgencyScope): string[] {
  const legacyDaoKey = scope.agencyDao;
  return [scope.organizationId, legacyDaoKey].filter(
    (key, index, keys): key is string => key !== null && keys.indexOf(key) === index,
  );
}

const notFound = () => new ORPCError("NOT_FOUND", { message: "Project not found" });

export function createProjectDirectory(
  projectsFor: (pluginContext: PluginContext) => ProjectsClient,
) {
  const byScope = new WeakMap<AgencyScope, AgencyProjects>();

  function build(scope: AgencyScope): AgencyProjects {
    const client = () => projectsFor(scope.pluginContext);
    const keys = ownerKeys(scope);
    let listing: Promise<Project[]> | undefined;

    async function fetchOwnedBy(organizationId: string): Promise<Project[]> {
      const out: Project[] = [];
      let cursor: string | undefined;
      do {
        const page = await client().listProjects({ organizationId, limit: 100, cursor });
        out.push(...page.data.map(toProject));
        cursor = page.meta.nextCursor ?? undefined;
      } while (cursor);
      return out;
    }

    async function fetchAll(): Promise<Project[]> {
      const pages = await Promise.all(keys.map(fetchOwnedBy));
      const byId = new Map(pages.flat().map((p) => [p.id, p]));
      return [...byId.values()];
    }

    async function fromCacheOr(
      matches: (project: Project) => boolean,
      fetchOne: () => Promise<{ data: PluginProject }>,
    ): Promise<Project> {
      if (listing) {
        const found = (await listing).find(matches);
        if (!found) throw notFound();
        return found;
      }
      let upstream: PluginProject;
      try {
        upstream = (await fetchOne()).data;
      } catch {
        throw notFound();
      }
      if (!upstream.organizationId || !keys.includes(upstream.organizationId)) throw notFound();
      return toProject(upstream);
    }

    return {
      list: () => {
        listing ??= fetchAll().catch((err) => {
          listing = undefined;
          throw err;
        });
        return listing;
      },

      require: (projectId) =>
        fromCacheOr(
          (p) => p.id === projectId,
          () => client().getProject({ id: projectId }),
        ),

      requireBySlug: (slug) =>
        fromCacheOr(
          (p) => p.slug === slug,
          () => client().getProjectBySlug({ slug }),
        ),
    };
  }

  return {
    forAgency: (scope: AgencyScope): AgencyProjects => {
      let projects = byScope.get(scope);
      if (!projects) {
        projects = build(scope);
        byScope.set(scope, projects);
      }
      return projects;
    },
  };
}

export type ProjectDirectory = ReturnType<typeof createProjectDirectory>;
