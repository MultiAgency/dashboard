import { fetchWithTimeout } from "./fetch";

const NEAR_RPC_URL = process.env.NEAR_RPC_URL ?? "https://rpc.mainnet.near.org";
const POLICY_TTL_MS = 60_000;

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
    const response = await fetchWithTimeout(NEAR_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "policy",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: daoAccountId,
          method_name: "get_policy",
          args_base64: btoa("{}"),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`NEAR RPC failed: ${response.status}`);
    }

    const json = (await response.json()) as {
      error?: unknown;
      result?: { result: number[] };
    };

    if (json.error) {
      throw new Error(`NEAR RPC error: ${JSON.stringify(json.error)}`);
    }
    if (!json.result?.result) {
      throw new Error("NEAR RPC returned no result");
    }

    const text = new TextDecoder().decode(new Uint8Array(json.result.result));
    const policy = JSON.parse(text) as SputnikPolicy;

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
  daoAccountId: string,
  accountId: string,
  roleName: string,
): Promise<boolean> {
  const roles = await getRoles(daoAccountId);
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

export interface DaoProposal {
  id: number;
  proposer: string;
  description: string;
  kind: DaoProposalKind;
  status: DaoProposalStatus;
  submissionTime: string;
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
  return {
    id: typeof raw.id === "number" ? raw.id : fallbackId,
    proposer: String(raw.proposer ?? ""),
    description: String(raw.description ?? ""),
    kind,
    status: (raw.status as DaoProposalStatus) ?? "InProgress",
    submissionTime: String(raw.submission_time ?? ""),
  };
}

export async function getProposal(
  daoAccountId: string,
  proposalId: number,
): Promise<DaoProposal | null> {
  const cacheKey = `${daoAccountId}::${proposalId}`;
  const cached = proposalCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.proposal;

  let proposal: DaoProposal | null = null;
  try {
    const result = await rpcCall<{ result: number[] }>({
      jsonrpc: "2.0",
      id: "proposal",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: daoAccountId,
        method_name: "get_proposal",
        args_base64: btoa(JSON.stringify({ id: proposalId })),
      },
    });
    const text = new TextDecoder().decode(new Uint8Array(result.result));
    const raw = JSON.parse(text) as Record<string, unknown>;
    proposal = parseProposal(raw, proposalId);
  } catch {
    proposal = null;
  }
  const expiresAt =
    proposal && TERMINAL_STATUSES.has(proposal.status)
      ? Number.POSITIVE_INFINITY
      : Date.now() + PROPOSAL_TTL_MS;
  proposalCache.set(cacheKey, { proposal, expiresAt });
  return proposal;
}

export async function getLastProposalId(daoAccountId: string): Promise<number> {
  const result = await rpcCall<{ result: number[] }>({
    jsonrpc: "2.0",
    id: "last-proposal",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: daoAccountId,
      method_name: "get_last_proposal_id",
      args_base64: btoa("{}"),
    },
  });
  const text = new TextDecoder().decode(new Uint8Array(result.result));
  return JSON.parse(text) as number;
}

export async function getProposals(
  daoAccountId: string,
  fromIndex: number,
  limit: number,
): Promise<DaoProposal[]> {
  const result = await rpcCall<{ result: number[] }>({
    jsonrpc: "2.0",
    id: "proposals",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: daoAccountId,
      method_name: "get_proposals",
      args_base64: btoa(JSON.stringify({ from_index: fromIndex, limit })),
    },
  });
  const text = new TextDecoder().decode(new Uint8Array(result.result));
  const raw = JSON.parse(text) as Array<Record<string, unknown>>;
  const proposals = raw.map((r, idx) => parseProposal(r, fromIndex + idx));
  // Warm the per-proposal cache so subsequent getProposal(id) calls hit cache.
  for (const p of proposals) {
    const cacheKey = `${daoAccountId}::${p.id}`;
    const expiresAt = TERMINAL_STATUSES.has(p.status)
      ? Number.POSITIVE_INFINITY
      : Date.now() + PROPOSAL_TTL_MS;
    proposalCache.set(cacheKey, { proposal: p, expiresAt });
  }
  return proposals;
}

const balanceCache = new Map<string, { balance: string; expiresAt: number }>();
const BALANCE_TTL_MS = 30_000;

async function rpcCall<T>(body: unknown): Promise<T> {
  const response = await fetchWithTimeout(NEAR_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`NEAR RPC failed: ${response.status}`);
  const json = (await response.json()) as { error?: unknown; result?: T };
  if (json.error) throw new Error(`NEAR RPC error: ${JSON.stringify(json.error)}`);
  if (json.result === undefined) throw new Error("NEAR RPC returned no result");
  return json.result;
}

function decodeViewResult(result: { result?: number[]; error?: string }): string {
  // call_function errors surface inside result.error, not at the JSON-RPC top level.
  if (result.error) throw new Error(result.error);
  if (!result.result) throw new Error("View call returned no result");
  return new TextDecoder().decode(new Uint8Array(result.result));
}

async function fetchAvailableNearBalance(daoAccountId: string): Promise<string> {
  const result = await rpcCall<{ result?: number[]; error?: string }>({
    jsonrpc: "2.0",
    id: "available",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: daoAccountId,
      method_name: "get_available_amount",
      args_base64: btoa("{}"),
    },
  });
  // Coerce to string — older Sputnik deployments may JSON-encode u128 as number.
  return String(JSON.parse(decodeViewResult(result)));
}

async function fetchFtBalance(accountId: string, tokenContractId: string): Promise<string> {
  const args = btoa(JSON.stringify({ account_id: accountId }));
  const result = await rpcCall<{ result?: number[]; error?: string }>({
    jsonrpc: "2.0",
    id: "ft_balance",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: tokenContractId,
      method_name: "ft_balance_of",
      args_base64: args,
    },
  });
  return String(JSON.parse(decodeViewResult(result)));
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

export async function getTreasuryBalances(
  daoAccountId: string,
  tokenIds: string[],
): Promise<Record<string, string>> {
  // allSettled so one token's RPC failure (rate limit, missing contract) doesn't crash the batch.
  const settled = await Promise.allSettled(
    tokenIds.map(async (tokenId) => {
      const isNative = tokenId === "near" || tokenId === "NEAR";
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
