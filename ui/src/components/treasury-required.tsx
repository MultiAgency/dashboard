import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent, Input, Spinner } from "@/components";
import { useMeRoles } from "@/hooks";
import { useApiClient } from "@/lib/api";
import { invalidateOrganizationQueries } from "@/lib/queries";

export function TreasuryRequired({ children }: { children: ReactNode }) {
  const { hasAgencyDao, isLoaded } = useMeRoles();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [daoAccountId, setDaoAccountId] = useState("");
  const connect = useMutation({
    mutationFn: () => apiClient.organizationTreasury.connect({ daoAccountId: daoAccountId.trim() }),
    onSuccess: async () => {
      toast.success("Treasury connected");
      await invalidateOrganizationQueries(queryClient, router);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (daoAccountId.trim()) connect.mutate();
  };

  if (!isLoaded) return <Spinner />;
  if (hasAgencyDao) return <>{children}</>;
  return (
    <Card>
      <CardContent className="space-y-2">
        <h2 className="font-display text-xl uppercase tracking-tight font-extrabold">
          Connect a treasury
        </h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Budgets, billings and prepayments need an Agency DAO. Create a treasury on Trezu (a
          single-member one works), link its member wallet on your Profile, then connect it here.
        </p>
        <a
          href="https://trezu.app"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm underline underline-offset-2 hover:text-foreground"
        >
          open Trezu
        </a>
        <p className="text-sm text-muted-foreground">
          <Link to="/profile" className="underline underline-offset-2 hover:text-foreground">
            Link a NEAR wallet
          </Link>
        </p>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
          <Input
            aria-label="Agency DAO account"
            placeholder="your-treasury.sputnik-dao.near"
            value={daoAccountId}
            onChange={(event) => setDaoAccountId(event.target.value)}
            required
          />
          <Button type="submit" disabled={connect.isPending || !daoAccountId.trim()}>
            {connect.isPending ? "connecting..." : "connect treasury"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
