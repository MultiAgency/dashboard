import { getRepository } from "@/app";

export const FORK_REPO_URL = "https://github.com/MultiAgency/dashboard";

export function getRepoUrl(): string {
  return getRepository() ?? FORK_REPO_URL;
}
