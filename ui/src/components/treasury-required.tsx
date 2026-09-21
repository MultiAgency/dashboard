import type { ReactNode } from "react";
import { Card, CardContent } from "@/components";
import { useMeRoles } from "@/hooks";

export function TreasuryRequired({ children }: { children: ReactNode }) {
  const { hasAgencyDao, isLoaded } = useMeRoles();
  if (!isLoaded || hasAgencyDao) return <>{children}</>;
  return (
    <Card>
      <CardContent className="space-y-2">
        <h2 className="font-display text-xl uppercase tracking-tight font-extrabold">
          Connect a treasury
        </h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Budgets, billings and prepayments need an Agency DAO. Create a treasury on Trezu (a
          single-member one works) and ask a platform admin to link it to your Organization.
        </p>
        <a
          href="https://trezu.app"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm underline underline-offset-2 hover:text-foreground"
        >
          open Trezu
        </a>
      </CardContent>
    </Card>
  );
}
