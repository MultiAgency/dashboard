import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check } from "lucide-react";
import { useAuthClient } from "@/app";
import { sessionQueryOptions } from "@/lib/auth";
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

  const { data: session } = useQuery(sessionQueryOptions(auth));
  const activeOrgId = session?.session?.activeOrganizationId ?? null;

  const orgsQuery = useQuery({
    queryKey: ["organizations", "list"],
    queryFn: async () => {
      const res = await auth.organization.list();
      return res.data ?? [];
    },
  });

  const switchMutation = useMutation({
    mutationFn: async (orgId: string) => {
      const { error } = await auth.organization.setActive({ organizationId: orgId });
      if (error) throw new Error(error.message || "Failed to switch organization");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session"] });
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["me", "roles"] });
    },
  });

  const organizations = orgsQuery.data ?? [];
  const activeOrg = organizations.find((o) => o.id === activeOrgId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground max-w-[180px]"
        >
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate min-w-0">{activeOrg?.name ?? "workspace"}</span>
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
        {organizations.length === 0 && (
          <DropdownMenuItem disabled className="text-muted-foreground">
            no organizations
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
