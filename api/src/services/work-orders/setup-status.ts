import { isPlaceholderAgencyName } from "../../lib/agency-name";
import type { OrganizationScope } from "../organization-access";
import type { FundingCheck } from "../payouts/history";

export type SetupState = "ok" | "missing" | "warning" | "optional";

export type SetupCheck = {
  key: string;
  label: string;
  state: SetupState;
  detail: string | null;
  fixHref: string | null;
  required: boolean;
};

type Outcome = { state: SetupState; detail: string | null };

export type SetupStatusDeps = {
  organizationName: (organizationId: string) => Promise<string | null>;
  representative: (
    organizationId: string,
  ) => Promise<{ name: string | null; email: string | null }>;
  emailEnabled: boolean;
  esignEnabled: boolean;
  google: {
    serviceAccount: boolean;
    connection: (
      organizationId: string,
    ) => Promise<{ connected: boolean; email: string | null; error: string | null }>;
    settings: (organizationId: string) => Promise<{
      googleTemplateId: string | null;
      googleDocumentsFolderId: string | null;
      googleSignedFolderId: string | null;
      googleLastError: string | null;
    } | null>;
  };
  payouts: {
    connected: (organizationId: string) => Promise<boolean>;
    configured: (organizationId: string) => Promise<boolean>;
    readiness: (
      organizationId: string,
      payee: string,
    ) => Promise<{ ready: boolean; code?: string | null; reason: string | null }>;
    fundingCheck: (
      organizationId: string,
      needs: { near: bigint; priceUsd: string | null },
    ) => Promise<FundingCheck | null>;
  } | null;
  fundingNeeds: (scope: OrganizationScope) => Promise<{ near: bigint; priceUsd: string | null }>;
};

const SETTINGS = {
  organization: "/admin/settings#organization",
  workOrders: "/admin/settings#work-orders",
  payouts: "/admin/settings#platform-agent",
};

