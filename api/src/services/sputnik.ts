import { and, eq } from "drizzle-orm";
import type { Database } from "../db";
import { proposals as proposalsTable } from "../db/schema";
import { fetchWithTimeout } from "./fetch";
import { NATIVE_TOKEN_ID } from "./tokens";

const POLICY_TTL_MS = 60_000;

// Sputnik DAO factory suffixes; matching orgAccounts double as DAO contracts.
const SPUTNIK_DAO_SUFFIXES = [".sputnik-dao.near", ".sputnikv2.testnet"];

export function isSputnikDao(accountId: string): boolean {
  return SPUTNIK_DAO_SUFFIXES.some((suffix) => accountId.endsWith(suffix));
}

// Network inferred from account suffix; `.testnet` → testnet, else mainnet.
export function networkOf(accountId: string): "mainnet" | "testnet" {
  return accountId.endsWith(".testnet") ? "testnet" : "mainnet";
}

// Per-network env overrides; a single var would misroute in multi-network mode.
export function rpcUrlFor(accountId: string): string {
  if (networkOf(accountId) === "testnet") {
    return process.env.NEAR_RPC_URL_TESTNET || "https://test.rpc.fastnear.com";
  }
  return process.env.NEAR_RPC_URL_MAINNET || "https://free.rpc.fastnear.com";
}

// FASTNEAR_API_KEY sent as Bearer only on fastnear hosts; covers legacy + canonical.
const FASTNEAR_HOSTS = new Set([
  "free.rpc.fastnear.com",
  "test.rpc.fastnear.com",
  "rpc.mainnet.fastnear.com",
  "rpc.testnet.fastnear.com",
  "rpc.fastnear.com",
  "api.fastnear.com",
  "test.api.fastnear.com",
]);

export function fastnearAuthHeaders(url: string): Record<string, string> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return {};
  }
  if (!FASTNEAR_HOSTS.has(host)) return {};
  const key = process.env.FASTNEAR_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

interface SputnikRole {
  name: string;
  kind: "Everyone" | { Group: string[] };
  permissions: string[];
}

interface SputnikPolicy {
  roles: SputnikRole[];
}

const policyCache = new Map<string, { policy: SputnikPolicy; expiresAt: number }>();

async function fetchPolicy(daoAccountId: string): Promise<SputnikPolicy> {
  const cached = policyCache.get(daoAccountId);
  if (cached && cached.expiresAt > Date.now()) return cached.policy;
  try {
    const policy = await viewCall<SputnikPolicy>(daoAccountId, daoAccountId, "get_policy", {});
    policyCache.set(daoAccountId, { policy, expiresAt: Date.now() + POLICY_TTL_MS });
    return policy;
  } catch (err) {
    // Stale-while-error: serve last successful policy when RPC fails (rate limits, transient downtime).
    if (cached) {
      console.warn("[API] fetchPolicy using stale cache:", daoAccountId, (err as Error).message);
      return cached.policy;
    }
    throw err;
  }
}

export interface DaoRole {
  name: string;
  isEveryone: boolean;
  members: string[];
  permissions: string[];
}

export async function getRoles(daoAccountId: string): Promise<DaoRole[]> {
  const policy = await fetchPolicy(daoAccountId);
  return policy.roles.map((r) => ({
    name: r.name,
    isEveryone: r.kind === "Everyone",
    members: r.kind === "Everyone" ? [] : r.kind.Group,
    permissions: r.permissions,
  }));
}

export async function userInRole(
  orgAccountId: string,
  accountId: string,
  roleName: string,
): Promise<boolean> {
  // Non-DAO orgs: every gate collapses to self-ownership (accountId === orgAccountId).
  if (!isSputnikDao(orgAccountId)) {
    return accountId === orgAccountId;
  }
  const roles = await getRoles(orgAccountId);
  const role = roles.find((r) => r.name === roleName);
  if (!role) return false;
  if (role.isEveryone) return true;
  return role.members.includes(accountId);
}

export type DaoProposalStatus =
  | "InProgress"
  | "Approved"
  | "Rejected"
  | "Removed"
  | "Expired"
  | "Moved"
  | "Failed";

export type DaoProposalKind =
  | { type: "Transfer"; tokenId: string; receiverId: string; amount: string }
  | { type: "Other"; name: string };

