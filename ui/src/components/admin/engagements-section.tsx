import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, Input } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field } from "@/components/admin-form";
import { AgentLinksPanel } from "@/components/agent-links-panel";
import { ChangeOrdersPanel } from "@/components/change-orders-panel";
import { PrepaymentsPanel } from "@/components/prepayments-panel";
import { useMeRoles } from "@/hooks";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions, useAuthClient } from "@/lib/auth";
import { createClientEngagement } from "@/lib/create-client-engagement";
import { parseDecimalToBase } from "@/lib/format-amount";
import {
  adminProjectsListQueryOptions,
  engagementsListQueryKey,
  engagementsListQueryOptions,
  invalidateOrganizationQueries,
  tokensListQueryOptions,
} from "@/lib/queries";

type Engagement = Awaited<ReturnType<ApiClient["engagements"]["list"]>>["data"][number];

const LABEL_CLS = "font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground";

const ENGAGEMENT_PHASE: Record<
  Engagement["status"],
  { variant: "default" | "outline"; end: boolean; share: boolean; respond: boolean; open: boolean }
> = {
  proposed: { variant: "outline", end: false, share: false, respond: true, open: false },
  active: { variant: "default", end: true, share: true, respond: false, open: true },
  declined: { variant: "outline", end: false, share: false, respond: false, open: false },
  ended: { variant: "outline", end: false, share: false, respond: false, open: true },
};

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
          <SubcontractForm />
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
  const queryClient = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  const create = useMutation({
    mutationFn: () => {
      if (!activeOrgId) throw new Error("Select an Agency Organization first.");
      return createClientEngagement(authClient, apiClient, {
        name,
        adminEmail,
        agencyOrganizationId: activeOrgId,
      });
    },
    onSuccess: ({ restored }) => {
      setName("");
      setAdminEmail("");
      if (restored) toast.success("Client created and invited");
      else toast.warning("Client created, but could not switch back to your Agency Organization.");
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: async () => {
      await invalidateOrganizationQueries(queryClient, router);
      await queryClient.invalidateQueries({ queryKey: engagementsListQueryKey });
    },
  });

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

function monthBounds(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function SubcontractForm() {
  const apiClient = useApiClient();
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const tokensQuery = useQuery(tokensListQueryOptions(apiClient));
  const projects = projectsQuery.data?.data ?? [];
  const tokens = tokensQuery.data?.tokens ?? [];
  const month = monthBounds();
  const [subcontractorOrganizationId, setSubcontractorOrganizationId] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [recordPrepayment, setRecordPrepayment] = useState(false);
  const [tokenId, setTokenId] = useState("");
  const [amount, setAmount] = useState("");
  const [periodStart, setPeriodStart] = useState(month.start);
  const [periodEnd, setPeriodEnd] = useState(month.end);

  const subcontract = useEngagementMutation(
    () => {
      const selected = tokens.find((token) => token.tokenId === (tokenId || tokens[0]?.tokenId));
      return apiClient.engagements.subcontract({
        subcontractorOrganizationId,
        projectIds,
        prepayment:
          recordPrepayment && selected
            ? {
                tokenId: selected.tokenId,
                amount: parseDecimalToBase(amount, selected.decimals),
                periodStart,
                periodEnd,
              }
            : undefined,
      });
    },
    "Project shared with the subcontractor",
    () => {
      setSubcontractorOrganizationId("");
      setProjectIds([]);
      setAmount("");
      setRecordPrepayment(false);
    },
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (recordPrepayment && !amount.trim()) {
      toast.error("Enter a prepayment amount, or leave it off.");
      return;
    }
    subcontract.mutate(undefined);
  };

  return (
    <Card className="lg:col-span-2">
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className={LABEL_CLS}>subcontract</div>
          <Field label="Subcontractor organization id">
            <Input
              value={subcontractorOrganizationId}
              onChange={(e) => setSubcontractorOrganizationId(e.target.value)}
              required
            />
          </Field>
          {projects.length > 0 && (
            <ul className="grid gap-1 sm:grid-cols-2">
              {projects.map((project) => (
                <li key={project.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={projectIds.includes(project.id)}
                      onChange={(e) =>
                        setProjectIds((current) =>
                          e.target.checked
                            ? [...current, project.id]
                            : current.filter((id) => id !== project.id),
                        )
                      }
                    />
                    <span className="truncate">{project.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={recordPrepayment}
              onChange={(e) => setRecordPrepayment(e.target.checked)}
            />
            record a prepayment
          </label>
          {recordPrepayment && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Token">
                <select
                  className="rounded-sm border border-input bg-background px-2 py-1.5 font-mono text-xs"
                  value={tokenId || tokens[0]?.tokenId || ""}
                  onChange={(e) => setTokenId(e.target.value)}
                >
                  {tokens.map((token) => (
                    <option key={token.tokenId} value={token.tokenId}>
                      {token.symbol}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Amount">
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </Field>
              <Field label="Period start">
                <Input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  required
                />
              </Field>
              <Field label="Period end">
                <Input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  required
                />
              </Field>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            The subcontractor can assign contributors and bill from its own Agency DAO immediately.
          </p>
          <Button type="submit" size="sm" disabled={subcontract.isPending}>
            {subcontract.isPending ? "sharing..." : "share project"}
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
  const phase = ENGAGEMENT_PHASE[engagement.status];

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
            <Badge variant={phase.variant}>{engagement.status}</Badge>
            {phase.end && (
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
        {(phase.share || shared.size > 0) && (
          <div className="space-y-1">
            <div className={LABEL_CLS}>shared projects</div>
            <ul className="grid gap-1 sm:grid-cols-2">
              {projects
                .filter((p) => phase.share || shared.has(p.id))
                .map((p) => (
                  <li key={p.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={shared.has(p.id)}
                        disabled={!phase.share || toggle.isPending}
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
        {hasAgencyDao && (phase.open || phase.end) && (
          <>
            <AgentLinksPanel engagementId={engagement.id} canManage={phase.share} />
            <PrepaymentsPanel engagementId={engagement.id} canManage={phase.share} />
            <ChangeOrdersPanel
              engagementId={engagement.id}
              side="agency"
              canManage={phase.share}
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
          <Badge variant={ENGAGEMENT_PHASE[engagement.status].variant}>{engagement.status}</Badge>
          {ENGAGEMENT_PHASE[engagement.status].respond && (
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
          {ENGAGEMENT_PHASE[engagement.status].open && (
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
