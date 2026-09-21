import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, Input } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field } from "@/components/admin-form";
import { ChangeOrdersPanel } from "@/components/change-orders-panel";
import { PrepaymentsPanel } from "@/components/prepayments-panel";
import { useMeRoles } from "@/hooks";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions, useAuthClient } from "@/lib/auth";
import {
  adminProjectsListQueryOptions,
  engagementsListQueryKey,
  engagementsListQueryOptions,
} from "@/lib/queries";

type Engagement = Awaited<ReturnType<ApiClient["engagements"]["list"]>>["data"][number];

const LABEL_CLS = "font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground";

function statusVariant(status: Engagement["status"]) {
  return status === "active" ? "default" : "outline";
}

export function EngagementsAdminSection() {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const activeOrgId = session?.session?.activeOrganizationId ?? null;
  const engagementsQuery = useQuery(engagementsListQueryOptions(apiClient));

  if (engagementsQuery.isError) return <AdminError error={engagementsQuery.error} />;

  const engagements = engagementsQuery.data?.data ?? [];
  const asAgency = engagements.filter((e) => e.role === "agency");
  const asClient = engagements.filter((e) => e.role === "client");

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div className="space-y-1">
          <div className={LABEL_CLS}>work we deliver</div>
          <h2 className="font-display text-2xl uppercase tracking-tight font-extrabold">Clients</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <NewClientForm activeOrgId={activeOrgId} />
          <ProposeForm />
        </div>
        {asAgency.length === 0 ? (
          <p className="text-sm text-muted-foreground">No clients yet.</p>
        ) : (
          <div className="space-y-3">
            {asAgency.map((engagement) => (
              <AgencyEngagementCard key={engagement.id} engagement={engagement} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <div className={LABEL_CLS}>work we buy</div>
          <h2 className="font-display text-2xl uppercase tracking-tight font-extrabold">
            Agencies
          </h2>
          {activeOrgId && (
            <p className="text-sm text-muted-foreground">
              To be proposed an Engagement, share your Organization id with the agency:{" "}
              <span className="font-mono text-xs text-foreground break-all">{activeOrgId}</span>
            </p>
          )}
        </div>
        {asClient.length === 0 ? (
          <p className="text-sm text-muted-foreground">You haven't hired an agency yet.</p>
        ) : (
          <div className="space-y-3">
            {asClient.map((engagement) => (
              <ClientEngagementCard key={engagement.id} engagement={engagement} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function useEngagementMutation<TInput>(
  mutationFn: (input: TInput) => Promise<unknown>,
  success: string,
  after?: () => void | Promise<void>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await after?.();
      toast.success(success);
      await queryClient.invalidateQueries({ queryKey: engagementsListQueryKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

function NewClientForm({ activeOrgId }: { activeOrgId: string | null }) {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  const create = useEngagementMutation(
    () => apiClient.engagements.createClient({ name, adminEmail }),
    "Client created and invited",
    async () => {
      if (activeOrgId) await authClient.organization.setActive({ organizationId: activeOrgId });
      setName("");
      setAdminEmail("");
    },
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(undefined);
  };

  return (
    <Card>
      <CardContent>
        <form className="space-y-3" onSubmit={submit}>
          <div className={LABEL_CLS}>new client</div>
          <Field label="name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="first admin email">
            <Input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" size="sm" disabled={create.isPending}>
            {create.isPending ? "creating..." : "create and invite"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ProposeForm() {
  const apiClient = useApiClient();
  const [clientOrganizationId, setClientOrganizationId] = useState("");

  const propose = useEngagementMutation(
    () => apiClient.engagements.propose({ clientOrganizationId }),
    "Engagement proposed",
    () => setClientOrganizationId(""),
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    propose.mutate(undefined);
  };

  return (
    <Card>
      <CardContent>
        <form className="space-y-3" onSubmit={submit}>
          <div className={LABEL_CLS}>existing organization</div>
          <Field label="organization id">
            <Input
              value={clientOrganizationId}
              onChange={(e) => setClientOrganizationId(e.target.value)}
              required
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            They accept from their own Engagements page before you can share projects.
          </p>
          <Button type="submit" size="sm" disabled={propose.isPending}>
            {propose.isPending ? "proposing..." : "propose engagement"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AgencyEngagementCard({ engagement }: { engagement: Engagement }) {
  const apiClient = useApiClient();
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const { hasAgencyDao } = useMeRoles();
  const shared = new Set(engagement.projectIds);
  const projects = projectsQuery.data?.data ?? [];
  const canShare = engagement.status === "active";

  const toggle = useEngagementMutation(
    ({ projectId, share }: { projectId: string; share: boolean }) =>
      share
        ? apiClient.engagements.share({ engagementId: engagement.id, projectId })
        : apiClient.engagements.unshare({ engagementId: engagement.id, projectId }),
    "Sharing updated",
  );
  const end = useEngagementMutation(
    () => apiClient.engagements.end({ id: engagement.id }),
    "Engagement ended",
  );

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="font-display text-lg uppercase tracking-tight font-bold">
              {engagement.client.name || engagement.client.organizationId}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">
              since {new Date(engagement.createdAt).toISOString().slice(0, 10)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant(engagement.status)}>{engagement.status}</Badge>
            {engagement.status === "active" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => end.mutate(undefined)}
                disabled={end.isPending}
              >
                end
              </Button>
            )}
          </div>
        </div>
        {(canShare || shared.size > 0) && (
          <div className="space-y-1">
            <div className={LABEL_CLS}>shared projects</div>
            <ul className="grid gap-1 sm:grid-cols-2">
              {projects
                .filter((p) => canShare || shared.has(p.id))
                .map((p) => (
                  <li key={p.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={shared.has(p.id)}
                        disabled={!canShare || toggle.isPending}
                        onChange={(e) =>
                          toggle.mutate({ projectId: p.id, share: e.target.checked })
                        }
                      />
                      <span className="truncate">{p.title}</span>
                    </label>
                  </li>
                ))}
            </ul>
          </div>
        )}
        {hasAgencyDao && engagement.status !== "proposed" && engagement.status !== "declined" && (
          <>
            <PrepaymentsPanel engagementId={engagement.id} canManage={canShare} />
            <ChangeOrdersPanel
              engagementId={engagement.id}
              side="agency"
              canManage={canShare}
              projects={projects.filter((p) => shared.has(p.id))}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ClientEngagementCard({ engagement }: { engagement: Engagement }) {
  const apiClient = useApiClient();
  const accept = useEngagementMutation(
    () => apiClient.engagements.accept({ id: engagement.id }),
    "Engagement accepted",
  );
  const decline = useEngagementMutation(
    () => apiClient.engagements.decline({ id: engagement.id }),
    "Engagement declined",
  );
  const pending = accept.isPending || decline.isPending;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="font-display text-lg uppercase tracking-tight font-bold">
            {engagement.agency.name || engagement.agency.organizationId}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {engagement.projectIds.length} shared projects
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(engagement.status)}>{engagement.status}</Badge>
          {engagement.status === "proposed" && (
            <>
              <Button size="sm" onClick={() => accept.mutate(undefined)} disabled={pending}>
                accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => decline.mutate(undefined)}
                disabled={pending}
              >
                decline
              </Button>
            </>
          )}
          {(engagement.status === "active" || engagement.status === "ended") && (
            <Button asChild size="sm" variant="outline">
              <Link to="/client" search={{ engagement: engagement.id }}>
                open
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
