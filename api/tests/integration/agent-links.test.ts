import { beforeEach, describe, expect, test } from "vitest";
import { createAgentLinksService } from "../../src/services/agent-links";
import type { OrganizationScope } from "../../src/services/organization-access";
import { clientWorkWorld, refused } from "../fakes/engagements";

describe("agent links", () => {
  const state = clientWorkWorld();
  let links: ReturnType<typeof createAgentLinksService>;
  let acmeEngagement: string;

  beforeEach(async () => {
    links = createAgentLinksService({ db: state.db });
    acmeEngagement = (await state.world.activeEngagement("acme")).id;
  });

  const studio = () => state.world.manager("studio-admin", "studio");
  const acmeOwner = () => state.world.manager("acme-owner", "acme");
  const acmeMember = () => state.world.member("acme-member", "acme");
  const labels = async (scope: OrganizationScope) =>
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

  test.each([
    "javascript:alert(1)",
    "ftp://files.example",
    "agents.example",
    "https://",
  ])("%s is refused as a link URL", async (url) => {
    await refused(add("Bad", url), "INVALID_URL");
    const ok = await add("Ok");
    await refused(links.update(await studio(), { id: ok.id, url }), "INVALID_URL");
  });

  test("only the Agency manages them, and other Organizations never see them", async () => {
    const link = await add("Research");
    const owner = await acmeOwner();

    await refused(
      links.create(owner, {
        engagementId: acmeEngagement,
        label: "Mine",
        url: "https://x.example",
      }),
      "NOT_FOUND",
    );
    await refused(links.remove(owner, { id: link.id }), "NOT_FOUND");
    await refused(links.update(owner, { id: link.id, label: "Hijacked" }), "NOT_FOUND");
    await refused(
      links.list(await state.world.member("globex-owner", "globex"), {
        engagementId: acmeEngagement,
      }),
      "NOT_FOUND",
    );
    expect(await labels(await acmeMember())).toEqual(["Research"]);
  });

  test("an ended Engagement keeps its links read-only", async () => {
    const link = await add("Research");
    await state.world.engagements.end(await studio(), acmeEngagement);

    await refused(add("Late"), "NOT_ACTIVE");
    await refused(links.remove(await studio(), { id: link.id }), "NOT_ACTIVE");
    await refused(
      links.reorder(await studio(), { engagementId: acmeEngagement, ids: [link.id] }),
      "NOT_ACTIVE",
    );
    expect(await labels(await acmeMember())).toEqual(["Research"]);
  });

  test("reordering must name exactly the Engagement's links", async () => {
    const research = await add("Research");
    await add("Support");

    await refused(
      links.reorder(await studio(), { engagementId: acmeEngagement, ids: [research.id] }),
      "ORDER_MISMATCH",
    );
  });
});