export type DaoVoteAction = "Approve" | "Reject" | "Remove";

export interface DaoProposal {
  id: number;
  proposer: string;
  description: string;
  kind: DaoProposalKind;
  status: DaoProposalStatus;
  submissionTime: string;
  // Per-voter record from Sputnik's `get_proposal().votes`. Empty for cache-read terminal
  // proposals (the `proposals` cache table doesn't persist votes; only the chain has them).
  votes: Record<string, DaoVoteAction>;
}

const proposalCache = new Map<string, { proposal: DaoProposal | null; expiresAt: number }>();
const PROPOSAL_TTL_MS = 15_000;
const TERMINAL_STATUSES = new Set<DaoProposalStatus>([
  "Approved",
  "Rejected",
  "Removed",
  "Expired",
  "Moved",
  "Failed",
]);

type ProposalRow = typeof proposalsTable.$inferSelect;
type NewProposalRow = typeof proposalsTable.$inferInsert;

function rowToDaoProposal(row: ProposalRow): DaoProposal {
  const kind: DaoProposalKind =
    row.kindType === "Transfer"
      ? {
          type: "Transfer",
          tokenId: row.transferTokenId ?? "",
          receiverId: row.transferReceiverId ?? "",
          amount: row.transferAmount ?? "0",
        }
      : { type: "Other", name: row.otherKindName ?? "Unknown" };
  return {
    id: row.proposalId,
    proposer: row.proposer,
    description: row.description,
    kind,
    status: row.status,
    submissionTime: row.submissionTime,
    // Cache table doesn't persist per-voter votes; downstream renders this as "no tally available."
    votes: {},
  };
}

function daoProposalToRow(daoAccountId: string, p: DaoProposal): NewProposalRow {
  return {
    daoAccountId,
    proposalId: p.id,
    proposer: p.proposer,
    description: p.description,
    status: p.status as Exclude<DaoProposalStatus, "InProgress">,
    kindType: p.kind.type,
    transferTokenId: p.kind.type === "Transfer" ? p.kind.tokenId : null,
    transferReceiverId: p.kind.type === "Transfer" ? p.kind.receiverId : null,
    transferAmount: p.kind.type === "Transfer" ? p.kind.amount : null,
    otherKindName: p.kind.type === "Other" ? p.kind.name : null,
    submissionTime: p.submissionTime,
  };
}

