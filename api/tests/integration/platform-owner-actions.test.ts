import { ASSETS } from "@multiagency/sdk";
import { generateKey } from "near-kit";
import { beforeEach, describe, expect, test } from "vitest";
import { createPlatformAgents, type PlatformAgents } from "../../src/services/platform/agents";
import {
  createPlatformOwnerActions,
  type PlatformOwnerActions,
} from "../../src/services/platform/owner-actions";
import type { PayoutTerms } from "../../src/services/platform/payouts";
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
const DAY = 86_400_000;
const WNEAR_RULES = {
  asset: "wnear",
  maxPerPayout: "50",
  monthlyBudgetUsd: "500",
  ownerApproval: false,
} as const;

describe("owner actions through the platform", () => {
  const database = migratedDatabase({ perTest: true });
  let platform: FakePlatformApp;
  let clock: Date;
  let agents: PlatformAgents;
  let actions: PlatformOwnerActions;
  let payees: string[];
  let terms: Map<string, PayoutTerms>;
  const key = generateKey().publicKey.toString();

  beforeEach(async () => {
    clock = new Date("2026-11-25T12:00:00.000Z");
    payees = ["carol.near"];
    terms = new Map();
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
    actions = createPlatformOwnerActions({
      db: database.db,
      app: platform.client(),
      agents,
      payees: async () => payees,
      payoutTerms: async () => terms,
      now: () => clock,
    });
    const setup = await agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER });
    const signed = (view: Awaited<ReturnType<PlatformAgents["view"]>>, signature: string) => ({
      message: view.signing?.message ?? "",
      nonce: view.signing?.nonce ?? "",
      publicKey: key,
      signature,
    });
    const created = await agents.submitSigned(ORG, ACTOR, signed(setup, "c2V0dXA="));
    await agents.prepareCreate(ORG, ACTOR);
    platform.confirmCreate(created.agent ?? "");
    const consent = await agents.startConsent(ORG, ACTOR, { days: 90 });
    await agents.submitSigned(ORG, ACTOR, signed(consent, "Y29uc2VudA=="));
  });

  const prepareBody = () =>
    (
      platform.calls.filter((c) => c.route === "agent:owner/prepare").at(-1)?.body as {
        input: { action: Record<string, unknown> };
      }
    ).input.action;

  test("rules can't be signed before they're saved", async () => {
    await expect(actions.prepare(ORG, ACTOR, { kind: "rules" })).rejects.toThrow(
      /Save the payout rules first/,
    );
  });

  test("the first rules go to the confirm page, and the agent's policy follows once signed there", async () => {
    const saved = await actions.saveRules(ORG, ACTOR, WNEAR_RULES);
    expect(saved.pending).toContain("Pay carol.near by withdrawal to their NEAR account");

    const prepared = await actions.prepare(ORG, ACTOR, { kind: "rules" });
    expect(prepared.intent).toBeNull();
    expect(prepared.action).toMatchObject({ kind: "rules", status: "prepared", open: true });
    expect(prepared.action.confirmUrl).toBe(
      `https://${HOST}/confirm/${prepared.action.correlationId}`,
    );
    expect(prepareBody()).toMatchObject({
      type: "policy_update",
      expectedPolicy: { revision: 3, digest: "d" },
      changes: {
        withdrawals: [{ address: "carol.near" }],
        assets: [ASSETS.wNEAR],
        owner_approval: false,
      },
    });
    expect(prepared.preview?.after).toMatchObject({ owner_approval: false });

    const again = await actions.prepare(ORG, ACTOR, { kind: "rules" });
    expect(again.action.correlationId).toBe(prepared.action.correlationId);
    expect(platform.count("agent:owner/prepare")).toBe(2);

    platform.confirm(prepared.action.correlationId);
    expect(await actions.follow(ORG, prepared.action.correlationId)).toMatchObject({
      status: "SUCCESS",
      open: false,
    });
    expect((await actions.view(ORG)).pending).toEqual([]);
    await expect(actions.prepare(ORG, ACTOR, { kind: "rules" })).rejects.toThrow(/already match/);
  });

  test("a new builder is a readable edit, signed in the dashboard and sent once", async () => {
    await actions.saveRules(ORG, ACTOR, WNEAR_RULES);
    const first = await actions.prepare(ORG, ACTOR, { kind: "rules" });
    platform.confirm(first.action.correlationId);
    await actions.follow(ORG, first.action.correlationId);

    payees = ["carol.near", "dave.near"];
    expect((await actions.view(ORG)).pending).toEqual([
      "Pay dave.near by withdrawal to their NEAR account",
    ]);
    const added = await actions.prepare(ORG, ACTOR, { kind: "rules" });
    expect(added.intent?.standard).toBe("nep413");
    expect(added.action.confirmUrl).toBeNull();
    expect(prepareBody()).toMatchObject({
      changes: { withdrawals: [{ address: "carol.near" }, { address: "dave.near" }] },
    });

    const signedData = { ...added.intent, public_key: key, signature: "x" };
    expect(
      await actions.submit(ORG, { correlationId: added.action.correlationId, signedData }),
    ).toMatchObject({ status: "SUCCESS" });
    await expect(
      actions.submit(ORG, { correlationId: added.action.correlationId, signedData }),
    ).rejects.toThrow(/already sent/);
    expect(platform.count("agent:owner/submit")).toBe(1);
    expect((await actions.view(ORG)).pending).toEqual([]);
  });

  test("a lost submission reply is followed, never sent again", async () => {
    const grant = await actions.prepare(ORG, ACTOR, { kind: "grant" });
    platform.failNext("agent:owner/submit", { ok: false, kind: "unknown" });
    const followed = await actions.submit(ORG, {
      correlationId: grant.action.correlationId,
      signedData: { signature: "x" },
    });
    expect(followed.status).toBe("submitting");
    expect(platform.count("agent:owner/status")).toBe(1);
    await expect(
      actions.submit(ORG, { correlationId: grant.action.correlationId, signedData: {} }),
    ).rejects.toThrow(/already sent/);
  });

  test("a grant lasts 90 days, is renewed 14 days before, and is reminded once", async () => {
    const prepared = await actions.prepare(ORG, ACTOR, { kind: "grant" });
    expect(prepareBody()).toEqual({
      type: "grant_issue",
      label: "payout",
      expiresAt: new Date(clock.getTime() + 90 * DAY).toISOString(),
    });
    expect(prepared.intent?.standard).toBe("nep413");
    await actions.submit(ORG, {
      correlationId: prepared.action.correlationId,
      signedData: { signature: "x" },
    });
    expect((await actions.view(ORG)).grant).toMatchObject({ expiringSoon: false });
    expect(await actions.grantReminders()).toEqual([]);

    clock = new Date(clock.getTime() + 80 * DAY);
    expect((await actions.view(ORG)).grant).toMatchObject({ expiringSoon: true });
    expect(await actions.grantReminders()).toEqual([
      { organizationId: ORG, expiresAt: new Date("2027-02-23T12:00:00.000Z") },
    ]);
    expect(await actions.grantReminders()).toEqual([]);
  });

  test("only a live payout grant can be revoked", async () => {
    await expect(
      actions.prepare(ORG, ACTOR, { kind: "grant_revoke", grantId: "grant-9" }),
    ).rejects.toThrow(/isn't live/);
    const grant = await actions.prepare(ORG, ACTOR, { kind: "grant" });
    await actions.submit(ORG, { correlationId: grant.action.correlationId, signedData: {} });
    const grantId = (await actions.view(ORG)).grant?.grantId ?? "";
    const revoke = await actions.prepare(ORG, ACTOR, { kind: "grant_revoke", grantId });
    await actions.submit(ORG, { correlationId: revoke.action.correlationId, signedData: {} });
    expect((await actions.view(ORG)).grant).toBeNull();
  });

  test("freezing is signed on the confirm page, and a lost answer adopts the open freeze", async () => {
    const before = platform.count("agent:owner/prepare");
    platform.loseNextAnswer("agent:owner/prepare");
    const adopted = await actions.prepare(ORG, ACTOR, { kind: "freeze" });
    expect(adopted.action).toMatchObject({ kind: "freeze", status: "adopted", open: true });
    expect(adopted.intent).toBeNull();
    expect(platform.count("agent:owner/prepare")).toBe(before + 1);

    const correlationId = adopted.action.correlationId;
    platform.confirm(correlationId);
    await actions.follow(ORG, correlationId);
    expect((await actions.view(ORG)).frozen).toBe(true);

    const unfreeze = await actions.prepare(ORG, ACTOR, { kind: "unfreeze" });
    expect(unfreeze.action.confirmUrl).toMatch(/\/confirm\//);
  });

  test("reading the owner actions follows the open ones, and keeps unsigned ones open", async () => {
    const freeze = await actions.prepare(ORG, ACTOR, { kind: "freeze" });
    const grant = await actions.prepare(ORG, ACTOR, { kind: "grant" });
    platform.confirm(freeze.action.correlationId);
    const before = platform.count("agent:owner/status");

    const listed = (await actions.view(ORG)).actions;
    expect(platform.count("agent:owner/status")).toBe(before + 2);
    expect(listed.find((a) => a.correlationId === freeze.action.correlationId)).toMatchObject({
      status: "SUCCESS",
      open: false,
    });
    expect(listed.find((a) => a.correlationId === grant.action.correlationId)).toMatchObject({
      status: "prepared",
      open: true,
    });

    await actions.view(ORG);
    expect(platform.count("agent:owner/status")).toBe(before + 3);
  });

  test("one Organization can't follow or submit another's action", async () => {
    const grant = await actions.prepare(ORG, ACTOR, { kind: "grant" });
    await expect(actions.follow(OTHER, grant.action.correlationId)).rejects.toThrow(
      /no connected platform agent/,
    );
    await expect(
      actions.submit(OTHER, { correlationId: grant.action.correlationId, signedData: {} }),
    ).rejects.toThrow(/no connected platform agent/);
  });

  test("checking an action before it's signed keeps it open and signable", async () => {
    const grant = await actions.prepare(ORG, ACTOR, { kind: "grant" });
    expect(await actions.follow(ORG, grant.action.correlationId)).toMatchObject({
      status: "prepared",
      open: true,
    });
    expect(
      await actions.submit(ORG, { correlationId: grant.action.correlationId, signedData: {} }),
    ).toMatchObject({ status: "SUCCESS" });
  });

  test("an open action is reused only for the same request; another one supersedes it", async () => {
    for (const _ of [1, 2]) {
      const grant = await actions.prepare(ORG, ACTOR, { kind: "grant" });
      await actions.submit(ORG, { correlationId: grant.action.correlationId, signedData: {} });
    }
    const live = (platform.overview.grants as Array<{ grant_id: string }>).map((g) => g.grant_id);
    expect(live).toHaveLength(2);
    const revokeA = await actions.prepare(ORG, ACTOR, { kind: "grant_revoke", grantId: live[0] });
    expect(
      (await actions.prepare(ORG, ACTOR, { kind: "grant_revoke", grantId: live[0] })).action
        .correlationId,
    ).toBe(revokeA.action.correlationId);
    const revokeB = await actions.prepare(ORG, ACTOR, { kind: "grant_revoke", grantId: live[1] });
    expect(revokeB.action.correlationId).not.toBe(revokeA.action.correlationId);
    expect(prepareBody()).toEqual({ type: "grant_revoke", grantId: live[1] });
    const listed = (await actions.view(ORG)).actions;
    expect(listed.find((a) => a.correlationId === revokeA.action.correlationId)).toMatchObject({
      status: "superseded",
      open: false,
    });

    await actions.saveRules(ORG, ACTOR, WNEAR_RULES);
    const first = await actions.prepare(ORG, ACTOR, { kind: "rules" });
    await actions.saveRules(ORG, ACTOR, { ...WNEAR_RULES, monthlyBudgetUsd: "900" });
    const changed = await actions.prepare(ORG, ACTOR, { kind: "rules" });
    expect(changed.action.correlationId).not.toBe(first.action.correlationId);
    expect(prepareBody()).toMatchObject({ changes: { budget: { monthly_usd: "900" } } });
  });

  test("a held payout is shown with its work order, and the owner's vote names its payee and amount", async () => {
    terms.set("held-1", {
      compensationRequestId: "req-1",
      workOrderId: "wo-1",
      workOrderTitle: "Site build",
      approvedAmount: "5000000",
      tokenId: "usd",
      priceUsd: null,
    });
    expect((await actions.view(ORG)).held).toEqual([
      {
        approvalId: "appr-1",
        correlationId: "held-1",
        at: "2026-11-25T10:00:00Z",
        recipient: "carol.near",
        amount: "5000000",
        asset: "nep141:usdc",
        chain: null,
        terms: expect.objectContaining({ workOrderTitle: "Site build" }),
      },
    ]);

    const vote = await actions.prepare(ORG, ACTOR, {
      kind: "payout_vote",
      approvalId: "appr-1",
      verdict: "approve",
    });
    expect(prepareBody()).toEqual({
      type: "approval_vote",
      approvalId: "appr-1",
      verdict: "approve",
      correlationId: "held-1",
    });
    expect(vote.action.summary).toMatch(/^Approve paying .+ to carol\.near for "Site build"$/);
    expect(vote.intent).not.toBeNull();

    await actions.submit(ORG, { correlationId: vote.action.correlationId, signedData: {} });
    expect(platform.votes).toEqual([{ approvalId: "appr-1", verdict: "approve" }]);
    expect((await actions.view(ORG)).held).toEqual([]);
  });

  test("a signed vote still processing is followed until the platform settles it", async () => {
    platform.settleLater = true;
    const vote = await actions.prepare(ORG, ACTOR, {
      kind: "payout_vote",
      approvalId: "appr-1",
      verdict: "reject",
    });
    const submitted = await actions.submit(ORG, {
      correlationId: vote.action.correlationId,
      signedData: {},
    });
    expect(vote.action.summary).toMatch(/^Reject paying /);
    expect(submitted).toMatchObject({ status: "PROCESSING", open: true });

    const before = platform.count("agent:owner/status");
    expect((await actions.view(ORG)).actions[0]).toMatchObject({
      status: "PROCESSING",
      open: true,
    });
    expect(platform.count("agent:owner/status")).toBe(before + 1);

    platform.settle(vote.action.correlationId);
    expect((await actions.view(ORG)).actions[0]).toMatchObject({ status: "SUCCESS", open: false });
    await actions.view(ORG);
    expect(platform.count("agent:owner/status")).toBe(before + 2);
  });

  test("an action signed on the confirm page stays followed, without its link, until it settles", async () => {
    const freeze = await actions.prepare(ORG, ACTOR, { kind: "freeze" });
    expect(freeze.action.confirmUrl).toMatch(/\/confirm\//);
    platform.confirm(freeze.action.correlationId, false);
    expect((await actions.view(ORG)).actions[0]).toMatchObject({
      status: "PROCESSING",
      open: true,
      confirmUrl: null,
    });
    platform.settle(freeze.action.correlationId);
    expect((await actions.view(ORG)).actions[0]).toMatchObject({ status: "SUCCESS", open: false });
  });

  test("the scheduled run follows signed actions with nobody watching", async () => {
    platform.settleLater = true;
    const vote = await actions.prepare(ORG, ACTOR, {
      kind: "payout_vote",
      approvalId: "appr-1",
      verdict: "reject",
    });
    await actions.submit(ORG, { correlationId: vote.action.correlationId, signedData: {} });
    expect(await actions.followUnsettled()).toBe(1);
    expect((await actions.view(ORG)).actions[0]).toMatchObject({ open: true });

    platform.settle(vote.action.correlationId);
    expect(await actions.followUnsettled()).toBe(1);
    expect(await actions.followUnsettled()).toBe(0);
  });

  test("a vote is only for a payout that's waiting for one, and says how", async () => {
    const before = platform.count("agent:owner/prepare");
    await expect(
      actions.prepare(ORG, ACTOR, { kind: "payout_vote", approvalId: "appr-9", verdict: "reject" }),
    ).rejects.toThrow(/isn't waiting for the owner's vote/);
    await expect(
      actions.prepare(ORG, ACTOR, { kind: "payout_vote", approvalId: "appr-1" }),
    ).rejects.toThrow(/how/);
    expect(platform.count("agent:owner/prepare")).toBe(before);
  });

  test("a vote whose answer was lost isn't adopted from another open vote", async () => {
    platform.loseNextAnswer("agent:owner/prepare");
    await expect(
      actions.prepare(ORG, ACTOR, { kind: "payout_vote", approvalId: "appr-1", verdict: "reject" }),
    ).rejects.toThrow(/answer was lost/);
    expect(platform.count("agent:owner/actions")).toBe(0);
  });

  test("the owner chooses whether each payout waits for a vote", async () => {
    await actions.saveRules(ORG, ACTOR, { ...WNEAR_RULES, ownerApproval: true });
    expect((await actions.view(ORG)).rules).toMatchObject({ ownerApproval: true });
    await actions.prepare(ORG, ACTOR, { kind: "rules" });
    expect(prepareBody()).not.toHaveProperty("changes.owner_approval");
  });

  test("another open action of the kind is reported, not adopted in place of this one", async () => {
    platform.failNext("agent:owner/prepare", {
      ok: false,
      kind: "refused",
      code: "owner_action_open",
      error: "open",
    });
    await expect(actions.prepare(ORG, ACTOR, { kind: "freeze" })).rejects.toThrow(
      /still open on the platform/,
    );
    expect((await actions.view(ORG)).actions).toEqual([]);
  });
});
