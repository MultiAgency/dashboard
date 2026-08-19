import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, DataTable, Input, Textarea } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field } from "@/components/admin-form";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import {
  buildContributorLinks,
  formatSkillsInput,
  parseSkillsInput,
  splitContributorLinks,
} from "@/lib/contributor-profile";
import { isValidNearAccountId } from "@/lib/near-account";
import { adminContributorsListQueryKey, adminContributorsListQueryOptions } from "@/lib/queries";

type Contributor = Awaited<ReturnType<ApiClient["contributors"]["list"]>>["data"][number];

export function ContributorsAdminSection() {
  const apiClient = useApiClient();
  const contributorsQuery = useQuery(adminContributorsListQueryOptions(apiClient));
  const [creating, setCreating] = useState(false);

  if (contributorsQuery.isError) {
    return <AdminError error={contributorsQuery.error} />;
  }

  const columns: ColumnDef<Contributor>[] = [
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      cell: ({ row }) => (
        <Link
          to="/admin/contributors/$nearAccount"
          params={{ nearAccount: row.original.nearAccount }}
          className="font-display text-sm uppercase tracking-tight font-bold hover:underline"
        >
          {row.original.name ?? row.original.nearAccount}
        </Link>
      ),
    },
    {
      id: "nearAccount",
      header: "NEAR",
      accessorKey: "nearAccount",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.nearAccount}</span>
      ),
    },
    {
      id: "skills",
      header: "Skills",
      accessorFn: (row) => row.skills.join(", "),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.skills.slice(0, 3).map((s) => (
            <Badge key={s} variant="outline" className="text-[10px]">
              {s}
            </Badge>
          ))}
          {row.original.skills.length > 3 && (
            <span className="text-xs text-muted-foreground">+{row.original.skills.length - 3}</span>
          )}
        </div>
      ),
    },
    {
      id: "location",
      header: "Location",
      accessorKey: "location",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.location ?? "—"}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <Link
          to="/admin/contributors/$nearAccount"
          params={{ nearAccount: row.original.nearAccount }}
          className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground hover:underline"
        >
          edit
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-end gap-3">
        <Button
          onClick={() => setCreating((v) => !v)}
          variant={creating ? "outline" : "default"}
          className="font-display uppercase tracking-wide"
        >
          {creating ? "cancel" : "+ new builder"}
        </Button>
      </header>

      {creating && <ContributorCreateForm onDone={() => setCreating(false)} />}

      <DataTable
        columns={columns}
        data={contributorsQuery.data?.data ?? []}
        isLoading={contributorsQuery.isLoading}
        error={contributorsQuery.error}
        onRetry={() => contributorsQuery.refetch()}
        emptyMessage="No builders yet. Create your first one above."
        csvFilename="builders"
        viewId="admin-builders"
        searchPlaceholder="Search builders…"
      />
    </div>
  );
}

