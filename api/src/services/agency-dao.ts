import { and, count, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { billings, budgets, organizationDaos, prepayments } from "../db/schema";
import type { Network } from "../lib/network";
import { agencyDaoOf, type OrganizationScope } from "./organization-access";
import type { ProjectDirectory } from "./project-directory";
import { type DaoRole, isSputnikDao, networkOf } from "./sputnik";

export type DaoRoles = (daoAccountId: string) => Promise<DaoRole[]>;

export type AgencyDaoStatus = {
  daoAccountId: string | null;
  network: Network;
  inUse: boolean;
};

export type ConnectRequest = {
  organizationId: string;
  daoAccountId: string;
  network: Network;
  walletAccounts: string[] | null;
};

const badRequest = (message: string) => new ORPCError("BAD_REQUEST", { message });
const forbidden = (message: string) => new ORPCError("FORBIDDEN", { message });

export function createAgencyDaoService(deps: {
  db: Database;
  directory: ProjectDirectory;
  daoRoles: DaoRoles;
}) {
  const { db, directory, daoRoles } = deps;

  async function countBudgets(projectIds: string[]) {
    if (projectIds.length === 0) return 0;
    const [row] = await db
      .select({ n: count() })
      .from(budgets)
      .where(inArray(budgets.projectId, projectIds));
    return row?.n ?? 0;
  }

  async function countBillings(daoAccountId: string, projectIds: string[]) {
    const [row] = await db
      .select({ n: count() })
      .from(billings)
      .where(
        or(
          eq(billings.payingDaoAccountId, daoAccountId),
          projectIds.length > 0
            ? and(isNull(billings.payingDaoAccountId), inArray(billings.projectId, projectIds))
            : undefined,
        ),
      );
    return row?.n ?? 0;
  }

  async function countPrepayments(daoAccountId: string) {
    const [row] = await db
      .select({ n: count() })
      .from(prepayments)
      .where(eq(prepayments.daoAccountId, daoAccountId));
    return row?.n ?? 0;
  }

  const treasuryReferences = [
    (_dao: string, projectIds: string[]) => countBudgets(projectIds),
    (dao: string, projectIds: string[]) => countBillings(dao, projectIds),
    (dao: string) => countPrepayments(dao),
  ];

  async function inUse(scope: OrganizationScope): Promise<boolean> {
    const dao = scope.agencyDao;
    if (!dao) return false;
    const projectIds = (await directory.forAgency(scope).list()).map((p) => p.id);
    const counts = await Promise.all(
      treasuryReferences.map((references) => references(dao, projectIds)),
    );
    return counts.some((n) => n > 0);
  }

  async function requireUnreferenced(scope: OrganizationScope): Promise<void> {
    if (await inUse(scope)) {
      throw forbidden(
        "This Agency DAO holds Prepayments or funds Budget entries or Billings of your Projects, so it cannot be changed or disconnected.",
      );
    }
  }

  async function requireDao(daoAccountId: string, network: Network): Promise<DaoRole[]> {
    if (!isSputnikDao(daoAccountId)) {
      throw badRequest(`${daoAccountId} is not a Sputnik DAO account.`);
    }
    const daoNetwork = networkOf(daoAccountId);
    if (daoNetwork !== network) {
      throw badRequest(
        `${daoAccountId} is a ${daoNetwork} DAO. Switch the network to ${daoNetwork}.`,
      );
    }
    try {
      return await daoRoles(daoAccountId);
    } catch {
      throw badRequest(`No Sputnik DAO ${daoAccountId} was found on ${network}.`);
    }
  }

  function requireWalletRole(roles: DaoRole[], walletAccounts: string[]): void {
    const members = new Set(roles.filter((r) => !r.isEveryone).flatMap((r) => r.members));
    if (!walletAccounts.some((account) => members.has(account))) {
      throw forbidden(
        "Your linked NEAR wallet must hold a role in this DAO. Link a wallet that is a DAO member and try again.",
      );
    }
  }

  async function requireFree(daoAccountId: string, organizationId: string): Promise<void> {
    const [taken] = await db
      .select()
      .from(organizationDaos)
      .where(
        and(
          eq(organizationDaos.daoAccountId, daoAccountId),
          ne(organizationDaos.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (taken) throw badRequest(`${daoAccountId} is already connected to another Organization.`);
  }

  async function connect(request: ConnectRequest, current: OrganizationScope | null) {
    const daoAccountId = request.daoAccountId.trim();
    const roles = await requireDao(daoAccountId, request.network);
    if (request.walletAccounts) requireWalletRole(roles, request.walletAccounts);
    await requireFree(daoAccountId, request.organizationId);

    const existing = await agencyDaoOf(db, request.organizationId);
    if (existing === daoAccountId) return { daoAccountId };
    if (existing && current) await requireUnreferenced(current);
    if (existing && !current) {
      throw forbidden("This Organization already has an Agency DAO.");
    }

    await db
      .insert(organizationDaos)
      .values({ organizationId: request.organizationId, daoAccountId })
      .onConflictDoUpdate({ target: organizationDaos.organizationId, set: { daoAccountId } });
    return { daoAccountId };
  }

  return {
    status: async (scope: OrganizationScope): Promise<AgencyDaoStatus> => ({
      daoAccountId: scope.agencyDao,
      network: scope.network,
      inUse: await inUse(scope),
    }),

    connectForMember: (
      scope: OrganizationScope,
      request: { daoAccountId: string; network: Network; walletAccounts: string[] },
    ) => connect({ organizationId: scope.organizationId, ...request }, scope),

    connectAsPlatformAdmin: (organizationId: string, daoAccountId: string, network: Network) =>
      connect({ organizationId, daoAccountId, network, walletAccounts: null }, null),

    disconnect: async (scope: OrganizationScope) => {
      await requireUnreferenced(scope);
      await db
        .delete(organizationDaos)
        .where(eq(organizationDaos.organizationId, scope.organizationId));
      return { daoAccountId: null };
    },
  };
}

export type AgencyDaoService = ReturnType<typeof createAgencyDaoService>;
