import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_authenticated/client-forbidden")({
  component: ClientForbiddenPage,
});

function ClientForbiddenPage() {
  return (
    <div className="mx-auto max-w-lg space-y-4 py-12 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        client portal · 403
      </p>
      <h1 className="font-display text-3xl font-black uppercase tracking-tight">No agencies yet</h1>
      <p className="text-sm text-muted-foreground">
        Your active Organization has no Engagement with an agency. Switch Organization in the
        header, or ask your agency to invite you.
      </p>
      <Link to="/" className="inline-block text-sm underline underline-offset-2">
        Back to home
      </Link>
    </div>
  );
}
