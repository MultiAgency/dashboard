import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_authenticated/admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/projects" });
  },
});
