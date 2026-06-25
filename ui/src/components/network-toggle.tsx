import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useApiClient, useAuthClient } from "@/app";
import { sessionQueryOptions } from "@/lib/auth";
import { publicSettingsQueryOptions } from "@/lib/queries";

const NETWORK_COOKIE = "current_near_network";

type Network = "mainnet" | "testnet";

export function NetworkToggle() {
  // Skip SSR — cookie/URL-driven hydration risks class mismatch with runtime config.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const { data: publicSettings } = useQuery(publicSettingsQueryOptions(apiClient));

  if (!mounted) return null;
  // Server pin (NEAR_NETWORK env set) forces single-network mode.
  if (publicSettings?.networkPinned) return null;

  const current = authClient.near.getNetwork();

  // Signed in: wallet network IS the network; sign out to switch.
  if (session?.user) return null;

  return (
    <fieldset className="inline-flex items-center gap-0 font-mono text-[10px] uppercase tracking-wide border border-border rounded-sm overflow-hidden">
      <legend className="sr-only">NEAR network</legend>
      <NetworkOption value="mainnet" current={current} label="mainnet" />
      <NetworkOption value="testnet" current={current} label="testnet" />
    </fieldset>
  );
}

function NetworkOption({
  value,
  current,
  label,
}: {
  value: Network;
  current: Network;
  label: string;
}) {
  const authClient = useAuthClient();
  const active = value === current;
  const id = `network-${value}`;
  const handleChange = useCallback(() => {
    authClient.near.setNetwork(value);
    // biome-ignore lint/suspicious/noDocumentCookie: carries network to server for settings/DAO routing
    document.cookie = `${NETWORK_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax; secure`;
  }, [authClient, value]);
  return (
    <>
      <input
        type="radio"
        id={id}
        name="agency-network"
        value={value}
        checked={active}
        onChange={handleChange}
        className="sr-only peer"
      />
      <label
        htmlFor={id}
        className={
          active
            ? "px-2 h-6 inline-flex items-center bg-foreground text-background cursor-pointer"
            : "px-2 h-6 inline-flex items-center bg-transparent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        }
      >
        {label}
      </label>
    </>
  );
}
