import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { Field } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useApiClient } from "@/lib/api";
import { csvTimestamp, downloadCsv } from "@/lib/csv";
import { formatTokenAmount, tokenSymbol } from "@/lib/format-amount";
import { trezuProposalUrl } from "@/lib/trezu";

export type ProposalStatus =
  | "InProgress"
  | "Approved"
  | "Rejected"
  | "Removed"
  | "Expired"
  | "Moved"
  | "Failed";

export type StatusBucket = "open" | "approved" | "failed" | "closed";

export const ALL_STATUS_BUCKETS: StatusBucket[] = ["open", "approved", "failed", "closed"];

const STATUS_TO_BUCKET: Record<ProposalStatus, StatusBucket> = {
  InProgress: "open",
  Approved: "approved",
  Failed: "failed",
  Rejected: "closed",
  Removed: "closed",
  Expired: "closed",
  Moved: "closed",
};

const STATUS_BUCKETS: { key: StatusBucket; label: string }[] = [
  { key: "open", label: "open" },
  { key: "approved", label: "approved" },
  { key: "failed", label: "failed" },
  { key: "closed", label: "closed" },
];

export type ProposalsFilter = {
  status: ReadonlySet<StatusBucket>;
  token: string;
  receiver: string;
};

const EMPTY_PROPOSALS_FILTER: ProposalsFilter = {
  status: new Set(),
  token: "",
  receiver: "",
};

// shadcn <Select> rejects empty-string SelectItem values; sentinels stand in for "no filter" / "no choice".
const ALL_TOKENS_SENTINEL = "__all__";
const NO_CONTRIBUTOR_SENTINEL = "__none__";

export type ProposalMapping = {
  billingId: string;
  projectId: string;
  projectSlug: string;
  projectTitle: string;
};

export type VoteAction = "Approve" | "Reject" | "Remove";

export type Proposal = {
  proposalId: string;
  proposer: string;
  description: string;
  status: ProposalStatus;
  tokenId: string;
  receiverId: string;
  amount: string;
  submissionTime: string;
  votes: Record<string, VoteAction>;
  mapping?: ProposalMapping | null;
};

export type OperatorContext = {
  projects: Array<{ id: string; slug: string; title: string }>;
  contributors: Array<{ id: string; name: string }>;
};

const BILLING_INVALIDATIONS = [
  ["proposals", "list"],
  ["admin", "billings", "list"],
  ["admin", "projects", "budget"],
  ["treasury", "rollups"],
] as const;

type ProposalsListProps = {
  proposals: Proposal[];
  isLoading: boolean;
  isError: boolean;
  hasNext: boolean;
  isFetchingNext: boolean;
  fetchNextPage: () => void;
  orgAccountId: string | null;
  filter: ProposalsFilter;
  onFilterChange: (next: ProposalsFilter) => void;
  operatorContext?: OperatorContext;
};

