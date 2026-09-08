import { queryOptions } from "@tanstack/react-query";
import type { AuthClient } from "./auth";

export type NearProfile = {
  name?: string;
  description?: string;
  image?: { url?: string; ipfs_cid?: string };
};

export function nearProfileQueryOptions(
  authClient: Pick<AuthClient, "near">,
  accountId: string | null | undefined,
) {
  return queryOptions({
    queryKey: ["me", "near-profile", accountId ?? null] as const,
    queryFn: async (): Promise<NearProfile | null> => {
      if (!accountId) return null;
      const res = await authClient.near.getProfile(accountId);
      return res?.data ?? null;
    },
    enabled: !!accountId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
