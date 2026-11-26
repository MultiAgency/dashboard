import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { platformAgents, platformPayouts } from "../../src/db/schema";
import { createPlatformAgents } from "../../src/services/platform/agents";
import {
  ASSETS,
  createPlatformApp,
  type PlatformSettings,
  platformSettings,
} from "../../src/services/platform/client";
import { createPlatformOwnerActions } from "../../src/services/platform/owner-actions";
import { createPlatformPayouts } from "../../src/services/platform/payouts";
import { createPlatformReads } from "../../src/services/platform/reads";
import { migratedDatabase } from "../integration/_pg";

const statePath = process.env.PLATFORM_STACK_STATE;
const ORG = `orgStack${Date.now()}`;
const OWNER = "owner.near";
const PAYEE = "payee.near";
const ACTOR = "stack-admin";

type Signed = { publicKey: string; signature: string };

let sequence = 0;

function controls(directory: string) {
  return async (command: string, input: Record<string, unknown>) => {
    const name = `dashboard-${process.pid}-${++sequence}`;
    const path = join(directory, "controls", `${name}.json`);
    const answer = join(directory, "controls", `${name}.result.json`);
    writeFileSync(`${path}.tmp`, JSON.stringify({ command, ...input }));
    renameSync(`${path}.tmp`, path);
    const deadline = Date.now() + 30_000;
    while (!existsSync(answer)) {
      if (Date.now() > deadline) throw new Error(`${command}: no answer from the stack`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const result = JSON.parse(readFileSync(answer, "utf8")) as
      | { ok: true; value: Signed & Record<string, unknown> }
      | { ok: false; error: string };
    if (!result.ok) throw new Error(`${command}: ${result.error}`);
    return result.value;
  };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function stackSettings(): PlatformSettings {
  const state = JSON.parse(readFileSync(statePath ?? "", "utf8")) as {
    app: { deployment: string; base: string; credentialFile: string };
  };
  const settings = platformSettings({
    PLATFORM_URL: state.app.base,
    PLATFORM_APP_CREDENTIAL: readFileSync(state.app.credentialFile, "utf8").trim(),
    PLATFORM_DEPLOYMENT: state.app.deployment,
  });
  if (!settings) throw new Error("the stack's settings don't parse");
  return settings;
}

describe.skipIf(!statePath)("the dashboard's server on the platform's local stack", () => {
  const database = migratedDatabase();

  async function connected(org: string, payout: boolean) {
    const settings = stackSettings();
    const app = createPlatformApp(settings);
    const agents = createPlatformAgents({ db: database.db, app, settings });
    const control = controls(dirname(statePath ?? ""));
    const ownerSigns = (payload: { message: string; recipient: string; nonce: string }) =>
      control("signOwner", payload);
    const setup = await agents.startSetup(org, ACTOR, { ownerAccountId: OWNER });
    if (!setup.signing) throw new Error(`no setup text: ${JSON.stringify(setup)}`);
    await agents.submitSigned(org, ACTOR, {
      message: setup.signing.message,
      nonce: setup.signing.nonce,
      ...(await ownerSigns(setup.signing)),
    });
    let prepared: Awaited<ReturnType<typeof agents.prepareCreate>> | null = null;
    for (let attempt = 0; attempt < 30 && !prepared; attempt++) {
      prepared = await agents.prepareCreate(org, ACTOR).catch(async (error: unknown) => {
        if (attempt === 29) throw error;
        await pause(1_000);
        return null;
      });
    }
    if (!prepared?.intent) throw new Error("creation came back for the confirm page");
    const created = await ownerSigns(prepared.intent.payload);
    await agents.submitCreate(org, {
      correlationId: prepared.view.create?.correlationId ?? "",
      signedData: {
        ...prepared.intent,
        public_key: created.publicKey,
        signature: created.signature,
      },
    });
    let view = await agents.view(org);
    for (let attempt = 0; attempt < 30 && view.state !== "needs_consent"; attempt++) {
      await pause(1_000);
      view = await agents.followCreate(org);
    }
    const consent = await agents.startConsent(org, ACTOR, { days: 90, payout });
    if (!consent.signing) throw new Error("no consent text");
    const done = await agents.submitSigned(org, ACTOR, {
      message: consent.signing.message,
      nonce: consent.signing.nonce,
      ...(await ownerSigns(consent.signing)),
    });
    expect(done.state).toBe("connected");
    return { app, agents, control, ownerSigns, agentId: view.agentId ?? "" };
  }

  test("connects an Organization's payout agent and reads it within the consent", async () => {
    const state = JSON.parse(readFileSync(statePath ?? "", "utf8")) as {
      app: { deployment: string; base: string; credentialFile: string };
    };
    const settings = platformSettings({
      PLATFORM_URL: state.app.base,
      PLATFORM_APP_CREDENTIAL: readFileSync(state.app.credentialFile, "utf8").trim(),
      PLATFORM_DEPLOYMENT: state.app.deployment,
    });
    if (!settings) throw new Error("the stack's settings don't parse");
    const app = createPlatformApp(settings);
    const agents = createPlatformAgents({ db: database.db, app, settings });
    const reads = createPlatformReads({ app, agents });
    const control = controls(dirname(statePath ?? ""));
    const ownerSigns = (payload: { message: string; recipient: string; nonce: string }) =>
      control("signOwner", payload);

    await expect(
      ownerSigns({
        message: `Sign in to ${settings.host}`,
        recipient: settings.host,
        nonce: randomBytes(32).toString("base64"),
      }),
    ).rejects.toThrow();

    const setup = await agents.startSetup(ORG, ACTOR, { ownerAccountId: OWNER });
    if (!setup.signing) throw new Error(`no setup text: ${JSON.stringify(setup)}`);
    expect(setup.signing.recipient).toBe(settings.host);
    const setupSigned = await ownerSigns(setup.signing);
    const creating = await agents.submitSigned(ORG, ACTOR, {
      message: setup.signing.message,
      nonce: setup.signing.nonce,
      ...setupSigned,
    });
    expect(creating.state).toBe("creating");

    let prepared: Awaited<ReturnType<typeof agents.prepareCreate>> | null = null;
    for (let attempt = 0; attempt < 30 && !prepared; attempt++) {
      try {
        prepared = await agents.prepareCreate(ORG, ACTOR);
      } catch (error) {
        if (attempt === 29) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    if (!prepared?.intent) {
      throw new Error(
        `creation came back for the confirm page: ${JSON.stringify(prepared?.view.create)}`,
      );
    }
    const correlationId = prepared.view.create?.correlationId ?? "";
    const createSigned = await ownerSigns(prepared.intent.payload);
    await agents.submitCreate(ORG, {
      correlationId,
      signedData: {
        ...prepared.intent,
        public_key: createSigned.publicKey,
        signature: createSigned.signature,
      },
    });

    let view = await agents.view(ORG);
    for (let attempt = 0; attempt < 30 && view.state !== "needs_consent"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      view = await agents.followCreate(ORG);
    }
    expect(view.state).toBe("needs_consent");
    expect(view.agentId).toBeTruthy();

    const consent = await agents.startConsent(ORG, ACTOR, { days: 90 });
    if (!consent.signing) throw new Error("no consent text");
    const consentSigned = await ownerSigns(consent.signing);
    const connected = await agents.submitSigned(ORG, ACTOR, {
      message: consent.signing.message,
      nonce: consent.signing.nonce,
      ...consentSigned,
    });
    expect(connected.state).toBe("connected");
    expect(connected.consent?.scopes).toEqual(["owner", "read"]);

    const overview = await reads.overview(ORG);
    expect(overview.agentId).toBe(view.agentId);
    for (const read of [
      "unresolved",
      "activity",
      "ledger",
      "policyHistory",
      "ownerActions",
    ] as const) {
      expect(Array.isArray(await reads[read](ORG)), read).toBe(true);
    }

    const again = await agents
      .startSetup(ORG, ACTOR, { ownerAccountId: OWNER })
      .catch((e: Error) => e);
    expect(again).toBeInstanceOf(Error);

    const owner = createPlatformOwnerActions({
      db: database.db,
      app,
      agents,
      payees: async () => [PAYEE],
      payoutTerms: async () => new Map(),
    });
    const signAndSubmit = async (prepared: Awaited<ReturnType<typeof owner.prepare>>) => {
      if (!prepared.intent) {
        throw new Error(
          `${prepared.action.kind} came back for the confirm page: ${prepared.action.confirmUrl}`,
        );
      }
      const signedOwner = await ownerSigns(prepared.intent.payload);
      return owner.submit(ORG, {
        correlationId: prepared.action.correlationId,
        signedData: {
          ...prepared.intent,
          public_key: signedOwner.publicKey,
          signature: signedOwner.signature,
        },
      });
    };
    const waitFor = async (correlationId: string) => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const followed = await owner.follow(ORG, correlationId);
        if (followed.status === "SUCCESS") return followed;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      throw new Error(`${correlationId} never succeeded`);
    };

    const saved = await owner.saveRules(ORG, ACTOR, {
      asset: "usdc",
      maxPerPayout: "5",
      monthlyBudgetUsd: "100",
      ownerApproval: false,
    });
    expect(saved.pending).toContain(`Pay ${PAYEE} by confidential transfer`);
    const rules = await owner.prepare(ORG, ACTOR, { kind: "rules" });
    expect(rules.preview?.after).toBeTruthy();
    await waitFor((await signAndSubmit(rules)).correlationId);
    expect((await owner.view(ORG)).pending).toEqual([]);
    expect((await reads.overview(ORG)).agreed).toContain(PAYEE);

    const grant = await owner.prepare(ORG, ACTOR, { kind: "grant" });
    await waitFor((await signAndSubmit(grant)).correlationId);
    expect((await owner.view(ORG)).grant).toMatchObject({ expiringSoon: false });

    await owner.saveRules(ORG, ACTOR, {
      asset: "wnear",
      maxPerPayout: "2",
      monthlyBudgetUsd: "100",
      ownerApproval: false,
    });
    const toWnear = await owner.prepare(ORG, ACTOR, { kind: "rules" });
    await waitFor((await signAndSubmit(toWnear)).correlationId);
    const switched = await reads.overview(ORG);
    expect(switched.assets).toEqual(["nep141:wrap.near"]);
    expect(switched.destinations).toEqual([{ action: "withdraw", address: PAYEE, chain: "near" }]);
    expect((await owner.view(ORG)).pending).toEqual([]);

    const ended = await agents.disconnect(ORG, ACTOR);
    expect(ended.state).toBe("ended");
    const listed = await app.consents.list(ORG);
    if (!listed.ok) throw new Error(JSON.stringify(listed));
    expect(
      listed.value.consents.filter((c) => c.agentId === view.agentId).every((c) => c.revoked),
    ).toBe(true);
    await expect(reads.overview(ORG)).rejects.toThrow(/no connected platform agent/);
  }, 180_000);

  test("a held payout the owner rejects is followed until it settles, then never sent again; an approved one is paid once", async () => {
    const org = `orgVote${Date.now()}`;
    const { app, agents, control, ownerSigns, agentId } = await connected(org, true);
    const owner = createPlatformOwnerActions({
      db: database.db,
      app,
      agents,
      payees: async () => [PAYEE],
      payoutTerms: async () => new Map(),
    });
    const payouts = createPlatformPayouts({
      db: database.db,
      app,
      agents,
      pendingPayees: owner.pendingPayees,
    });
    const settle = async (correlationId: string) => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const followed = await owner.follow(org, correlationId);
        if (!followed.open) return followed;
        await pause(1_000);
      }
      throw new Error(`${correlationId} never settled`);
    };
    const signAndSubmit = async (prepared: Awaited<ReturnType<typeof owner.prepare>>) => {
      if (!prepared.intent) throw new Error(`${prepared.action.kind} has no readable text`);
      const signed = await ownerSigns(prepared.intent.payload);
      return owner.submit(org, {
        correlationId: prepared.action.correlationId,
        signedData: {
          ...prepared.intent,
          public_key: signed.publicKey,
          signature: signed.signature,
        },
      });
    };

    await owner.saveRules(org, ACTOR, {
      asset: "usdc",
      maxPerPayout: "5",
      monthlyBudgetUsd: "100",
      ownerApproval: true,
    });
    await settle(
      (await signAndSubmit(await owner.prepare(org, ACTOR, { kind: "rules" }))).correlationId,
    );
    await settle(
      (await signAndSubmit(await owner.prepare(org, ACTOR, { kind: "grant" }))).correlationId,
    );
    await control("fund", { agent: agentId, amount: "20000000" });
    await database.db
      .update(platformAgents)
      .set({ payoutRoute: "platform" })
      .where(eq(platformAgents.organizationId, org));
    const usdc = ASSETS.USDC.replace(/^nep141:/, "");
    const pay = (requestId: string) =>
      payouts.send(org, { requestId, recipient: PAYEE, amount: "2000000", tokenId: usdc });

    const first = await pay(`${org}-reject`);
    expect(first).toMatchObject({ status: "processing" });
    const heldFirst = (await owner.view(org)).held.find(
      (h) => h.correlationId === first.correlationId,
    );
    if (!heldFirst) throw new Error("the payout isn't held for a vote");
    const reject = await owner.prepare(org, ACTOR, {
      kind: "payout_vote",
      approvalId: heldFirst.approvalId,
      verdict: "reject",
    });
    await signAndSubmit(reject);
    expect(await settle(reject.action.correlationId)).toMatchObject({
      status: "FAILED",
      open: false,
    });
    expect(await payouts.refresh(first)).toMatchObject({ status: "rejected", provenUnsent: true });
    expect(await pay(`${org}-reject`)).toMatchObject({ id: first.id, status: "rejected" });

    const second = await pay(`${org}-approve`);
    const heldSecond = (await owner.view(org)).held.find(
      (h) => h.correlationId === second.correlationId,
    );
    if (!heldSecond) throw new Error("the second payout isn't held");
    const approve = await owner.prepare(org, ACTOR, {
      kind: "payout_vote",
      approvalId: heldSecond.approvalId,
      verdict: "approve",
    });
    await signAndSubmit(approve);
    await control("settle", { correlation: second.correlationId });
    expect((await settle(approve.action.correlationId)).status).toBe("SUCCESS");
    let paid = await payouts.refresh(second);
    for (let attempt = 0; attempt < 30 && paid.status !== "paid"; attempt++) {
      await pause(1_000);
      paid = await payouts.refresh(second);
    }
    expect(paid.status).toBe("paid");
    const attempts = await database.db
      .select()
      .from(platformPayouts)
      .where(eq(platformPayouts.organizationId, org));
    expect(attempts.map((a) => [a.compensationRequestId, a.state]).sort()).toEqual([
      [`${org}-approve`, "succeeded"],
      [`${org}-reject`, "rejected"],
    ]);
  }, 240_000);
});
