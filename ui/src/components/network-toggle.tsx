import { GlobeIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useAuthClient } from "@/app";
import { sessionQueryOptions } from "@/lib/auth";

export function NetworkToggle() {
  const auth = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(auth));
  const supportedNetworks = auth.near.getSupportedNetworks();
  const currentNetwork = auth.useActiveNetwork();

  if (session?.user) return null;
  if (supportedNetworks.length <= 1) return null;

  return (
    <div className="flex h-7 items-center gap-0.5 border border-border bg-muted/30 p-0.5">
      {supportedNetworks.map((network) => (
        <button
          type="button"
          key={network}
          onClick={() => {
            auth.near.setNetwork(network);
          }}
          aria-pressed={currentNetwork === network}
          className={`flex h-full items-center gap-1.5 px-2 text-xs font-medium leading-none transition-colors ${
            currentNetwork === network
              ? "bg-background text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <GlobeIcon aria-hidden className="hidden size-3 sm:block" />
          <span className="sm:hidden">{network === "mainnet" ? "Main" : "Test"}</span>
          <span className="hidden sm:inline">{network === "mainnet" ? "Mainnet" : "Testnet"}</span>
        </button>
      ))}
    </div>
  );
}
