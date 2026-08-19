import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_authenticated/client/forbidden")({
  component: ClientForbiddenPage,
});

function ClientForbiddenPage() {
  return (
    <div className="mx-auto max-w-lg space-y-4 py-12 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        client portal · 403
      </p>
      <h1 className="font-display text-3xl font-black uppercase tracking-tight">Not a client</h1>
      <p className="text-sm text-muted-foreground">
        This NEAR wallet is not linked to a client record. Ask your agency to add your NEAR account
        under Admin → Clients, then sign in again.
      </p>
      <Link to="/" className="inline-block text-sm underline underline-offset-2">
        Back to home
      </Link>
    </div>
  );
}
