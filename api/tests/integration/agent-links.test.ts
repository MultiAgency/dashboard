import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { createAgentLinksService } from "../../src/services/agent-links";
import { engagementWorld } from "../fakes/engagements";
import { applyAllMigrations } from "./_pg";

const organizations = [
  { id: "studio", name: "Studio", slug: "studio" },
  { id: "acme", name: "Acme Corp", slug: "acme" },
  { id: "globex", name: "Globex", slug: "globex" },
];

const members = [
  { userId: "studio-admin", organizationId: "studio", role: "admin" as const },
  { userId: "studio-member", organizationId: "studio", role: "member" as const },
  { userId: "acme-owner", organizationId: "acme", role: "owner" as const },
  { userId: "acme-member", organizationId: "acme", role: "member" as const },
  { userId: "globex-owner", organizationId: "globex", role: "owner" as const },
];

const users = members.map((m) => ({ id: m.userId, email: `${m.userId}@example.com` }));

describe("agent links", () => {
  let pg: PGlite;
  let db: Database;
  let world: Awaited<ReturnType<typeof engagementWorld>>;
  let links: ReturnType<typeof createAgentLinksService>;
  let acmeEngagement: string;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
    world = await engagementWorld(db, { organizations, members, users, projects: [] });
    links = createAgentLinksService({ db });
    const proposed = await world.engagements.propose(await studio(), {
      slug: "acme",
      name: "Acme Corp",
    });
    await world.engagements.accept(await acmeOwner(), proposed.id);
    acmeEngagement = proposed.id;
  });

  afterEach(async () => {
    await pg.close();
  });

  const studio = () => world.manager("studio-admin", "studio");
  const acmeOwner = () => world.manager("acme-owner", "acme");
  const acmeMember = () => world.member("acme-member", "acme");
  const labels = async (scope: Awaited<ReturnType<typeof studio>>) =>
    (await links.list(scope, { engagementId: acmeEngagement })).data.map((l) => l.label);

  async function add(label: string, url = `https://agents.example/${label.toLowerCase()}`) {
    return links.create(await studio(), { engagementId: acmeEngagement, label, url });
  }

  test("the Agency adds, edits, reorders and removes links; Client members list them in order", async () => {
    const research = await add("Research");
    const support = await add("Support");
    const writer = await add("Writer");

    await links.update(await studio(), {
      id: support.id,
      label: "Support desk",
      url: "http://support.example",
    });
    await links.reorder(await studio(), {
      engagementId: acmeEngagement,
      ids: [writer.id, research.id, support.id],
    });
    await links.remove(await studio(), { id: research.id });

    const seen = (await links.list(await acmeMember(), { engagementId: acmeEngagement })).data;
    expect(seen.map((l) => [l.label, l.url])).toEqual([
      ["Writer", "https://agents.example/writer"],
      ["Support desk", "http://support.example"],
    ]);
    expect(await labels(await studio())).toEqual(["Writer", "Support desk"]);
  });

  test("only http and https URLs are accepted", async () => {
    await expect(add("Evil", "javascript:alert(1)")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "INVALID_URL" },
    });
    const ok = await add("Ok");
    await expect(
      links.update(await studio(), { id: ok.id, url: "ftp://files.example" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", data: { reason: "INVALID_URL" } });
  });

  test("only the Agency manages them", async () => {
    const link = await add("Research");

    await expect(
      links.create(await acmeOwner(), {
        engagementId: acmeEngagement,
        label: "Mine",
        url: "https://mine.example",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(links.remove(await acmeOwner(), { id: link.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      links.update(await acmeOwner(), { id: link.id, label: "Hijacked" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await labels(await acmeMember())).toEqual(["Research"]);
  });

  test("other Organizations never see them", async () => {
    await add("Research");

    await expect(
      links.list(await world.member("globex-owner", "globex"), { engagementId: acmeEngagement }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("an ended Engagement keeps its links read-only", async () => {
    const link = await add("Research");
    await world.engagements.end(await studio(), acmeEngagement);

    await expect(add("Late")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "NOT_ACTIVE" },
    });
    await expect(links.remove(await studio(), { id: link.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "NOT_ACTIVE" },
    });
    await expect(
      links.reorder(await studio(), { engagementId: acmeEngagement, ids: [link.id] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", data: { reason: "NOT_ACTIVE" } });
    expect(await labels(await acmeMember())).toEqual(["Research"]);
  });

  test("reordering must name exactly the Engagement's links", async () => {
    const research = await add("Research");
    await add("Support");

    await expect(
      links.reorder(await studio(), { engagementId: acmeEngagement, ids: [research.id] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", data: { reason: "ORDER_MISMATCH" } });
  });
});
