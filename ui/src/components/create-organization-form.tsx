import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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
  const slugTaken = create.error instanceof SlugTakenError;
  const slugMalformed = slugTrimmed.length > 0 && !isValidSlug(slugTrimmed);
  const slugInvalid = slugTaken || slugMalformed;

  const applySuggestion = (value: string) => {
    setSlug(value);
    setSlugTouched(true);
    setSuggestion(null);
    create.reset();
  };

  return (
    <form
      autoComplete="off"
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) create.mutate();
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="create-organization-name">Name</FieldLabel>
          <Input
            id="create-organization-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            placeholder="Acme Studio"
            disabled={create.isPending}
            required
          />
        </Field>
        <Field data-invalid={slugInvalid || undefined}>
          <FieldLabel htmlFor="create-organization-slug">Slug</FieldLabel>
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
            placeholder="acme-studio"
            aria-invalid={slugInvalid || undefined}
            aria-describedby="create-organization-slug-description"
            disabled={create.isPending}
            required
          />
          <FieldDescription id="create-organization-slug-description">
            Unique across the platform. Others use it to find your Organization.
          </FieldDescription>
          {slugMalformed && !slugTaken && (
            <FieldError aria-live="polite">
              Use lowercase letters, numbers and single hyphens.
            </FieldError>
          )}
          {slugTaken && (
            <FieldError aria-live="polite">“{slugTrimmed}” is already taken.</FieldError>
          )}
          {slugTaken && suggestion && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => applySuggestion(suggestion)}
              >
                Use “{suggestion}”
              </Button>
            </div>
          )}
        </Field>
      </FieldGroup>
      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit}>
          {create.isPending && <Spinner data-icon="inline-start" />}
          {create.isPending ? "Creating…" : "Create Organization"}
        </Button>
      </div>
    </form>
  );
}
