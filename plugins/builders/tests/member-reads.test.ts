import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startRegistry, TOKENS } from "./registry";

const admitted = {
  status: "admitted" as const,
  proofUrl: "https://github.com/MultiAgency/near-agencies/issues/1",
  admittedAt: "2026-10-02T09:00:00.000Z",
};

describe("reading board members", () => {
  let registry: Awaited<ReturnType<typeof startRegistry>>;
  let anonymous: any;

  beforeAll(async () => {
    registry = await startRegistry();
    const board = (network: keyof typeof TOKENS) => registry.board(TOKENS[network]);
    anonymous = registry.anonymous();

    await registry
      .signedIn("carol", "carol.near")
      .createBuilder({ nearAccount: "carol.near", name: "Carol" });
    await board("testnet").putMember({
      githubLogin: "grace",
      network: "testnet",
      kind: "human",
      account: { account: "grace.testnet", proof: "sig" },
      admission: admitted,
    });
    await registry.signedIn("platform", null, { platformAdmin: true }).recordAgreement({
      githubLogin: "grace",
      version: "2026-09",
      attestedAt: "2026-10-01T12:00:00.000Z",
      proof: "ed25519:signed-attestation",
    });
    await board("testnet").putMember({
      githubLogin: "grace-bot",
      network: "testnet",
      kind: "agent",
      operatorGithubLogin: "grace",
      admission: { ...admitted, status: "suspended" },
    });
    await board("mainnet").putMember({
      githubLogin: "ada",
      network: "mainnet",
      kind: "human",
      account: { account: "ada.near", proof: "sig" },
      admission: admitted,
    });
  });

  afterAll(async () => {
    await registry.shutdown();
  });

  test("lists every member by GitHub login, without plain builder profiles", async () => {
    const { data } = await anonymous.listMembers({});

    expect(data.map((m: any) => m.githubLogin)).toEqual(["ada", "grace", "grace-bot"]);
  });

  test("lists the members admitted on one network", async () => {
    const { data } = await anonymous.listMembers({ network: "testnet", status: "admitted" });

    expect(data.map((m: any) => m.githubLogin)).toEqual(["grace"]);
  });

  test("shows an agent's operator", async () => {
    const { data } = await anonymous.listMembers({ status: "suspended" });

    expect(data).toEqual([
      expect.objectContaining({
        githubLogin: "grace-bot",
        kind: "agent",
        operatorGithubLogin: "grace",
      }),
    ]);
  });

  test("never lists the services-agreement attestation", async () => {
    const { data } = await anonymous.listMembers({});

    expect(JSON.stringify(data)).not.toMatch(/agreement|attest|ed25519|version/);
  });

  test("returns one member by GitHub login in any case", async () => {
    const { data } = await anonymous.getMember({ githubLogin: "Ada" });

    expect(data).toEqual({
      githubLogin: "ada",
      kind: "human",
      operatorGithubLogin: null,
      name: null,
      skills: [],
      nearAccount: "ada.near",
      accounts: [{ network: "mainnet", account: "ada.near" }],
      admissions: [
        {
          network: "mainnet",
          status: "admitted",
          proofUrl: "https://github.com/MultiAgency/near-agencies/issues/1",
          admittedAt: "2026-10-02T09:00:00.000Z",
        },
      ],
    });
  });

  test.each([
    ["an unknown login", "nobody"],
    ["a builder who is not a member", "carol"],
  ])("does not find %s", async (_name, githubLogin) => {
    await expect(anonymous.getMember({ githubLogin })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
