import { LockIcon, WarningCircleIcon } from "@phosphor-icons/react";
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
import { ConnectTreasuryPrompt } from "@/components/connect-treasury-prompt";
import { needsTreasury } from "@/lib/treasury";

function isAccessError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "FORBIDDEN" || code === "UNAUTHORIZED";
}

function errorMessage(error: unknown): string {
  return typeof error === "object" && error && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : "";
}

function isNoOrgContext(error: unknown): boolean {
  if (!isAccessError(error)) return false;
  const lower = errorMessage(error).toLowerCase();
  return lower.includes("organization required") || lower.includes("workspace required");
}

export function AdminError({ error }: { error: unknown }) {
  if (needsTreasury(error)) return <ConnectTreasuryPrompt />;
  const isAccess = isAccessError(error);
  const noOrg = isNoOrgContext(error);
  const message = errorMessage(error);

  return (
    <Empty variant="outline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {isAccess ? <LockIcon aria-hidden /> : <WarningCircleIcon aria-hidden />}
        </EmptyMedia>
        <EmptyTitle>
          {noOrg ? "Workspace not set up" : isAccess ? "Access denied" : "Could not load"}
        </EmptyTitle>
        <EmptyDescription>
          {noOrg
            ? "This workspace hasn't been set up yet. Create it in the platform admin to enable member management, settings, and projects."
            : isAccess
              ? message || "You don't have access to this surface."
              : message ||
                "We couldn't load this data. Try again, or check the API logs if this keeps happening."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap justify-center gap-2">
          {noOrg && (
            <Button asChild size="sm">
              <Link to="/platform">Set up workspace</Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to="/">Back to home</Link>
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  );
}