export function ProposalsList({
  proposals,
  isLoading,
  isError,
  hasNext,
  isFetchingNext,
  fetchNextPage,
  orgAccountId,
  filter,
  onFilterChange,
  operatorContext,
}: ProposalsListProps) {
  const [selected, setSelected] = useState<Proposal | null>(null);

  const distinctTokens = useMemo(() => {
    const set = new Set<string>();
    for (const p of proposals) if (p.tokenId) set.add(p.tokenId);
    return Array.from(set).sort();
  }, [proposals]);

  const filtered = useMemo(() => {
    const q = filter.receiver.trim().toLowerCase();
    return proposals.filter((p) => {
      if (filter.status.size > 0 && !filter.status.has(STATUS_TO_BUCKET[p.status])) return false;
      if (filter.token && p.tokenId !== filter.token) return false;
      if (q && !p.receiverId.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [proposals, filter]);

  const toggleBucket = (bucket: StatusBucket) => {
    const next = new Set(filter.status);
    if (next.has(bucket)) next.delete(bucket);
    else next.add(bucket);
    onFilterChange({ ...filter, status: next });
  };

  const hasActiveFilter = filter.status.size > 0 || !!filter.token || filter.receiver.trim() !== "";
  const clearFilters = () => onFilterChange(EMPTY_PROPOSALS_FILTER);

  if (isLoading) {
    return (
      <div className="border border-border">
        <Table>
          <ProposalsTableHeader />
          <TableBody>
            {[0, 1, 2].map((i) => (
              <ProposalRowSkeleton key={i} />
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }
  if (isError) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        could not load — try again
      </p>
    );
  }
  if (proposals.length === 0) {
    return (
      <Empty className="border-2 border-dashed border-border/40">
        <EmptyTitle className="font-display text-2xl uppercase tracking-tight text-muted-foreground">
          no payouts yet
        </EmptyTitle>
      </Empty>
    );
  }
  return (
    <div className="space-y-4">
      <ProposalsFilterBar
        statusFilter={filter.status}
        onToggleBucket={toggleBucket}
        tokenFilter={filter.token}
        onTokenChange={(t) => onFilterChange({ ...filter, token: t })}
        distinctTokens={distinctTokens}
        receiverQuery={filter.receiver}
        onReceiverChange={(q) => onFilterChange({ ...filter, receiver: q })}
        total={proposals.length}
        shown={filtered.length}
        hasActiveFilter={hasActiveFilter}
        onClear={clearFilters}
        onExport={() => exportProposalsCsv(filtered)}
        canExport={filtered.length > 0}
      />
      <div className="border border-border">
        <Table>
          <ProposalsTableHeader />
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground text-center py-8"
                >
                  no matches — clear filters to see all
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => (
                <ProposalRow
                  key={p.proposalId}
                  proposal={p}
                  onSelect={setSelected}
                  showAttribution={!!operatorContext}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {hasNext && (
        <div className="flex justify-center pt-2">
          <Button
            onClick={fetchNextPage}
            disabled={isFetchingNext}
            variant="outline"
            className="font-display uppercase tracking-wide"
          >
            {isFetchingNext ? "loading..." : "load more →"}
          </Button>
        </div>
      )}
      <ProposalDetailDialog
        proposal={selected}
        orgAccountId={orgAccountId}
        operatorContext={operatorContext}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}

function ProposalsFilterBar({
  statusFilter,
  onToggleBucket,
  tokenFilter,
  onTokenChange,
  distinctTokens,
  receiverQuery,
  onReceiverChange,
  total,
  shown,
  hasActiveFilter,
  onClear,
  onExport,
  canExport,
}: {
  statusFilter: ReadonlySet<StatusBucket>;
  onToggleBucket: (b: StatusBucket) => void;
  tokenFilter: string;
  onTokenChange: (t: string) => void;
  distinctTokens: string[];
  receiverQuery: string;
  onReceiverChange: (q: string) => void;
  total: number;
  shown: number;
  hasActiveFilter: boolean;
  onClear: () => void;
  onExport: () => void;
  canExport: boolean;
}) {
  return (
    <div className="space-y-3 border border-border bg-card/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mr-1">
          status
        </span>
        {STATUS_BUCKETS.map((b) => {
          const active = statusFilter.has(b.key);
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => onToggleBucket(b.key)}
              aria-pressed={active}
              className={`font-mono text-[10px] uppercase tracking-[0.18em] px-2 py-1 border transition-colors duration-150 cursor-pointer ${
                active
                  ? "bg-foreground text-background border-foreground"
                  : "bg-transparent text-muted-foreground border-foreground/40 hover:text-foreground hover:border-foreground/70"
              }`}
            >
              {b.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            token
          </div>
          <Select
            value={tokenFilter || ALL_TOKENS_SENTINEL}
            onValueChange={(v) => onTokenChange(v === ALL_TOKENS_SENTINEL ? "" : v)}
          >
            <SelectTrigger
              aria-label="filter by token"
              className="font-mono text-xs uppercase tracking-wide h-8"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TOKENS_SENTINEL}>all tokens</SelectItem>
              {distinctTokens.map((tid) => (
                <SelectItem key={tid} value={tid}>
                  {tokenSymbol(tid)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1 min-w-[12rem]">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            receiver
          </div>
          <Input
            value={receiverQuery}
            onChange={(e) => onReceiverChange(e.target.value)}
            placeholder="search account…"
            aria-label="filter by receiver account"
            className="font-mono text-xs h-8"
          />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground tabular-nums">
            {shown === total ? `${total}` : `${shown} of ${total}`}
          </div>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={onClear}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground cursor-pointer underline-offset-2 hover:underline"
            >
              clear ✕
            </button>
          )}
          <button
            type="button"
            onClick={onExport}
            disabled={!canExport}
            aria-label="download visible rows as CSV"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed underline-offset-2 hover:underline"
          >
            export csv ↓
          </button>
        </div>
      </div>
    </div>
  );
}

function ProposalsTableHeader() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] w-[80px]">
          id
        </TableHead>
        <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] w-[110px]">
          status
        </TableHead>
        <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em]">
          description
        </TableHead>
        <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] text-right">
          amount
        </TableHead>
        <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em]">to</TableHead>
        <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] w-[120px]">
          submitted
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

export const STATUS_LABEL: Record<ProposalStatus, string> = {
  InProgress: "open",
  Approved: "approved",
  Rejected: "rejected",
  Removed: "removed",
  Expired: "expired",
  Moved: "moved",
  Failed: "failed",
};

type BadgeVariant = "default" | "secondary" | "accent" | "destructive" | "outline";
const STATUS_VARIANT: Record<ProposalStatus, BadgeVariant> = {
  InProgress: "default",
  Approved: "secondary",
  Rejected: "outline",
  Removed: "outline",
  Expired: "outline",
  Moved: "outline",
  Failed: "destructive",
};

function ProposalRowSkeleton() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="h-3 w-12" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-16" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3 w-full" />
      </TableCell>
      <TableCell className="text-right">
        <Skeleton className="h-3 w-16 ml-auto" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3 w-20" />
      </TableCell>
    </TableRow>
  );
}

const STATUS_ROW_TINT: Record<ProposalStatus, string> = {
  InProgress: "",
  Approved: "",
  Failed: "bg-destructive/5",
  Rejected: "bg-muted/40",
  Removed: "bg-muted/40",
  Expired: "bg-muted/40",
  Moved: "bg-muted/40",
};

function ProposalRow({
  proposal,
  onSelect,
  showAttribution,
}: {
  proposal: Proposal;
  onSelect: (p: Proposal) => void;
  showAttribution: boolean;
}) {
  const submitted = formatSubmitted(proposal.submissionTime, "date");
  const tint = STATUS_ROW_TINT[proposal.status] ?? "";
  return (
    <TableRow
      onClick={() => onSelect(proposal)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(proposal);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Open proposal ${proposal.proposalId} details`}
      className={`cursor-pointer hover:bg-muted/50 focus:bg-muted/50 focus:outline-none ${tint}`}
    >
      <TableCell className="font-mono text-xs text-muted-foreground">
        #{proposal.proposalId}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={STATUS_VARIANT[proposal.status] ?? "outline"}>
            {STATUS_LABEL[proposal.status] ?? proposal.status}
          </Badge>
          {showAttribution && proposal.mapping && (
            <Badge variant="outline" className="font-mono text-[10px]">
              @{proposal.mapping.projectSlug}
            </Badge>
          )}
          {showAttribution && !proposal.mapping && proposal.status === "Approved" && (
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              unrecorded
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-sm max-w-[24rem]">
        <span className="line-clamp-2 break-words">{proposal.description}</span>
      </TableCell>
      <TableCell className="font-mono tabular-nums text-right whitespace-nowrap">
        {formatTokenAmount(proposal.amount, proposal.tokenId)}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground break-all max-w-[14rem]">
        {proposal.receiverId}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
        {submitted}
      </TableCell>
    </TableRow>
  );
}

function ProposalDetailDialog({
  proposal,
  orgAccountId,
  operatorContext,
  onOpenChange,
}: {
  proposal: Proposal | null;
  orgAccountId: string | null;
  operatorContext?: OperatorContext;
  onOpenChange: (open: boolean) => void;
}) {
  const trezuUrl =
    proposal && orgAccountId ? trezuProposalUrl(orgAccountId, proposal.proposalId) : null;
  return (
    <Dialog open={!!proposal} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {proposal && (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em]">
                <span className="text-muted-foreground">proposal</span>
                <span>#{proposal.proposalId}</span>
                <Badge variant={STATUS_VARIANT[proposal.status] ?? "outline"}>
                  {STATUS_LABEL[proposal.status] ?? proposal.status}
                </Badge>
              </div>
              <DialogTitle className="font-display text-2xl uppercase tracking-tight font-extrabold leading-tight">
                {formatTokenAmount(proposal.amount, proposal.tokenId)}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Transfer proposal #{proposal.proposalId} details
              </DialogDescription>
            </DialogHeader>
            <dl className="grid gap-3 text-sm">
              <DetailField label="receiver" value={proposal.receiverId} mono />
              <DetailField label="proposer" value={proposal.proposer} mono />
              <DetailField
                label="submitted"
                value={formatSubmitted(proposal.submissionTime, "minute")}
                mono
              />
              <VoteTally votes={proposal.votes} />
              {proposal.description && (
                <div className="space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    description
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {proposal.description}
                  </p>
                </div>
              )}
            </dl>
            {operatorContext && (
              <ProposalBillingSection
                proposal={proposal}
                operatorContext={operatorContext}
                onAfterChange={() => onOpenChange(false)}
              />
            )}
            <DialogFooter>
              {trezuUrl && (
                <Button asChild variant="outline" className="font-display uppercase tracking-wide">
                  <a href={trezuUrl} target="_blank" rel="noopener noreferrer">
                    view on trezu <ArrowUpRight className="ml-1 size-3" />
                  </a>
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProposalBillingSection({
  proposal,
  operatorContext,
  onAfterChange,
}: {
  proposal: Proposal;
  operatorContext: OperatorContext;
  onAfterChange: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { projects, contributors } = operatorContext;
  const [projectId, setProjectId] = useState("");
  const [contributorId, setContributorId] = useState("");
  const [note, setNote] = useState("");

  const invalidate = () =>
    Promise.all(
      BILLING_INVALIDATIONS.map((key) => queryClient.invalidateQueries({ queryKey: [...key] })),
    );

  const recordMutation = useMutation({
    mutationFn: async () =>
      apiClient.billings.create({
        projectId,
        contributorId: contributorId || undefined,
        proposalId: proposal.proposalId,
        note: note.trim() || undefined,
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success(`Proposal #${proposal.proposalId} recorded`);
      onAfterChange();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to record billing"),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!proposal.mapping) throw new Error("No billing to delete");
      return apiClient.billings.delete({ id: proposal.mapping.billingId });
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(`Billing for proposal #${proposal.proposalId} deleted`);
      onAfterChange();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete billing"),
  });

  const [confirmOpen, setConfirmOpen] = useState(false);

  if (proposal.mapping) {
    return (
      <>
        <div className="space-y-2 border-t pt-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            billing
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/admin/projects/$slug"
              params={{ slug: proposal.mapping.projectSlug }}
              className="font-mono text-xs underline-offset-2 hover:underline"
            >
              @{proposal.mapping.projectSlug}
            </Link>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-xs"
              onClick={() => setConfirmOpen(true)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "deleting..." : "delete"}
            </Button>
          </div>
        </div>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={`Delete billing for proposal #${proposal.proposalId}?`}
          description="You can re-record it afterwards. Chain status remains the source of truth."
          confirmLabel="delete"
          destructive
          onConfirm={async () => {
            await deleteMutation.mutateAsync();
          }}
        />
      </>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="space-y-1 border-t pt-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          billing
        </div>
        <p className="text-xs text-muted-foreground">Create a project before recording billings.</p>
      </div>
    );
  }

  const canRecord = projectId !== "" && !recordMutation.isPending;
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        record billing
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="project" htmlFor={`record-project-${proposal.proposalId}`}>
          <Select
            value={projectId}
            onValueChange={setProjectId}
            disabled={recordMutation.isPending}
          >
            <SelectTrigger id={`record-project-${proposal.proposalId}`} className="w-full">
              <SelectValue placeholder="select project…" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="contributor" htmlFor={`record-contributor-${proposal.proposalId}`}>
          <Select
            value={contributorId || NO_CONTRIBUTOR_SENTINEL}
            onValueChange={(v) => setContributorId(v === NO_CONTRIBUTOR_SENTINEL ? "" : v)}
            disabled={recordMutation.isPending}
          >
            <SelectTrigger id={`record-contributor-${proposal.proposalId}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CONTRIBUTOR_SENTINEL}>none</SelectItem>
              {contributors.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="note" htmlFor={`record-note-${proposal.proposalId}`}>
        <Input
          id={`record-note-${proposal.proposalId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={recordMutation.isPending}
          maxLength={2000}
        />
      </Field>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => recordMutation.mutate()} disabled={!canRecord}>
          {recordMutation.isPending ? "recording..." : "record"}
        </Button>
      </div>
    </div>
  );
}

function VoteTally({ votes }: { votes: Record<string, VoteAction> }) {
  const entries = Object.values(votes);
  const counts = { Approve: 0, Reject: 0, Remove: 0 };
  for (const v of entries) counts[v]++;
  return (
    <div className="space-y-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        votes
      </div>
      {entries.length === 0 ? (
        <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
          no tally available
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums">
          <span>
            <span className="text-muted-foreground">approve</span> {counts.Approve}
          </span>
          <span>
            <span className="text-muted-foreground">reject</span> {counts.Reject}
          </span>
          {counts.Remove > 0 && (
            <span>
              <span className="text-muted-foreground">remove</span> {counts.Remove}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className={`${mono ? "font-mono text-xs" : "text-sm"} break-all`}>{value}</div>
    </div>
  );
}

// submissionTime is nanoseconds-since-epoch (Sputnik's chain native format).
function formatSubmitted(submissionTime: string, precision: "date" | "minute" | "iso"): string {
  try {
    const iso = new Date(Number(BigInt(submissionTime) / 1_000_000n)).toISOString();
    if (precision === "date") return iso.slice(0, 10);
    if (precision === "minute") return `${iso.slice(0, 16).replace("T", " ")} UTC`;
    return iso;
  } catch {
    return "—";
  }
}

function exportProposalsCsv(rows: Proposal[]): void {
  downloadCsv(`payouts-${csvTimestamp()}.csv`, rows, [
    { header: "proposal_id", value: (r) => r.proposalId },
    { header: "status", value: (r) => r.status },
    { header: "submitted_utc", value: (r) => formatSubmitted(r.submissionTime, "iso") },
    { header: "token_symbol", value: (r) => tokenSymbol(r.tokenId) },
    { header: "token_id", value: (r) => r.tokenId },
    { header: "amount_base_units", value: (r) => r.amount },
    { header: "amount_display", value: (r) => formatTokenAmount(r.amount, r.tokenId) },
    { header: "receiver", value: (r) => r.receiverId },
    { header: "proposer", value: (r) => r.proposer },
    { header: "description", value: (r) => r.description },
  ]);
}
