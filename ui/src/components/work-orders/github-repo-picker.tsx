import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useState } from "react";
import { Button, Input } from "@/components";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useApiClient } from "@/lib/api";
import { workOrderGithubReposQueryOptions } from "@/lib/queries";

export const DEFAULT_GITHUB_ORGS = ["NEARBuilders", "MultiAgency"] as const;
const OTHER = "other";

const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function GithubRepoPicker({
  selected,
  onToggle,
  onClose,
}: {
  selected: string[];
  onToggle: (repo: string, checked: boolean) => void;
  onClose: () => void;
}) {
  const apiClient = useApiClient();
  const [choice, setChoice] = useState<string>(DEFAULT_GITHUB_ORGS[0]);
  const [otherInput, setOtherInput] = useState("");
  const [otherOrg, setOtherOrg] = useState("");
  const [search, setSearch] = useState("");
  const org = choice === OTHER ? otherOrg : choice;
  const reposQuery = useQuery(workOrderGithubReposQueryOptions(apiClient, org));
  const term = search.trim().toLowerCase();
  const repos = (reposQuery.data?.repos ?? []).filter(
    (r) =>
      !term ||
      r.fullName.toLowerCase().includes(term) ||
      r.description?.toLowerCase().includes(term),
  );

  const applyOther = () => setOtherOrg(otherInput.trim());
  const onOtherEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    applyOther();
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Import from GitHub</p>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={choice}
        onValueChange={(value) => {
          if (value) setChoice(value);
        }}
        aria-label="GitHub organization"
      >
        {DEFAULT_GITHUB_ORGS.map((name) => (
          <ToggleGroupItem key={name} value={name}>
            {name}
          </ToggleGroupItem>
        ))}
        <ToggleGroupItem value={OTHER}>Other</ToggleGroupItem>
      </ToggleGroup>
      {choice === OTHER && (
        <div className="flex gap-2">
          <Input
            aria-label="GitHub organization"
            placeholder="organization"
            value={otherInput}
            onKeyDown={onOtherEnter}
            onChange={(e) => setOtherInput(e.target.value)}
          />
          <Button type="button" size="sm" variant="outline" onClick={applyOther}>
            Load
          </Button>
        </div>
      )}
      {org !== "" && (
        <Input
          aria-label="Search repositories"
          placeholder="Search repositories"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      {org === "" ? null : reposQuery.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : reposQuery.error ? (
        <p className="text-sm text-muted-foreground">{reposQuery.error.message}</p>
      ) : repos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No public repositories match.</p>
      ) : (
        <ul
          className="flex max-h-64 flex-col gap-1 overflow-y-auto"
          aria-label={`${org} repositories`}
        >
          {repos.map((repo) => {
            const id = `gh-repo-${repo.fullName}`;
            const checked = selected.some((s) => sameRepo(s, repo.fullName));
            return (
              <li key={repo.fullName} className="flex items-start gap-2 py-1">
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={(value) => onToggle(repo.fullName, value === true)}
                />
                <label htmlFor={id} className="flex min-w-0 flex-1 flex-col text-sm">
                  <span className="truncate font-medium">{repo.fullName}</span>
                  {repo.description && (
                    <span className="truncate text-xs text-muted-foreground">
                      {repo.description}
                    </span>
                  )}
                </label>
                <a
                  href={`https://github.com/${repo.fullName}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${repo.fullName} on GitHub`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ArrowSquareOutIcon aria-hidden className="size-4" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