function ContributorCreateForm({ onDone }: { onDone: () => void }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [nearAccount, setNearAccount] = useState("");
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [location, setLocation] = useState("");
  const [github, setGithub] = useState("");
  const [website, setWebsite] = useState("");

  const createMutation = useMutation({
    mutationFn: async () =>
      apiClient.contributors.create({
        nearAccount: nearAccount.trim(),
        name: name.trim() || undefined,
        bio: bio.trim() || undefined,
        skills: parseSkillsInput(skills),
        location: location.trim() || undefined,
        links: buildContributorLinks(github, website),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminContributorsListQueryKey });
      toast.success("Builder created");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to create builder"),
  });

  const isPending = createMutation.isPending;
  const nearTrimmed = nearAccount.trim();
  const nearOk = nearTrimmed.length > 0 && isValidNearAccountId(nearTrimmed);
  const canSubmit = nearOk && !isPending;

  return (
    <Card>
      <CardContent className="p-5 grid gap-4">
        <Field
          label="near account"
          htmlFor="new-near"
          helper="Required — builders are keyed by NEAR account."
        >
          <Input
            id="new-near"
            value={nearAccount}
            onChange={(e) => setNearAccount(e.target.value)}
            placeholder="contributor.near"
            disabled={isPending}
          />
          {nearTrimmed && !nearOk && (
            <p className="text-xs text-destructive">Invalid NEAR account id</p>
          )}
        </Field>
        <Field label="name (optional)" htmlFor="new-name">
          <Input
            id="new-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isPending}
          />
        </Field>
        <Field label="bio (optional)" htmlFor="new-bio">
          <Textarea
            id="new-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            disabled={isPending}
          />
        </Field>
        <Field
          label="skills (optional)"
          htmlFor="new-skills"
          helper="Comma-separated, e.g. react, rust, design"
        >
          <Input
            id="new-skills"
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            disabled={isPending}
          />
        </Field>
        <Field label="location (optional)" htmlFor="new-location">
          <Input
            id="new-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Berlin, DE"
            disabled={isPending}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="github (optional)" htmlFor="new-github">
            <Input
              id="new-github"
              value={github}
              onChange={(e) => setGithub(e.target.value)}
              placeholder="https://github.com/..."
              disabled={isPending}
            />
          </Field>
          <Field label="website (optional)" htmlFor="new-website">
            <Input
              id="new-website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://..."
              disabled={isPending}
            />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit}>
            {isPending ? "creating..." : "create builder"}
          </Button>
          <Button onClick={onDone} variant="outline" disabled={isPending}>
            cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ContributorProfileForm({
  nearAccount,
  contributor,
}: {
  nearAccount: string;
  contributor: Contributor;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const linkFields = splitContributorLinks(contributor.links);

  const [name, setName] = useState(contributor.name ?? "");
  const [bio, setBio] = useState(contributor.bio ?? "");
  const [skills, setSkills] = useState(formatSkillsInput(contributor.skills));
  const [location, setLocation] = useState(contributor.location ?? "");
  const [github, setGithub] = useState(linkFields.github);
  const [website, setWebsite] = useState(linkFields.website);

  const saveMutation = useMutation({
    mutationFn: async () =>
      apiClient.contributors.update({
        nearAccount,
        name: name.trim() || undefined,
        bio: bio.trim() || undefined,
        skills: parseSkillsInput(skills),
        location: location.trim() || undefined,
        links: buildContributorLinks(github, website),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["admin", "contributors", "detail", nearAccount],
      });
      await queryClient.invalidateQueries({ queryKey: adminContributorsListQueryKey });
      toast.success("Profile saved");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save profile"),
  });

  return (
    <Card>
      <CardContent className="p-5 grid gap-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          edit profile
          {!contributor.registered && (
            <span className="ml-2 text-muted-foreground/80">(not registered as builder yet)</span>
          )}
        </div>
        <Field label="name" htmlFor="edit-name">
          <Input
            id="edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saveMutation.isPending}
          />
        </Field>
        <Field label="bio" htmlFor="edit-bio">
          <Textarea
            id="edit-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            disabled={saveMutation.isPending}
          />
        </Field>
        <Field label="skills" htmlFor="edit-skills" helper="Comma-separated">
          <Input
            id="edit-skills"
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            disabled={saveMutation.isPending}
          />
        </Field>
        <Field label="location" htmlFor="edit-location">
          <Input
            id="edit-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={saveMutation.isPending}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="github" htmlFor="edit-github">
            <Input
              id="edit-github"
              value={github}
              onChange={(e) => setGithub(e.target.value)}
              disabled={saveMutation.isPending}
            />
          </Field>
          <Field label="website" htmlFor="edit-website">
            <Input
              id="edit-website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              disabled={saveMutation.isPending}
            />
          </Field>
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="w-fit font-display uppercase tracking-wide"
        >
          {saveMutation.isPending ? "saving..." : "save profile"}
        </Button>
      </CardContent>
    </Card>
  );
}
