import { ArrowLeftIcon, CopyIcon, FolderIcon, InfoIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsContent,
  TabsTrigger,
} from "@/components";
import { AgentLinksPanel } from "@/components/admin/agent-links-panel";
import { IdeasInbox } from "@/components/admin/ideas-inbox";
import { PrepaymentsPanel } from "@/components/admin/prepayments-panel";
import { AdminError } from "@/components/admin-error";
import { ChangeOrdersPanel, ShortfallWarnings } from "@/components/change-orders";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  EngagementKindBadge,
  EngagementStatusBadge,
  type EngagementView,
  InvitationStatusBadge,
} from "@/components/engagement-status";
import { PageHeader } from "@/components/page-header";
import { ScrollableTabsList } from "@/components/scrollable-tabs-list";
import { useEngagementAction } from "@/hooks/use-engagement-action";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { awaitingCountFor } from "@/lib/change-orders";
import { acceptsIdeas } from "@/lib/navigation";
import {
  adminProjectsListQueryOptions,
  awaitingChangeOrdersQueryOptions,
  engagementDetailQueryOptions,
} from "@/lib/queries";

const ENGAGEMENT_TABS = ["projects", "prepayments", "plan", "ideas", "links"] as const;

type EngagementTab = (typeof ENGAGEMENT_TABS)[number];

const engagementSearchSchema = z.object({
  tab: z.enum(ENGAGEMENT_TABS).optional().catch("projects"),
});

function isEngagementTab(value: string): value is EngagementTab {
  return (ENGAGEMENT_TABS as readonly string[]).includes(value);
}

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

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading engagement</span>
      <Skeleton className="h-5 w-28" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-8 w-full max-w-lg" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

