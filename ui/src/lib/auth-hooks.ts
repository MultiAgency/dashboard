import { useQuery } from "@tanstack/react-query";
import { type ClientRuntimeConfig, getAuthClient } from "@/app";

export function useRelayHistory(session: any, runtimeConfig?: Partial<ClientRuntimeConfig>) {
  return useQuery({
    queryKey: ["relay-history"],
    queryFn: async () => {
      const res = await getAuthClient(runtimeConfig).near.relayHistory();
      if (res.error) {
        console.error("relayHistory error:", res.error);
      }
      return res?.data?.transactions ?? [];
    },
    enabled: !!session,
    refetchInterval: 2000,
  });
}
