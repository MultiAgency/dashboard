import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Building2, Check } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { sessionQueryOptions } from "@/lib/auth";
import { isAgencyWorkspace } from "@/lib/org-metadata";
import { invalidateWorkspaceQueries } from "@/lib/queries";
import { switchAgencyWorkspace } from "@/lib/workspace";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function OrgSwitcher() {
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const recoveredRef = useRef(false);

  const { data: session } = useQuery(sessionQueryOptions(auth));
  const activeOrgId = session?.session?.activeOrganizationId ?? null;

  const orgsQuery = useQuery({
    queryKey: ["organizations", "list"] as const,
    queryFn: async () => {
      const res = await auth.organization.list();
      return res.data ?? [];
    },
  });

  const switchMutation = useMutation({
    mutationFn: (orgId: string) => switchAgencyWorkspace(auth, orgId),
    onSuccess: async (ok) => {
      if (!ok) {
        toast.error("Could not switch agency — try signing out and back in.");
        return;
      }
      await queryClient.fetchQuery(sessionQueryOptions(auth));
      await invalidateWorkspaceQueries(queryClient, router);
    },
    onError: () => {
      toast.error("Could not switch agency — try signing out and back in.");
    },
  });

  const organizations = useMemo(
    () => (orgsQuery.data ?? []).filter((org) => isAgencyWorkspace(org.metadata)),
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground max-w-[180px]"
        >
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate min-w-0">{activeOrg?.name ?? "agency"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">agencies</DropdownMenuLabel>
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
        {organizations.length === 0 && (
          <DropdownMenuItem disabled className="text-muted-foreground">
            no agencies
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
