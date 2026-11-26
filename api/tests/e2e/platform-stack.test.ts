import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { createPlatformAgents } from "../../src/services/platform/agents";
import { createPlatformApp, platformSettings } from "../../src/services/platform/client";
import { createPlatformReads } from "../../src/services/platform/reads";
import { migratedDatabase } from "../integration/_pg";

const statePath = process.env.PLATFORM_STACK_STATE;
const ORG = `orgStack${Date.now()}`;
const OWNER = "owner.near";
const ACTOR = "stack-admin";

type Signed = { publicKey: string; signature: string };

function controls(directory: string) {
  let sequence = 0;
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
      | { ok: true; value: Signed }
      | { ok: false; error: string };
    if (!result.ok) throw new Error(`${command}: ${result.error}`);
    return result.value;
  };
}

describe.skipIf(!statePath)("the dashboard's server on the platform's local stack", () => {
  const database = migratedDatabase();

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
      "held",
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

    const ended = await agents.disconnect(ORG, ACTOR);
    expect(ended.state).toBe("ended");
    const listed = await app.consents.list(ORG);
    if (!listed.ok) throw new Error(JSON.stringify(listed));
    expect(
      listed.value.consents.filter((c) => c.agentId === view.agentId).every((c) => c.revoked),
    ).toBe(true);
    await expect(reads.overview(ORG)).rejects.toThrow(/no connected platform agent/);
  }, 180_000);
});