function EngagementDetailPage() {
  const { engagementId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const apiClient = useApiClient();
  const engagementQuery = useQuery(engagementDetailQueryOptions(apiClient, engagementId));
  const { canAccessAdmin } = useMeRoles();
  const projects = useQuery(adminProjectsListQueryOptions(apiClient)).data?.data ?? [];
  const awaiting = awaitingCountFor(
    useQuery(awaitingChangeOrdersQueryOptions(apiClient)).data?.data ?? [],
    engagementId,
  );
  const [confirmEnd, setConfirmEnd] = useState(false);
  const end = useEngagementAction(
    () => apiClient.engagements.end({ id: engagementId }),
    "Engagement ended",
  );

  if (engagementQuery.isLoading) return <DetailSkeleton />;
  if (engagementQuery.isError) return <AdminError error={engagementQuery.error} />;
  const engagement = engagementQuery.data;
  if (!engagement) return null;
  const endable =
    engagement.status === "active" ||
    (engagement.status === "proposed" && engagement.side === "agency");
  const sharedProjects = projects.filter((p) => engagement.projectIds.includes(p.id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/engagements">
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            Engagements
          </Link>
        </Button>
      </div>
      <PageHeader
        title={engagement.client.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>@{engagement.client.slug}</span>
            <EngagementStatusBadge status={engagement.status} />
            <EngagementKindBadge kind={engagement.kind} />
            {engagement.invitation && <InvitationStatusBadge invitation={engagement.invitation} />}
          </span>
        }
        actions={
          endable && (
            <Button variant="destructive" onClick={() => setConfirmEnd(true)}>
              {engagement.status === "proposed" ? "Withdraw proposal" : "End Engagement"}
            </Button>
          )
        }
      />

      {engagement.status === "ended" && (
        <Alert>
          <InfoIcon aria-hidden />
          <AlertDescription>
            This Engagement ended. Its shared Projects stay visible to the Client as read-only
            history, and nothing new can be shared through it.
          </AlertDescription>
        </Alert>
      )}
      {engagement.status === "proposed" && (
        <Alert>
          <InfoIcon aria-hidden />
          <AlertDescription>
            Waiting for {engagement.client.name} to accept or decline.
          </AlertDescription>
        </Alert>
      )}

      {engagement.status !== "proposed" && tab !== "plan" && (
        <ShortfallWarnings engagementId={engagement.id} projects={sharedProjects} />
      )}

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
              search: {
                tab: isEngagementTab(value) && value !== "projects" ? value : undefined,
              },
              replace: true,
            });
          }}
        >
          <ScrollableTabsList>
            <TabsTrigger value="projects">Shared Projects</TabsTrigger>
            <TabsTrigger value="prepayments">Prepayments</TabsTrigger>
            <TabsTrigger value="plan">
              Plan and Change orders
              {awaiting > 0 && (
                <Badge size="counter" aria-label={`${awaiting} awaiting you`}>
                  {awaiting}
                </Badge>
              )}
            </TabsTrigger>
            {acceptsIdeas(engagement.kind) && <TabsTrigger value="ideas">Ideas</TabsTrigger>}
            <TabsTrigger value="links">Agent links</TabsTrigger>
          </ScrollableTabsList>
          <TabsContent value="projects" className="mt-4">
            <SharedProjects engagement={engagement} />
          </TabsContent>
          <TabsContent value="prepayments" className="mt-4">
            <PrepaymentsPanel engagement={engagement} />
          </TabsContent>
          <TabsContent value="plan" className="mt-4">
            <ChangeOrdersPanel
              engagementId={engagement.id}
              side="agency"
              names={{ agency: engagement.agency.name, client: engagement.client.name }}
              projects={sharedProjects}
              active={engagement.status === "active"}
              canManage={canAccessAdmin}
            />
          </TabsContent>
          {acceptsIdeas(engagement.kind) && (
            <TabsContent value="ideas" className="mt-4">
              <IdeasInbox engagement={engagement} canManage={canAccessAdmin} />
            </TabsContent>
          )}
          <TabsContent value="links" className="mt-4">
            <AgentLinksPanel engagement={engagement} canManage={canAccessAdmin} />
          </TabsContent>
        </Tabs>
      )}

      {endable && (
        <ConfirmDialog
          open={confirmEnd}
          onOpenChange={setConfirmEnd}
          title={
            engagement.status === "proposed"
              ? "Withdraw this proposal?"
              : `End the Engagement with ${engagement.client.name}?`
          }
          description="Nothing new can be shared through it afterwards. Shared Projects, budget and billings stay visible to the Client as read-only history. You can propose a new Engagement later."
          confirmLabel={engagement.status === "proposed" ? "Withdraw" : "End Engagement"}
          cancelLabel="Cancel"
          destructive
          onConfirm={async () => {
            await end.mutateAsync(undefined);
          }}
        />
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
  const pending = invitation.status === "pending";

  return (
    <Card>
      <CardHeader>
        <CardTitle>First admin invitation</CardTitle>
        <CardDescription>
          {invitation.email} is invited as owner of {engagement.client.name}
          {pending ? ` until ${new Date(invitation.expiresAt).toISOString().slice(0, 10)}` : ""}.
          Once they accept, the Client manages its own team.
        </CardDescription>
        <CardAction>
          <InvitationStatusBadge invitation={invitation} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="invitation-link">Invitation link</FieldLabel>
            <div className="flex gap-2">
              <Input id="invitation-link" value={link} readOnly className="flex-1" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Copy the invitation link"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(link)
                    .then(() => toast.success("Link copied"))
                    .catch(() => toast.error("Could not copy the link"));
                }}
              >
                <CopyIcon aria-hidden />
              </Button>
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="invitation-email">Send to another email</FieldLabel>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy && email.includes("@")) {
                  changeEmail.mutate(undefined, { onSuccess: () => setEmail("") });
                }
              }}
            >
              <Input
                id="invitation-email"
                type="email"
                value={email}
                placeholder="name@example.com"
                onChange={(e) => setEmail(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" variant="outline" disabled={busy || !email.includes("@")}>
                Change email
              </Button>
            </form>
            <FieldDescription>The old link stops working.</FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {pending && (
          <Button variant="outline" onClick={() => cancel.mutate(undefined)} disabled={busy}>
            <XIcon data-icon="inline-start" aria-hidden />
            Cancel invitation
          </Button>
        )}
        <Button onClick={() => resend.mutate(undefined)} disabled={busy}>
          Resend invitation
        </Button>
      </CardFooter>
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
    <Card>
      <CardHeader>
        <CardTitle>Shared Projects</CardTitle>
        <CardDescription>
          {engagement.kind === "subcontract"
            ? "Your Subcontractor staffs and bills these Projects from its own DAO. It cannot edit them, touch your budget or see your Clients."
            : "The Client's members see these Projects in full, with budget and billings. A Project with budget from this Engagement, or in its plan, cannot be unshared."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {engagement.projectIds.length === 0 ? (
          <Empty variant="outline">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderIcon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Nothing shared yet</EmptyTitle>
              <EmptyDescription>
                {active && shareable.length > 0
                  ? "Share a Project below."
                  : "Shared Projects show up here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup>
            {engagement.projectIds.map((id) => {
              const project = projectById.get(id);
              return (
                <Item key={id} asChild variant="outline" size="sm">
                  <li>
                    <ItemContent className="min-w-0">
                      <ItemTitle>
                        {project ? (
                          <Link
                            to="/admin/projects/$slug"
                            params={{ slug: project.slug }}
                            className="underline-offset-4 hover:underline"
                          >
                            {project.title}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{id}</span>
                        )}
                      </ItemTitle>
                    </ItemContent>
                    {active && (
                      <ItemActions>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={unshare.isPending}
                          onClick={() => unshare.mutate(id)}
                        >
                          Unshare
                        </Button>
                      </ItemActions>
                    )}
                  </li>
                </Item>
              );
            })}
          </ItemGroup>
        )}
      </CardContent>
      {active && shareable.length > 0 && (
        <CardFooter>
          <form
            className="flex w-full flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (projectId) share.mutate(projectId, { onSuccess: () => setProjectId("") });
            }}
          >
            <Field className="flex-1">
              <FieldLabel htmlFor="share-project">Share a Project</FieldLabel>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="share-project" className="w-full">
                  <SelectValue placeholder="Choose a Project" />
                </SelectTrigger>
                <SelectContent>
                  {shareable.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit" disabled={!projectId || share.isPending}>
              {share.isPending ? "Sharing…" : "Share"}
            </Button>
          </form>
        </CardFooter>
      )}
    </Card>
  );
}
