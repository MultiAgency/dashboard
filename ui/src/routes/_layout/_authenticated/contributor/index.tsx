import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_authenticated/contributor/")({
  component: ContributorHome,
});

function ContributorHome() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Contributor Portal</h1>
      <p className="text-muted-foreground">
        View your assigned projects, billings, and contributions.
      </p>
    </div>
  );
}
