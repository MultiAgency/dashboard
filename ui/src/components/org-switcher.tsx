import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { Building2, Check, Mail, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { usePendingInvitations } from "@/components/pending-invitations";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions } from "@/lib/auth";
import {
  invalidateWorkspaceQueries,
  myOrganizationsQueryOptions,
  setActiveOrganizationKey,
} from "@/lib/queries";
import { activeWorkspace, recoveryTarget, switchWorkspace } from "@/lib/workspace";
import { CreateOrganizationForm } from "./create-organization-form";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
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
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const recoveredRef = useRef(false);
  const [creating, setCreating] = useState(false);

  const { data: session } = useQuery(sessionQueryOptions(auth));
  const activeOrgId = session?.session?.activeOrganizationId ?? null;
  const orgsQuery = useQuery(myOrganizationsQueryOptions(apiClient));
  const organizations = orgsQuery.data?.data ?? [];
  const activeOrg = activeWorkspace(organizations, activeOrgId);
  const invitationCount = usePendingInvitations().data?.length ?? 0;

  const switchMutation = useMutation({
    mutationFn: (orgId: string) => switchWorkspace(auth, orgId),
    onSuccess: async (ok, orgId) => {
      if (!ok) {
        toast.error("Could not switch Organization — try signing out and back in.");
        return;
      }
      setActiveOrganizationKey(orgId);
      await queryClient.fetchQuery(sessionQueryOptions(auth));
      await invalidateWorkspaceQueries(queryClient, router);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not switch Organization — try signing out and back in.");
    },
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (recoveredRef.current || !orgsQuery.isSuccess || switchMutation.isPending) return;
    const target = recoveryTarget(organizations, activeOrgId);
    if (!target) return;
    recoveredRef.current = true;
    switchMutation.mutate(target);
  }, [activeOrgId, organizations, orgsQuery.isSuccess, switchMutation]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="flex items-center gap-2 text-xs text-muted-foreground max-w-[120px] sm:max-w-[180px]"
            aria-label={`Organization: ${activeOrg?.name ?? "none"}`}
          >
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline truncate min-w-0">
              {activeOrg?.name ?? "organization"}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            organizations
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {organizations.map((org) => (
            <DropdownMenuItem
              key={org.id}
              className="flex items-center justify-between gap-2 cursor-pointer"
              onClick={() => {
                if (org.id !== activeOrgId) switchMutation.mutate(org.id);
              }}
            >
              <span className="truncate min-w-0 flex-1">{org.name}</span>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {org.role ?? ""}
              </span>
              {org.id === activeOrgId && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
            </DropdownMenuItem>
          ))}
          {organizations.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              You are not in an Organization yet. Create one, or accept an invitation.
            </div>
          )}
          <DropdownMenuSeparator />
          {invitationCount > 0 && (
            <DropdownMenuItem asChild className="cursor-pointer gap-2">
              <Link to="/profile" hash="invitations">
                <Mail className="h-3.5 w-3.5" />
                {invitationCount} pending invitation{invitationCount === 1 ? "" : "s"}
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="cursor-pointer gap-2" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            create organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
            <DialogDescription>
              You become its owner. Connect a treasury later in Settings to use money features.
            </DialogDescription>
          </DialogHeader>
          <CreateOrganizationForm onCreated={() => setCreating(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
