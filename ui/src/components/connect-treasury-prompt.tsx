import { Link } from "@tanstack/react-router";
import { Badge, Button, Card, CardContent } from "@/components";
import { useMeRoles } from "@/hooks/use-me-roles";

export function ConnectTreasuryPrompt() {
  const { canAccessAdmin } = useMeRoles();

  return (
    <Card>
      <CardContent className="p-8 text-center space-y-3">
        <Badge variant="outline">connect a treasury</Badge>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Budgets, Billings and treasury views need an Agency DAO, such as a single-member Trezu
          treasury.{" "}
          {canAccessAdmin
            ? "Connect one in Settings → Treasury."
            : "Ask an owner or admin of your Organization to connect one in Settings → Treasury."}
        </p>
        {canAccessAdmin && (
          <Button asChild size="sm">
            <Link to="/admin/settings" hash="treasury">
              connect a treasury
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