async function readProposalFromDb(
  db: Database,
  daoAccountId: string,
  proposalId: number,
): Promise<DaoProposal | null> {
  try {
    const rows = await db
      .select()
      .from(proposalsTable)
      .where(
        and(
          eq(proposalsTable.daoAccountId, daoAccountId),
          eq(proposalsTable.proposalId, proposalId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToDaoProposal(row) : null;
  } catch (err) {
    console.warn("[API] readProposalFromDb failed:", (err as Error).message);
    return null;
  }
}

async function persistTerminalProposals(
  db: Database,
  daoAccountId: string,
  list: DaoProposal[],
): Promise<void> {
  const rows = list
    .filter((p) => TERMINAL_STATUSES.has(p.status))
    .map((p) => daoProposalToRow(daoAccountId, p));
  if (rows.length === 0) return;
  try {
    await db.insert(proposalsTable).values(rows).onConflictDoNothing();
  } catch (err) {
    console.warn("[API] persistTerminalProposals failed:", (err as Error).message);
  }
}

function parseProposal(raw: Record<string, unknown>, fallbackId: number): DaoProposal {
  const rawKind = raw.kind as Record<string, unknown> | undefined;
  let kind: DaoProposalKind = { type: "Other", name: "Unknown" };
  if (rawKind && typeof rawKind === "object") {
    const kindName = Object.keys(rawKind)[0] ?? "Unknown";
    if (kindName === "Transfer") {
      const t = rawKind.Transfer as Record<string, unknown> | undefined;
      if (t) {
        kind = {
          type: "Transfer",
          tokenId: String(t.token_id ?? ""),
          receiverId: String(t.receiver_id ?? ""),
          amount: String(t.amount ?? "0"),
        };
      }
    } else {
      kind = { type: "Other", name: kindName };
    }
  }
  const rawVotes = raw.votes;
  const votes: Record<string, DaoVoteAction> = {};
  if (rawVotes && typeof rawVotes === "object") {
    for (const [acct, action] of Object.entries(rawVotes as Record<string, unknown>)) {
      if (action === "Approve" || action === "Reject" || action === "Remove") {
        votes[acct] = action;
      }
    }
  }
  return {
    id: typeof raw.id === "number" ? raw.id : fallbackId,
    proposer: String(raw.proposer ?? ""),
    description: String(raw.description ?? ""),
    kind,
    status: (raw.status as DaoProposalStatus) ?? "InProgress",
    submissionTime: String(raw.submission_time ?? ""),
    votes,
  };
}

export async function getProposal(
  db: Database,
  daoAccountId: string,
  proposalId: number,
): Promise<DaoProposal | null> {
  const cacheKey = `${daoAccountId}::${proposalId}`;
  const cached = proposalCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.proposal;

  const persisted = await readProposalFromDb(db, daoAccountId, proposalId);
  if (persisted) {
    proposalCache.set(cacheKey, { proposal: persisted, expiresAt: Number.POSITIVE_INFINITY });
    return persisted;
  }

  let proposal: DaoProposal | null = null;
  try {
    const raw = await viewCall<Record<string, unknown>>(
      daoAccountId,
      daoAccountId,
      "get_proposal",
      {
        id: proposalId,
      },
    );
    proposal = parseProposal(raw, proposalId);
  } catch {
    proposal = null;
  }
  const isTerminal = proposal && TERMINAL_STATUSES.has(proposal.status);
  const expiresAt = isTerminal ? Number.POSITIVE_INFINITY : Date.now() + PROPOSAL_TTL_MS;
  proposalCache.set(cacheKey, { proposal, expiresAt });
  if (isTerminal && proposal) {
    await persistTerminalProposals(db, daoAccountId, [proposal]);
  }
  return proposal;
}

export async function getLastProposalId(daoAccountId: string): Promise<number> {
  return viewCall<number>(daoAccountId, daoAccountId, "get_last_proposal_id", {});
}

export async function getProposals(
  db: Database,
  daoAccountId: string,
  fromIndex: number,
  limit: number,
): Promise<DaoProposal[]> {
  const raw = await viewCall<Array<Record<string, unknown>>>(
    daoAccountId,
    daoAccountId,
    "get_proposals",
    { from_index: fromIndex, limit },
  );
  const proposals = raw.map((r, idx) => parseProposal(r, fromIndex + idx));
  // Warm the per-proposal cache so subsequent getProposal(id) calls hit cache.
  for (const p of proposals) {
    const cacheKey = `${daoAccountId}::${p.id}`;
    const expiresAt = TERMINAL_STATUSES.has(p.status)
      ? Number.POSITIVE_INFINITY
      : Date.now() + PROPOSAL_TTL_MS;
    proposalCache.set(cacheKey, { proposal: p, expiresAt });
  }
  await persistTerminalProposals(db, daoAccountId, proposals);
  return proposals;
}

const balanceCache = new Map<string, { balance: string; expiresAt: number }>();
const BALANCE_TTL_MS = 30_000;

export interface FtMetadata {
  symbol: string;
  decimals: number;
  name: string;
  icon: string | null;
}

const ftMetadataCache = new Map<string, { metadata: FtMetadata | null; expiresAt: number }>();
const FT_METADATA_FAIL_TTL_MS = 60_000;

// Route by owner network, not contract-name suffix (`wrap.testnet` on mainnet is still mainnet).
export async function getFtMetadata(
  tokenContractId: string,
  ownerAccountId: string,
): Promise<FtMetadata | null> {
  const cacheKey = `${ownerAccountId}::${tokenContractId}`;
  const cached = ftMetadataCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.metadata;
  try {
    const raw = await viewCall<Record<string, unknown>>(
      ownerAccountId,
      tokenContractId,
      "ft_metadata",
      {},
    );
    if (typeof raw.decimals !== "number") {
      console.warn("[API] getFtMetadata: token has no decimals, treating as unknown:", cacheKey);
      ftMetadataCache.set(cacheKey, {
        metadata: null,
        expiresAt: Date.now() + FT_METADATA_FAIL_TTL_MS,
      });
      return null;
    }
    const metadata: FtMetadata = {
      symbol: String(raw.symbol ?? tokenContractId),
      decimals: raw.decimals,
      name: String(raw.name ?? tokenContractId),
      icon: typeof raw.icon === "string" ? raw.icon : null,
    };
    ftMetadataCache.set(cacheKey, { metadata, expiresAt: Number.POSITIVE_INFINITY });
    return metadata;
  } catch (err) {
    console.warn("[API] getFtMetadata failed:", cacheKey, (err as Error).message);
    ftMetadataCache.set(cacheKey, {
      metadata: null,
      expiresAt: Date.now() + FT_METADATA_FAIL_TTL_MS,
    });
    return null;
  }
}

// NEAR Foundation public RPC fallback; skipped if operator set a private override.
function publicRpcFallback(network: "mainnet" | "testnet"): string {
  return network === "testnet" ? "https://rpc.testnet.near.org" : "https://rpc.mainnet.near.org";
}

async function rpcFetch<T>(url: string, body: unknown): Promise<T> {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...fastnearAuthHeaders(url) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`NEAR RPC failed: ${response.status}`);
  const json = (await response.json()) as { error?: unknown; result?: T };
  if (json.error) throw new Error(`NEAR RPC error: ${JSON.stringify(json.error)}`);
  if (json.result === undefined) throw new Error("NEAR RPC returned no result");
  return json.result;
}

async function rpcCall<T>(accountId: string, body: unknown): Promise<T> {
  const primary = rpcUrlFor(accountId);
  try {
    return await rpcFetch<T>(primary, body);
  } catch (err) {
    const network = networkOf(accountId);
    const operatorOverride =
      network === "testnet" ? process.env.NEAR_RPC_URL_TESTNET : process.env.NEAR_RPC_URL_MAINNET;
    if (operatorOverride) throw err;
    const fallback = publicRpcFallback(network);
    console.warn(
      "[API] RPC primary failed, retrying on public NEAR RPC:",
      primary,
      "→",
      fallback,
      (err as Error).message,
    );
    return await rpcFetch<T>(fallback, body);
  }
}

// All call_function views; inner result.error must surface (else misleading EOF).
async function viewCall<T>(
  networkAccountId: string,
  contractAccountId: string,
  methodName: string,
  args: object,
): Promise<T> {
  const result = await rpcCall<{ result?: number[]; error?: string }>(networkAccountId, {
    jsonrpc: "2.0",
    id: methodName,
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: contractAccountId,
      method_name: methodName,
      args_base64: btoa(JSON.stringify(args)),
    },
  });
  if (result.error) throw new Error(result.error);
  if (!result.result) throw new Error("View call returned no result");
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result))) as T;
}