export function isPlaceholderRepresentativeEmail(email: string | null | undefined): boolean {
  const value = email?.trim().toLowerCase() ?? "";
  return value === "" || value.endsWith("@near.email");
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const ok = (detail: string | null = null): Outcome => ({ state: "ok", detail });
const missing = (detail: string): Outcome => ({ state: "missing", detail });
const warning = (detail: string): Outcome => ({ state: "warning", detail });
const optional = (detail: string): Outcome => ({ state: "optional", detail });

const listOf = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export function createSetupStatus(deps: SetupStatusDeps) {
  async function agencyName(organizationId: string): Promise<Outcome> {
    const name = (await deps.organizationName(organizationId))?.trim() ?? "";
    if (!isPlaceholderAgencyName(name, organizationId)) return ok(name);
    return missing(
      name
        ? `“${name}” looks like a placeholder; builders see it in every email and document`
        : "No name yet; builders see it in every email and document",
    );
  }

  async function representative(organizationId: string): Promise<Outcome> {
    const { name, email } = await deps.representative(organizationId);
    const lacking = [!name?.trim() && "name", !email?.trim() && "email"].filter(
      (item): item is string => !!item,
    );
    if (lacking.length > 0) {
      return missing(`Add the default representative's ${listOf(lacking)}`);
    }
    if (isPlaceholderRepresentativeEmail(email)) {
      return missing(`${email} is a placeholder address; agency emails would go nowhere`);
    }
    return ok(`${name} <${email}>`);
  }

  async function email(organizationId: string): Promise<Outcome> {
    if (!deps.emailEnabled) {
      return missing("Emails are off on this server. Ask your server admin to turn them on.");
    }
    const { email } = await deps.representative(organizationId);
    return ok(
      email && !isPlaceholderRepresentativeEmail(email)
        ? `Builders get emails; agency emails go to the representative (${email})`
        : "Builders get emails; agency emails go to the representative",
    );
  }

  async function signing(): Promise<Outcome> {
    return deps.esignEnabled
      ? ok("Builders sign the work order document")
      : warning("E-signature is off on this server. Builders accept the terms in MultiAgency.");
  }

  async function google(organizationId: string): Promise<Outcome> {
    const [connection, settings] = await Promise.all([
      deps.google.connection(organizationId),
      deps.google.settings(organizationId),
    ]);
    if (connection.connected && connection.error) {
      return warning(`Reconnect Google Drive: ${connection.error}`);
    }
    const linked = connection.connected || deps.google.serviceAccount;
    const lacking = [
      !settings?.googleTemplateId && "a template",
      !settings?.googleDocumentsFolderId && "a documents folder",
      !settings?.googleSignedFolderId && "a signed folder",
    ].filter((item): item is string => !!item);
    if (!linked) {
      return lacking.length === 3
        ? optional("Connect Drive to use your own template")
        : warning("Connect Drive to use the template you chose");
    }
    const via = connection.connected
      ? `Connected${connection.email ? ` as ${connection.email}` : ""}`
      : "Using the server's Google account";
    if (lacking.length === 3) {
      return optional(`${via}; choose a template and folders`);
    }
    if (lacking.length > 0) return warning(`${via}; choose ${listOf(lacking)}`);
    if (settings?.googleLastError) return warning(`Google Drive: ${settings.googleLastError}`);
    return ok(`${via}; template and folders chosen`);
  }

  function payoutsOutcomes(scope: OrganizationScope) {
    const payouts = deps.payouts;
    const organizationId = scope.organizationId;
    let configured: Promise<boolean> | null = null;
    const configuredOnce = () => {
      configured ??= payouts ? payouts.configured(organizationId) : Promise.resolve(false);
      return configured;
    };

    const agent = async (): Promise<Outcome> => {
      if (!payouts) return optional("Not on this server; requests are paid by DAO proposal");
      if (!(await payouts.connected(organizationId))) {
        return optional("None; requests are paid by DAO proposal");
      }
      if (!(await configuredOnce())) {
        return warning("Connected, but the owner's consent doesn't include payouts");
      }
      const check = await payouts.readiness(organizationId, "");
      if (!check.ready && check.code !== "payee_not_allowed") {
        return warning(check.reason ?? "The platform agent can't pay yet");
      }
      return ok("Rules applied; can pay approved requests");
    };

    const funding = async (): Promise<Outcome> => {
      if (!payouts || !(await configuredOnce())) {
        return optional("Set up a payout agent first");
      }
      const needs = await deps.fundingNeeds(scope);
      const bufferPercent = needs.priceUsd ? 2n : 0n;
      const needed = needs.near + (needs.near * bufferPercent) / 100n;
      const check = await payouts.fundingCheck(organizationId, {
        near: needed,
        priceUsd: needs.priceUsd,
      });
      if (!check) return optional("Its balance is shown on the platform agent's card");
      if (check.balanceNear === null) return warning("Couldn't read the agent's balance");
      const problems: string[] = [];
      if (check.lowBalance) {
        problems.push(
          `Holds ${check.balanceNear} NEAR, active work orders need ≈${check.neededNear} NEAR`,
        );
      }
      if (check.budgetTooLow) {
        problems.push(
          `$${check.monthlyBudgetUsd} monthly limit is below the ≈$${check.monthlyNeededUsd} active work orders need`,
        );
      } else if (
        check.monthlyRemainingUsd !== null &&
        check.monthlyNeededUsd !== null &&
        Number(check.monthlyNeededUsd) > Number(check.monthlyRemainingUsd)
      ) {
        problems.push(
          `$${check.monthlyRemainingUsd} left of this month's payout limit, active work orders need ≈$${check.monthlyNeededUsd}`,
        );
      }
      if (problems.length > 0) return warning(problems.join(". "));
      return ok(
        needed === 0n
          ? `Holds ${check.balanceNear} NEAR; no unpaid budgets yet`
          : `Holds ${check.balanceNear} NEAR, enough for the ≈${check.neededNear} NEAR active work orders need`,
      );
    };

    return { agent, funding };
  }

  async function run(
    key: string,
    label: string,
    required: boolean,
    fixHref: string | null,
    outcome: () => Promise<Outcome>,
  ): Promise<SetupCheck> {
    try {
      const { state, detail } = await outcome();
      return { key, label, state, detail, fixHref: state === "ok" ? null : fixHref, required };
    } catch (error) {
      return {
        key,
        label,
        state: "warning",
        detail: `Couldn't check: ${errorText(error)}`,
        fixHref,
        required,
      };
    }
  }

  return {
    checks: async (scope: OrganizationScope): Promise<SetupCheck[]> => {
      const organizationId = scope.organizationId;
      const payouts = payoutsOutcomes(scope);
      return Promise.all([
        run("agency_name", "Agency name", true, SETTINGS.organization, () =>
          agencyName(organizationId),
        ),
        run("representative", "Default representative", true, SETTINGS.workOrders, () =>
          representative(organizationId),
        ),
        run("email", "Email delivery", true, null, () => email(organizationId)),
        run("signing", "E-signature", true, null, signing),
        run("google", "Google Drive document", false, SETTINGS.workOrders, () =>
          google(organizationId),
        ),
        run("payouts_agent", "Payout agent", false, SETTINGS.payouts, payouts.agent),
        run("payouts_funding", "Payout agent funding", false, SETTINGS.payouts, payouts.funding),
      ]);
    },
  };
}

export type SetupStatus = ReturnType<typeof createSetupStatus>;
