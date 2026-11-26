import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db";
import { type PlatformDepositRow, platformAgents, platformDeposits } from "../../db/schema";
import { badRequest, type PlatformAgents, platformError } from "./agents";
import type { OwnerOutput, PlatformApp } from "./client";
import { PAYOUT_ASSET_TERMS } from "./rules";
import type { PayoutAsset } from "./terms";

type Status = OwnerOutput<"depositStatus">;
type DepositAsset = (typeof PAYOUT_ASSET_TERMS)[PayoutAsset]["id"];
type Connected = {
  calls: ReturnType<PlatformApp["agent"]>;
  connection: NonNullable<Awaited<ReturnType<PlatformAgents["connection"]>>>;
};

export function createPlatformDeposits(deps: {
  db: Database;
  app: PlatformApp | null;
  agents: PlatformAgents;
  now?: () => Date;
}) {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();

  async function connected(organizationId: string): Promise<Connected> {
    const connection = await deps.agents.connection(organizationId);
    if (!deps.app || !connection) {
      throw badRequest("This Organization has no connected platform agent");
    }
    if (!connection.scopes.includes("payout")) {
      throw badRequest(
        "The owner's consent doesn't include payouts. Ask the owner to sign a new one with payouts.",
      );
    }
    return { calls: deps.app.agent(organizationId, connection.agent), connection };
  }

  async function assetOf(organizationId: string) {
    const [row] = await db
      .select({ asset: platformAgents.payoutAsset })
      .from(platformAgents)
      .where(eq(platformAgents.organizationId, organizationId))
      .limit(1);
    if (!row?.asset) {
      throw badRequest("Save the payout rules first: they say which asset the agent pays in");
    }
    return PAYOUT_ASSET_TERMS[row.asset];
  }

  async function latestOf(organizationId: string, asset: string) {
    const [row] = await db
      .select()
      .from(platformDeposits)
      .where(
        and(eq(platformDeposits.organizationId, organizationId), eq(platformDeposits.asset, asset)),
      )
      .orderBy(desc(platformDeposits.createdAt))
      .limit(1);
    return row ?? null;
  }

  async function update(row: PlatformDepositRow, patch: Partial<PlatformDepositRow>) {
    const [updated] = await db
      .update(platformDeposits)
      .set({ ...patch, updatedAt: now() })
      .where(eq(platformDeposits.requestId, row.requestId))
      .returning();
    return updated ?? row;
  }

  const usable = (row: PlatformDepositRow) =>
    row.state === "ready" && (!row.expiresAt || row.expiresAt.getTime() > now().getTime());

  function depositView(row: PlatformDepositRow) {
    const terms = Object.values(PAYOUT_ASSET_TERMS).find((t) => t.id === row.asset);
    return {
      requestId: row.requestId,
      asset: row.asset,
      symbol: terms?.symbol ?? row.asset,
      decimals: terms?.decimals ?? null,
      state: row.state,
      usable: usable(row),
      address: row.address,
      memo: row.memo,
      minAmount: row.minAmount,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      code: row.code,
    };
  }

  function answered(status: Status): Partial<PlatformDepositRow> {
    if (status.state === "ready") {
      return {
        state: "ready",
        address: status.deposit.address,
        memo: status.deposit.memo,
        minAmount: status.deposit.minAmount,
        expiresAt: status.deposit.expiresAt ? new Date(status.deposit.expiresAt) : null,
      };
    }
    if (status.state === "refused") return { state: "refused", code: status.code };
    return { state: "unknown" };
  }

  async function ask(
    organizationId: string,
    { calls, connection }: Connected,
    row: PlatformDepositRow,
    asset: DepositAsset,
  ) {
    const asked = await calls.call("deposit", { asset, requestId: row.requestId });
    if (asked.ok) {
      return update(row, {
        state: "ready",
        address: asked.value.address,
        memo: asked.value.memo,
        minAmount: asked.value.minAmount,
        expiresAt: asked.value.expiresAt ? new Date(asked.value.expiresAt) : null,
      });
    }
    if (asked.kind === "refused")
      return update(row, { state: "refused", code: asked.code ?? null });
    if (asked.kind === "session" || asked.kind === "forbidden") {
      await deps.agents.accessFailed(organizationId, connection.consentId, asked);
      throw platformError(asked);
    }
    return read({ calls, connection }, await update(row, { state: "unknown" }));
  }

  async function read({ calls }: Connected, row: PlatformDepositRow) {
    const status = await calls.call("depositStatus", { requestId: row.requestId });
    if (!status.ok) return row;
    if (status.value.state === "not_found") return row;
    return update(row, answered(status.value));
  }

  async function fund(organizationId: string, actorId: string) {
    const handle = await connected(organizationId);
    const asset = await assetOf(organizationId);
    const last = await latestOf(organizationId, asset.id);
    if (last && usable(last)) return depositView(last);
    if (last && (last.state === "requesting" || last.state === "unknown")) {
      const followed = await read(handle, last);
      if (usable(followed)) return depositView(followed);
      if (followed.state !== "ready" && followed.state !== "refused") {
        return depositView(await ask(organizationId, handle, followed, asset.id));
      }
    }
    const requestId = `deposit-${randomUUID()}`;
    await db.insert(platformDeposits).values({
      requestId,
      organizationId,
      agent: handle.connection.agent,
      asset: asset.id,
      state: "requesting",
      requestedBy: actorId,
      createdAt: now(),
      updatedAt: now(),
    });
    const [row] = await db
      .select()
      .from(platformDeposits)
      .where(eq(platformDeposits.requestId, requestId));
    if (!row) throw badRequest("The deposit request couldn't be recorded");
    return depositView(await ask(organizationId, handle, row, asset.id));
  }

  async function current(organizationId: string) {
    const asset = await assetOf(organizationId).catch(() => null);
    if (!asset) return null;
    const last = await latestOf(organizationId, asset.id);
    return last ? depositView(last) : null;
  }

  return { fund, current };
}

export type PlatformDeposits = ReturnType<typeof createPlatformDeposits>;
