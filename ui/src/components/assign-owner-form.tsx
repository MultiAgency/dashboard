import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Button, Card, CardContent, Input } from "@/components";
import { Field } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";

export function AssignOwnerForm() {
  const authClient = useAuthClient();
  const apiClient = useApiClient();
  const [organizationId, setOrganizationId] = useState("");
  const [email, setEmail] = useState("");

  const assign = useMutation({
    mutationFn: async () => {
      const wanted = email.trim().toLowerCase();
      const { data, error } = await authClient.admin.listUsers({
        query: { searchField: "email", searchOperator: "contains", searchValue: wanted, limit: 10 },
      });
      if (error) throw new Error(error.message ?? "Could not look up the user");
      const user = data?.users.find((u) => u.email.toLowerCase() === wanted);
      if (!user) throw new Error(`No account uses ${email.trim()}. Ask them to sign up first.`);
      await apiClient.platform.assignOwner({
        organizationId: organizationId.trim(),
        userId: user.id,
      });
    },
    onSuccess: () => {
      toast.success(`${email.trim()} is now an owner`);
      setOrganizationId("");
      setEmail("");
    },
    onError: (e: Error) => toast.error(e.message || "Could not assign the owner"),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    assign.mutate();
  };

  return (
    <Card>
      <CardContent className="p-4">
        <form className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={submit}>
          <Field label="organization id" htmlFor="assign-owner-organization">
            <Input
              id="assign-owner-organization"
              autoComplete="off"
              required
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              disabled={assign.isPending}
            />
          </Field>
          <Field label="new owner email" htmlFor="assign-owner-email">
            <Input
              id="assign-owner-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={assign.isPending}
            />
          </Field>
          <Button type="submit" size="sm" disabled={assign.isPending}>
            {assign.isPending ? "assigning..." : "assign owner →"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
