import { useQuery } from "@tanstack/react-query";
import { useAuthClient } from "@/app";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { sessionQueryOptions } from "@/lib/auth";

export function NetworkToggle({ label }: { label?: string }) {
  const auth = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(auth));
  const supportedNetworks = auth.near.getSupportedNetworks();
  const currentNetwork = auth.useActiveNetwork();

  if (session?.user) return null;
  if (supportedNetworks.length <= 1) return null;

  const toggle = (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={currentNetwork}
      onValueChange={(network) => {
        if (network) auth.near.setNetwork(network as typeof currentNetwork);
      }}
      aria-label="NEAR network"
    >
      {supportedNetworks.map((network) => (
        <ToggleGroupItem key={network} value={network} aria-label={network}>
          <span className="sm:hidden">{network === "mainnet" ? "Main" : "Test"}</span>
          <span className="hidden sm:inline">{network === "mainnet" ? "Mainnet" : "Testnet"}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );

  if (!label) return toggle;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {toggle}
    </div>
  );
}
