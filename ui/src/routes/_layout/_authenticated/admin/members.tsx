import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_authenticated/admin/members")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/settings", search: { tab: "members" } });
  },
});
