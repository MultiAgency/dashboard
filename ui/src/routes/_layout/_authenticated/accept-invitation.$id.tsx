import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Button, Card, CardContent } from "@/components";
import { sessionQueryKey } from "@/lib/auth";
import { completeClientHandover } from "@/lib/client-handover";
import { userInvitationsQueryKey } from "@/lib/invitations";
import { meRolesQueryKey } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/accept-invitation/$id")({
  head: () => ({ meta: [{ title: "Accept invitation" }] }),
  component: AcceptInvitation,
});

function AcceptInvitation() {
  const { id } = Route.useParams();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: invitation, isLoading } = useQuery({
    queryKey: ["invitation", id],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getInvitation({ query: { id } });
      if (error) {
        if (error.status === 400 || error.status === 403 || error.status === 404) return null;
        throw new Error(error.message || "Failed to load invitation");
      }
      return data;
    },
    retry: false,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["organizations"] }),
      queryClient.invalidateQueries({ queryKey: userInvitationsQueryKey }),
      queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
      queryClient.invalidateQueries({ queryKey: meRolesQueryKey }),
    ]);

  const accept = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.acceptInvitation({ invitationId: id });
      if (error) throw new Error(error.message || "Failed to accept invitation");
      if (invitation?.organizationId) {
        const activated = await authClient.organization.setActive({
          organizationId: invitation.organizationId,
        });
        if (activated.error) return { activated: false, handoverPending: false };
        if (invitation.role === "owner") {
          try {
            const { data: session } = await authClient.getSession();
            if (!session?.user?.id) throw new Error("Could not load your session");
            await completeClientHandover(authClient, invitation.organizationId, session.user.id);
          } catch {
            return { activated: true, handoverPending: true };
          }
        }
        return { activated: true, handoverPending: false };
      }
      return { activated: false, handoverPending: false };
    },
    onSuccess: async ({ activated, handoverPending }) => {
      if (handoverPending) {
        toast.warning("Invitation accepted. Complete Client handover on the Team page.");
      } else if (activated) toast.success("Invitation accepted");
      else toast.warning("Invitation accepted. Select the Organization from the menu to open it.");
      await refresh();
      navigate({
        to: activated
          ? handoverPending
            ? "/admin/members"
            : invitation?.role === "owner"
              ? "/admin/engagements"
              : "/admin/projects"
          : "/",
        replace: true,
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const decline = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.rejectInvitation({ invitationId: id });
      if (error) throw new Error(error.message || "Failed to decline invitation");
    },
    onSuccess: async () => {
      toast.success("Invitation declined");
      await refresh();
      navigate({ to: "/", replace: true });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) {
    return (
      <p className="mt-12 text-center font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
        loading invitation...
      </p>
    );
  }

  if (!invitation) {
    return (
      <Card className="max-w-md mx-auto mt-12">
        <CardContent className="space-y-4 text-center">
          <p className="text-sm">
            This invitation doesn't exist, has expired, or was sent to a different email address.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/">go home</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const pending = accept.isPending || decline.isPending;

  return (
    <Card className="max-w-md mx-auto mt-12">
      <CardContent className="space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="font-display text-2xl uppercase tracking-tight font-extrabold">
            You've been invited
          </h1>
          <p className="text-sm text-muted-foreground">
            Join{" "}
            <span className="font-medium text-foreground">
              {invitation.organizationName ?? invitation.organizationSlug}
            </span>{" "}
            as <span className="font-mono">{invitation.role ?? "member"}</span>.
          </p>
        </div>
        <div className="flex justify-center gap-3">
          <Button size="sm" onClick={() => accept.mutate()} disabled={pending}>
            {accept.isPending ? "accepting..." : "accept"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => decline.mutate()} disabled={pending}>
            {decline.isPending ? "declining..." : "decline"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
