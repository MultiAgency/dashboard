import { VaultIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components";
import { useMeRoles } from "@/hooks/use-me-roles";

export function ConnectTreasuryPrompt() {
  const { canAccessAdmin } = useMeRoles();

  return (
    <Empty variant="outline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <VaultIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>Connect a treasury</EmptyTitle>
        <EmptyDescription>
          Budgets, Billings and treasury views need an Agency DAO, such as a single-member Trezu
          treasury.{" "}
          {canAccessAdmin
            ? "Connect one in the Treasury section of Settings."
            : "Ask an owner or admin of your Organization to connect one in the Treasury section of Settings."}
        </EmptyDescription>
      </EmptyHeader>
      {canAccessAdmin && (
        <EmptyContent>
          <Button asChild size="sm">
            <Link to="/admin/settings" hash="treasury">
              Connect a treasury
            </Link>
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
