import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent, Input, Separator } from "@/components";
import { Field } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";

export function SetupYourAgency() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [daoAccountId, setDaoAccountId] = useState("");
  const [adminRoleName, setAdminRoleName] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const claim = useMutation({
    mutationFn: () =>
      apiClient.bootstrap.config({
        daoAccountId: daoAccountId.trim(),
        ...(adminRoleName.trim() ? { adminRoleName: adminRoleName.trim() } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "public"] });
      toast.success("Agency claimed");
      navigate({ to: "/settings" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canSubmit = daoAccountId.trim().length > 0 && !claim.isPending;

  return (
    <Card variant="hi-vis" className="animate-fade-in-up max-w-xl">
      <CardContent className="space-y-6 sm:p-8">
        <div className="space-y-3">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            bootstrap
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight uppercase leading-[0.95]">
            setup your agency
          </h1>
          <Separator className="bg-foreground" />
          <p className="font-mono text-xs leading-relaxed text-muted-foreground">
            point this dashboard at your sputnik dao to get started. you must be admin on the
            destination dao. once configured, the rest of the agency identity (name, taglines, nearn
            slug) is editable from settings.
          </p>
        </div>

        <Field label="DAO account ID">
          <Input
            value={daoAccountId}
            onChange={(e) => setDaoAccountId(e.target.value)}
            placeholder="your-dao.sputnik-dao.near"
            disabled={claim.isPending}
          />
        </Field>

        {showAdvanced ? (
          <Field label="Admin role name">
            <Input
              value={adminRoleName}
              onChange={(e) => setAdminRoleName(e.target.value)}
              placeholder="Admin"
              disabled={claim.isPending}
            />
            <p className="text-xs text-muted-foreground font-mono">
              defaults to <code>Admin</code> (Trezu convention). use <code>council</code> for raw
              sputnik daos, or whatever role name your dao's policy uses.
            </p>
          </Field>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdvanced(true)}
            className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className="size-3" />
            advanced · admin role name
          </button>
        )}

        <Button
          variant="primary"
          onClick={() => claim.mutate()}
          disabled={!canSubmit}
          className="font-display uppercase tracking-wide"
        >
          {claim.isPending ? "claiming..." : "setup your agency"}
        </Button>
      </CardContent>
    </Card>
  );
}
