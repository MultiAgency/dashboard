import { PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
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
  FieldError,
  FieldGroup,
  Input,
  Textarea,
} from "@/components";
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
import { adminContributorsListQueryOptions, refreshAfter } from "@/lib/queries";

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
          className="font-medium hover:underline"
        >
          {row.original.name ?? row.original.nearAccount}
        </Link>
      ),
    },
    {
      id: "nearAccount",
      header: "NEAR",
      accessorKey: "nearAccount",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.nearAccount}</span>,
    },
    {
      id: "skills",
      header: "Skills",
      accessorFn: (row) => row.skills.join(", "),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.skills.slice(0, 3).map((s) => (
            <Badge key={s} variant="outline">
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
        <span className="text-muted-foreground">{row.original.location ?? "—"}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button asChild variant="ghost" size="icon-sm">
            <Link
              to="/admin/contributors/$nearAccount"
              params={{ nearAccount: row.original.nearAccount }}
              aria-label={`Edit ${row.original.name ?? row.original.nearAccount}`}
            >
              <PencilSimpleIcon aria-hidden />
            </Link>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {creating && <ContributorCreateForm onDone={() => setCreating(false)} />}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Builder directory</h2>
          </CardTitle>
          <CardDescription>
            Profiles are shared across Agencies and keyed by NEAR account.
          </CardDescription>
          {!creating && (
            <CardAction>
              <Button size="sm" onClick={() => setCreating(true)}>
                <PlusIcon data-icon="inline-start" aria-hidden />
                New builder
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={contributorsQuery.data?.data ?? []}
            isLoading={contributorsQuery.isLoading}
            error={contributorsQuery.error}
            onRetry={() => contributorsQuery.refetch()}
            emptyMessage="No builders yet"
            csvFilename="builders"
            viewId="admin-builders"
            searchPlaceholder="Search builders…"
          />
        </CardContent>
      </Card>
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
      await refreshAfter(queryClient, { type: "builders" });
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
      <CardHeader>
        <CardTitle>
          <h2>New builder</h2>
        </CardTitle>
        <CardDescription>Only the NEAR account is required.</CardDescription>
      </CardHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) createMutation.mutate();
        }}
      >
        <CardContent>
          <FieldGroup>
            <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
              <Field label="NEAR account" htmlFor="new-near">
                <Input
                  id="new-near"
                  value={nearAccount}
                  onChange={(e) => setNearAccount(e.target.value)}
                  placeholder="contributor.near"
                  disabled={isPending}
                  aria-invalid={nearTrimmed && !nearOk ? true : undefined}
                />
                {nearTrimmed && !nearOk && <FieldError>Invalid NEAR account ID</FieldError>}
              </Field>
              <Field label="Name" htmlFor="new-name">
                <Input
                  id="new-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isPending}
                />
              </Field>
            </div>
            <Field label="Bio" htmlFor="new-bio">
              <Textarea
                id="new-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                disabled={isPending}
              />
            </Field>
            <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
              <Field
                label="Skills"
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
              <Field label="Location" htmlFor="new-location">
                <Input
                  id="new-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Berlin, DE"
                  disabled={isPending}
                />
              </Field>
              <Field label="GitHub" htmlFor="new-github">
                <Input
                  id="new-github"
                  value={github}
                  onChange={(e) => setGithub(e.target.value)}
                  placeholder="https://github.com/..."
                  disabled={isPending}
                />
              </Field>
              <Field label="Website" htmlFor="new-website">
                <Input
                  id="new-website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://..."
                  disabled={isPending}
                />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="button" onClick={onDone} variant="outline" disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {isPending ? "Creating…" : "Create builder"}
          </Button>
        </CardFooter>
      </form>
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
      await refreshAfter(queryClient, { type: "builders" });
      toast.success("Profile saved");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save profile"),
  });

  const isPending = saveMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Profile</h2>
        </CardTitle>
        <CardDescription>Shown to every Agency that works with this builder.</CardDescription>
        {!contributor.registered && (
          <CardAction>
            <Badge variant="outline">Not registered yet</Badge>
          </CardAction>
        )}
      </CardHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!isPending) saveMutation.mutate();
        }}
      >
        <CardContent>
          <FieldGroup>
            <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
              <Field label="Name" htmlFor="edit-name">
                <Input
                  id="edit-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isPending}
                />
              </Field>
              <Field label="Location" htmlFor="edit-location">
                <Input
                  id="edit-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  disabled={isPending}
                />
              </Field>
            </div>
            <Field label="Bio" htmlFor="edit-bio">
              <Textarea
                id="edit-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                disabled={isPending}
              />
            </Field>
            <Field label="Skills" htmlFor="edit-skills" helper="Comma-separated">
              <Input
                id="edit-skills"
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                disabled={isPending}
              />
            </Field>
            <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
              <Field label="GitHub" htmlFor="edit-github">
                <Input
                  id="edit-github"
                  value={github}
                  onChange={(e) => setGithub(e.target.value)}
                  disabled={isPending}
                />
              </Field>
              <Field label="Website" htmlFor="edit-website">
                <Input
                  id="edit-website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  disabled={isPending}
                />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save profile"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
