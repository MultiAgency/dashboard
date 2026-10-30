import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useState } from "react";
import { toast } from "sonner";
import { Button, FieldError, Input } from "@/components";
import { Field } from "@/components/admin-form";
import { type ApiClient, useApiClient } from "@/lib/api";
import { isValidNearAccountId } from "@/lib/near-account";
import { refreshAfter } from "@/lib/queries";

type CreatedBuilder = Awaited<ReturnType<ApiClient["contributors"]["create"]>>["contributor"];

export function QuickCreateBuilder({
  onCreated,
  onCancel,
}: {
  onCreated: (builder: CreatedBuilder) => void;
  onCancel?: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [nearAccount, setNearAccount] = useState("");
  const [name, setName] = useState("");
  const nearTrimmed = nearAccount.trim();
  const nearOk = nearTrimmed !== "" && isValidNearAccountId(nearTrimmed);

  const create = useMutation({
    mutationFn: async () => {
      const { contributor } = await apiClient.contributors.create({
        nearAccount: nearTrimmed,
        name: name.trim() || undefined,
      });
      return contributor;
    },
    onSuccess: async (builder) => {
      await refreshAfter(queryClient, { type: "builders" });
      toast.success(`${builder.name ?? builder.nearAccount} added`);
      onCreated(builder);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to add the builder"),
  });

  const canSubmit = nearOk && !create.isPending;
  const submit = () => {
    if (canSubmit) create.mutate();
  };
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    submit();
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
      <p className="text-sm font-medium">New builder</p>
      <Field label="NEAR account" htmlFor="qc-builder-near" helper="Where they get paid.">
        <Input
          id="qc-builder-near"
          placeholder="builder.near"
          value={nearAccount}
          disabled={create.isPending}
          aria-invalid={nearTrimmed !== "" && !nearOk ? true : undefined}
          onKeyDown={onEnter}
          onChange={(e) => setNearAccount(e.target.value)}
        />
        {nearTrimmed !== "" && !nearOk && <FieldError>Invalid NEAR account ID</FieldError>}
      </Field>
      <Field label="Name" htmlFor="qc-builder-name">
        <Input
          id="qc-builder-name"
          value={name}
          disabled={create.isPending}
          onKeyDown={onEnter}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={!canSubmit} onClick={submit}>
          {create.isPending ? "Adding…" : "Add builder"}
        </Button>
        {onCancel && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={create.isPending}
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
