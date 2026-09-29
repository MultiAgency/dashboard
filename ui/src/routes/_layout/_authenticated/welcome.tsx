import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuthClient } from "@/app";
import { Card, CardContent } from "@/components";
import { CreateOrganizationForm } from "@/components/create-organization-form";
import { PendingInvitationsList } from "@/components/pending-invitations";
import { landingDestination, WELCOME_PATH } from "@/lib/account";
import { useApiClient } from "@/lib/api";

export const Route = createFileRoute("/_layout/_authenticated/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome" },
      { name: "description", content: "Your invitations and Organizations." },
    ],
  }),
  component: WelcomePage,
});

function WelcomePage() {
  const authClient = useAuthClient();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const landing = useQuery({
    queryKey: ["landing"],
    queryFn: () => landingDestination({ authClient, apiClient, queryClient }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  useEffect(() => {
    if (landing.data && landing.data !== WELCOME_PATH) {
      void navigate({ to: landing.data, replace: true });
    }
  }, [landing.data, navigate]);

  if (landing.isLoading || (landing.data && landing.data !== WELCOME_PATH)) {
    return (
      <Card>
        <CardContent className="text-center font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
          opening your workspace...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          get · started
        </div>
        <h1 className="font-display text-4xl sm:text-6xl font-black uppercase leading-none tracking-tight">
          Welcome
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          You are not a member of any Organization yet. Accept an invitation below to join one, or
          create your own. If you are expecting an invitation, ask an owner or admin of that
          Organization to send it to the email on your Profile.
        </p>
      </header>

      <section className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          pending invitations
        </div>
        <PendingInvitationsList />
      </section>

      <section className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          create an organization
        </div>
        <Card>
          <CardContent className="p-5">
            <CreateOrganizationForm />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
