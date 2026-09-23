import type { Organizations } from "./organization-access";
import type { PluginsClient } from "./plugins-types.gen";

export function createAuthOrganizations(auth: PluginsClient["auth"]): Organizations {
  return {
    daoOf: async (organizationId) => {
      try {
        const { daoAccountId } = await auth().getDao({ organizationId });
        return daoAccountId ?? null;
      } catch {
        return null;
      }
    },

    nameOf: async (context, organizationId) => {
      try {
        const org = await auth(context).getFullOrganization({ organizationId, membersLimit: 1 });
        return org?.name ?? null;
      } catch {
        return null;
      }
    },
  };
}
