import { Link } from "@tanstack/react-router";
import { Badge, Button, Card, CardContent } from "@/components";

function isAccessError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "FORBIDDEN" || code === "UNAUTHORIZED";
}

function isNoOrgContext(error: unknown): boolean {
  if (!isAccessError(error)) return false;
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  return message.toLowerCase().includes("organization required");
}

export function AdminError({ error }: { error: unknown }) {
  const isAccess = isAccessError(error);
  const noOrg = isNoOrgContext(error);
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";

  return (
    <Card>
      <CardContent className="p-8 text-center space-y-3">
        <Badge variant="outline">{isAccess ? "access denied" : "could not load"}</Badge>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          {noOrg
            ? "This org hasn't been set up yet. Create it in the platform admin to enable member management, settings, and projects."
            : isAccess
              ? message || "You don't have access to this surface."
              : "We couldn't load this data. Try again, or check the API logs if this keeps happening."}
        </p>
        {!isAccess && message && (
          <pre className="text-xs font-mono text-muted-foreground bg-muted/20 p-2 rounded-sm break-all whitespace-pre-wrap max-w-md mx-auto">
            {message}
          </pre>
        )}
        <div className="flex gap-2 justify-center">
          {noOrg && (
            <Button asChild size="sm">
              <Link to="/platform">set up org</Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to="/">back to home</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
