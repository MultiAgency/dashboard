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
  let stage: "starting" | "created" | "invited" = "starting";
  let clientOrganizationId: string | null = null;

  try {
    const { data: session, error: sessionError } = await authClient.getSession();
    if (sessionError || !session?.user?.id) {
      throw new Error(sessionError?.message || "Sign in again to create a Client Organization");
    }
    if (session.session.activeOrganizationId !== input.agencyOrganizationId) {
      throw new Error("Select the Agency Organization again before creating a Client");
    }
    const created = await authClient.organization.create({
      name: input.name.trim(),
      slug: slugify(input.name),
      metadata: { handoverOwnerUserId: session.user.id },
      keepCurrentActiveOrganization: true,
    });
    if (created.error) throw new Error(created.error.message || "Could not create Organization");
    if (!created.data?.id) throw new Error("Could not create Organization");
    stage = "created";
    clientOrganizationId = created.data.id;

    const invited = await authClient.organization.inviteMember({
      organizationId: clientOrganizationId,
      email: input.adminEmail.trim().toLowerCase(),
      role: "owner",
    });
    if (invited.error) throw new Error(invited.error.message || "Could not invite first admin");
    stage = "invited";

    return await apiClient.engagements.propose({ clientOrganizationId });
  } catch (error) {
    const detail = errorMessage(error);
    if (stage === "created") {
      throw new Error(
        `Client Organization ${clientOrganizationId} was created, but its invitation failed: ${detail}`,
      );
    }
    if (stage === "invited") {
      throw new Error(
        `Client Organization ${clientOrganizationId} and invitation were created, but Engagement setup failed: ${detail}. Propose an Engagement using this Organization ID.`,
      );
    }
    throw new Error(detail);
  }
}
