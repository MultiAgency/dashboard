import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import {
  Button,
  Card,
  CardContent,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components";
import { PrepaymentsPanel } from "@/components/admin/prepayments-panel";
import { AdminError } from "@/components/admin-error";
import { Empty, Field, Loading, selectClass } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  EngagementStatusBadge,
  type EngagementView,
  InvitationStatusBadge,
} from "@/components/engagement-status";
import { useEngagementAction } from "@/hooks/use-engagement-action";
import { useApiClient } from "@/lib/api";
import { adminProjectsListQueryOptions, engagementDetailQueryOptions } from "@/lib/queries";

const engagementSearchSchema = z.object({
  tab: z.enum(["projects", "prepayments"]).optional().catch("projects"),
});

export const Route = createFileRoute("/_layout/_authenticated/admin/engagements/$engagementId")({
  validateSearch: engagementSearchSchema,
  head: () => ({
    meta: [
      { title: "Engagement" },
      { name: "description", content: "An Engagement with a Client." },
    ],
  }),
  component: EngagementDetailPage,
});

function EngagementDetailPage() {
  const { engagementId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const apiClient = useApiClient();
  const engagementQuery = useQuery(engagementDetailQueryOptions(apiClient, engagementId));
  const [confirmEnd, setConfirmEnd] = useState(false);
  const end = useEngagementAction(
    () => apiClient.engagements.end({ id: engagementId }),
    "Engagement ended",
  );

  if (engagementQuery.isLoading) return <Loading label="Loading engagement" />;
  if (engagementQuery.isError) return <AdminError error={engagementQuery.error} />;
  const engagement = engagementQuery.data;
  if (!engagement) return null;
  const endable =
    engagement.status === "active" ||
    (engagement.status === "proposed" && engagement.side === "agency");

  return (
    <div className="space-y-8">
      <div>
        <Link
          to="/admin/engagements"
          className="text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          ← engagements
        </Link>
      </div>
      <header className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <EngagementStatusBadge status={engagement.status} />
          {engagement.invitation && <InvitationStatusBadge invitation={engagement.invitation} />}
        </div>
        <h1 className="font-display text-3xl font-black uppercase tracking-tight">
          {engagement.client.name}
        </h1>
        <p className="font-mono text-xs text-muted-foreground">@{engagement.client.slug}</p>
        {engagement.status === "ended" && (
          <p className="text-sm text-muted-foreground">
            This Engagement ended. Its shared Projects stay visible to the Client as read-only
            history, and nothing new can be shared through it.
          </p>
        )}
        {engagement.status === "proposed" && (
          <p className="text-sm text-muted-foreground">
            Waiting for {engagement.client.name} to accept or decline.
          </p>
        )}
      </header>

      {engagement.status === "active" &&
        engagement.invitation &&
        engagement.invitation.status !== "accepted" && <InvitationPanel engagement={engagement} />}

      {engagement.status === "proposed" ? (
        <SharedProjects engagement={engagement} />
      ) : (
        <Tabs
          value={tab ?? "projects"}
          onValueChange={(value) => {
            void navigate({
              search: { tab: value === "prepayments" ? "prepayments" : undefined },
              replace: true,
            });
          }}
        >
          <TabsList variant="line" className="font-mono text-[11px] uppercase tracking-[0.18em]">
            <TabsTrigger value="projects">shared projects</TabsTrigger>
            <TabsTrigger value="prepayments">prepayments</TabsTrigger>
          </TabsList>
          <TabsContent value="projects" className="mt-6">
            <SharedProjects engagement={engagement} />
          </TabsContent>
          <TabsContent value="prepayments" className="mt-6">
            <PrepaymentsPanel engagement={engagement} />
          </TabsContent>
        </Tabs>
      )}

      {endable && (
        <section className="space-y-3 pt-4 border-t border-destructive/30">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Danger zone</h2>
          <Button variant="destructive" size="sm" onClick={() => setConfirmEnd(true)}>
            {engagement.status === "proposed" ? "withdraw proposal" : "end engagement"}
          </Button>
          <ConfirmDialog
            open={confirmEnd}
            onOpenChange={setConfirmEnd}
            title={
              engagement.status === "proposed"
                ? "Withdraw this proposal?"
                : `End the Engagement with ${engagement.client.name}?`
            }
            description="Nothing new can be shared through it afterwards. Shared Projects, budget and billings stay visible to the Client as read-only history. You can propose a new Engagement later."
            confirmLabel={engagement.status === "proposed" ? "withdraw" : "end engagement"}
            destructive
            onConfirm={async () => {
              await end.mutateAsync(undefined);
            }}
          />
        </section>
      )}
    </div>
  );
}

function InvitationPanel({ engagement }: { engagement: EngagementView }) {
  const apiClient = useApiClient();
  const invitation = engagement.invitation!;
  const [email, setEmail] = useState("");
  const resend = useEngagementAction(
    () => apiClient.engagements.invitation.resend({ id: engagement.id }),
    "Invitation sent again",
  );
  const cancel = useEngagementAction(
    () => apiClient.engagements.invitation.cancel({ id: engagement.id }),
    "Invitation canceled",
  );
  const changeEmail = useEngagementAction(
    () => apiClient.engagements.invitation.changeEmail({ id: engagement.id, email: email.trim() }),
    "Invitation sent to the new address",
  );
  const busy = resend.isPending || cancel.isPending || changeEmail.isPending;
  const link =
    typeof window === "undefined" ? invitation.link : `${window.location.origin}${invitation.link}`;

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-xl uppercase font-extrabold">First admin</h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{invitation.email}</span> is invited as owner of{" "}
            {engagement.client.name}
            {invitation.status === "pending"
              ? ` until ${new Date(invitation.expiresAt).toISOString().slice(0, 10)}.`
              : ` (${invitation.status}).`}{" "}
            Once they accept, the Client manages its own team.
          </p>
          <p className="text-xs text-muted-foreground break-all">
            Invitation link: <span className="font-mono">{link}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => resend.mutate(undefined)} disabled={busy}>
            resend
          </Button>
          {invitation.status === "pending" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => cancel.mutate(undefined)}
              disabled={busy}
            >
              cancel invitation
            </Button>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="send to another email" htmlFor="invitation-email">
            <Input
              id="invitation-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !email.includes("@")}
            onClick={() => changeEmail.mutate(undefined, { onSuccess: () => setEmail("") })}
          >
            change email
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SharedProjects({ engagement }: { engagement: EngagementView }) {
  const apiClient = useApiClient();
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const projects = projectsQuery.data?.data ?? [];
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const shareable = projects.filter((p) => !engagement.projectIds.includes(p.id));
  const [projectId, setProjectId] = useState("");
  const active = engagement.status === "active";

  const share = useEngagementAction(
    (id: string) => apiClient.engagements.share({ engagementId: engagement.id, projectId: id }),
    "Project shared",
  );
  const unshare = useEngagementAction(
    (id: string) => apiClient.engagements.unshare({ engagementId: engagement.id, projectId: id }),
    "Project no longer shared",
  );

  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl uppercase font-extrabold">Shared projects</h2>
      <p className="text-sm text-muted-foreground max-w-2xl">
        The Client's members see these Projects in full, including their budget and every billing. A
        Project with budget attributed to this Engagement cannot be unshared.
      </p>
      {engagement.projectIds.length === 0 ? (
        <Empty label="Nothing shared yet." />
      ) : (
        <ul className="space-y-2">
          {engagement.projectIds.map((id) => {
            const project = projectById.get(id);
            return (
              <li
                key={id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border p-3"
              >
                {project ? (
                  <Link
                    to="/admin/projects/$slug"
                    params={{ slug: project.slug }}
                    className="text-sm underline hover:text-foreground"
                  >
                    {project.title}
                  </Link>
                ) : (
                  <span className="font-mono text-xs">{id}</span>
                )}
                {active && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={unshare.isPending}
                    onClick={() => unshare.mutate(id)}
                  >
                    unshare
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {active && shareable.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="share a project" htmlFor="share-project">
            <select
              id="share-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={selectClass}
            >
              <option value="">choose a project</option>
              {shareable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </Field>
          <Button
            size="sm"
            disabled={!projectId || share.isPending}
            onClick={() => share.mutate(projectId, { onSuccess: () => setProjectId("") })}
          >
            share
          </Button>
        </div>
      )}
    </section>
  );
}