// Coerce null → "0" — some FT impls violate NEP-141's "0" contract; keeps BigInt() safe.
function coerceBalance(raw: string | number | null | undefined): string {
  return raw == null ? "0" : String(raw);
}

async function fetchAvailableNearBalance(daoAccountId: string): Promise<string> {
  return coerceBalance(
    await viewCall<string | number | null>(daoAccountId, daoAccountId, "get_available_amount", {}),
  );
}

// Route by owner network (DAO's network), not contract-name suffix.
async function fetchFtBalance(accountId: string, tokenContractId: string): Promise<string> {
  return coerceBalance(
    await viewCall<string | number | null>(accountId, tokenContractId, "ft_balance_of", {
      account_id: accountId,
    }),
  );
}

// NEP-145 storage_balance_of. Returns null when the account isn't registered for this FT.
// Native NEAR has no storage registration concept — callers should skip for NATIVE_TOKEN_ID.
export interface StorageBalance {
  total: string;
  available: string;
}
export async function getStorageBalance(
  accountId: string,
  tokenContractId: string,
): Promise<StorageBalance | null> {
  try {
    const raw = await viewCall<{ total?: string | number; available?: string | number } | null>(
      accountId,
      tokenContractId,
      "storage_balance_of",
      { account_id: accountId },
    );
    if (!raw) return null;
    return { total: coerceBalance(raw.total), available: coerceBalance(raw.available) };
  } catch (err) {
    // Some non-standard FTs omit storage_balance_of; treat the same as "no registration data".
    console.warn(
      "[API] storage_balance_of failed:",
      tokenContractId,
      (err as Error).message ?? err,
    );
    return null;
  }
}

