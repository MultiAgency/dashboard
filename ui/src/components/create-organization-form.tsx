import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Button, Input } from "@/components";
import { Field } from "@/components/admin-form";
import { landingDestination, refreshAccountQueries } from "@/lib/account";
import { useApiClient } from "@/lib/api";
import { availableSlug, isOrganizationSlugTaken, isValidSlug, slugify } from "@/lib/slugify";

class SlugTakenError extends Error {
  constructor(readonly suggestion: string | null) {
    super("This slug is already taken.");
  }
}

export function CreateOrganizationForm({ onCreated }: { onCreated?: () => void }) {
  const authClient = useAuthClient();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const slugTrimmed = slug.trim();

  const isTaken = async (candidate: string) => {
    const { error } = await authClient.organization.checkSlug({ slug: candidate });
    return !!error;
  };

  const create = useMutation({
    mutationFn: async () => {
      if (await isTaken(slugTrimmed)) {
        throw new SlugTakenError(await availableSlug(slugTrimmed, isTaken));
      }
      const { data, error } = await authClient.organization.create({
        name: name.trim(),
        slug: slugTrimmed,
      });
      if (isOrganizationSlugTaken(error?.code)) {
        throw new SlugTakenError(await availableSlug(slugTrimmed, isTaken));
      }
      if (error || !data?.id)
        throw new Error(error?.message ?? "Could not create the Organization");
      const { error: activeError } = await authClient.organization.setActive({
        organizationId: data.id,
      });
      if (activeError) throw new Error(activeError.message ?? "Could not open the Organization");
      await refreshAccountQueries(queryClient);
      return landingDestination({ authClient, apiClient, queryClient });
    },
    onSuccess: (destination) => {
      toast.success(`Organization "${name.trim()}" created`);
      onCreated?.();
      navigate({ to: destination, replace: true });
    },
    onError: (e: Error) => {
      if (e instanceof SlugTakenError) {
        setSuggestion(e.suggestion);
        return;
      }
      toast.error(e.message);
    },
  });

  const canSubmit = name.trim().length > 0 && isValidSlug(slugTrimmed) && !create.isPending;

  return (
    <form
      autoComplete="off"
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) create.mutate();
      }}
    >
      <Field label="name" htmlFor="create-organization-name">
        <Input
          id="create-organization-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          disabled={create.isPending}
          required
        />
      </Field>
      <Field
        label="slug"
        htmlFor="create-organization-slug"
        helper="Unique across the platform. Others use it to find your Organization."
      >
        <Input
          id="create-organization-slug"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSuggestion(null);
            create.reset();
            setSlug(
              e.target.value
                .toLowerCase()
                .replace(/\s+/g, "-")
                .replace(/[^a-z0-9-]/g, ""),
            );
          }}
          placeholder="lowercase-with-hyphens"
          disabled={create.isPending}
          required
        />
        {create.error instanceof SlugTakenError && (
          <p className="text-xs text-destructive">
            “{slugTrimmed}” is already taken.
            {suggestion && (
              <>
                {" "}
                <button
                  type="button"
                  className="underline text-foreground"
                  onClick={() => {
                    setSlug(suggestion);
                    setSlugTouched(true);
                    setSuggestion(null);
                    create.reset();
                  }}
                >
                  Use “{suggestion}”
                </button>
              </>
            )}
          </p>
        )}
      </Field>
      <Button type="submit" disabled={!canSubmit}>
        {create.isPending ? "creating..." : "create organization"}
      </Button>
    </form>
  );
}
