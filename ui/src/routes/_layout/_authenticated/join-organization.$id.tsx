import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useApiClient, useAuthClient } from "@/app";
import { Button, Card, CardContent } from "@/components";
import { listOrganizations, switchOrganization } from "@/lib/organizations";
import { invalidateOrganizationQueries } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/join-organization/$id")({
  head: () => ({ meta: [{ title: "Join Organization" }] }),
  component: JoinOrganization,
});

function JoinOrganization() {
  const { id } = Route.useParams();
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const requestsQuery = useQuery({
    queryKey: ["organization-join-requests", "mine"],
    queryFn: () => apiClient.organizationJoinRequests.mine(),
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
  });
  const organizationsQuery = useQuery({
    queryKey: ["organizations", "list"],
    queryFn: () => listOrganizations(authClient),
  });
  const request = requestsQuery.data?.data.find((item) => item.organizationId === id);
  const isMember = organizationsQuery.data?.some((organization) => organization.id === id) ?? false;

  const join = useMutation({
    mutationFn: () => apiClient.organizationJoinRequests.request({ organizationId: id }),
    onSuccess: async () => {
      toast.success("Join request sent to the Organization admins");
      await queryClient.invalidateQueries({ queryKey: ["organization-join-requests", "mine"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const open = useMutation({
    mutationFn: async () => {
      if (!(await switchOrganization(authClient, id))) {
        throw new Error("Could not open Organization. Try signing in again.");
      }
    },
    onSuccess: async () => {
      await invalidateOrganizationQueries(queryClient, router);
      navigate({ to: "/admin/projects" });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card className="mx-auto mt-12 max-w-lg">
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <h1 className="font-display text-2xl uppercase tracking-tight font-extrabold">
            Join an Organization
          </h1>
          <p className="text-sm text-muted-foreground">
            Request access to this Organization. Its admins will review your request on their Team
            page. You can sign in with NEAR; an email invitation is not required.
          </p>
          <p className="break-all font-mono text-xs text-muted-foreground">{id}</p>
        </div>
        {requestsQuery.isError && (
          <p className="text-sm text-destructive">Could not load your join requests.</p>
        )}
        {isMember ? (
          <Button onClick={() => open.mutate()} disabled={open.isPending}>
            {open.isPending ? "opening..." : "open Organization"}
          </Button>
        ) : request?.status === "pending" ? (
          <p className="text-sm">Your request is waiting for an admin.</p>
        ) : request?.status === "approved" ? (
          <Button onClick={() => open.mutate()} disabled={open.isPending}>
            {open.isPending ? "opening..." : "open Organization"}
          </Button>
        ) : (
          <Button
            onClick={() => join.mutate()}
            disabled={join.isPending || requestsQuery.isLoading || organizationsQuery.isLoading}
          >
            {join.isPending ? "requesting..." : "request to join"}
          </Button>
        )}
        <p className="text-sm text-muted-foreground">
          You can also find your requests and invitations on your{" "}
          <Link to="/profile" hash="organizations" className="underline underline-offset-2">
            Profile
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