async function getCachedBalance(cacheKey: string, fetcher: () => Promise<string>): Promise<string> {
  const cached = balanceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.balance;
  try {
    const balance = await fetcher();
    balanceCache.set(cacheKey, { balance, expiresAt: Date.now() + BALANCE_TTL_MS });
    return balance;
  } catch (err) {
    // Stale-while-error: serve last successful balance when RPC fails (rate limits, transient downtime).
    if (cached) {
      console.warn("[API] getCachedBalance using stale cache:", cacheKey, (err as Error).message);
      return cached.balance;
    }
    throw err;
  }
}

// FT holdings via FastNEAR's account-ft REST (Sputnik has no FT-inventory view).
interface FtHoldingsCacheEntry {
  ids: string[];
  expiresAt: number;
}
const ftHoldingsCache = new Map<string, FtHoldingsCacheEntry>();
const FT_HOLDINGS_TTL_MS = 60_000;

function fastnearApiBase(accountId: string): string {
  return networkOf(accountId) === "testnet"
    ? "https://test.api.fastnear.com"
    : "https://api.fastnear.com";
}

interface FastnearAccountFtResponse {
  tokens?: Array<{ contract_id: string; balance: string }>;
}

async function fetchAccountFtHoldings(accountId: string): Promise<string[]> {
  const url = `${fastnearApiBase(accountId)}/v1/account/${accountId}/ft`;
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: fastnearAuthHeaders(url),
  });
  if (!response.ok) throw new Error(`FastNEAR account-ft failed: ${response.status}`);
  const data = (await response.json()) as FastnearAccountFtResponse;
  return (data.tokens ?? [])
    .filter((t) => {
      if (!t.balance) return false;
      try {
        return BigInt(t.balance) > 0n;
      } catch {
        return false;
      }
    })
    .map((t) => t.contract_id);
}

export async function getDaoTokenIds(daoAccountId: string): Promise<string[]> {
  const cached = ftHoldingsCache.get(daoAccountId);
  if (cached && cached.expiresAt > Date.now()) return cached.ids;
  try {
    const fts = await fetchAccountFtHoldings(daoAccountId);
    const ids = [NATIVE_TOKEN_ID, ...fts];
    ftHoldingsCache.set(daoAccountId, { ids, expiresAt: Date.now() + FT_HOLDINGS_TTL_MS });
    return ids;
  } catch (err) {
    // Stale-while-error: serve last successful result on transient failure.
    if (cached) {
      console.warn("[API] getDaoTokenIds using stale cache:", daoAccountId, (err as Error).message);
      return cached.ids;
    }
    console.warn("[API] getDaoTokenIds failed:", (err as Error).message);
    return [NATIVE_TOKEN_ID];
  }
}

export async function getTreasuryBalances(
  daoAccountId: string,
  tokenIds: string[],
): Promise<Record<string, string>> {
  // allSettled so one token's RPC failure (rate limit, missing contract) doesn't crash the batch.
  const settled = await Promise.allSettled(
    tokenIds.map(async (tokenId) => {
      const isNative = tokenId === NATIVE_TOKEN_ID || tokenId === "NEAR";
      const cacheKey = `${daoAccountId}::${tokenId}`;
      const balance = await getCachedBalance(cacheKey, () =>
        isNative ? fetchAvailableNearBalance(daoAccountId) : fetchFtBalance(daoAccountId, tokenId),
      );
      return [tokenId, balance] as const;
    }),
  );
  const result: Record<string, string> = {};
  tokenIds.forEach((tokenId, i) => {
    const outcome = settled[i];
    if (outcome && outcome.status === "fulfilled") {
      result[tokenId] = outcome.value[1];
    } else {
      const reason = outcome && outcome.status === "rejected" ? outcome.reason : undefined;
      console.warn(
        "[API] getTreasuryBalances skipped token:",
        tokenId,
        (reason as Error)?.message ?? reason,
      );
      result[tokenId] = "0";
    }
  });
  return result;
}

export async function enrichWithChainStatus<T extends { proposalId: string }>(
  db: Database,
  b: T,
  orgAccountId: string,
): Promise<T & { status: DaoProposalStatus }> {
  const proposalId = Number.parseInt(b.proposalId, 10);
  if (Number.isNaN(proposalId)) return { ...b, status: "InProgress" as const };
  const proposal = await getProposal(db, orgAccountId, proposalId);
  const status = (proposal?.status ?? "InProgress") as DaoProposalStatus;
  return { ...b, status };
}
