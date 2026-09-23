import type { ApiClient } from "@/lib/api";
import type { AuthClient } from "@/lib/auth";

type Input = {
  name: string;
  adminEmail: string;
  agencyOrganizationId: string;
};

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "client"}-${crypto.randomUUID().slice(0, 8)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function createClientEngagement(
  authClient: AuthClient,
  apiClient: ApiClient,
  input: Input,
) {
  let stage: "starting" | "created" | "invited" | "proposed" | "accepted" = "starting";
  let engagement: Awaited<ReturnType<ApiClient["engagements"]["accept"]>> | null = null;
  let failure: unknown;
  let restored = true;

  try {
    const created = await authClient.organization.create({
      name: input.name.trim(),
      slug: slugify(input.name),
      metadata: {},
      keepCurrentActiveOrganization: true,
    });
    if (created.error) throw new Error(created.error.message || "Could not create Organization");
    if (!created.data?.id) throw new Error("Could not create Organization");
    stage = "created";
    const clientOrganizationId = created.data.id;

    const invited = await authClient.organization.inviteMember({
      organizationId: clientOrganizationId,
      email: input.adminEmail.trim().toLowerCase(),
      role: "owner",
    });
    if (invited.error) throw new Error(invited.error.message || "Could not invite first admin");
    stage = "invited";

    const proposed = await apiClient.engagements.propose({ clientOrganizationId });
    stage = "proposed";

    const activated = await authClient.organization.setActive({
      organizationId: clientOrganizationId,
    });
    if (activated.error)
      throw new Error(activated.error.message || "Could not activate Client Organization");

    engagement = await apiClient.engagements.accept({ id: proposed.id });
    stage = "accepted";
  } catch (error) {
    failure = error;
  } finally {
    if (stage !== "starting") {
      try {
        const result = await authClient.organization.setActive({
          organizationId: input.agencyOrganizationId,
        });
        restored = !result.error;
      } catch {
        restored = false;
      }
    }
  }

  if (failure) {
    const detail = errorMessage(failure);
    if (stage === "created") {
      throw new Error(`Client Organization was created, but its invitation failed: ${detail}`);
    }
    if (stage === "invited") {
      throw new Error(
        `Client Organization and invitation were created, but Engagement setup failed: ${detail}`,
      );
    }
    if (stage === "proposed") {
      throw new Error(`Client Engagement was proposed but still needs acceptance: ${detail}`);
    }
    throw new Error(detail);
  }

  if (!engagement) throw new Error("Client Engagement setup did not finish");
  return { engagement, restored };
}
