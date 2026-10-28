import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/applications/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/contributors", search: { tab: "incoming" } });
  },
});
