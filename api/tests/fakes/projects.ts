import type { AgencyScope } from "../../src/lib/agency-scope";
import type { PluginProject, ProjectsClient } from "../../src/services/project-directory";

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

export function agencyScope(agencyDao: string, overrides: Partial<AgencyScope> = {}): AgencyScope {
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
