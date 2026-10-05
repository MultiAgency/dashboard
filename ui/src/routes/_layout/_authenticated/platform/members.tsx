import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DataTable,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Textarea,
} from "@/components";
import { VerifiedGithub } from "@/components/admin/contributors-section";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import type { ColumnDef } from "@/components/ui/data-table";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { platformMembersQueryKey, platformMembersQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/platform/members")({
  head: () => ({
    meta: [{ title: "Members | Platform" }],
  }),
  component: PlatformMembers,
});

type Member = Awaited<ReturnType<ApiClient["members"]["list"]>>["data"][number];
type Network = Member["admissions"][number]["network"];

function admissionOn(member: Member, network: Network) {
  const admission = member.admissions.find((a) => a.network === network);
  if (!admission) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant={admission.status === "admitted" ? "secondary" : "outline"}>
      {admission.status}
    </Badge>
  );
}

function PlatformMembers() {
  const apiClient = useApiClient();
  const membersQuery = useQuery(platformMembersQueryOptions(apiClient));
  const [recording, setRecording] = useState<string | null>(null);
  const members = membersQuery.data?.data ?? [];

  const columns: ColumnDef<Member>[] = [
    {
      id: "githubLogin",
      header: "Member",
      accessorKey: "githubLogin",
      cell: ({ row }) => (
        <div className="flex flex-col gap-1">
          <VerifiedGithub login={row.original.githubLogin} />
          {row.original.name && (
            <span className="text-xs text-muted-foreground">{row.original.name}</span>
          )}
        </div>
      ),
    },
    {
      id: "kind",
      header: "Kind",
      accessorKey: "kind",
      cell: ({ row }) =>
        row.original.operatorGithubLogin ? (
          <span>
            agent ·{" "}
            <span className="text-muted-foreground">@{row.original.operatorGithubLogin}</span>
          </span>
        ) : (
          row.original.kind
        ),
    },
    {
      id: "testnet",
      header: "Testnet",
      accessorFn: (row) => row.admissions.find((a) => a.network === "testnet")?.status ?? "",
      cell: ({ row }) => admissionOn(row.original, "testnet"),
    },
    {
      id: "mainnet",
      header: "Mainnet",
      accessorFn: (row) => row.admissions.find((a) => a.network === "mainnet")?.status ?? "",
      cell: ({ row }) => admissionOn(row.original, "mainnet"),
    },
    {
      id: "agreement",
      header: "Services agreement",
      accessorFn: (row) => row.agreement?.version ?? "",
      cell: ({ row }) =>
        row.original.agreement ? (
          <span>
            {row.original.agreement.version}{" "}
            <span className="text-muted-foreground">
              · {row.original.agreement.attestedAt.slice(0, 10)}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">None</span>
        ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRecording(row.original.githubLogin)}
          >
            {row.original.agreement ? "Update agreement" : "Record agreement"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Members"
        description="Everyone the contribution board has admitted, with their admission on each network and whether a services agreement is on file. Only platform admins see agreements."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/platform">Workspaces</Link>
          </Button>
        }
      />

      {recording && (
        <RecordAgreementForm
          key={recording}
          githubLogin={recording}
          existing={members.find((m) => m.githubLogin === recording)?.agreement ?? null}
          onDone={() => setRecording(null)}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Board members</h2>
          </CardTitle>
          <CardDescription>
            Members come from the board's join flow. The board verifies each GitHub login and NEAR
            account; agreements are recorded here.
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">{members.length}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {membersQuery.isError ? (
            <LoadError
              title="Could not load members"
              description={membersQuery.error?.message || "Check your connection and try again."}
              onRetry={() => void membersQuery.refetch()}
            />
          ) : (
            <DataTable
              columns={columns}
              data={members}
              isLoading={membersQuery.isLoading}
              emptyMessage="No members yet. The board adds them when it admits someone."
              searchPlaceholder="Search members…"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RecordAgreementForm({
  githubLogin,
  existing,
  onDone,
}: {
  githubLogin: string;
  existing: Member["agreement"];
  onDone: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [version, setVersion] = useState(existing?.version ?? "");
  const [attestedOn, setAttestedOn] = useState(existing?.attestedAt.slice(0, 10) ?? "");
  const [proof, setProof] = useState("");

  const recordMutation = useMutation({
    mutationFn: () =>
      apiClient.members.recordAgreement({
        githubLogin,
        version: version.trim(),
        attestedAt: new Date(`${attestedOn}T00:00:00.000Z`).toISOString(),
        proof: proof.trim(),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: platformMembersQueryKey });
      toast.success(`Agreement recorded for @${githubLogin}`);
      onDone();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to record the agreement"),
  });

  const canSubmit = Boolean(version.trim() && attestedOn && proof.trim());
  const isPending = recordMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Services agreement for @{githubLogin}</h2>
        </CardTitle>
        <CardDescription>
          Recording an agreement makes this member internal. The proof stays private: it's never
          shown again, including here.
        </CardDescription>
      </CardHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !isPending) recordMutation.mutate();
        }}
      >
        <CardContent>
          <FieldGroup>
            <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
              <Field>
                <FieldLabel htmlFor="agreement-version">Agreement version</FieldLabel>
                <Input
                  id="agreement-version"
                  name="agreement-version"
                  autoComplete="off"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="e.g. 2026-09"
                  disabled={isPending}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="agreement-date">Signed on</FieldLabel>
                <Input
                  id="agreement-date"
                  name="agreement-date"
                  type="date"
                  value={attestedOn}
                  onChange={(e) => setAttestedOn(e.target.value)}
                  disabled={isPending}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="agreement-proof">Proof</FieldLabel>
              <Textarea
                id="agreement-proof"
                name="agreement-proof"
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                placeholder="Where the signed agreement lives, or its signature"
                disabled={isPending}
              />
              <FieldDescription>
                Stored privately. Recording again replaces the previous agreement.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || isPending}>
            {isPending ? "Recording…" : "Record agreement"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
