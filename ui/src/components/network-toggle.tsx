import { useQuery } from "@tanstack/react-query";
import { Globe } from "lucide-react";
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
    <div className="flex items-center gap-2 p-1 border border-border rounded-lg bg-muted/30">
      {supportedNetworks.map((network) => (
        <button
          type="button"
          key={network}
          onClick={() => {
            auth.near.setNetwork(network);
          }}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            currentNetwork === network
              ? "bg-background text-foreground shadow-sm border border-border/50"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Globe className="h-3 w-3" />
            {network === "mainnet" ? "Mainnet" : "Testnet"}
          </span>
        </button>
      ))}
    </div>
  );
}
