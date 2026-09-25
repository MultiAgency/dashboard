import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuthClient } from "@/app";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "@/components";
import { CreateOrganizationForm } from "@/components/create-organization-form";
import { LoadingCard } from "@/components/loading-card";
import { PageHeader } from "@/components/page-header";
import { PendingInvitationsList } from "@/components/pending-invitations";
import { landingDestination, WELCOME_PATH } from "@/lib/account";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions } from "@/lib/auth";
import { realEmail } from "@/lib/membership";

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
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const email = realEmail(session?.user?.email);

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
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-3 w-3/4" />
        </div>
        <LoadingCard label="your workspace" rows={2} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl animate-fade-in flex-col gap-6">
      <PageHeader
        title="Welcome to MultiAgency"
        description="You're not in an Organization yet. Join one you were invited to, or create your own."
      />

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Join an Organization</h2>
          </CardTitle>
          <CardDescription>Accept an invitation to work with an existing team.</CardDescription>
        </CardHeader>
        <CardContent>
          <PendingInvitationsList
            emptyDescription={
              email ? (
                <>
                  Ask an owner or admin to invite{" "}
                  <span className="font-medium break-all text-foreground">{email}</span>.
                  Invitations show up here.
                </>
              ) : (
                "Add an email on your Profile, then ask an owner or admin to invite it."
              )
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Create an Organization</h2>
          </CardTitle>
          <CardDescription>
            You become its owner and can invite your team. Connect a treasury later in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateOrganizationForm />
        </CardContent>
      </Card>
    </div>
  );
}
