import { ASSETS } from "@multiagency/sdk";
import { generateKey } from "near-kit";
import { beforeEach, describe, expect, test } from "vitest";
import { platformAgents, platformDeposits } from "../../src/db/schema";
import { createPlatformAgents, type PlatformAgents } from "../../src/services/platform/agents";
import {
  createPlatformDeposits,
  type PlatformDeposits,
} from "../../src/services/platform/deposits";
import { FakePlatformApp } from "../fakes/platform-app";
import { migratedDatabase } from "./_pg";

const ORG = "orgStudio";
const ACTOR = "user-admin";
const OWNER = "rita.near";
const HOST = "platform.test";
const SETTINGS = {
  base: `https://${HOST}`,
  host: HOST,
  deployment: "multiagency-dashboard",
  credential: "tap_x.y",
} as const;

describe("funding a platform agent", () => {
  const database = migratedDatabase({ perTest: true });
  let platform: FakePlatformApp;
  let clock: Date;
  let agents: PlatformAgents;
  let deposits: PlatformDeposits;
  const key = generateKey().publicKey.toString();

  async function connect(payout: boolean) {
    const signed = (view: Awaited<ReturnType<PlatformAgents["view"]>>, signature: string) => ({
      message: view.signing?.message ?? "",
      nonce: view.signing?.nonce ?? "",
      publicKey: key,
      signature,
    });
    const setup = await agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER });
    const created = await agents.submitSigned(ORG, ACTOR, signed(setup, "c2V0dXA="));
    await agents.prepareCreate(ORG, ACTOR);
    platform.confirmCreate(created.agent ?? "");
    const consent = await agents.startConsent(ORG, ACTOR, { days: 90, payout });
    await agents.submitSigned(ORG, ACTOR, signed(consent, "Y29uc2VudA=="));
  }

  const payIn = (asset: "wnear" | "usdc") =>
    database.db
      .update(platformAgents)
      .set({ payoutAsset: asset, maxPerPayout: "1", monthlyBudgetUsd: "10" });

  const asked = () =>
    platform.calls
      .filter((c) => c.route === "agent:deposit")
      .map((c) => (c.body as { input: { asset: string; requestId: string } }).input);

  beforeEach(async () => {
    clock = new Date("2026-11-25T12:00:00.000Z");
    platform = new FakePlatformApp({
      host: HOST,
      deployment: SETTINGS.deployment,
      now: () => clock.getTime(),
    });
    agents = createPlatformAgents({
      db: database.db,
      app: platform.client(),
      settings: SETTINGS,
      now: () => clock,
    });
    deposits = createPlatformDeposits({
      db: database.db,
      app: platform.client(),
      agents,
      now: () => clock,
    });
  });

  test("an address is asked for once, under an ID recorded before the call, in the asset the rules pay", async () => {
    await connect(true);
    await payIn("wnear");
    const first = await deposits.fund(ORG, ACTOR);
    expect(first).toMatchObject({
      asset: ASSETS.wNEAR,
      symbol: "wNEAR",
      state: "ready",
      usable: true,
      address: "deposit-address-1",
      minAmount: "1000",
    });
    expect(asked()).toEqual([{ asset: ASSETS.wNEAR, requestId: first.requestId }]);

    expect(await deposits.fund(ORG, ACTOR)).toMatchObject({ requestId: first.requestId });
    expect(await deposits.current(ORG)).toMatchObject({ requestId: first.requestId });
    expect(asked()).toHaveLength(1);
  });

  test("a lost answer is read back by its ID, never asked for under a new one", async () => {
    await connect(true);
    await payIn("usdc");
    platform.loseNextAnswer("agent:deposit");
    const funded = await deposits.fund(ORG, ACTOR);
    expect(funded).toMatchObject({ asset: ASSETS.USDC, state: "ready", usable: true });
    expect(asked()).toHaveLength(1);
    expect(platform.count("agent:depositStatus")).toBe(1);
  });

  test("an uncertain request that the platform never received is asked for again under the same ID", async () => {
    await connect(true);
    await payIn("wnear");
    platform.failNext("agent:deposit", { ok: false, kind: "unavailable", error: "down" });
    const pending = await deposits.fund(ORG, ACTOR);
    expect(pending).toMatchObject({ state: "unknown", usable: false });

    const funded = await deposits.fund(ORG, ACTOR);
    expect(funded).toMatchObject({ requestId: pending.requestId, state: "ready" });
    expect(asked().map((a) => a.requestId)).toEqual([pending.requestId, pending.requestId]);
  });

  test("a refused or expired address is replaced by a new request", async () => {
    await connect(true);
    await payIn("wnear");
    platform.failNext("agent:deposit", { ok: false, kind: "refused", code: "asset_not_allowed" });
    const refused = await deposits.fund(ORG, ACTOR);
    expect(refused).toMatchObject({ state: "refused", code: "asset_not_allowed" });

    const second = await deposits.fund(ORG, ACTOR);
    expect(second.requestId).not.toBe(refused.requestId);
    expect(second).toMatchObject({ state: "ready" });

    clock = new Date(clock.getTime() + 2 * 3_600_000);
    const third = await deposits.fund(ORG, ACTOR);
    expect(third.requestId).not.toBe(second.requestId);
    expect(asked()).toHaveLength(3);
  });

  test("nothing is asked for without payouts in the consent, or without rules naming the asset", async () => {
    await connect(false);
    await payIn("wnear");
    await expect(deposits.fund(ORG, ACTOR)).rejects.toThrow(/doesn't include payouts/);

    await database.db.update(platformAgents).set({ payoutAsset: null });
    await expect(deposits.current(ORG)).resolves.toBeNull();
    expect(asked()).toEqual([]);
    expect(await database.db.select().from(platformDeposits)).toEqual([]);
  });

  test("an Organization without the rules saved is told to save them first", async () => {
    await connect(true);
    await expect(deposits.fund(ORG, ACTOR)).rejects.toThrow(/Save the payout rules first/);
    expect(asked()).toEqual([]);
  });
});
