import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components";
import { Checkbox } from "@/components/ui/checkbox";
import { useApiClient } from "@/lib/api";
import { publicProjectQueryOptions, publicTeamQueryOptions } from "@/lib/queries";

export function PublicTeamSetting({
  projectId,
  slug,
  isPublic,
}: {
  projectId: string;
  slug: string;
  isPublic: boolean;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const settingQuery = useQuery(publicTeamQueryOptions(apiClient, projectId));
  const showTeam = settingQuery.data?.showTeam ?? false;

  const saveMutation = useMutation({
    mutationFn: (next: boolean) =>
      apiClient.agency.projects.setPublicTeam({ projectId, showTeam: next }),
    onSuccess: async (data) => {
      queryClient.setQueryData(publicTeamQueryOptions(apiClient, projectId).queryKey, data);
      await queryClient.invalidateQueries({
        queryKey: publicProjectQueryOptions(apiClient, slug).queryKey,
      });
      toast.success(data.showTeam ? "Team shown on the public page" : "Team hidden");
    },
    onError: (err: Error) => toast.error(err.message || "Could not save"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Public page</h2>
        </CardTitle>
        <CardDescription>
          {isPublic ? (
            <>
              Anyone can see this project at{" "}
              <Link
                to="/work/$slug"
                params={{ slug }}
                className="underline underline-offset-4 hover:text-foreground"
              >
                /work/{slug}
              </Link>
              .
            </>
          ) : (
            "This project is not public, so it has no public page."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal">
          <Checkbox
            id={`public-team-${projectId}`}
            checked={showTeam}
            disabled={settingQuery.isLoading || saveMutation.isPending}
            onCheckedChange={(checked) => saveMutation.mutate(checked === true)}
          />
          <FieldContent>
            <FieldLabel htmlFor={`public-team-${projectId}`}>
              Show the team on the public page
            </FieldLabel>
            <FieldDescription>
              Lists the builders on this project by name and role. Off by default.
            </FieldDescription>
          </FieldContent>
        </Field>
      </CardContent>
    </Card>
  );
}
