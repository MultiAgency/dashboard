import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type Network, startRegistry, TOKENS } from "./registry";

const agreement = {
  version: "2026-09",
  attestedAt: "2026-10-01T12:00:00.000Z",
  proof: "ed25519:signed-attestation",
};

const admitted = (issue: number) => ({
  status: "admitted" as const,
  proofUrl: `https://github.com/MultiAgency/near-agencies/issues/${issue}`,
  admittedAt: "2026-10-02T09:00:00.000Z",
});

let counter = 0;
const nextLogin = () => `member-${++counter}`;

describe("writing board members", () => {
  let registry: Awaited<ReturnType<typeof startRegistry>>;
  let boardClient: (token?: string) => any;
  let agencyClient: () => any;
  let platformAdminClient: () => any;
  let clientFor: (userId: string, nearAccount: string) => any;
  let anonymousClient: () => any;

  const put = (network: Network, input: Record<string, unknown>) =>
    boardClient(TOKENS[network]).putMember({ network, kind: "human", ...input });

  async function admittedHuman(network: Network) {
    const githubLogin = nextLogin();
    await put(network, {
      githubLogin,
      account: {
        account: `${githubLogin}.${network === "mainnet" ? "near" : "testnet"}`,
        proof: "sig",
      },
      admission: admitted(counter),
    });
    return githubLogin;
  }

  beforeAll(async () => {
    registry = await startRegistry();
    boardClient = registry.board;
    agencyClient = () => registry.signedIn("agency-admin", "agency-admin.near", { trusted: true });
    clientFor = (userId, nearAccount) => registry.signedIn(userId, nearAccount);
    platformAdminClient = () => registry.signedIn("platform", null, { platformAdmin: true });
    anonymousClient = registry.anonymous;
  });

  afterAll(async () => {
    await registry.shutdown();
  });

  describe("the registry token", () => {
    test.each([
      ["no token", undefined, "UNAUTHORIZED"],
      ["a wrong token", "guess", "UNAUTHORIZED"],
      ["the testnet token", TOKENS.testnet, "FORBIDDEN"],
    ])("rejects a mainnet write with %s", async (_name, token, code) => {
      await expect(
        boardClient(token).putMember({
          githubLogin: nextLogin(),
          network: "mainnet",
          kind: "human",
        }),
      ).rejects.toMatchObject({ code });
    });

    test("rejects a testnet write with the mainnet token", async () => {
      await expect(
        boardClient(TOKENS.mainnet).putMember({
          githubLogin: nextLogin(),
          network: "testnet",
          kind: "human",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    test("refuses writes to a network with no token configured", async () => {
      const unconfigured = await startRegistry({ withTokens: false });

      await expect(
        unconfigured
          .board("anything")
          .putMember({ githubLogin: nextLogin(), network: "testnet", kind: "human" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await unconfigured.shutdown();
    });
  });

  describe("a testnet admission", () => {
    test("stores a member with no mainnet account, kept out of the builder list", async () => {
      const githubLogin = nextLogin();

      const { data } = await put("testnet", {
        githubLogin,
        name: "Grace",
        skills: ["rust"],
        account: { account: `${githubLogin}.testnet`, proof: "sig" },
        admission: admitted(1),
      });

      expect(data).toEqual({
        githubLogin,
        kind: "human",
        operatorGithubLogin: null,
        name: "Grace",
        skills: ["rust"],
        nearAccount: null,
        accounts: [{ network: "testnet", account: `${githubLogin}.testnet` }],
        admissions: [
          {
            network: "testnet",
            status: "admitted",
            proofUrl: "https://github.com/MultiAgency/near-agencies/issues/1",
            admittedAt: "2026-10-02T09:00:00.000Z",
          },
        ],
      });
      const list = await anonymousClient().listBuilders({ search: "Grace" });
      expect(list.data).toEqual([]);
    });

    test("admits an outside contributor with no services agreement", async () => {
      const { data } = await put("testnet", { githubLogin: nextLogin(), admission: admitted(2) });

      expect(data.admissions).toEqual([expect.objectContaining({ status: "admitted" })]);
    });

    test("needs the proof and date to admit", async () => {
      const { proofUrl: _omitted, ...withoutProof } = admitted(3);

      await expect(
        put("testnet", { githubLogin: nextLogin(), admission: withoutProof }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    test("normalises the GitHub login", async () => {
      const githubLogin = nextLogin();

      const { data } = await put("testnet", { githubLogin: githubLogin.toUpperCase() });

      expect(data.githubLogin).toBe(githubLogin);
    });

    test("gives the same result when retried", async () => {
      const githubLogin = nextLogin();
      const write = {
        githubLogin,
        account: { account: `${githubLogin}.testnet`, proof: "sig" },
        admission: admitted(4),
      };

      const first = await put("testnet", write);
      const second = await put("testnet", write);

      expect(second).toEqual({ data: first.data, overwritten: [] });
    });
  });

  describe("an agent", () => {
    test("needs an operator", async () => {
      await expect(
        put("testnet", { githubLogin: nextLogin(), kind: "agent" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    test("needs an operator admitted on the same network", async () => {
      const operator = await admittedHuman("mainnet");

      await expect(
        put("testnet", { githubLogin: nextLogin(), kind: "agent", operatorGithubLogin: operator }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    test("is stored with its operator", async () => {
      const operator = await admittedHuman("testnet");

      const { data } = await put("testnet", {
        githubLogin: "ada-bot[bot]",
        kind: "agent",
        operatorGithubLogin: operator,
      });

      expect(data).toMatchObject({ kind: "agent", operatorGithubLogin: operator });
    });

    test("cannot operate another agent", async () => {
      const operator = await admittedHuman("testnet");
      const agent = nextLogin();
      await put("testnet", {
        githubLogin: agent,
        kind: "agent",
        operatorGithubLogin: operator,
        admission: admitted(5),
      });

      await expect(
        put("testnet", { githubLogin: nextLogin(), kind: "agent", operatorGithubLogin: agent }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
    test("cannot be a member who operates agents", async () => {
      const operator = await admittedHuman("testnet");
      await put("testnet", {
        githubLogin: nextLogin(),
        kind: "agent",
        operatorGithubLogin: operator,
      });
      const otherOperator = await admittedHuman("testnet");

      await expect(
        put("testnet", {
          githubLogin: operator,
          kind: "agent",
          operatorGithubLogin: otherOperator,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("identity across networks", () => {
    async function agentAdmittedOnMainnet() {
      const firstOperator = await admittedHuman("testnet");
      const mainnetOperator = await admittedHuman("mainnet");
      const agent = nextLogin();
      await put("testnet", {
        githubLogin: agent,
        kind: "agent",
        operatorGithubLogin: firstOperator,
      });
      const result = await put("mainnet", {
        githubLogin: agent,
        kind: "agent",
        operatorGithubLogin: mainnetOperator,
        admission: admitted(6),
      });
      return { agent, firstOperator, mainnetOperator, result };
    }

    test("a mainnet admission sets the operator and reports what it overwrote", async () => {
      const { mainnetOperator, result } = await agentAdmittedOnMainnet();

      expect(result.data.operatorGithubLogin).toBe(mainnetOperator);
      expect(result.overwritten).toEqual(["operatorGithubLogin"]);
    });

    test("testnet cannot change the operator once mainnet has admitted the member", async () => {
      const { agent, firstOperator } = await agentAdmittedOnMainnet();

      await expect(
        put("testnet", { githubLogin: agent, kind: "agent", operatorGithubLogin: firstOperator }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    test("testnet cannot change the kind once mainnet has admitted the member", async () => {
      const githubLogin = await admittedHuman("mainnet");
      const operator = await admittedHuman("testnet");

      await expect(
        put("testnet", { githubLogin, kind: "agent", operatorGithubLogin: operator }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    test("a suspended mainnet admission still keeps identity on mainnet", async () => {
      const { agent, firstOperator, mainnetOperator } = await agentAdmittedOnMainnet();
      await put("mainnet", {
        githubLogin: agent,
        kind: "agent",
        operatorGithubLogin: mainnetOperator,
        admission: { status: "suspended" },
      });

      await expect(
        put("testnet", { githubLogin: agent, kind: "agent", operatorGithubLogin: firstOperator }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    test("a mainnet write rechecks that the operator is admitted on mainnet", async () => {
      const operator = await admittedHuman("testnet");
      const agent = nextLogin();
      await put("testnet", { githubLogin: agent, kind: "agent", operatorGithubLogin: operator });

      await expect(
        put("mainnet", {
          githubLogin: agent,
          kind: "agent",
          operatorGithubLogin: operator,
          admission: admitted(10),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    test("reports a changed name, skills or account", async () => {
      const githubLogin = nextLogin();
      await put("testnet", {
        githubLogin,
        name: "Grace",
        skills: ["rust"],
        account: { account: `${githubLogin}.testnet`, proof: "sig" },
      });

      const { overwritten } = await put("testnet", {
        githubLogin,
        name: "Grace H",
        skills: ["rust", "review"],
        account: { account: `${githubLogin}-2.testnet`, proof: "sig" },
      });

      expect(overwritten).toEqual(["name", "skills", "account"]);
    });

    test("testnet can still update skills once mainnet has admitted the member", async () => {
      const { agent, mainnetOperator } = await agentAdmittedOnMainnet();

      const { data } = await put("testnet", {
        githubLogin: agent,
        kind: "agent",
        operatorGithubLogin: mainnetOperator,
        skills: ["triage"],
      });

      expect(data.skills).toEqual(["triage"]);
    });

    test("a member admitted on both networks keeps each admission", async () => {
      const githubLogin = await admittedHuman("testnet");

      const { data } = await put("mainnet", {
        githubLogin,
        account: { account: `${githubLogin}.near`, proof: "sig" },
        admission: { ...admitted(7), status: "suspended" },
      });

      expect(data.admissions.map((a: any) => [a.network, a.status])).toEqual([
        ["mainnet", "suspended"],
        ["testnet", "admitted"],
      ]);
      expect(data.accounts.map((a: any) => a.network)).toEqual(["mainnet", "testnet"]);
    });
  });

  describe("the services agreement", () => {
    const record = (client: any, githubLogin: string) =>
      client.recordAgreement({ githubLogin, ...agreement });

    test("is recorded by a platform admin", async () => {
      const githubLogin = await admittedHuman("testnet");

      const { data } = await record(platformAdminClient(), githubLogin);

      expect(data).toEqual({
        githubLogin,
        version: agreement.version,
        attestedAt: agreement.attestedAt,
        recordedBy: "platform",
        recordedAt: expect.any(String),
      });
    });

    test("is never returned with the member", async () => {
      const githubLogin = await admittedHuman("testnet");
      await record(platformAdminClient(), githubLogin);

      const { data } = await put("testnet", { githubLogin, skills: ["rust"] });

      expect(JSON.stringify(data)).not.toMatch(/agreement|attest|ed25519|version/);
    });

    test.each([
      ["anyone signed out", () => anonymousClient(), "UNAUTHORIZED"],
      ["a board token", () => boardClient(TOKENS.mainnet), "UNAUTHORIZED"],
      ["an Agency manager", () => agencyClient(), "FORBIDDEN"],
    ])("cannot be recorded by %s", async (_name, client, code) => {
      const githubLogin = await admittedHuman("testnet");

      await expect(record(client(), githubLogin)).rejects.toMatchObject({ code });
    });

    test("needs an existing member", async () => {
      await expect(record(platformAdminClient(), nextLogin())).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    test("is listed for a platform admin with every member, without its proof", async () => {
      const signed = await admittedHuman("testnet");
      const unsigned = await admittedHuman("testnet");
      await record(platformAdminClient(), signed);

      const { data } = await platformAdminClient().listMembersWithAgreements({});
      const byLogin = new Map<string, any>(data.map((m: any) => [m.githubLogin, m]));

      expect(byLogin.get(signed).agreement).toEqual({
        version: agreement.version,
        attestedAt: agreement.attestedAt,
        recordedBy: "platform",
        recordedAt: expect.any(String),
      });
      expect(byLogin.get(unsigned).agreement).toBeNull();
      expect(byLogin.get(unsigned).nearAccount).toBeNull();
      expect(JSON.stringify(data)).not.toContain(agreement.proof);
    });

    test.each([
      ["anyone signed out", () => anonymousClient(), "UNAUTHORIZED"],
      ["an Agency manager", () => agencyClient(), "FORBIDDEN"],
    ])("is not listed for %s", async (_name, client, code) => {
      await expect(client().listMembersWithAgreements({})).rejects.toMatchObject({ code });
    });
  });

  describe("the mainnet account", () => {
    test("lists a testnet-only member as a builder once mainnet admits it", async () => {
      const githubLogin = await admittedHuman("testnet");

      await put("mainnet", {
        githubLogin,
        account: { account: `${githubLogin}.near`, proof: "sig" },
        admission: admitted(8),
      });

      const { data } = await anonymousClient().getBuilder({ nearAccount: `${githubLogin}.near` });
      expect(data.nearAccount).toBe(`${githubLogin}.near`);
    });

    test("admits an existing dashboard profile instead of duplicating it", async () => {
      const nearAccount = `${nextLogin()}.near`;
      await agencyClient().createBuilder({ nearAccount, name: "Ada", bio: "Kept" });
      const githubLogin = nextLogin();

      const { data } = await put("mainnet", {
        githubLogin,
        account: { account: nearAccount, proof: "sig" },
        admission: admitted(9),
      });

      expect(data).toMatchObject({ githubLogin, name: "Ada", nearAccount });
      const profile = await anonymousClient().getBuilder({ nearAccount });
      expect(profile.data.bio).toBe("Kept");
    });

    test("joins a testnet member to their own dashboard profile", async () => {
      const githubLogin = nextLogin();
      const nearAccount = `${githubLogin}.near`;
      await clientFor(githubLogin, nearAccount).createBuilder({
        nearAccount,
        name: "Grace",
        bio: "Kept",
      });
      await put("testnet", { githubLogin, admission: admitted(11) });

      const { data } = await put("mainnet", {
        githubLogin,
        account: { account: nearAccount, proof: "sig" },
        admission: admitted(12),
      });

      expect(data).toMatchObject({ githubLogin, name: "Grace", nearAccount });
      expect(data.admissions.map((a: any) => a.network)).toEqual(["mainnet", "testnet"]);
      const profile = await anonymousClient().getBuilder({ nearAccount });
      expect(profile.data).toMatchObject({ bio: "Kept", userId: githubLogin });
    });

    test("keeps the dashboard profile's skills when joining it", async () => {
      const githubLogin = nextLogin();
      const nearAccount = `${githubLogin}.near`;
      await agencyClient().createBuilder({ nearAccount, skills: ["rust"] });
      await put("testnet", { githubLogin });

      const { data } = await put("mainnet", {
        githubLogin,
        account: { account: nearAccount, proof: "sig" },
      });

      expect(data.skills).toEqual(["rust"]);
    });

    test("cannot be taken from another member", async () => {
      const holder = await admittedHuman("mainnet");

      await expect(
        put("mainnet", {
          githubLogin: nextLogin(),
          account: { account: `${holder}.near`, proof: "sig" },
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  test("a testnet account cannot be taken from another member", async () => {
    const holder = await admittedHuman("testnet");

    await expect(
      put("testnet", {
        githubLogin: nextLogin(),
        account: { account: `${holder}.testnet`, proof: "sig" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("an Agency cannot edit a member's builder profile", async () => {
    const githubLogin = await admittedHuman("mainnet");

    await expect(
      agencyClient().updateBuilderProfile({ nearAccount: `${githubLogin}.near`, name: "Renamed" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("a member can still edit their own builder profile", async () => {
    const githubLogin = await admittedHuman("mainnet");
    const nearAccount = `${githubLogin}.near`;

    const { data } = await clientFor(githubLogin, nearAccount).updateBuilderProfile({
      nearAccount,
      bio: "Mine",
    });

    expect(data.bio).toBe("Mine");
  });

  test("a member's builder profile cannot be removed from the dashboard", async () => {
    const githubLogin = await admittedHuman("mainnet");

    await expect(
      platformAdminClient().deleteBuilder({ nearAccount: `${githubLogin}.near` }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
