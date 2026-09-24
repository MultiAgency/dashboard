import { ORPCError } from "every-plugin/orpc";
import type { PluginContext } from "../../src/lib/organizations";
import type { PluginsClient } from "../../src/lib/plugins-types.gen";
import type { AgencyScope, TreasuryScope } from "../../src/services/organization-access";
import {
  createProjectDirectory,
  type PluginProject,
  type ProjectsClient,
} from "../../src/services/project-directory";

export function project(id: string, organizationId: string): PluginProject {
  return {
    id,
    ownerId: "owner.near",
    organizationId,
    kind: "project",
    slug: `slug-${id}`,
    title: `Project ${id}`,
    description: null,
    content: null,
    status: "active",
    visibility: "private",
    repository: null,
    domain: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  };
}

export function inMemoryProjects(projects: PluginProject[]) {
  const calls = { list: 0, get: 0 };
  const detail = (found: PluginProject | undefined) => {
    if (!found) throw new Error("not found upstream");
    return { data: { ...found, apps: [] } } as Awaited<ReturnType<ProjectsClient["getProject"]>>;
  };
  const client: ProjectsClient = {
    listProjects: async (input) => {
      calls.list += 1;
      const matching = projects.filter((p) => p.organizationId === input.organizationId);
      const start = input.cursor ? Number(input.cursor) : 0;
      const limit = input.limit ?? 100;
      const data = matching.slice(start, start + limit);
      const next = start + limit < matching.length ? String(start + limit) : null;
      return { data, meta: { total: matching.length, hasMore: next !== null, nextCursor: next } };
    },
    getProject: async ({ id }) => {
      calls.get += 1;
      return detail(projects.find((p) => p.id === id));
    },
    getProjectBySlug: async ({ slug }) => {
      calls.get += 1;
      return detail(projects.find((p) => p.slug === slug));
    },
  };
  return { client, calls };
}

export function agencyScope(
  agencyDao: string,
  overrides: Partial<Omit<AgencyScope, "agencyDao">> = {},
): TreasuryScope {
  return {
    organizationId: null,
    agencyDao,
    network: agencyDao.endsWith(".testnet") ? "testnet" : "mainnet",
    role: "admin",
    actorId: "admin.near",
    canSeePrivate: true,
    pluginContext: {},
    ...overrides,
  };
}

type CreateInput = Parameters<ReturnType<PluginsClient["projects"]>["createProject"]>[0];
type UpdateInput = Parameters<ReturnType<PluginsClient["projects"]>["updateProject"]>[0];

export function inMemoryProjectsPlugin(seed: PluginProject[]) {
  const projects = [...seed];
  const { client } = inMemoryProjects(projects);
  const forContext = (context: PluginContext) => ({
    ...client,
    createProject: async (input: CreateInput): Promise<PluginProject> => {
      if (projects.some((p) => p.slug === input.slug)) {
        throw new ORPCError("BAD_REQUEST", {
          message: "A project with this slug already exists",
          data: { validationErrors: [{ field: "slug", code: "SLUG_TAKEN" }] },
        });
      }
      const created: PluginProject = {
        ...project(input.id ?? `created-${projects.length + 1}`, ""),
        organizationId: context.organization?.activeOrganizationId ?? null,
        ownerId: context.near?.primaryAccountId ?? context.userId ?? "anonymous",
        kind: input.kind,
        slug: input.slug,
        title: input.title,
        description: input.description ?? null,
        content: input.content ?? null,
        visibility: input.visibility ?? "private",
        repository: input.repository ?? null,
      };
      projects.push(created);
      return created;
    },
    updateProject: async ({ id, ...patch }: UpdateInput): Promise<PluginProject> => {
      const found = projects.find((p) => p.id === id);
      if (!found) throw new Error("not found upstream");
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) Object.assign(found, { [key]: value });
      }
      return found;
    },
  });
  const plugins = {
    projects: forContext,
    builders: () => ({ listBuilders: async () => ({ data: [] }) }),
  } as unknown as PluginsClient;
  return { plugins, directory: createProjectDirectory(forContext), projects };
}
