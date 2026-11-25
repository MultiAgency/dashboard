import { consentMessage, parseConsentMessage, parseSetupMessage } from "@multiagency/sdk";
import { generateKey } from "near-kit";
import { beforeEach, describe, expect, test } from "vitest";
import { createPlatformAgents, type PlatformAgents } from "../../src/services/platform/agents";
import { createPlatformReads } from "../../src/services/platform/reads";
import type { ConsentDays } from "../../src/services/platform/terms";
import { FakePlatformApp } from "../fakes/platform-app";
import { migratedDatabase } from "./_pg";

const ORG = "orgStudio";
const OTHER = "orgAtelier";
const OWNER = "rita.near";
const HOST = "platform.test";
const DEPLOYMENT = "multiagency-dashboard";
const ACTOR = "user-admin";
const SETTINGS = {
  base: `https://${HOST}`,
  host: HOST,
  deployment: DEPLOYMENT,
  credential: "tap_x.y",
} as const;

describe("connecting a platform agent", () => {
  const database = migratedDatabase({ perTest: true });
  let platform: FakePlatformApp;
  let clock: Date;
  let agents: PlatformAgents;
  const key = generateKey().publicKey.toString();

  beforeEach(() => {
    clock = new Date("2026-11-25T12:00:00.000Z");
    platform = new FakePlatformApp({
      host: HOST,
      deployment: DEPLOYMENT,
      now: () => clock.getTime(),
    });
    agents = createPlatformAgents({
      db: database.db,
      app: platform.client(),
      settings: SETTINGS,
      now: () => clock,
    });
  });

  function signed(view: Awaited<ReturnType<PlatformAgents["view"]>>, signature = "c2lnbmF0dXJl") {
    if (!view.signing) throw new Error("nothing to sign");
    return { message: view.signing.message, nonce: view.signing.nonce, publicKey: key, signature };
  }

  async function connect(days: ConsentDays = 90) {
    const setup = await agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER });
    const created = await agents.submitSigned(ORG, ACTOR, signed(setup, "c2V0dXA="));
    await agents.prepareCreate(ORG, ACTOR);
    platform.confirmCreate(created.agent ?? "");
    const consent = await agents.startConsent(ORG, ACTOR, { days });
    return agents.submitSigned(ORG, ACTOR, signed(consent, "Y29uc2VudA=="));
  }

  test("off: with no settings nothing calls the platform and every change is refused", async () => {
    const off = createPlatformAgents({ db: database.db, app: null, settings: null });
    const view = await off.view(ORG);
    expect(view).toMatchObject({ available: false, state: "off", signing: null });
    await expect(off.startSetup(ORG, ACTOR, { ownerAccountId: OWNER })).rejects.toThrow(
      /isn't turned on/,
    );
    await expect(off.disconnect(ORG, ACTOR)).rejects.toThrow(/isn't turned on/);
    expect(platform.calls).toEqual([]);
  });

  test("setup asks the owner to sign the canonical setup text with a platform nonce", async () => {
    const view = await agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER });
    expect(view.state).toBe("setup_pending");
    const setup = parseSetupMessage(view.signing?.message ?? "");
    expect(setup).toMatchObject({
      host: HOST,
      deployment: DEPLOYMENT,
      organization: ORG,
      owner: OWNER,
      area: "payables",
    });
    expect(Date.parse(setup?.expiresAt ?? "") - clock.getTime()).toBeLessThanOrEqual(3_600_000);
    expect(view.signing?.recipient).toBe(HOST);
    expect(Buffer.from(view.signing?.nonce ?? "", "base64")).toHaveLength(32);
    expect(platform.count("consents.nonce")).toBe(1);
    expect(view.signing?.message).not.toContain("Sign in");
  });

  test("setup, creation through the confirm page and consent connect the Organization", async () => {
    const setup = await agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER });
    const creating = await agents.submitSigned(ORG, ACTOR, signed(setup));
    expect(creating).toMatchObject({ state: "creating", setupPublicKey: key, signing: null });
    expect(creating.agent).toMatch(/^own-/);

    const prepared = await agents.prepareCreate(ORG, ACTOR);
    expect(prepared.intent).toBeNull();
    expect(prepared.view.create?.confirmUrl).toBe(`https://${HOST}/confirm/corr-1`);
    const asked = platform.calls.find((c) => c.route === "agent:owner/prepare")?.body as {
      input: unknown;
    };
    expect(asked.input).toEqual({
      action: {
        type: "agent_create",
        owner: { type: "near", account_id: OWNER, public_key: key },
        role: "payout",
      },
      signer: "wallet",
    });
    expect(platform.count("agent:owner/submit")).toBe(0);

    platform.confirmCreate(creating.agent ?? "");
    const created = await agents.view(ORG);
    expect(created).toMatchObject({
      state: "needs_consent",
      agentId: `agent-id-${creating.agent}`,
    });

    const consent = await agents.startConsent(ORG, ACTOR, { days: 90 });
    const text = parseConsentMessage(consent.signing?.message ?? "");
    expect(text).toMatchObject({
      organization: ORG,
      owner: OWNER,
      agent: creating.agent,
      agentId: created.agentId,
      scopes: ["owner", "read"],
    });
    expect(consent.signing?.message).toBe(
      consentMessage({
        host: HOST,
        deployment: DEPLOYMENT,
        organization: ORG,
        owner: OWNER,
        agent: creating.agent ?? "",
        agentId: created.agentId ?? "",
        scopes: ["read", "owner"],
        expiresAt: text?.expiresAt ?? "",
      }),
    );
    expect(Date.parse(text?.expiresAt ?? "") - clock.getTime()).toBe(90 * 86_400_000);

    const connected = await agents.submitSigned(ORG, ACTOR, signed(consent, "Y29uc2VudA=="));
    expect(connected).toMatchObject({ state: "connected", signing: null, retryable: false });
    expect(connected.consent?.scopes).toEqual(["owner", "read"]);
  });

  test("a readable creation intent is signed in the dashboard and submitted once", async () => {
    platform.createMode = "nep413";
    const setup = await agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER });
    await agents.submitSigned(ORG, ACTOR, signed(setup));
    const prepared = await agents.prepareCreate(ORG, ACTOR);
    expect(prepared.intent?.standard).toBe("nep413");
    const correlationId = prepared.view.create?.correlationId ?? "";

    const again = await agents.prepareCreate(ORG, ACTOR);
    expect(again.intent?.payload).toEqual(prepared.intent?.payload);
    expect(platform.count("agent:owner/prepare")).toBe(1);

    const submitted = await agents.submitCreate(ORG, {
      correlationId,
      signedData: { signature: "x" },
    });
    expect(submitted.state).toBe("needs_consent");
    await expect(
      agents.submitCreate(ORG, { correlationId, signedData: { signature: "x" } }),
    ).rejects.toThrow();
    expect(platform.count("agent:owner/submit")).toBe(1);
  });

  test("a lost submission reply is followed by status, never sent again", async () => {
    platform.createMode = "nep413";
    const setup = await agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER });
    await agents.submitSigned(ORG, ACTOR, signed(setup));
    const prepared = await agents.prepareCreate(ORG, ACTOR);
    const correlationId = prepared.view.create?.correlationId ?? "";
    platform.failNext("agent:owner/submit", { ok: false, kind: "unknown" });

    const view = await agents.submitCreate(ORG, { correlationId, signedData: { signature: "x" } });
    expect(platform.count("agent:owner/status")).toBe(1);
    expect(view.create?.status).toBe("PENDING_SIGNATURE");
    await expect(
      agents.submitCreate(ORG, { correlationId, signedData: { signature: "x" } }),
    ).rejects.toThrow(/already sent/);
    expect(platform.count("agent:owner/submit")).toBe(1);
  });

  test("creation waits for the agent's server and adopts an open creation after a lost answer", async () => {
    platform.createMode = "nep413";
    const setup = await agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER });
    await agents.submitSigned(ORG, ACTOR, signed(setup));

    platform.failNext("identity", { ok: false, kind: "unavailable" });
    await expect(agents.prepareCreate(ORG, ACTOR)).rejects.toThrow(/didn't answer/);
    expect(platform.count("agent:owner/prepare")).toBe(0);

    platform.failNext("agent:owner/prepare", { ok: false, kind: "unknown" });
    await expect(agents.prepareCreate(ORG, ACTOR)).rejects.toThrow(/shows no creation waiting/);
    expect((await agents.view(ORG)).create).toBeNull();

    platform.loseNextAnswer("agent:owner/prepare");
    const adopted = await agents.prepareCreate(ORG, ACTOR);
    expect(platform.count("agent:owner/prepare")).toBe(2);
    expect(adopted.intent).toBeNull();
    expect(adopted.view.create).toMatchObject({
      correlationId: [...platform.opened.keys()][0],
      confirmUrl: null,
      status: "adopted",
    });
    await expect(
      agents.submitCreate(ORG, {
        correlationId: adopted.view.create?.correlationId ?? "",
        signedData: { signature: "x" },
      }),
    ).rejects.toThrow(/already sent/);
    expect(platform.count("agent:owner/submit")).toBe(0);

    clock = new Date(clock.getTime() + 11 * 60_000);
    const fresh = await agents.prepareCreate(ORG, ACTOR);
    expect(fresh.intent?.standard).toBe("nep413");
    expect(platform.count("agent:owner/prepare")).toBe(3);
  });

  test("an unanswered submission keeps the signed body and resends exactly it", async () => {
    const setup = await agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER });
    platform.failNext("setup", { ok: false, kind: "unavailable" });
    await expect(agents.submitSigned(ORG, ACTOR, signed(setup))).rejects.toThrow(/didn't answer/);
    const waiting = await agents.view(ORG);
    expect(waiting).toMatchObject({ state: "setup_pending", retryable: true, signing: null });

    const retried = await agents.retry(ORG, ACTOR);
    expect(retried.state).toBe("creating");
    const bodies = platform.calls.filter((c) => c.route === "setup").map((c) => c.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(platform.consents.size).toBe(1);
  });

  test("only the text and nonce the dashboard issued, unexpired, are submitted", async () => {
    const setup = await agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER });
    const tampered = {
      ...signed(setup),
      message: setup.signing?.message.replace(OWNER, "mallory.near") ?? "",
    };
    await expect(agents.submitSigned(ORG, ACTOR, tampered)).rejects.toThrow(/isn't the text/);
    await expect(
      agents.submitSigned(ORG, ACTOR, {
        ...signed(setup),
        nonce: Buffer.alloc(32).toString("base64"),
      }),
    ).rejects.toThrow(/isn't the text/);
    clock = new Date(clock.getTime() + 16 * 60_000);
    await expect(agents.submitSigned(ORG, ACTOR, signed(setup))).rejects.toThrow(
      /Nothing is waiting/,
    );
    expect(platform.count("setup")).toBe(0);
  });

  test("an agent this deployment already set up and created goes straight to consent", async () => {
    platform.reserve({
      agent: "own-existing",
      organization: ORG,
      owner: OWNER,
      area: "payables",
      agentId: "agent-id-existing",
    });
    const view = await agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER });
    expect(view).toMatchObject({
      state: "needs_consent",
      agent: "own-existing",
      agentId: "agent-id-existing",
    });
    expect(platform.count("setup")).toBe(0);
    expect(platform.count("consents.nonce")).toBe(0);
  });

  test("the owner can change until the agent is created, and not after", async () => {
    const setup = await agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER });
    const reserved = await agents.submitSigned(ORG, ACTOR, signed(setup));
    const switched = await agents.startSetup(ORG, ACTOR, { ownerAccountId: "otto.near" });
    expect(switched).toMatchObject({
      ownerAccountId: "otto.near",
      state: "setup_pending",
      setupPublicKey: null,
    });
    expect(switched.agent).toBeNull();
    const ottos = await agents.submitSigned(ORG, ACTOR, signed(switched, "b3R0bw=="));
    expect(ottos.agent).not.toBe(reserved.agent);

    await agents.prepareCreate(ORG, ACTOR);
    platform.confirmCreate(ottos.agent ?? "");
    await agents.view(ORG);
    await expect(agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER })).rejects.toThrow(
      /already has a platform agent, owned by otto.near/,
    );
  });

  test("a consent for a replaced agent is refused and asks for a new text", async () => {
    const setup = await agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER });
    const created = await agents.submitSigned(ORG, ACTOR, signed(setup));
    await agents.prepareCreate(ORG, ACTOR);
    platform.confirmCreate(created.agent ?? "");
    const consent = await agents.startConsent(ORG, ACTOR, { days: 30 });
    const reservation = platform.reservations.get(created.agent ?? "");
    if (reservation) reservation.agentId = "agent-id-replacement";

    await expect(agents.submitSigned(ORG, ACTOR, signed(consent))).rejects.toThrow(/agent_changed/);
    const view = await agents.view(ORG);
    expect(view).toMatchObject({ signing: null, retryable: false });
    const again = await agents.startConsent(ORG, ACTOR, { days: 30 });
    expect(parseConsentMessage(again.signing?.message ?? "")?.agentId).toBe("agent-id-replacement");
  });

  test("disconnecting revokes every live consent on the platform", async () => {
    await connect();
    const view = await agents.disconnect(ORG, ACTOR);
    expect(view.state).toBe("ended");
    expect([...platform.consents.values()].every((c) => c.revoked)).toBe(true);
    expect(view.consents[0]?.revokedReason).toBe("dashboard");
  });

  test("a revocation the platform doesn't answer stops the disconnect", async () => {
    await connect();
    platform.failNext("consents.revoke", { ok: false, kind: "unavailable" });
    await expect(agents.disconnect(ORG, ACTOR)).rejects.toThrow(/didn't answer/);
    expect((await agents.view(ORG)).state).toBe("connected");
  });

  test("reads come from the connected agent and end with its access", async () => {
    await connect();
    const reads = createPlatformReads({ app: platform.client(), agents });
    const overview = await reads.overview(ORG);
    expect(overview).toMatchObject({
      revision: 3,
      ownerApproval: true,
      agreed: ["carol.near"],
      monthly: { spentUsd: "20", remainingUsd: "480" },
    });
    expect(overview.book[0]).toMatchObject({ symbol: "USDC", confidential: "12500000" });
    expect(await reads.held(ORG)).toEqual([
      {
        at: "2026-11-25T10:00:00Z",
        kind: "remote",
        correlationId: "held-1",
        approvalId: "appr-1",
        recipient: "carol.near",
        amount: "5000000",
        asset: "nep141:usdc",
        chain: null,
      },
    ]);

    platform.failNext("agent:overview", {
      ok: false,
      kind: "forbidden",
      status: 403,
      code: "consent_revoked",
      error: "key removed",
    });
    await expect(reads.overview(ORG)).rejects.toThrow(/refused access/);
    const view = await agents.view(ORG);
    expect(view.state).toBe("ended");
    expect(view.consents[0]?.revokedReason).toBe("access_ended");
  });

  test("a consent whose reply was lost is found on the platform, without signing or sending again", async () => {
    const setup = await agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER });
    const created = await agents.submitSigned(ORG, ACTOR, signed(setup, "c2V0dXA="));
    await agents.prepareCreate(ORG, ACTOR);
    platform.confirmCreate(created.agent ?? "");
    const consent = await agents.startConsent(ORG, ACTOR, { days: 90 });
    platform.loseNextAnswer("consents.submit");
    await expect(agents.submitSigned(ORG, ACTOR, signed(consent, "Y29uc2VudA=="))).rejects.toThrow(
      /didn't answer/,
    );

    const view = await agents.view(ORG);
    expect(view).toMatchObject({ state: "connected", retryable: false, signing: null });
    expect(platform.count("consents.submit")).toBe(1);
  });

  test("disconnecting revokes a platform consent the dashboard never recorded", async () => {
    await connect();
    const stray = [...platform.consents.values()].find((c) => c.agentId !== "unborn");
    if (!stray) throw new Error("no consent");
    platform.consents.set("stray", { ...stray, id: "stray", revoked: false, revokedAt: null });
    await agents.disconnect(ORG, ACTOR);
    expect(platform.consents.get("stray")?.revoked).toBe(true);
  });

  test("an access check that ended mid-call is confirmed with the platform before anything is marked", async () => {
    await connect();
    const reads = createPlatformReads({ app: platform.client(), agents });
    const accessEndedMidCall = {
      ok: false,
      kind: "forbidden",
      status: 403,
      code: "access_ended",
      error: "Access ended before forwarding",
    } as const;
    platform.failNext("agent:overview", accessEndedMidCall);
    await expect(reads.overview(ORG)).rejects.toThrow(/refused access/);
    expect((await agents.view(ORG)).state).toBe("connected");

    for (const consent of platform.consents.values()) consent.revoked = true;
    platform.failNext("agent:overview", accessEndedMidCall);
    await expect(reads.overview(ORG)).rejects.toThrow(/refused access/);
    const ended = await agents.view(ORG);
    expect(ended.state).toBe("ended");
    expect(ended.consents[0]?.revokedReason).toBe("access_ended");
  });

  test("an agent whose owner changed ends access", async () => {
    await connect();
    const reads = createPlatformReads({ app: platform.client(), agents });
    platform.failNext("agent:held", {
      ok: false,
      kind: "forbidden",
      status: 403,
      code: "owner_changed",
      error: "owner changed",
    });
    await expect(reads.held(ORG)).rejects.toThrow(/owner_changed/);
    expect((await agents.view(ORG)).state).toBe("ended");
  });

  test("a refused read that isn't the end of access leaves the consent live", async () => {
    await connect();
    const reads = createPlatformReads({ app: platform.client(), agents });
    platform.failNext("agent:held", { ok: false, kind: "unavailable" });
    await expect(reads.held(ORG)).rejects.toThrow(/didn't answer/);
    expect((await agents.view(ORG)).state).toBe("connected");
  });

  test("before an Organization is removed, every consent the platform lists for it is revoked", async () => {
    await connect();
    const stray = [...platform.consents.values()].find((c) => c.agentId !== "unborn");
    if (!stray) throw new Error("no consent");
    platform.consents.set("stray", { ...stray, id: "stray", revoked: false, revokedAt: null });

    await agents.beforeOrganizationRemoved(ORG);

    expect([...platform.consents.values()].every((c) => c.revoked)).toBe(true);
    const view = await agents.view(ORG);
    expect(view.state).toBe("ended");
    expect(view.consents.map((c) => c.revokedReason)).toEqual(["organization_deleted"]);
  });

  test("an Organization isn't cleared for removal while a revocation goes unanswered", async () => {
    await connect();
    platform.failNext("consents.revoke", { ok: false, kind: "unavailable" });
    await expect(agents.beforeOrganizationRemoved(ORG)).rejects.toThrow(/didn't answer/);
    expect((await agents.view(ORG)).state).toBe("connected");
  });

  test("removal needs platform access only for an Organization that has a platform agent", async () => {
    await connect();
    const off = createPlatformAgents({ db: database.db, app: null, settings: null });
    await expect(off.beforeOrganizationRemoved(ORG)).rejects.toThrow(/has a platform agent/);
    await expect(off.beforeOrganizationRemoved(OTHER)).resolves.toBeUndefined();
    const before = platform.calls.length;
    await agents.beforeOrganizationRemoved(OTHER);
    expect(platform.calls.length).toBe(before);
  });

  test("upkeep revokes for an Organization deleted around the dashboard, once", async () => {
    await connect();
    const exists = async (organizationId: string) => organizationId !== ORG;

    expect(await agents.maintain(exists)).toEqual({ checked: 1, revoked: 1, failed: [] });
    expect([...platform.consents.values()].every((c) => c.revoked)).toBe(true);

    const calls = platform.calls.length;
    expect(await agents.maintain(exists)).toEqual({ checked: 0, revoked: 0, failed: [] });
    expect(platform.calls.length).toBe(calls);
  });

  test("upkeep notices a consent the platform ended, and never revokes without a directory", async () => {
    await connect();
    for (const consent of platform.consents.values()) consent.revoked = true;

    expect(await agents.maintain(null)).toEqual({ checked: 1, revoked: 0, failed: [] });
    expect((await agents.view(ORG)).state).toBe("ended");
    expect(platform.count("consents.revoke")).toBe(0);
  });

  test("upkeep reports an Organization it couldn't check and goes on", async () => {
    await connect();
    platform.failNext("consents.list", { ok: false, kind: "unavailable" });
    expect(await agents.maintain(async () => true)).toEqual({
      checked: 1,
      revoked: 0,
      failed: [ORG],
    });
    expect((await agents.view(ORG)).state).toBe("connected");
  });

  test("one Organization's agent is never read or revoked for another", async () => {
    await connect();
    const reads = createPlatformReads({ app: platform.client(), agents });
    await expect(reads.overview(OTHER)).rejects.toThrow(/no connected platform agent/);
    const other = await agents.disconnect(OTHER, ACTOR);
    expect(other.state).toBe("not_connected");
    expect((await agents.view(ORG)).state).toBe("connected");
  });
});
