import { getRepository } from "@/app";

export const TEMPLATE_REPO_URL = "https://github.com/MultiAgency/dashboard";

export function getRepoUrl(): string {
  return getRepository() ?? TEMPLATE_REPO_URL;
}
