import { describe, expect, it } from "vitest";
import type { AgencyScope } from "../../src/lib/agency-scope";
import { createProjectDirectory } from "../../src/services/project-directory";
import { agencyScope, inMemoryProjects, project } from "../fakes/projects";

const AGENCY = "alpha.sputnik-dao.near";
const OTHER_AGENCY = "beta.sputnik-dao.near";

function scope(overrides: Partial<AgencyScope> = {}): AgencyScope {
  return agencyScope(AGENCY, overrides);
}

describe("project directory", () => {
  it("lists every project of the agency across pages as domain projects", async () => {
    const many = Array.from({ length: 150 }, (_, i) => project(`p${i}`, AGENCY));
    const { client } = inMemoryProjects([...many, project("x", OTHER_AGENCY)]);

    const projects = await createProjectDirectory(() => client)
      .forAgency(scope())
      .list();

    expect(projects).toHaveLength(150);
    expect(projects[0]).toMatchObject({
      id: "p0",
      organizationId: AGENCY,
      slug: "slug-p0",
      kind: "project",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  it("fetches the agency's projects once per scope", async () => {
    const { client, calls } = inMemoryProjects([project("a", AGENCY)]);
    const directory = createProjectDirectory(() => client);
    const s = scope();

    await directory.forAgency(s).list();
    await directory.forAgency(s).list();
    await directory.forAgency(s).require("a");

    expect(calls.list).toBe(1);
    expect(calls.get).toBe(0);
  });

  it("require returns a project that belongs to the agency", async () => {
    const { client } = inMemoryProjects([project("a", AGENCY)]);

    const found = await createProjectDirectory(() => client)
      .forAgency(scope())
      .require("a");

    expect(found.id).toBe("a");
  });

  it("require hides projects of other agencies and unknown ids as NOT_FOUND", async () => {
    const { client } = inMemoryProjects([project("b", OTHER_AGENCY)]);
    const agencyProjects = createProjectDirectory(() => client).forAgency(scope());

    await expect(agencyProjects.require("b")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(agencyProjects.require("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requireBySlug finds the agency's project without listing the agency", async () => {
    const { client, calls } = inMemoryProjects([project("a", AGENCY), project("b", OTHER_AGENCY)]);
    const agencyProjects = createProjectDirectory(() => client).forAgency(scope());

    expect((await agencyProjects.requireBySlug("slug-a")).id).toBe("a");
    await expect(agencyProjects.requireBySlug("slug-b")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(agencyProjects.requireBySlug("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(calls.list).toBe(0);
  });

  it("calls the projects plugin as the scope's caller", async () => {
    const seen: unknown[] = [];
    const { client } = inMemoryProjects([project("a", AGENCY)]);
    const pluginContext = { userId: "u1" };

    await createProjectDirectory((ctx) => {
      seen.push(ctx);
      return client;
    })
      .forAgency(scope({ pluginContext }))
      .list();

    expect(seen).toEqual([pluginContext]);
  });
});
