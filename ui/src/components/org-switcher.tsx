import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Building2, Check, Plus } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/components";
import { sessionQueryOptions } from "@/lib/auth";
import { isOrganization } from "@/lib/org-metadata";
import { listOrganizations, switchOrganization } from "@/lib/organizations";
import { invalidateOrganizationQueries } from "@/lib/queries";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function OrgSwitcher({ onboarding = false }: { onboarding?: boolean }) {
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const recoveredRef = useRef(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  const { data: session } = useQuery(sessionQueryOptions(auth));
  const activeOrgId = session?.session?.activeOrganizationId ?? null;

  const orgsQuery = useQuery({
    queryKey: ["organizations", "list"] as const,
    queryFn: () => listOrganizations(auth),
  });

  const switchMutation = useMutation({
    mutationFn: (orgId: string) => switchOrganization(auth, orgId),
    onSuccess: async (ok) => {
      if (!ok) {
        toast.error("Could not switch Organization — try signing out and back in.");
        return;
      }
      await queryClient.fetchQuery(sessionQueryOptions(auth));
      await invalidateOrganizationQueries(queryClient, router);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not switch Organization — try signing out and back in.");
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const result = await auth.organization.create({
        name: name.trim(),
        slug: slug.trim(),
        metadata: {},
      });
      if (result.error) throw new Error(result.error.message || "Could not create Organization");
      if (!result.data?.id) throw new Error("Could not create Organization");
      const organization = result.data;
      const switched = await switchOrganization(auth, organization.id).catch(() => false);
      return { organization, switched };
    },
    onSuccess: async ({ organization, switched }) => {
      setCreateOpen(false);
      setName("");
      setSlug("");
      setSlugEdited(false);
      await invalidateOrganizationQueries(queryClient, router);
      if (switched) {
        toast.success(`Organization "${organization.name}" created`);
        await router.navigate({ to: "/admin/projects" });
      } else {
        toast.warning(`Organization "${organization.name}" created. Select it from the menu.`);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const organizations = useMemo(
    () => (orgsQuery.data ?? []).filter((org) => isOrganization(org.metadata)),
    [orgsQuery.data],
  );
  const activeOrg = organizations.find((o) => o.id === activeOrgId);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (recoveredRef.current || orgsQuery.isLoading || switchMutation.isPending) return;
    if (organizations.length === 0 || activeOrg) return;
    recoveredRef.current = true;
    switchMutation.mutate(organizations[0]!.id);
  }, [activeOrg, organizations, orgsQuery.isLoading, switchMutation]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() && slug.trim() && !createMutation.isPending) createMutation.mutate();
  };

  return (
    <>
      {onboarding ? (
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          create Organization
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={activeOrg?.name ?? "Create or switch Organization"}
              className="flex items-center gap-2 text-xs text-muted-foreground max-w-[180px]"
            >
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate min-w-0">
                {activeOrg?.name ??
                  (organizations.length === 0 ? "create Organization" : "Organization")}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              organizations
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {organizations.map((org) => (
              <DropdownMenuItem
                key={org.id}
                className="flex items-center justify-between cursor-pointer"
                onClick={() => switchMutation.mutate(org.id)}
              >
                <span className="truncate min-w-0 flex-1">{org.name}</span>
                {org.id === activeOrgId && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
              </DropdownMenuItem>
            ))}
            {organizations.length === 0 && !orgsQuery.isError && (
              <DropdownMenuItem disabled className="text-muted-foreground">
                no Organizations yet
              </DropdownMenuItem>
            )}
            {orgsQuery.isError && (
              <DropdownMenuItem onSelect={() => void orgsQuery.refetch()}>
                could not load · retry
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              create Organization
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => !createMutation.isPending && setCreateOpen(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
            <DialogDescription>
              Your Organization can run Projects right away. Money features need an Agency DAO
              later.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submit}>
            <label htmlFor="new-organization-name" className="grid gap-1 text-sm">
              name
              <Input
                id="new-organization-name"
                value={name}
                onChange={(event) => {
                  const value = event.target.value;
                  setName(value);
                  if (!slugEdited) setSlug(slugify(value));
                }}
                disabled={createMutation.isPending}
                required
              />
            </label>
            <label htmlFor="new-organization-slug" className="grid gap-1 text-sm">
              slug
              <Input
                id="new-organization-slug"
                value={slug}
                onChange={(event) => {
                  setSlugEdited(true);
                  setSlug(slugify(event.target.value));
                }}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                disabled={createMutation.isPending}
                required
              />
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={createMutation.isPending}
              >
                cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || !name.trim() || !slug.trim()}
              >
                {createMutation.isPending ? "creating..." : "create Organization"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
