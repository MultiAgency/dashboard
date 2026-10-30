import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../../db";
import {
  billings,
  type CompensationRequestRow,
  compensationRequests,
  type DRIVE_FILE_OUTCOMES,
  type WorkOrderDocumentRow,
  type WorkOrderEvidenceRow,
  type WorkOrderRow,
  type WorkOrderSignatureRow,
  workOrderDocuments,
  workOrderDriveFiles,
  workOrderEvidence,
  workOrderIntegrations,
  workOrderJobLock,
  workOrderOutbox,
  workOrderSignatures,
  workOrders,
} from "../../db/schema";
import { nearAccountsOf, type PluginContext } from "../../lib/organizations";
import { rememberedLogin, rememberLogin } from "../builder-logins";
import type { NotificationKind } from "../notifications";
import type { AgencyScope, OrganizationScope, TreasuryScope } from "../organization-access";
import { atomicToNear } from "../payouts/policy";
import { type FundingCheck, noUnsettledPayout, payoutRetryable } from "../payouts/service";
import type { Project, ProjectDirectory } from "../project-directory";
import { type DaoProposal, proposalDescription } from "../sputnik";
import { baseUnitsToDisplay, getTokenMetadata, NATIVE_TOKEN_ID } from "../tokens";
import { createAutoApproval, trustViewOf } from "./auto-approval";
import type { ConsistencyChecker } from "./consistency";
import type { EsignPort, EsignRole } from "./documenso";
import {
  codeIn,
  documentFields,
  longDate,
  missingFields,
  pdfText,
  requiredFields,
} from "./documents";
import { eventId, type WorkOrderEvent, type WorkOrderEventType } from "./events";
import { collectEvidence, summarizeActivity } from "./evidence";
import { cachedOrgRepos, type GhRepoOwnership, GitHubError, type GitHubPort } from "./github";
import type { DriveFile, GooglePort } from "./google";
import { type PriceFeed, type PriceQuote, USD, USD_DECIMALS, usdToTokens } from "./prices";
import { type Progress, progressOf } from "./progress";
import { assessRenewal, renewalCode } from "./renewal";
import {
  buildContributions,
  paymentSection,
  renderReport,
  servedReport,
  sha256Hex,
  templateAssessment,
} from "./report";
import {
  fromBase64,
  sha256Bytes,
  signedPdf,
  termsPdf,
  toBase64,
  withSignaturePage,
} from "./signing";
import type { Summarizer } from "./summarizer";
import { mappedValues, parseFieldMap, templateTags } from "./template-fields";
import { addDays, dateOf, daysBetween, nextPeriod, startOfDay, UTC, windowOf } from "./time";
import type {
  CollectedEvidence,
  EvidenceDetails,
  ManualItem,
  RenewalAssessment,
  RenewalThresholds,
  WorkOrderScope,
} from "./types";

export type BuilderProfile = {
  nearAccount: string;
  name: string | null;
  githubLogin: string | null;
  userId: string | null;
};

export type WorkOrderNotifier = {
  notify(input: {
    organizationId: string;
    kind: NotificationKind;
    payload: Record<string, string>;
    link: string;
    excludeUserId?: string | null;
    email?: boolean;
  }): Promise<unknown>;
  notifyUser(input: {
    userId: string;
    organizationId: string;
    kind: NotificationKind;
    payload: Record<string, string>;
    link: string;
  }): Promise<unknown>;
};

export type WorkOrderDeps = {
  db: Database;
  directory: ProjectDirectory;
  scopeOfOrganization: (organizationId: string) => Promise<AgencyScope>;
  agencyDaoOf: (organizationId: string) => Promise<string | null>;
  organizationName: (organizationId: string) => Promise<string>;
  builders: { get(nearAccount: string): Promise<BuilderProfile | null> };
  github: GitHubPort;
  ownership: (repo: string) => Promise<GhRepoOwnership>;
  proposal: (daoAccountId: string, proposalId: number) => Promise<DaoProposal | null>;
  proposalBond: (daoAccountId: string) => Promise<string>;
  prices?: PriceFeed | null;
  esign?: EsignPort | null;
  payouts?: {
    readiness(
      organizationId: string,
      payee: string,
      amountAtomic?: string | bigint | null,
      priceUsd?: string | null,
    ): Promise<{ ready: boolean; code?: string | null; reason: string | null }>;
    fundingCheck?(
      organizationId: string,
      needs: { near: bigint; priceUsd: string | null },
    ): Promise<FundingCheck | null>;
    send(
      organizationId: string,
      input: { requestId: string; recipient: string; amount: string },
    ): Promise<AgentPayoutView>;
    refresh(payout: AgentPayoutView): Promise<AgentPayoutView>;
    latest(requestId: string): Promise<AgentPayoutView | null>;
    ensurePayees?(organizationId: string): Promise<{ ok: boolean; reason: string | null }>;
    maintain?(): Promise<{
      intentsSettled: number;
      grantReminders: { organizationId: string; expiresAt: Date }[];
    }>;
  } | null;
  notifications: WorkOrderNotifier;
  thresholds: RenewalThresholds;
  outbox?: {
    enqueue(
      organizationId: string,
      workOrderId: string | null,
      event: WorkOrderEvent,
    ): Promise<unknown>;
    deliver?(): Promise<unknown>;
  } | null;
  summarizer?: Summarizer;
  consistency?: ConsistencyChecker | null;
  google?: GooglePort | null;
  googleFor?: (organizationId: string) => Promise<GooglePort | null>;
  userEmail?: (userId: string) => Promise<string | null>;
  appOrigin?: string;
  timeZone?: string;
  now?: () => Date;
};

export type AgentPayoutView = {
  id: string;
  organizationId: string;
  requestId: string;
  status:
    | "sending"
    | "queued"
    | "processing"
    | "paid"
    | "failed"
    | "refused"
    | "uncertain"
    | "needs_review";
  amount: string;
  correlationId: string | null;
  txHash: string | null;
  txUrl: string | null;
  reason: string | null;
  provenUnsent: boolean;
  createdAt: Date;
};

export type Signer = {
  name: string;
  role: "contractor" | "representative";
  signedAt: string | null;
};

export type WorkOrderFields = {
  code?: string;
  projectId: string;
  builderNearAccount: string;
  title: string;
  scope?: string | null;
  repos: string[];
  periodStart: string;
  periodEnd: string;
  graceDays?: number;
  tokenId: string;
  budgetAmount: string;
  payoutTokenId?: string | null;
  autoRenew?: boolean;
  githubLogin?: string | null;
  contractorName?: string | null;
  contractorEmail?: string | null;
  representativeName?: string | null;
  representativeEmail?: string | null;
  ipModel?: string | null;
  customFields?: Record<string, string> | null;
};

type WorkOrderStatus = WorkOrderRow["status"];
type RequestStatus = CompensationRequestRow["status"];

const COMMITTED: readonly RequestStatus[] = ["approved", "paying", "proposed", "paid"];
const OPEN_REQUEST: readonly RequestStatus[] = ["draft", "submitted"];
const EDITABLE: readonly WorkOrderStatus[] = ["draft", "offered", "accepted"];
const PAYABLE: readonly WorkOrderStatus[] = ["active", "ended", "exhausted"];
const FINAL: readonly WorkOrderStatus[] = ["terminated"];
const FAILED_PROPOSAL = new Set(["Rejected", "Removed", "Expired", "Moved"]);
const RECENT_MS = 7 * 86_400_000;
const ENDING_SOON_DAYS = 3;
const LOCK_ID = "work-orders";
const LOCK_MS = 15 * 60_000;
const TICK_LOCK_ID = "work-orders-tick";
const TICK_LOCK_MS = 2 * 60_000;
const SIGNATURE_LOCK_MS = 2 * 60_000;
const AUTO_PAY_RETRY_MS = 5 * 60_000;
const NO_AGENT = "No payout agent";
const UNKNOWN_PROJECT = "Unknown project";

const IN_FLIGHT: AgentPayoutView["status"][] = [
  "sending",
  "queued",
  "processing",
  "uncertain",
  "paid",
];
const STUCK_PAYING_MS = 10 * 60_000;
const DAO_PAYMENT_NOTE =
  "Being paid through a DAO proposal: automatic payment is off for this request. Link the proposal once it's created, or reject the request so the builder can request it again.";

function payoutInFlight(last: AgentPayoutView | null | undefined): boolean {
  return !!last && IN_FLIGHT.includes(last.status);
}

function unsettledPayoutReason(payout: AgentPayoutView): string {
  if (payout.status === "paid") return "The automatic payout already went out";
  if (IN_FLIGHT.includes(payout.status)) {
    return `The automatic payout is still being sent (${payout.status}); wait for it to settle`;
  }
  return `The last automatic payout is ${payout.status.replace(/_/g, " ")}: check the payout agent's history; if nothing went out, reject the request so the builder can request it again`;
}

const NOT_PAYING_NOW = new Set(["unavailable", "no_agent"]);
const NEEDS_REVIEW = "needs_review";

const nearAccountUrl = (account: string) =>
  `https://nearblocks.io/address/${encodeURIComponent(account)}`;

type FundingCode = "insufficient_balance" | "over_monthly_budget" | "over_cap";

function fundingCodeOf(text: string): FundingCode | null {
  if (/insufficient[_ ]balance/i.test(text)) return "insufficient_balance";
  if (/over_monthly_budget|spend_budget_exceeded|month's budget/i.test(text))
    return "over_monthly_budget";
  if (/over_cap|cap per payout/i.test(text)) return "over_cap";
  return null;
}

function emailHeaders(payload: string): { to: string | null; subject: string | null } {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== "object" || parsed === null) return { to: null, subject: null };
    const { to, subject } = parsed as Record<string, unknown>;
    return {
      to: typeof to === "string" ? to : null,
      subject: typeof subject === "string" ? subject : null,
    };
  } catch {
    return { to: null, subject: null };
  }
}

const REPO = /^[A-Za-z0-9-]{1,39}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const CODE = /^[A-Za-z0-9._-]{1,40}$/;
const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const badRequest = (reason: string, message: string) =>
  new ORPCError("BAD_REQUEST", { message, data: { reason } });
const notFound = (what = "Work order") =>
  new ORPCError("NOT_FOUND", { message: `${what} not found` });

export function repoOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+\/[^/]+)/i.exec(trimmed);
  const repo = match?.[1] ?? trimmed;
  return REPO.test(repo) ? repo : null;
}

export function termsHash(
  row: Pick<
    WorkOrderRow,
    | "code"
    | "projectId"
    | "builderNearAccount"
    | "title"
    | "scope"
    | "repos"
    | "periodStart"
    | "periodEnd"
    | "graceDays"
    | "tokenId"
    | "budgetAmount"
    | "payoutTokenId"
    | "autoRenew"
    | "githubLogin"
    | "contractorName"
    | "representativeName"
    | "ipModel"
  > & { customFields?: string | null },
): string {
  const custom = customFieldsOf(row.customFields ?? null);
  const terms = {
    autoRenew: row.autoRenew,
    budgetAmount: row.budgetAmount,
    builderNearAccount: row.builderNearAccount,
    code: row.code,
    contractorName: row.contractorName ?? null,
    githubLogin: row.githubLogin?.toLowerCase() ?? null,
    ipModel: row.ipModel ?? null,
    payoutTokenId: row.payoutTokenId ?? null,
    representativeName: row.representativeName ?? null,
    graceDays: row.graceDays,
    periodEnd: row.periodEnd,
    periodStart: row.periodStart,
    projectId: row.projectId,
    repos: [...parseList(row.repos)].map((r) => r.toLowerCase()).sort(),
    scope: row.scope ?? null,
    title: row.title,
    tokenId: row.tokenId,
    ...(Object.keys(custom).length > 0 ? { customFields: custom } : {}),
  };
  return createHash("sha256").update(JSON.stringify(terms), "utf8").digest("hex");
}

function isoOrNull(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function parseList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function customFieldsOf(raw: string | null): Record<string, string> {
  const value = parseJson<unknown>(raw, {});
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string" && v.trim() !== "")
      .map(([k, v]): [string, string] => [k, String(v)])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function customFieldsText(value: Record<string, string> | null | undefined): string | null {
  const clean = Object.fromEntries(
    Object.entries(value ?? {})
      .map(([k, v]): [string, string] => [k.trim(), v.trim()])
      .filter(([k, v]) => k && v)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return Object.keys(clean).length > 0 ? JSON.stringify(clean) : null;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const optionalText = (value: string | null | undefined) => value?.trim() || null;

const sum = (amounts: (string | null)[]) =>
  amounts.reduce((total, amount) => total + BigInt(amount ?? "0"), 0n);

export function createWorkOrdersService(deps: WorkOrderDeps) {
  const { db, directory } = deps;
  const orgRepos = cachedOrgRepos(deps.github, 10 * 60_000);
  const now = () => deps.now?.() ?? new Date();
  const timeZone = deps.timeZone ?? UTC;
  const today = () => dateOf(now(), timeZone);
  const windowOfRow = (row: Pick<WorkOrderRow, "periodStart" | "periodEnd" | "graceDays">) =>
    windowOf({ ...row, timeZone });
  const display = (amount: string | bigint, tokenId: string) => {
    if (tokenId !== USD) return baseUnitsToDisplay(amount.toString(), tokenId);
    const value = BigInt(amount);
    const factor = 10n ** BigInt(USD_DECIMALS);
    const cents = ((value % factor) / 10_000n).toString().padStart(2, "0");
    const whole = (value / factor).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `$${whole}${cents === "00" ? "" : `.${cents}`}`;
  };
  const adminLink = (id: string) => `/admin/work-orders/${id}`;
  const builderLink = (id: string) => `/work-orders/${id}`;
  const absolute = (path: string) => {
    if (!deps.appOrigin) return path;
    try {
      return new URL(path, deps.appOrigin).toString();
    } catch {
      return path;
    }
  };
  const decimalOf = (amount: string | bigint, tokenId: string) =>
    tokenId === USD
      ? display(amount, tokenId).replace(/[$,]/g, "")
      : (display(amount, tokenId).split(" ")[0] ?? amount.toString());
  const symbolOf = (tokenId: string) =>
    tokenId === USD ? "USD" : display("0", tokenId).split(" ").slice(1).join(" ") || tokenId;
  const payoutTokenOf = (row: Pick<WorkOrderRow, "tokenId" | "payoutTokenId">) =>
    row.tokenId === USD ? NATIVE_TOKEN_ID : row.tokenId;

  async function nearOf(
    row: WorkOrderRow,
    amount: bigint,
  ): Promise<{ near: bigint; priceUsd: string | null }> {
    if (row.tokenId !== USD) return { near: amount, priceUsd: null };
    if (!deps.prices) throw badRequest("NO_PRICES", "USD prices aren't available on this server");
    const decimals = getTokenMetadata(NATIVE_TOKEN_ID)?.decimals ?? 24;
    const quote = await deps.prices.price(NATIVE_TOKEN_ID);
    return { near: usdToTokens(amount, quote.priceUsd, decimals), priceUsd: quote.priceUsd };
  }

  async function priceOf(row: WorkOrderRow, request: CompensationRequestRow) {
    const tokenId = payoutTokenOf(row);
    if (row.tokenId !== USD) {
      return { tokenId, amount: request.approvedAmount ?? "0", priceUsd: null, pricedAt: null };
    }
    if (request.daoPaymentStartedAt && request.payoutAmount && request.priceUsd) {
      return {
        tokenId,
        amount: request.payoutAmount,
        priceUsd: request.priceUsd,
        pricedAt: request.pricedAt,
      };
    }
    if (!deps.prices) throw badRequest("NO_PRICES", "USD prices aren't available on this server");
    const decimals = getTokenMetadata(tokenId)?.decimals;
    if (decimals === undefined) throw badRequest("UNKNOWN_TOKEN", `${tokenId} isn't a known token`);
    let quote: PriceQuote;
    try {
      quote = await deps.prices.price(tokenId);
    } catch (error) {
      throw badRequest(
        "NO_PRICE",
        `Couldn't get the ${symbolOf(tokenId)} price: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const amount = usdToTokens(BigInt(request.approvedAmount ?? "0"), quote.priceUsd, decimals);
    if (amount <= 0n) throw badRequest("AMOUNT_NOT_POSITIVE", "The approved amount is too small");
    return { tokenId, amount: amount.toString(), priceUsd: quote.priceUsd, pricedAt: now() };
  }

  type PayoutQuote = Awaited<ReturnType<typeof priceOf>>;

  const lockedPrice = (payout: PayoutQuote) =>
    payout.priceUsd
      ? {
          payoutTokenId: payout.tokenId,
          payoutAmount: payout.amount,
          priceUsd: payout.priceUsd,
          pricedAt: payout.pricedAt,
        }
      : {};

  type Announcement = {
    request?: CompensationRequestRow | null;
    payout?: { txUrl: string | null; near: string; accountUrl?: string | null } | null;
    reportMd?: string | null;
    mismatches?: string[] | null;
    renewal?: WorkOrderEvent["renewal"];
    note?: string | null;
    document?: string | null;
    hold?: WorkOrderEvent["hold"];
  };

  async function contactsOf(row: WorkOrderRow, builder: BuilderProfile | null) {
    const lookup = async (userId: string | null | undefined) =>
      userId && deps.userEmail ? await deps.userEmail(userId).catch(() => null) : null;
    return {
      contractorEmail: row.contractorEmail ?? (await lookup(builder?.userId)),
      representativeEmail: row.representativeEmail,
    };
  }

  async function announce(row: WorkOrderRow, type: WorkOrderEventType, extra: Announcement = {}) {
    if (!deps.outbox) return;
    try {
      const [project, agencyName, builder] = await Promise.all([
        projectOf(row),
        deps.organizationName(row.organizationId).catch(() => row.organizationId),
        deps.builders.get(row.builderNearAccount).catch(() => null),
      ]);
      const contacts = await contactsOf(row, builder);
      const request = extra.request ?? null;
      const github = row.githubLogin ?? builder?.githubLogin ?? "";
      const event: WorkOrderEvent = {
        id: eventId(),
        type,
        createdAt: now().toISOString(),
        agency: { id: row.organizationId, name: agencyName },
        workOrder: {
          id: row.code,
          title: row.title,
          project: project?.title ?? UNKNOWN_PROJECT,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          budget: display(row.budgetAmount, row.tokenId),
        },
        contractor: {
          name: row.contractorName ?? builder?.name ?? row.builderNearAccount,
          email: contacts.contractorEmail,
          github,
          nearAccount: row.builderNearAccount,
        },
        representative: {
          name: row.representativeName ?? agencyName,
          email: contacts.representativeEmail,
        },
        request: request
          ? {
              id: `${row.code}-R${request.seq}`,
              status: request.status,
              requestedUsd: decimalOf(request.requestedAmount, row.tokenId),
              approvedUsd: request.approvedAmount
                ? decimalOf(request.approvedAmount, row.tokenId)
                : null,
              tokenAmount: request.approvedAmount ?? request.requestedAmount,
              symbol: symbolOf(row.tokenId),
              requested: display(request.requestedAmount, row.tokenId),
              approved: request.approvedAmount
                ? display(request.approvedAmount, row.tokenId)
                : null,
              note: request.note,
            }
          : null,
        payout: extra.payout ?? null,
        links: {
          contractor: absolute(builderLink(row.id)),
          review: absolute(adminLink(row.id)),
          report: null,
          confirm: absolute(builderLink(row.id)),
          document: extra.document ?? row.documentUrl ?? row.preparedDocumentUrl ?? null,
          sign: row.esignBuilderUrl ?? null,
          countersign: row.esignRepresentativeUrl ?? null,
          settings: absolute("/admin/settings#payouts"),
        },
        reportMd: extra.reportMd ?? null,
        terms:
          type === "work_order.created"
            ? {
                effectiveDate: row.periodStart,
                servicesAgreementDate: null,
                budgetUsd: decimalOf(row.budgetAmount, row.tokenId),
                budget: display(row.budgetAmount, row.tokenId),
                symbol: symbolOf(row.tokenId),
                ipModel: row.ipModel,
                payee: row.builderNearAccount,
                payoutMethod: "withdraw",
                contractorGithub: github,
                repos: parseList(row.repos),
                autoRenew: row.autoRenew,
                scope: row.scope,
              }
            : null,
        mismatches: extra.mismatches ?? null,
        note: extra.note ?? null,
        renewal: extra.renewal ?? null,
        hold: extra.hold ?? null,
      };
      await deps.outbox.enqueue(row.organizationId, row.id, event);
    } catch (error) {
      console.warn(`[API] work order ${row.code} ${type} couldn't be queued`, error);
    }
  }

  async function markSigned(
    row: WorkOrderRow,
    input: { sha: string; documentUrl: string | null; signedAt: Date; signers: Signer[] },
  ): Promise<WorkOrderRow> {
    const signed = await update(row.id, {
      status: "accepted",
      offeredAt: row.offeredAt ?? input.signedAt,
      acceptedAt: input.signedAt,
      acceptedByUserId: null,
      acceptedTermsHash: termsHash(row),
      signatureMethod: "google_esign",
      signedAt: input.signedAt,
      signers: JSON.stringify(input.signers),
      documentSha256: input.sha,
      documentUrl: input.documentUrl,
    });
    const payload = await payloadOf(signed);
    await notifyManagers(signed, "work_order_signed", payload);
    await notifyBuilder(signed, "work_order_signed", payload);
    await announce(signed, "work_order.signed", { document: signed.documentUrl });
    if ((await payeeOf(signed)).needsConfirmation) {
      await announce(signed, "work_order.confirm_payee");
      await notifyBuilder(signed, "work_order_confirm_payee", payload);
    }
    return autoActivate(signed, true);
  }

  async function integrationOf(organizationId: string) {
    const [row] = await db
      .select()
      .from(workOrderIntegrations)
      .where(eq(workOrderIntegrations.organizationId, organizationId))
      .limit(1);
    return row ?? null;
  }

  async function recordGoogle(organizationId: string, error: string | null, checked = false) {
    await db
      .update(workOrderIntegrations)
      .set({ googleLastError: error, ...(checked ? { googleCheckedAt: now() } : {}) })
      .where(eq(workOrderIntegrations.organizationId, organizationId));
  }

  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const reasonOf = (error: unknown) =>
    error instanceof ORPCError
      ? ((error.data as { reason?: string } | undefined)?.reason ?? null)
      : null;

  async function googleOf(organizationId: string): Promise<GooglePort | null> {
    return (await deps.googleFor?.(organizationId)) ?? deps.google ?? null;
  }

  async function fillGoogleDocument(row: WorkOrderRow): Promise<WorkOrderRow | null> {
    const google = await googleOf(row.organizationId);
    const settings = google ? await integrationOf(row.organizationId) : null;
    if (!google || !settings?.googleTemplateId || !settings.googleDocumentsFolderId) return null;
    const [project, agencyName, builder] = await Promise.all([
      projectOf(row),
      deps.organizationName(row.organizationId).catch(() => row.organizationId),
      deps.builders.get(row.builderNearAccount).catch(() => null),
    ]);
    const contacts = await contactsOf(row, builder);
    const fields = documentFields({
      code: row.code,
      project: documentProjectTitle(row, project),
      contractorName: row.contractorName ?? builder?.name ?? row.builderNearAccount,
      contractorEmail: contacts.contractorEmail,
      representativeName: row.representativeName ?? agencyName,
      representativeEmail: contacts.representativeEmail,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      budgetDecimal: decimalOf(row.budgetAmount, row.tokenId),
      budget: display(row.budgetAmount, row.tokenId),
      ipModel: row.ipModel,
      payee: row.builderNearAccount,
      github: row.githubLogin ?? builder?.githubLogin ?? "",
      repos: parseList(row.repos),
      autoRenew: row.autoRenew,
      scope: row.scope,
    });
    const { values, blank } = mappedValues({
      fields,
      map: parseFieldMap(settings.googleFieldMap),
      custom: customFieldsOf(row.customFields),
    });
    const copy = await google.copy(settings.googleTemplateId, {
      name: `Work Order ${row.code}: ${row.title}`,
      parentId: settings.googleDocumentsFolderId,
    });
    const occurrences = await google.fill(copy.id, values);
    const leftover = await google
      .read(copy.id)
      .then((doc) => templateTags(doc).map((t) => t.tag))
      .catch(() => [] as string[]);
    const warnings = [
      ...leftover.map((tag) => `Template tag {{${tag}}} wasn't filled`),
      ...blank.map((label) => `"${label}" was left blank`),
    ];
    const url = copy.webViewLink ?? `https://docs.google.com/document/d/${copy.id}/edit`;
    const updated = await update(row.id, {
      documentId: copy.id,
      preparedDocumentUrl: url,
      documentFields: JSON.stringify(requiredFields(values, occurrences)),
      documentWarning: warnings.length > 0 ? warnings.join("; ") : null,
    });
    await recordGoogle(row.organizationId, null);
    return updated;
  }

  async function draftDocument(row: WorkOrderRow, strict = false): Promise<WorkOrderRow> {
    try {
      const filled = await fillGoogleDocument(row);
      if (filled) return filled;
    } catch (error) {
      const message = `Couldn't fill the Google Docs template for ${row.code}: ${errorText(error)}`;
      await recordGoogle(row.organizationId, message);
      console.warn(`[API] ${message}`);
      if (strict) throw badRequest("GOOGLE_FAILED", message);
      return row;
    }
    await announce(row, "work_order.created");
    return row;
  }

  async function recordDriveFile(input: {
    organizationId: string;
    fileId: string;
    name: string;
    url: string | null;
    sha256: string | null;
    workOrderId: string | null;
    outcome: (typeof DRIVE_FILE_OUTCOMES)[number];
    note: string | null;
  }) {
    const values = { ...input, processedAt: now() };
    await db
      .insert(workOrderDriveFiles)
      .values(values)
      .onConflictDoUpdate({ target: workOrderDriveFiles.fileId, set: values });
  }

  async function checkSignedDocuments(organizationId: string) {
    const counts = { checked: 0, attached: 0, mismatch: 0, unmatched: 0, error: 0 };
    const google = await googleOf(organizationId);
    const settings = google ? await integrationOf(organizationId) : null;
    if (!google || !settings?.googleSignedFolderId) return counts;
    let files: DriveFile[];
    try {
      files = await google.listPdfs(settings.googleSignedFolderId);
    } catch (error) {
      const message = `Couldn't read the Signed folder: ${errorText(error)}`;
      await recordGoogle(organizationId, message, true);
      throw badRequest("GOOGLE_FAILED", message);
    }
    const done = new Set(
      (
        await db
          .select({ fileId: workOrderDriveFiles.fileId, outcome: workOrderDriveFiles.outcome })
          .from(workOrderDriveFiles)
          .where(eq(workOrderDriveFiles.organizationId, organizationId))
      )
        .filter((f) => f.outcome !== "error")
        .map((f) => f.fileId),
    );
    for (const { fileId } of await db
      .select({ fileId: workOrders.signedDriveFileId })
      .from(workOrders)
      .where(
        and(eq(workOrders.organizationId, organizationId), isNotNull(workOrders.signedDriveFileId)),
      )) {
      if (fileId) done.add(fileId);
    }
    let open = await db
      .select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.organizationId, organizationId),
          inArray(workOrders.status, ["draft", "offered"]),
        ),
      );
    for (const file of files.filter((f) => !done.has(f.id))) {
      counts.checked += 1;
      const base = { organizationId, fileId: file.id, name: file.name, url: file.webViewLink };
      try {
        const bytes = await google.download(file.id);
        const sha = createHash("sha256").update(bytes).digest("hex");
        const text = await pdfText(bytes);
        const named = open.filter((row) => codeIn(text, row.code));
        const filled = named.filter((r) => r.documentFields);
        const row = filled.length === 1 ? filled[0] : undefined;
        if (!row) {
          const note =
            named.length === 0
              ? "No unsigned work order's code is in this PDF"
              : filled.length > 1
                ? `More than one work order matches: ${filled.map((r) => r.code).join(", ")}`
                : `${named[0]?.code} has no filled document on record: use Fill the document first`;
          await recordDriveFile({
            ...base,
            sha256: sha,
            workOrderId: null,
            outcome: "unmatched",
            note,
          });
          counts.unmatched += 1;
          continue;
        }
        const missing = missingFields(
          text,
          parseJson<Record<string, string>>(row.documentFields, {}),
        );
        if (missing.length > 0) {
          await announce(row, "work_order.signature_mismatch", {
            mismatches: missing,
            document: file.webViewLink,
          });
          await recordDriveFile({
            ...base,
            sha256: sha,
            workOrderId: row.id,
            outcome: "mismatch",
            note: missing.join("; "),
          });
          counts.mismatch += 1;
          continue;
        }
        await markSigned(row, {
          sha,
          documentUrl: file.webViewLink,
          signedAt: isoOrNull(file.createdTime) ?? now(),
          signers: [],
        });
        open = open.filter((r) => r.id !== row.id);
        await recordDriveFile({
          ...base,
          sha256: sha,
          workOrderId: row.id,
          outcome: "attached",
          note: null,
        });
        counts.attached += 1;
      } catch (error) {
        await recordDriveFile({
          ...base,
          sha256: null,
          workOrderId: null,
          outcome: "error",
          note: errorText(error),
        });
        counts.error += 1;
      }
    }
    await recordGoogle(organizationId, null, true);
    return counts;
  }

  async function termsRows(row: WorkOrderRow): Promise<[string, string][]> {
    const [project, agencyName, builder] = await Promise.all([
      projectOf(row),
      deps.organizationName(row.organizationId).catch(() => row.organizationId),
      deps.builders.get(row.builderNearAccount).catch(() => null),
    ]);
    const contacts = await contactsOf(row, builder);
    return [
      ["Work order", `${row.code}: ${row.title}`],
      ["Agency", agencyName],
      ["Project", documentProjectTitle(row, project)],
      ["Builder (contractor)", row.contractorName ?? builder?.name ?? row.builderNearAccount],
      ["Builder's email", contacts.contractorEmail ?? ""],
      ["Agency representative", row.representativeName ?? agencyName],
      ["Representative's email", contacts.representativeEmail ?? ""],
      ["Work period", `${longDate(row.periodStart)} to ${longDate(row.periodEnd)}`],
      [
        "Budget cap",
        `${display(row.budgetAmount, row.tokenId)}${row.tokenId === USD ? ", paid in NEAR at the price when each payment is made" : ""}`,
      ],
      ["Payout account (NEAR)", row.builderNearAccount],
      ["GitHub account", row.githubLogin ?? ""],
      ["Repositories in scope", parseList(row.repos).join(", ")],
      ["Authorized work", row.scope ?? ""],
      ["IP model", row.ipModel ?? ""],
      [
        "Monthly renewal",
        row.autoRenew
          ? "Renews monthly, with the same terms, while the base metrics are met; otherwise the representative decides."
          : "No",
      ],
      [
        "How work counts",
        "Work counts once the repository owner approves or merges it on GitHub. The budget is a maximum, not a guarantee; each payment follows an approved compensation request.",
      ],
    ];
  }

  async function prepareOfferDocument(row: WorkOrderRow) {
    let current = row;
    let pdf: Uint8Array;
    const google = await googleOf(row.organizationId);
    const settings = google ? await integrationOf(row.organizationId) : null;
    if (google && settings?.googleTemplateId && settings.googleDocumentsFolderId) {
      try {
        if (!current.documentId || !current.documentFields) {
          current = (await fillGoogleDocument(current)) ?? current;
        }
        if (!current.documentId) throw new Error("The template wasn't filled");
        pdf = await google.exportPdf(current.documentId);
      } catch (error) {
        const message = `Couldn't prepare the document of ${row.code}: ${errorText(error)}`;
        await recordGoogle(row.organizationId, message);
        throw badRequest("GOOGLE_FAILED", message);
      }
    } else {
      pdf = await termsPdf({
        title: `Work Order ${row.code}`,
        rows: await termsRows(row),
        footer:
          "Signed electronically in MultiAgency: each party reviews this document and signs it with their typed name; the builder signs in with the NEAR account above.",
      });
    }
    const sha256 = sha256Bytes(pdf);
    await db.insert(workOrderDocuments).values({
      id: crypto.randomUUID(),
      workOrderId: row.id,
      kind: "offered",
      fileName: `Work Order ${row.code}.pdf`,
      pdf: toBase64(pdf),
      sha256,
      termsHash: termsHash(current),
      createdAt: now(),
    });
    return current;
  }

  async function finalizeSigned(row: WorkOrderRow, offered: WorkOrderDocumentRow) {
    const signatures = await signaturesOf(row.id, offered.sha256);
    const ordered = (["contractor", "representative"] as const)
      .map((role) => signatures.find((s) => s.role === role))
      .filter((s): s is WorkOrderSignatureRow => Boolean(s));
    const completedAt = now();
    const final = await signedPdf({
      original: fromBase64(offered.pdf),
      title: `Work Order ${row.code}: ${row.title}`,
      documentSha256: offered.sha256,
      completedAt,
      signers: ordered.map((s) => ({
        role: s.role,
        name: s.name,
        email: s.email,
        nearAccount: s.nearAccount,
        ip: s.ip,
        userAgent: s.userAgent,
        signedAt: s.signedAt,
      })),
    });
    return storeSigned(row, offered, final, ordered, "in_app");
  }

  async function storeSigned(
    row: WorkOrderRow,
    offered: WorkOrderDocumentRow,
    final: Uint8Array,
    ordered: { name: string; role: "contractor" | "representative"; signedAt: Date }[],
    method: "in_app" | "documenso",
  ) {
    const completedAt = now();
    const sha256 = sha256Bytes(final);
    const fileName = `Work Order ${row.code} (signed).pdf`;
    await db.insert(workOrderDocuments).values({
      id: crypto.randomUUID(),
      workOrderId: row.id,
      kind: "signed",
      fileName,
      pdf: toBase64(final),
      sha256,
      termsHash: offered.termsHash,
      driveFileId: null,
      driveUrl: null,
      createdAt: completedAt,
    });
    const stored = await update(row.id, {
      signatureMethod: method,
      signedAt: completedAt,
      signers: JSON.stringify(
        ordered.map((s) => ({ name: s.name, role: s.role, signedAt: s.signedAt.toISOString() })),
      ),
      documentSha256: sha256,
      documentUrl: null,
      signedDriveFileId: null,
      signedDriveUrl: null,
      signedDriveError: null,
    });
    const signed = await saveSignedToDrive(stored);
    const driveUrl = signed.signedDriveUrl;
    const payload = await payloadOf(signed);
    await notifyManagers(signed, "work_order_signed", payload);
    await notifyBuilder(signed, "work_order_signed", payload);
    await announce(signed, "work_order.signed", {
      document: driveUrl ?? absolute(builderLink(row.id)),
    });
    return autoActivate(signed, true);
  }

  const driveAttempts = new Map<string, number>();
  const DRIVE_RETRY_MS = 5 * 60_000;

  async function saveSignedToDrive(row: WorkOrderRow): Promise<WorkOrderRow> {
    if (row.signedDriveFileId || !row.signedAt) return row;
    if (row.signatureMethod !== "in_app" && row.signatureMethod !== "documenso") return row;
    const google = await googleOf(row.organizationId);
    const settings = google ? await integrationOf(row.organizationId) : null;
    const folderId = settings?.googleSignedFolderId ?? settings?.googleDocumentsFolderId ?? null;
    if (!google || !folderId) return row;
    const doc = await latestDocument(row.id, "signed");
    if (!doc) return row;
    if (doc.driveFileId) {
      return update(row.id, {
        signedDriveFileId: doc.driveFileId,
        signedDriveUrl: doc.driveUrl ?? `https://drive.google.com/file/d/${doc.driveFileId}/view`,
        signedDriveError: null,
      });
    }
    driveAttempts.set(row.id, now().getTime());
    const name = `Work Order ${row.code} - ${row.title} (signed).pdf`.replace(/[\\/]/g, "-");
    try {
      const uploaded = await google.uploadPdf(folderId, name, fromBase64(doc.pdf));
      const url = uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`;
      await recordDriveFile({
        organizationId: row.organizationId,
        fileId: uploaded.id,
        name,
        url,
        sha256: doc.sha256,
        workOrderId: row.id,
        outcome: "attached",
        note: row.signatureMethod === "documenso" ? "Signed in Documenso" : "Signed in MultiAgency",
      });
      await db
        .update(workOrderDocuments)
        .set({ driveFileId: uploaded.id, driveUrl: url })
        .where(eq(workOrderDocuments.id, doc.id));
      driveAttempts.delete(row.id);
      return update(row.id, {
        signedDriveFileId: uploaded.id,
        signedDriveUrl: url,
        signedDriveError: null,
        documentUrl: row.documentUrl ?? url,
      });
    } catch (error) {
      const message = `Couldn't save the signed PDF of ${row.code} to Google Drive: ${errorText(error)}`;
      await recordGoogle(row.organizationId, message);
      return update(row.id, { signedDriveError: message });
    }
  }

  async function retryDriveUploads(counts: Record<string, number>) {
    const rows = await db
      .select()
      .from(workOrders)
      .where(
        and(
          isNotNull(workOrders.signedAt),
          isNull(workOrders.signedDriveFileId),
          isNotNull(workOrders.signedDriveError),
          inArray(workOrders.signatureMethod, ["in_app", "documenso"]),
        ),
      );
    for (const row of rows) {
      const last = driveAttempts.get(row.id);
      if (last !== undefined && now().getTime() - last < DRIVE_RETRY_MS) continue;
      const saved = await saveSignedToDrive(row).catch(() => row);
      if (saved.signedDriveFileId) counts.driveUploads = (counts.driveUploads ?? 0) + 1;
    }
  }

  function clientMeta(meta: { ip?: string | null; userAgent?: string | null } = {}) {
    return { ip: meta.ip?.slice(0, 100) ?? null, userAgent: meta.userAgent?.slice(0, 500) ?? null };
  }

  async function documentOf(row: WorkOrderRow) {
    const doc =
      (await latestDocument(row.id, "signed")) ?? (await latestDocument(row.id, "offered"));
    if (!doc) throw notFound("Document");
    return {
      kind: doc.kind,
      fileName: doc.fileName,
      sha256: doc.sha256,
      pdfBase64: doc.pdf,
      driveUrl: doc.driveUrl,
      current: doc.termsHash === termsHash(row),
    };
  }

  async function paidBefore(row: WorkOrderRow): Promise<boolean> {
    const dao = await deps.agencyDaoOf(row.organizationId).catch(() => null);
    if (!dao) return false;
    const paid = await db
      .select({ proposalId: billings.proposalId })
      .from(billings)
      .where(
        and(eq(billings.nearAccount, row.builderNearAccount), eq(billings.payingDaoAccountId, dao)),
      )
      .orderBy(desc(billings.createdAt))
      .limit(20);
    for (const billing of paid) {
      const id = Number(billing.proposalId);
      if (!Number.isInteger(id)) continue;
      const proposal = await deps.proposal(dao, id).catch(() => null);
      if (proposal?.status === "Approved") return true;
    }
    return false;
  }

  function paidBeforeOnce(row: WorkOrderRow, paidCache?: Map<string, Promise<boolean>>) {
    if (!paidCache) return paidBefore(row);
    const key = `${row.organizationId}:${row.builderNearAccount}`;
    const cached = paidCache.get(key) ?? paidBefore(row);
    paidCache.set(key, cached);
    return cached;
  }

  async function payeeOf(row: WorkOrderRow, paidCache?: Map<string, Promise<boolean>>) {
    if (row.payeeConfirmedAt) {
      return {
        account: row.builderNearAccount,
        confirmedAt: row.payeeConfirmedAt.toISOString(),
        paidBefore: null as boolean | null,
        needsConfirmation: false,
      };
    }
    const known = EDITABLE.includes(row.status) ? await paidBeforeOnce(row, paidCache) : null;
    return {
      account: row.builderNearAccount,
      confirmedAt: null,
      paidBefore: known,
      needsConfirmation: known === false,
    };
  }

  async function mustRow(id: string): Promise<WorkOrderRow> {
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, id)).limit(1);
    if (!row) throw notFound();
    return row;
  }

  async function ownRow(scope: OrganizationScope, id: string): Promise<WorkOrderRow> {
    const row = await mustRow(id);
    if (row.organizationId !== scope.organizationId) throw notFound();
    return row;
  }

  async function rememberBuilderLogin(
    organizationId: string,
    nearAccount: string,
    login: string | null,
    profile?: BuilderProfile | null,
  ) {
    if (!login) return;
    const builder =
      profile === undefined ? await deps.builders.get(nearAccount).catch(() => null) : profile;
    if (!builder || builder.githubLogin) return;
    await rememberLogin(db, organizationId, nearAccount, login, now());
  }

  async function mustRequest(id: string): Promise<CompensationRequestRow> {
    const [row] = await db
      .select()
      .from(compensationRequests)
      .where(eq(compensationRequests.id, id))
      .limit(1);
    if (!row) throw notFound("Compensation request");
    return row;
  }

  async function update(id: string, patch: Partial<WorkOrderRow>): Promise<WorkOrderRow> {
    const [row] = await db
      .update(workOrders)
      .set({ ...patch, updatedAt: now() })
      .where(eq(workOrders.id, id))
      .returning();
    if (!row) throw notFound();
    return row;
  }

  async function updateRequest(
    id: string,
    patch: Partial<CompensationRequestRow>,
  ): Promise<CompensationRequestRow> {
    const [row] = await db
      .update(compensationRequests)
      .set({ ...patch, updatedAt: now() })
      .where(eq(compensationRequests.id, id))
      .returning();
    if (!row) throw notFound("Compensation request");
    return row;
  }

  async function releasePaying(id: string) {
    await db
      .update(compensationRequests)
      .set({ status: "approved", updatedAt: now() })
      .where(and(eq(compensationRequests.id, id), eq(compensationRequests.status, "paying")));
  }

  async function updateUnpaid(
    id: string,
    patch: Partial<CompensationRequestRow>,
  ): Promise<CompensationRequestRow> {
    const [row] = await db
      .update(compensationRequests)
      .set({ ...patch, updatedAt: now() })
      .where(
        and(
          eq(compensationRequests.id, id),
          inArray(compensationRequests.status, ["approved", "paying"]),
          isNull(compensationRequests.daoPaymentStartedAt),
        ),
      )
      .returning();
    return row ?? mustRequest(id);
  }

  async function requestsOf(workOrderId: string) {
    return db
      .select()
      .from(compensationRequests)
      .where(eq(compensationRequests.workOrderId, workOrderId))
      .orderBy(asc(compensationRequests.seq));
  }

  async function evidenceOf(workOrderId: string) {
    return db
      .select()
      .from(workOrderEvidence)
      .where(eq(workOrderEvidence.workOrderId, workOrderId))
      .orderBy(asc(workOrderEvidence.occurredAt), asc(workOrderEvidence.url));
  }

  function amountsOf(row: WorkOrderRow, requests: CompensationRequestRow[]) {
    const committed = sum(
      requests.filter((r) => COMMITTED.includes(r.status)).map((r) => r.approvedAmount),
    );
    const paid = sum(requests.filter((r) => r.status === "paid").map((r) => r.approvedAmount));
    const budget = BigInt(row.budgetAmount);
    const remaining = budget > committed ? budget - committed : 0n;
    return { committed, paid, remaining };
  }

  function documentProjectTitle(row: WorkOrderRow, project: { title: string } | null): string {
    if (project) return project.title;
    throw badRequest(
      "PROJECT_UNAVAILABLE",
      `Couldn't load the project of ${row.code}, so its document wasn't made. Try again in a moment.`,
    );
  }

  async function projectOf(
    row: Pick<WorkOrderRow, "organizationId" | "projectId"> &
      Partial<Pick<WorkOrderRow, "projectTitle" | "projectSlug">>,
  ): Promise<{ title: string; slug: string } | null> {
    if (row.projectTitle) {
      return { title: row.projectTitle, slug: row.projectSlug ?? row.projectId };
    }
    const scope = await deps.scopeOfOrganization(row.organizationId);
    return directory
      .forAgency(scope)
      .require(row.projectId)
      .then((project) => ({ title: project.title, slug: project.slug }))
      .catch(() => null);
  }

  async function latestDocument(workOrderId: string, kind: "offered" | "signed") {
    const [doc] = await db
      .select()
      .from(workOrderDocuments)
      .where(
        and(eq(workOrderDocuments.workOrderId, workOrderId), eq(workOrderDocuments.kind, kind)),
      )
      .orderBy(desc(workOrderDocuments.createdAt))
      .limit(1);
    return doc ?? null;
  }

  async function signaturesOf(workOrderId: string, documentSha256: string) {
    return db
      .select()
      .from(workOrderSignatures)
      .where(
        and(
          eq(workOrderSignatures.workOrderId, workOrderId),
          eq(workOrderSignatures.documentSha256, documentSha256),
        ),
      );
  }

  function esignOf(row: WorkOrderRow) {
    if (!row.esignEnvelopeId && !row.esignError) return null;
    return {
      provider: "documenso" as const,
      sent: !!row.esignEnvelopeId,
      builderUrl: row.esignBuilderUrl,
      representativeUrl: row.esignRepresentativeUrl,
      error: row.esignError,
    };
  }

  async function signingOf(row: WorkOrderRow) {
    const offered = await latestDocument(row.id, "offered");
    const current = offered && offered.termsHash === termsHash(row) ? offered : null;
    return signingFrom(row, current, current ? await signaturesOf(row.id, current.sha256) : []);
  }

  function signingFrom(
    row: WorkOrderRow,
    offered: { sha256: string } | null,
    signatures: Pick<WorkOrderSignatureRow, "role" | "name" | "signedAt">[],
  ) {
    const esign = esignOf(row);
    if (!offered) {
      return {
        documentSha256: null,
        builder: null,
        representative: null,
        needsCountersign: false,
        awaitingRepresentative: false,
        esign,
      };
    }
    const signer = (role: "contractor" | "representative") => {
      const found = signatures.find((s) => s.role === role);
      return found ? { name: found.name, signedAt: found.signedAt.toISOString() } : null;
    };
    const builder = signer("contractor");
    const representative = signer("representative");
    return {
      documentSha256: offered.sha256,
      builder,
      representative,
      needsCountersign: builder !== null && representative === null,
      awaitingRepresentative:
        !!esign?.sent &&
        row.esignRepresentativeFirst &&
        row.status === "offered" &&
        representative === null,
      esign,
    };
  }

  async function syncPendingSignatures(): Promise<number> {
    if (!deps.esign) return 0;
    const pending = await db
      .select()
      .from(workOrders)
      .where(
        and(
          inArray(workOrders.status, ["offered", "accepted"]),
          isNotNull(workOrders.esignEnvelopeId),
          isNull(workOrders.signedAt),
        ),
      );
    for (const row of pending) {
      try {
        await syncSignatures(row);
      } catch (error) {
        console.warn(`[API] work order ${row.code} signature check failed`, error);
      }
    }
    return pending.length;
  }

  async function sendForSignature(row: WorkOrderRow) {
    const esign = deps.esign;
    if (!esign) return row;
    const builder = await deps.builders.get(row.builderNearAccount).catch(() => null);
    const contacts = await contactsOf(row, builder);
    const offered = await latestDocument(row.id, "offered");
    if (!offered) throw badRequest("NO_DOCUMENT", "The work order document wasn't prepared");
    const agencyName = await deps
      .organizationName(row.organizationId)
      .catch(() => row.organizationId);
    const signers = [
      {
        role: "representative" as const,
        name: row.representativeName ?? agencyName,
        email: contacts.representativeEmail ?? "",
      },
      {
        role: "contractor" as const,
        name: row.contractorName ?? builder?.name ?? row.builderNearAccount,
        email: contacts.contractorEmail ?? "",
      },
    ];
    const title = `Work Order ${row.code}: ${row.title}`;
    const { pdf, boxes } = await withSignaturePage({
      original: fromBase64(offered.pdf),
      title,
      signers,
    });
    const sha256 = sha256Bytes(pdf);
    try {
      const sent = await esign.send({
        title,
        externalId: row.id,
        fileName: offered.fileName,
        pdf,
        subject: `Please sign Work Order ${row.code}`,
        message: `${agencyName} signed Work Order ${row.code} (${row.title}) and sent it to you to review and sign.`,
        signers: signers.map((signer) => ({ ...signer, ...boxes[signer.role] })),
      });
      await db
        .update(workOrderDocuments)
        .set({ pdf: toBase64(pdf), sha256 })
        .where(eq(workOrderDocuments.id, offered.id));
      return await update(row.id, {
        esignEnvelopeId: sent.envelopeId,
        esignRepresentativeFirst: true,
        esignBuilderUrl: sent.signingUrls.contractor ?? null,
        esignRepresentativeUrl: sent.signingUrls.representative ?? null,
        esignError: null,
      });
    } catch (error) {
      const message = `Couldn't send ${row.code} for signature: ${errorText(error)}`;
      await update(row.id, { esignError: message });
      throw badRequest("ESIGN_FAILED", message);
    }
  }

  async function cancelEnvelope(row: WorkOrderRow, reason: string, strict = false) {
    if (!deps.esign || !row.esignEnvelopeId || row.signedAt) return;
    try {
      await deps.esign.cancel(row.esignEnvelopeId, reason);
    } catch (error) {
      console.warn(`[API] couldn't cancel the Documenso envelope of ${row.code}`, error);
      if (strict) {
        throw badRequest(
          "ESIGN_CANCEL_FAILED",
          `Couldn't withdraw ${row.code} in Documenso, so it wasn't deleted: ${errorText(error)}`,
        );
      }
    }
  }

  async function tryWithSignatureLock<T>(
    id: string,
    fn: () => Promise<T>,
  ): Promise<{ value: T } | null> {
    const holder = crypto.randomUUID();
    const lock = `signatures:${id}`;
    if (!(await claimLock(holder, lock, SIGNATURE_LOCK_MS))) return null;
    try {
      return { value: await fn() };
    } finally {
      await releaseLock(holder, lock);
    }
  }

  async function withSignatureLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const result = await tryWithSignatureLock(id, fn);
    if (!result) {
      throw badRequest("SIGNATURES_BUSY", "Signatures are being checked; try again in a moment");
    }
    return result.value;
  }

  async function syncSignatures(row: WorkOrderRow): Promise<WorkOrderRow> {
    if (!deps.esign || !row.esignEnvelopeId || row.signedAt) return row;
    const synced = await tryWithSignatureLock(row.id, async () =>
      syncEnvelope(await mustRow(row.id)),
    );
    return synced?.value ?? row;
  }

  async function syncEnvelope(row: WorkOrderRow): Promise<WorkOrderRow> {
    const esign = deps.esign;
    if (!esign || !row.esignEnvelopeId || row.signedAt) return row;
    if (row.status !== "offered" && row.status !== "accepted") return row;
    let state: Awaited<ReturnType<EsignPort["status"]>>;
    try {
      state = await esign.status(row.esignEnvelopeId, {
        representativeFirst: row.esignRepresentativeFirst,
      });
    } catch (error) {
      return update(row.id, { esignError: `Couldn't check Documenso: ${errorText(error)}` });
    }
    const offered = await latestDocument(row.id, "offered");
    if (!offered) return row;
    let current = row.esignError ? await update(row.id, { esignError: null }) : row;
    if (state.status === "rejected") {
      if (current.status !== "offered") return current;
      const reason = state.signers.find((s) => s.rejected)?.rejectionReason ?? "";
      const declined = await update(row.id, {
        status: "draft",
        offeredAt: null,
        esignEnvelopeId: null,
        esignBuilderUrl: null,
        esignRepresentativeUrl: null,
        esignError: `Declined in Documenso${reason ? `: ${reason}` : ""}`,
      });
      await notifyManagers(
        declined,
        "work_order_declined",
        await payloadOf(declined, { note: reason }),
      );
      return declined;
    }
    const existing = await signaturesOf(row.id, offered.sha256);
    const recorded: EsignRole[] = [];
    for (const signer of state.signers) {
      if (!signer.signedAt || existing.some((s) => s.role === signer.role)) continue;
      const inserted = await db
        .insert(workOrderSignatures)
        .values({
          id: crypto.randomUUID(),
          workOrderId: row.id,
          documentSha256: offered.sha256,
          role: signer.role,
          name: signer.name,
          email: signer.email,
          userId: null,
          nearAccount: signer.role === "contractor" ? row.builderNearAccount : null,
          ip: null,
          userAgent: null,
          signedAt: new Date(signer.signedAt),
        })
        .onConflictDoNothing()
        .returning({ id: workOrderSignatures.id });
      if (inserted.length > 0) recorded.push(signer.role);
    }
    const contractor = state.signers.find((s) => s.role === "contractor");
    if (
      recorded.includes("representative") &&
      current.status === "offered" &&
      !contractor?.signedAt &&
      state.status !== "completed"
    ) {
      await notifyBuilder(current, "work_order_offered", await payloadOf(current));
      await announce(current, "work_order.offered");
    }
    if (current.status === "offered" && contractor?.signedAt) {
      current = await update(row.id, {
        status: "accepted",
        acceptedAt: new Date(contractor.signedAt),
        acceptedTermsHash: termsHash(row),
        signatureMethod: "documenso",
        payeeConfirmedAt: row.payeeConfirmedAt ?? now(),
        payeeConfirmedBy: row.payeeConfirmedBy ?? row.builderNearAccount,
      });
      await notifyManagers(current, "work_order_accepted", await payloadOf(current));
      if (state.status !== "completed") {
        await announce(current, "work_order.builder_signed", { note: contractor.name });
      }
    }
    if (state.status !== "completed") return current;
    let final: Uint8Array;
    try {
      final = await esign.downloadSigned(row.esignEnvelopeId);
    } catch (error) {
      return update(row.id, {
        esignError: `Couldn't download the signed PDF: ${errorText(error)}`,
      });
    }
    const signatures = await signaturesOf(row.id, offered.sha256);
    const ordered = (["contractor", "representative"] as const)
      .map((role) => signatures.find((s) => s.role === role))
      .filter((s): s is WorkOrderSignatureRow => Boolean(s));
    return storeSigned(current, offered, final, ordered, "documenso");
  }

  function scopeOf(row: WorkOrderRow): WorkOrderScope {
    const activated = row.activatedAt ? dateOf(row.activatedAt, timeZone) : null;
    const start =
      !activated || activated <= row.periodStart
        ? row.periodStart
        : activated <= row.periodEnd
          ? activated
          : addDays(row.periodEnd, row.graceDays + 1);
    return {
      code: row.code,
      contractorGithub: row.githubLogin ?? "",
      repos: parseList(row.repos),
      periodStart: start,
      periodEnd: row.periodEnd,
      graceDays: row.graceDays,
      timeZone,
    };
  }

  function activationBlockers(
    row: WorkOrderRow,
    builder: BuilderProfile | null,
    payeeNeedsConfirmation: boolean,
    needsCountersign = false,
    awaitingRepresentative = false,
  ): string[] {
    if (row.status !== "draft" && row.status !== "offered" && row.status !== "accepted") return [];
    const out: string[] = [];
    if (row.status === "draft") {
      out.push("Offer it to the builder, or have the work order document e-signed");
    }
    if (row.status === "offered" && awaitingRepresentative) {
      out.push("Sign it in Documenso to send it to the builder");
    } else if (row.status === "offered") {
      out.push("Waiting for the builder to accept the terms or sign the document");
    }
    if (row.status === "accepted" && row.acceptedTermsHash !== termsHash(row)) {
      out.push("The terms changed after the builder accepted them");
    }
    if (needsCountersign) out.push("Countersign the work order");
    if (!builder) out.push("The builder has no profile on MultiAgency");
    if (!row.githubLogin) out.push("Add the builder's GitHub login");
    if (payeeNeedsConfirmation) {
      out.push(
        `The builder hasn't confirmed the payout account ${row.builderNearAccount} (this Agency hasn't paid it before)`,
      );
    }
    if (parseList(row.repos).length === 0) out.push("Add at least one GitHub repository");
    return out;
  }

  function evidenceView(row: WorkOrderEvidenceRow) {
    return {
      id: row.id,
      kind: row.kind,
      repo: row.repo,
      number: row.number,
      url: row.url,
      title: row.title,
      state: row.state,
      occurredAt: row.occurredAt?.toISOString() ?? null,
      assignedAt: row.assignedAt?.toISOString() ?? null,
      assignedBy: row.assignedBy,
      authorized: row.authorized,
      flags: parseJson<string[]>(row.flags, []),
      links: parseJson<string[]>(row.links, []),
    };
  }

  function collectedOf(row: WorkOrderEvidenceRow): CollectedEvidence {
    const view = evidenceView(row);
    return { ...view, details: parseJson<EvidenceDetails>(row.details, {}) };
  }

  async function requestView(
    request: CompensationRequestRow,
    row: WorkOrderRow,
    siblings?: CompensationRequestRow[],
    evidence?: WorkOrderEvidenceRow[],
  ) {
    const others = siblings ?? (await requestsOf(row.id));
    const authorizedEvidence = countAuthorized(
      row,
      request,
      evidence ?? (await evidenceOf(row.id)),
    );
    const overlaps = others
      .filter(
        (other) =>
          other.id !== request.id &&
          COMMITTED.includes(other.status) &&
          other.coversFrom <= request.coversTo &&
          other.coversTo >= request.coversFrom,
      )
      .map((other) => `${row.code}-R${other.seq}`);
    const daoAccountId = request.billingId ? await deps.agencyDaoOf(row.organizationId) : null;
    const paymentMd =
      request.status === "paid" && request.proposalId && request.approvedAmount
        ? paymentSection({
            amount: display(request.approvedAmount, row.tokenId),
            daoAccountId: daoAccountId ?? "",
            proposalId: request.proposalId,
            approvedBy: request.approvedBy ?? "",
            paidOn: request.paidAt ? dateOf(request.paidAt, timeZone) : today(),
          })
        : null;
    return {
      id: request.id,
      workOrderId: request.workOrderId,
      code: `${row.code}-R${request.seq}`,
      seq: request.seq,
      coversFrom: request.coversFrom,
      coversTo: request.coversTo,
      status: request.status,
      requestedAmount: request.requestedAmount,
      approvedAmount: request.approvedAmount,
      approvedBy: request.approvedBy,
      decidedAt: request.decidedAt?.toISOString() ?? null,
      note: request.note,
      contributionsMd: request.contributionsMd,
      assessmentMd: request.assessmentMd,
      assessmentIsDraft: !request.assessmentEdited,
      manualItems: parseJson<ManualItem[]>(request.manualItems, []),
      reportMd: request.reportMd
        ? servedReport(request.reportMd, request.reportSha256, paymentMd)
        : null,
      reportSha256: request.reportSha256,
      overlaps,
      authorizedEvidence,
      daoPaymentStartedAt: request.daoPaymentStartedAt?.toISOString() ?? null,
      autoPayBlocked:
        request.status === "approved" && request.autoPayBlockedReason && request.autoPayBlockedAt
          ? {
              reason: request.autoPayBlockedReason,
              since: request.autoPayBlockedAt.toISOString(),
              triedAt: request.autoPayTriedAt?.toISOString() ?? null,
            }
          : null,
      agentPayout:
        deps.payouts && ["paying", "paid", "approved"].includes(request.status)
          ? await deps.payouts
              .latest(request.id)
              .then((p) =>
                p
                  ? {
                      status: p.status,
                      amount: p.amount,
                      txUrl: p.txUrl,
                      accountUrl: nearAccountUrl(row.builderNearAccount),
                      reason: p.reason,
                      canRetry: payoutRetryable(p),
                    }
                  : null,
              )
              .catch(() => null)
          : null,
      payout:
        request.payoutAmount && request.payoutTokenId
          ? {
              tokenId: request.payoutTokenId,
              amount: request.payoutAmount,
              priceUsd: request.priceUsd,
              pricedAt: request.pricedAt?.toISOString() ?? null,
            }
          : null,
      submittedAt: request.submittedAt?.toISOString() ?? null,
      trust: trustViewOf(request),
      proposalId: request.proposalId,
      payingDaoAccountId: daoAccountId,
      paidAt: request.paidAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    };
  }

  function adminView<T extends { signing: { esign: ReturnType<typeof esignOf> } }>(value: T): T {
    const esign = value.signing.esign;
    return esign
      ? { ...value, signing: { ...value.signing, esign: { ...esign, builderUrl: null } } }
      : value;
  }

  function builderView<
    T extends {
      signing: { esign: ReturnType<typeof esignOf>; awaitingRepresentative: boolean };
    },
  >(value: T): T {
    const esign = value.signing.esign;
    const builderUrl = value.signing.awaitingRepresentative ? null : (esign?.builderUrl ?? null);
    const progress =
      "progress" in value && value.progress
        ? { progress: { ...(value.progress as Progress), next: null, attention: [] } }
        : {};
    return {
      ...value,
      ...progress,
      ...(esign
        ? {
            signing: {
              ...value.signing,
              esign: { ...esign, builderUrl, representativeUrl: null },
            },
          }
        : {}),
    };
  }

  type ViewCache = {
    projects?: Map<string, Project>;
    requests?: Map<string, CompensationRequestRow[]>;
    builders?: Map<string, Promise<BuilderProfile | null>>;
    paid?: Map<string, Promise<boolean>>;
    signing?: Map<string, ReturnType<typeof signingFrom>>;
  };

  async function viewCacheOf(rows: WorkOrderRow[], projects: Map<string, Project>) {
    const ids = rows.map((r) => r.id);
    const [requestRows, offeredRows, signatureRows] = ids.length
      ? await Promise.all([
          db
            .select()
            .from(compensationRequests)
            .where(inArray(compensationRequests.workOrderId, ids))
            .orderBy(asc(compensationRequests.seq)),
          db
            .select({
              workOrderId: workOrderDocuments.workOrderId,
              termsHash: workOrderDocuments.termsHash,
              sha256: workOrderDocuments.sha256,
            })
            .from(workOrderDocuments)
            .where(
              and(
                inArray(workOrderDocuments.workOrderId, ids),
                eq(workOrderDocuments.kind, "offered"),
              ),
            )
            .orderBy(desc(workOrderDocuments.createdAt)),
          db
            .select({
              workOrderId: workOrderSignatures.workOrderId,
              documentSha256: workOrderSignatures.documentSha256,
              role: workOrderSignatures.role,
              name: workOrderSignatures.name,
              signedAt: workOrderSignatures.signedAt,
            })
            .from(workOrderSignatures)
            .where(inArray(workOrderSignatures.workOrderId, ids)),
        ])
      : [[], [], []];
    const requests = new Map<string, CompensationRequestRow[]>(ids.map((id) => [id, []]));
    for (const r of requestRows) requests.get(r.workOrderId)?.push(r);
    const latestOffered = new Map<string, (typeof offeredRows)[number]>();
    for (const doc of offeredRows) {
      if (!latestOffered.has(doc.workOrderId)) latestOffered.set(doc.workOrderId, doc);
    }
    const signing = new Map(
      rows.map((row) => {
        const offered = latestOffered.get(row.id);
        const current = offered && offered.termsHash === termsHash(row) ? offered : null;
        return [
          row.id,
          signingFrom(
            row,
            current,
            current
              ? signatureRows.filter(
                  (s) => s.workOrderId === row.id && s.documentSha256 === current.sha256,
                )
              : [],
          ),
        ] as const;
      }),
    );
    const builders = new Map<string, Promise<BuilderProfile | null>>();
    for (const account of new Set(rows.map((r) => r.builderNearAccount))) {
      builders.set(
        account,
        deps.builders.get(account).catch(() => null),
      );
    }
    return { projects, requests, builders, paid: new Map(), signing } satisfies ViewCache;
  }

  async function view(row: WorkOrderRow, cache?: ViewCache) {
    const [requests, builder] = await Promise.all([
      cache?.requests?.get(row.id) ?? requestsOf(row.id),
      cache?.builders?.get(row.builderNearAccount) ??
        deps.builders.get(row.builderNearAccount).catch(() => null),
    ]);
    const project = cache?.projects?.get(row.projectId) ?? (await projectOf(row));
    const payee = await payeeOf(row, cache?.paid);
    const signing = cache?.signing?.get(row.id) ?? (await signingOf(row));
    const { committed, paid, remaining } = amountsOf(row, requests);
    const renewal = parseJson<RenewalAssessment | null>(row.renewalAssessment, null);
    const blockers = activationBlockers(
      row,
      builder,
      payee.needsConfirmation,
      signing.needsCountersign,
      signing.awaitingRepresentative,
    );
    const progress = progressOf({
      status: row.status,
      builderName: row.contractorName ?? builder?.name ?? row.builderNearAccount,
      representativeName: row.representativeName,
      createdAt: row.createdAt.toISOString(),
      offeredAt: row.offeredAt?.toISOString() ?? null,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      activatedAt: row.activatedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      today: today(),
      signFirst:
        row.esignEnvelopeId !== null
          ? row.esignRepresentativeFirst
          : row.status === "draft" && !!deps.esign,
      builderSignedAt: signing.builder?.signedAt ?? null,
      representativeSignedAt: signing.representative?.signedAt ?? null,
      awaitingRepresentative: signing.awaitingRepresentative,
      needsCountersign: signing.needsCountersign,
      representativeUrl: signing.esign?.representativeUrl ?? null,
      esignError: signing.esign?.error ?? null,
      blockers,
      payeeNeedsConfirmation: payee.needsConfirmation,
      documentWarning: row.documentWarning,
      driveError: row.signedDriveFileId ? null : row.signedDriveError,
      renewalStatus: row.renewalStatus,
      requests: requests.map((r) => ({
        id: r.id,
        code: `${row.code}-R${r.seq}`,
        status: r.status,
        requested: display(r.requestedAmount, row.tokenId),
        approved: r.approvedAmount ? display(r.approvedAmount, row.tokenId) : null,
        note: r.note,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        paidAt: r.paidAt?.toISOString() ?? null,
        blockedReason: r.autoPayBlockedReason,
        blockedCode: r.autoPayBlockedCode,
        daoPaymentStarted: r.daoPaymentStartedAt !== null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
    return {
      id: row.id,
      code: row.code,
      organizationId: row.organizationId,
      projectId: row.projectId,
      projectTitle: project?.title ?? UNKNOWN_PROJECT,
      projectSlug: project?.slug ?? null,
      builder: {
        nearAccount: row.builderNearAccount,
        name: builder?.name ?? null,
        githubLogin: row.githubLogin,
        profileGithubLogin: builder?.githubLogin ?? null,
      },
      contractorName: row.contractorName,
      contractorEmail: row.contractorEmail,
      representativeName: row.representativeName,
      representativeEmail: row.representativeEmail,
      ipModel: row.ipModel,
      payee,
      signature: {
        method: row.signatureMethod,
        signedAt: row.signedAt?.toISOString() ?? null,
        signers: parseJson<Signer[]>(row.signers, []),
        preparedDocumentUrl: row.preparedDocumentUrl,
        documentWarning: row.documentWarning,
        driveUrl: row.signedDriveUrl,
        driveError: row.signedDriveFileId ? null : row.signedDriveError,
      },
      customFields: customFieldsOf(row.customFields),
      title: row.title,
      scope: row.scope,
      repos: parseList(row.repos),
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      graceDays: row.graceDays,
      timeZone,
      tokenId: row.tokenId,
      payoutTokenId: payoutTokenOf(row),
      budgetAmount: row.budgetAmount,
      committedAmount: committed.toString(),
      paidAmount: paid.toString(),
      remainingAmount: remaining.toString(),
      autoRenew: row.autoRenew,
      status: row.status,
      offeredAt: row.offeredAt?.toISOString() ?? null,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      termsChanged: row.status === "accepted" && row.acceptedTermsHash !== termsHash(row),
      documentSha256: row.documentSha256,
      documentUrl: row.documentUrl,
      activatedAt: row.activatedAt?.toISOString() ?? null,
      activationBlockers: blockers,
      progress,
      signing,
      lastCollectedAt: row.lastCollectedAt?.toISOString() ?? null,
      waiting: requests.filter((r) => r.status === "submitted" || r.status === "approved").length,
      renewedFrom: row.renewedFrom,
      renewal:
        row.renewalStatus && renewal
          ? {
              status: row.renewalStatus,
              assessment: renewal,
              decidedBy: row.renewalDecidedBy,
              decidedAt: row.renewalDecidedAt?.toISOString() ?? null,
              note: row.renewalNote,
              renewedTo: row.renewedTo,
            }
          : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async function detail(row: WorkOrderRow) {
    const [base, evidence, requests] = await Promise.all([
      view(row),
      evidenceOf(row.id),
      requestsOf(row.id),
    ]);
    const collected = evidence.map(collectedOf);
    const repoOwners = await Promise.all(
      parseList(row.repos).map(async (repo) => {
        try {
          const o = await deps.ownership(repo);
          return {
            repo,
            owner: o.owner,
            ownerType: o.ownerType,
            approvers: o.approvers,
            error: null,
          };
        } catch (error) {
          return {
            repo,
            owner: null,
            ownerType: null,
            approvers: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    return {
      ...base,
      evidence: evidence.map(evidenceView),
      activity: summarizeActivity(collected, scopeOf(row)),
      requests: await Promise.all(requests.map((r) => requestView(r, row, requests, evidence))),
      repoOwners,
    };
  }

  async function validateFields(
    scope: OrganizationScope,
    input: Omit<WorkOrderFields, "code"> & { code: string },
    excludeId?: string,
  ) {
    if (!CODE.test(input.code)) {
      throw badRequest(
        "INVALID_CODE",
        "The code may use letters, digits, dots, dashes and underscores",
      );
    }
    if (!input.title.trim()) throw badRequest("TITLE_REQUIRED", "Give the work order a title");
    if (input.periodEnd < input.periodStart) {
      throw badRequest("INVALID_PERIOD", "The period must end on or after its start");
    }
    if (BigInt(input.budgetAmount) <= 0n) {
      throw badRequest("AMOUNT_NOT_POSITIVE", "The budget must be more than zero");
    }
    for (const repo of input.repos) {
      if (!REPO.test(repo)) throw badRequest("INVALID_REPO", `${repo} isn't a GitHub owner/name`);
    }
    if (input.githubLogin && !GITHUB_LOGIN.test(input.githubLogin)) {
      throw badRequest("INVALID_GITHUB_LOGIN", `${input.githubLogin} isn't a GitHub login`);
    }
    for (const email of [input.contractorEmail, input.representativeEmail]) {
      if (email && !EMAIL.test(email))
        throw badRequest("INVALID_EMAIL", `${email} isn't an email address`);
    }
    const project = await directory.forAgency(scope).require(input.projectId);
    const [taken] = await db
      .select({ id: workOrders.id })
      .from(workOrders)
      .where(
        and(eq(workOrders.organizationId, scope.organizationId), eq(workOrders.code, input.code)),
      )
      .limit(1);
    if (taken && taken.id !== excludeId) {
      throw badRequest("CODE_TAKEN", `Work order ${input.code} already exists`);
    }
    return project;
  }

  async function nextCode(organizationId: string): Promise<string> {
    const rows = await db
      .select({ code: workOrders.code })
      .from(workOrders)
      .where(eq(workOrders.organizationId, organizationId));
    const numbers = rows
      .map((r) => /^WO-(\d+)$/.exec(r.code)?.[1])
      .filter(Boolean)
      .map(Number);
    return `WO-${String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(4, "0")}`;
  }

  async function notifyManagers(
    row: WorkOrderRow,
    kind: NotificationKind,
    payload: Record<string, string>,
    excludeUserId?: string | null,
  ) {
    await deps.notifications
      .notify({
        organizationId: row.organizationId,
        kind,
        payload,
        link: adminLink(row.id),
        excludeUserId,
        email: false,
      })
      .catch((error: unknown) => console.warn("[API] work order notification failed:", error));
  }

  async function notifyBuilder(
    row: WorkOrderRow,
    kind: NotificationKind,
    payload: Record<string, string>,
  ) {
    const builder = await deps.builders.get(row.builderNearAccount).catch(() => null);
    if (!builder?.userId) return;
    await deps.notifications
      .notifyUser({
        userId: builder.userId,
        organizationId: row.organizationId,
        kind,
        payload,
        link: builderLink(row.id),
      })
      .catch((error: unknown) => console.warn("[API] work order notification failed:", error));
  }

  async function payloadOf(row: WorkOrderRow, extra: Record<string, string> = {}) {
    const [project, agencyName, builder] = await Promise.all([
      projectOf(row),
      deps.organizationName(row.organizationId).catch(() => row.organizationId),
      deps.builders.get(row.builderNearAccount).catch(() => null),
    ]);
    return {
      code: row.code,
      projectTitle: project?.title ?? UNKNOWN_PROJECT,
      agencyName,
      builderName: builder?.name ?? row.builderNearAccount,
      budget: display(row.budgetAmount, row.tokenId),
      period: `${row.periodStart} → ${row.periodEnd}`,
      periodEnd: row.periodEnd,
      ...extra,
    };
  }

  async function allowPayee(row: WorkOrderRow) {
    const payouts = deps.payouts;
    if (!payouts?.ensurePayees || payoutTokenOf(row) !== NATIVE_TOKEN_ID) return;
    const result = await payouts
      .ensurePayees(row.organizationId)
      .catch((error: unknown) => ({ ok: false, reason: errorText(error) }));
    if (result.ok) return;
    await notifyManagers(
      row,
      "work_order_payee_not_allowed",
      await payloadOf(row, {
        payee: row.builderNearAccount,
        reason: result.reason ?? "the signed rules don't allow it yet",
      }),
    );
  }

  async function activateRow(row: WorkOrderRow, actor: string): Promise<WorkOrderRow> {
    const activated = await update(row.id, {
      status: "active",
      activatedAt: now(),
      activatedBy: actor,
    });
    await notifyBuilder(activated, "work_order_activated", await payloadOf(activated));
    await announce(activated, "work_order.active");
    await allowPayee(activated);
    return activated;
  }

  async function blockersOf(row: WorkOrderRow) {
    const builder = await deps.builders.get(row.builderNearAccount).catch(() => null);
    const payee = await payeeOf(row);
    const signing = await signingOf(row);
    return activationBlockers(
      row,
      builder,
      payee.needsConfirmation,
      signing.needsCountersign,
      signing.awaitingRepresentative,
    );
  }

  async function autoActivate(row: WorkOrderRow, tellBlockers = false): Promise<WorkOrderRow> {
    if (row.status !== "accepted" || !row.signedAt) return row;
    const blockers = await blockersOf(row);
    if (blockers.length === 0) return activateRow(row, "system");
    if (tellBlockers) {
      await notifyManagers(
        row,
        "work_order_activation_blocked",
        await payloadOf(row, { blockers: blockers.join("; ") }),
      );
    }
    return row;
  }

  async function activateReady(counts: Record<string, number>) {
    const ready = await db
      .select()
      .from(workOrders)
      .where(and(eq(workOrders.status, "accepted"), isNotNull(workOrders.signedAt)));
    for (const row of ready) {
      try {
        const activated = await autoActivate(row);
        if (activated.status === "active") counts.activated = (counts.activated ?? 0) + 1;
      } catch (error) {
        console.warn(`[API] work order ${row.code} couldn't be activated`, error);
      }
    }
  }

  function requireBuilder(context: PluginContext, row: WorkOrderRow) {
    if (row.status === "draft" || !nearAccountsOf(context).includes(row.builderNearAccount)) {
      throw notFound();
    }
  }

  async function replaceEvidence(
    row: WorkOrderRow,
    collected: CollectedEvidence[],
    keepRepos: string[],
  ) {
    const existing = await evidenceOf(row.id);
    const confirmed = new Set(existing.filter((e) => e.confirmed).map((e) => e.url));
    const keep = new Set(keepRepos.map((r) => r.toLowerCase()));
    const fresh = collected.filter((c) => !(c.repo && keep.has(c.repo.toLowerCase())));
    const keyOf = (e: { kind: string; url: string }) => `${e.kind} ${e.url}`;
    const freshKeys = new Set(fresh.map(keyOf));
    const byKey = new Map(existing.filter((e) => e.kind !== "manual").map((e) => [keyOf(e), e]));
    await db.transaction(async (tx) => {
      const stale = existing.filter(
        (e) =>
          e.kind !== "manual" &&
          !(e.repo && keep.has(e.repo.toLowerCase())) &&
          !freshKeys.has(keyOf(e)),
      );
      if (stale.length) {
        await tx.delete(workOrderEvidence).where(
          inArray(
            workOrderEvidence.id,
            stale.map((e) => e.id),
          ),
        );
      }
      for (const item of fresh) {
        const isConfirmed = confirmed.has(item.url);
        const values = {
          kind: item.kind,
          repo: item.repo,
          number: item.number,
          url: item.url,
          title: item.title,
          state: item.state,
          occurredAt: item.occurredAt ? new Date(item.occurredAt) : null,
          assignedAt: item.assignedAt ? new Date(item.assignedAt) : null,
          assignedBy: item.assignedBy,
          authorized: item.authorized || isConfirmed,
          confirmed: isConfirmed,
          flags: JSON.stringify(item.flags),
          links: JSON.stringify(item.links),
          details: JSON.stringify(item.details),
          collectedAt: now(),
        };
        const current = byKey.get(keyOf(item));
        if (current) {
          await tx
            .update(workOrderEvidence)
            .set(values)
            .where(eq(workOrderEvidence.id, current.id));
          continue;
        }
        await tx
          .insert(workOrderEvidence)
          .values({ id: crypto.randomUUID(), workOrderId: row.id, ...values })
          .onConflictDoNothing();
      }
      await tx.update(workOrders).set({ lastCollectedAt: now() }).where(eq(workOrders.id, row.id));
    });
  }

  async function collect(row: WorkOrderRow): Promise<WorkOrderRow> {
    if (!PAYABLE.includes(row.status)) {
      throw badRequest("NOT_ACTIVE", "Activate the work order before collecting evidence");
    }
    if (!row.githubLogin) throw badRequest("NO_GITHUB_LOGIN", "The work order has no GitHub login");
    const failed: { repo: string; error: unknown }[] = [];
    let collected: CollectedEvidence[];
    try {
      collected = await collectEvidence(scopeOf(row), {
        github: deps.github,
        ownership: deps.ownership,
        onRepoError: (repo, error) => failed.push({ repo, error }),
      });
    } catch (error) {
      throw badRequest(
        "GITHUB_UNAVAILABLE",
        `Couldn't read the evidence from GitHub: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const repos = parseList(row.repos);
    if (failed.length > 0 && failed.length === repos.length) {
      const first = failed[0]?.error;
      throw badRequest(
        "GITHUB_UNAVAILABLE",
        `Couldn't read the evidence from GitHub: ${first instanceof Error ? first.message : String(first)}`,
      );
    }
    for (const f of failed) {
      console.warn(`[API] work order ${row.code}: ${f.repo} couldn't be read`, f.error);
    }
    await replaceEvidence(
      row,
      collected,
      failed.map((f) => f.repo),
    );
    return mustRow(row.id);
  }

  function evidenceFor(
    row: WorkOrderRow,
    evidence: WorkOrderEvidenceRow[],
    coversFrom: string,
    coversTo: string,
  ) {
    const grace = coversTo === row.periodEnd ? row.graceDays : 0;
    const from = startOfDay(coversFrom, timeZone);
    const to = startOfDay(addDays(coversTo, grace + 1), timeZone) - 1;
    return evidence.filter((e) => {
      if (e.kind === "assigned_issue") return true;
      if (!e.occurredAt) return false;
      const at = e.occurredAt.getTime();
      return at >= from && at <= to;
    });
  }

  function evidenceOfRequest(
    row: WorkOrderRow,
    request: CompensationRequestRow,
    evidence: WorkOrderEvidenceRow[],
  ) {
    const ids = parseJson<string[] | null>(request.evidenceIds, null);
    return ids
      ? evidence.filter((e) => ids.includes(e.id))
      : evidenceFor(row, evidence, request.coversFrom, request.coversTo);
  }

  const delivered = (e: Pick<WorkOrderEvidenceRow, "kind" | "state">) =>
    e.kind !== "assigned_issue" || e.state === "done";

  function countAuthorized(
    row: WorkOrderRow,
    request: CompensationRequestRow,
    evidence: WorkOrderEvidenceRow[],
    confirmIds: string[] = [],
  ) {
    const confirmed = new Set(confirmIds);
    const counted = new Set(
      evidenceOfRequest(row, request, evidence)
        .filter((e) => e.authorized && delivered(e))
        .map((e) => e.id),
    );
    for (const e of evidence) if (confirmed.has(e.id) && delivered(e)) counted.add(e.id);
    return counted.size;
  }

  async function authorizedEvidenceOf(
    row: WorkOrderRow,
    request: CompensationRequestRow,
    confirmIds: string[] = [],
  ) {
    return countAuthorized(row, request, await evidenceOf(row.id), confirmIds);
  }

  function contributionsOf(
    row: WorkOrderRow,
    evidence: WorkOrderEvidenceRow[],
    manualItems: ManualItem[],
    summary: string | null = null,
  ) {
    const scope = scopeOf(row);
    const collected = evidence.map(collectedOf);
    return buildContributions({
      scope,
      evidence: collected,
      activity: summarizeActivity(collected, scope),
      manualItems,
      summary,
    });
  }

  function draftReportOf(contributionsMd: string, assessmentMd: string) {
    return `${contributionsMd}\n\n## Assessment\n${assessmentMd}`;
  }

  function proratedAmount(
    row: WorkOrderRow,
    remaining: bigint,
    coversFrom: string,
    coversTo: string,
  ): bigint {
    const periodDays = BigInt(daysBetween(row.periodStart, row.periodEnd) + 1);
    const coveredDays = BigInt(daysBetween(coversFrom, coversTo) + 1);
    const share = (BigInt(row.budgetAmount) * coveredDays) / periodDays;
    const amount = share < remaining ? share : remaining;
    return amount > 0n ? amount : remaining;
  }

  async function draftRequest(
    initial: WorkOrderRow,
    input: { coversFrom?: string; coversTo?: string },
    auto = false,
  ): Promise<CompensationRequestRow> {
    let row = initial;
    if (row.status !== "active" && row.status !== "ended") {
      throw badRequest("NOT_OPEN", `Work order ${row.code} is ${row.status}: no new requests`);
    }
    const existing = await requestsOf(row.id);
    if (existing.some((r) => r.status === "draft")) {
      throw badRequest("DRAFT_EXISTS", "A draft request already exists for this work order");
    }
    const coversFrom = input.coversFrom ?? row.periodStart;
    const coversTo = input.coversTo ?? row.periodEnd;
    if (coversFrom > coversTo || coversFrom < row.periodStart || coversTo > row.periodEnd) {
      throw badRequest("INVALID_PERIOD", "The covered dates must lie inside the work order period");
    }
    if (amountsOf(row, existing).remaining <= 0n) {
      throw badRequest("BUDGET_USED", "The work order budget is used up");
    }
    if (!auto) {
      try {
        row = await collect(row);
      } catch (error) {
        console.warn(`[API] collecting ${row.code} before drafting failed`, error);
      }
    }
    const requests = await requestsOf(row.id);
    if (requests.some((r) => r.status === "draft")) {
      throw badRequest("DRAFT_EXISTS", "A draft request already exists for this work order");
    }
    const { remaining } = amountsOf(row, requests);
    if (remaining <= 0n) throw badRequest("BUDGET_USED", "The work order budget is used up");
    const evidence = evidenceFor(row, await evidenceOf(row.id), coversFrom, coversTo);
    const seq = (requests.at(-1)?.seq ?? 0) + 1;
    const project = await projectOf(row);
    const draft =
      deps.summarizer && evidence.length > 0
        ? await deps.summarizer
            .draftReport({
              workOrderCode: row.code,
              project: project?.title ?? UNKNOWN_PROJECT,
              contractorGithub: row.githubLogin ?? "",
              periodStart: coversFrom,
              periodEnd: coversTo,
              evidence: evidence.map(collectedOf),
            })
            .catch(() => null)
        : null;
    const contributionsMd = contributionsOf(row, evidence, [], draft?.summary ?? null);
    const assessmentMd = templateAssessment(draft?.assessment);
    const [inserted] = await db
      .insert(compensationRequests)
      .values({
        id: crypto.randomUUID(),
        workOrderId: row.id,
        seq,
        coversFrom,
        coversTo,
        status: "draft",
        requestedAmount: proratedAmount(row, remaining, coversFrom, coversTo).toString(),
        summary: draft?.summary ?? null,
        contributionsMd,
        assessmentMd,
        createdAt: now(),
        updatedAt: now(),
      })
      .returning();
    if (auto) await update(row.id, { autoDraftedFor: row.periodEnd });
    await notifyBuilder(
      row,
      "compensation_request_ready",
      await payloadOf(row, { requestCode: `${row.code}-R${seq}` }),
    );
    await announce(row, "request.report_ready", {
      request: inserted,
      reportMd: draftReportOf(contributionsMd, assessmentMd),
    });
    return inserted!;
  }

  async function markPaidByAgent(
    request: CompensationRequestRow,
    row: WorkOrderRow,
    payout: AgentPayoutView,
  ): Promise<CompensationRequestRow> {
    const dao = await deps.agencyDaoOf(row.organizationId).catch(() => null);
    const paid = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(compensationRequests)
        .set({ status: "paid", updatedAt: now() })
        .where(
          and(
            eq(compensationRequests.id, request.id),
            inArray(compensationRequests.status, ["approved", "paying"]),
          ),
        )
        .returning({ id: compensationRequests.id });
      if (!claimed) return null;
      const [billing] = await tx
        .insert(billings)
        .values({
          id: crypto.randomUUID(),
          projectId: row.projectId,
          nearAccount: row.builderNearAccount,
          tokenId: NATIVE_TOKEN_ID,
          amount: payout.amount,
          proposalId: `intents:${payout.txHash ?? payout.correlationId ?? payout.id}`,
          payingDaoAccountId: dao,
          note: `Work order ${row.code}, request ${row.code}-R${request.seq}, paid by the payout agent`,
          createdAt: now(),
        })
        .returning();
      const [updated] = await tx
        .update(compensationRequests)
        .set({
          status: "paid",
          paidAt: now(),
          billingId: billing!.id,
          payoutTokenId: NATIVE_TOKEN_ID,
          payoutAmount: payout.amount,
          autoPayBlockedReason: null,
          autoPayBlockedCode: null,
          autoPayBlockedAt: null,
          updatedAt: now(),
        })
        .where(eq(compensationRequests.id, request.id))
        .returning();
      return updated!;
    });
    if (!paid) return mustRequest(request.id);
    if (
      amountsOf(row, await requestsOf(row.id)).remaining === 0n &&
      (row.status === "active" || row.status === "ended")
    ) {
      await update(row.id, { status: "exhausted" });
    }
    const payload = await payloadOf(row, {
      requestCode: `${row.code}-R${request.seq}`,
      amount: display(payout.amount, NATIVE_TOKEN_ID),
      daoAccountId: dao ?? "",
      proposalId: payout.txHash ?? "",
      status: "Paid",
    });
    await notifyBuilder(row, "compensation_request_paid", payload);
    await notifyManagers(row, "compensation_request_paid", payload);
    await announce(row, "request.payout_released", {
      request: paid,
      payout: {
        near: row.builderNearAccount,
        txUrl: payout.txUrl,
        accountUrl: nearAccountUrl(row.builderNearAccount),
      },
      reportMd: (await requestView(paid, row)).reportMd,
    });
    return paid;
  }

  async function fundingHoldOf(
    request: CompensationRequestRow,
    row: WorkOrderRow,
    reason: string,
  ): Promise<WorkOrderEvent["hold"]> {
    const payouts = deps.payouts;
    let code = fundingCodeOf(reason);
    let plain = reason;
    if (payouts && request.payoutAmount) {
      const check = await payouts
        .readiness(
          row.organizationId,
          row.builderNearAccount,
          request.payoutAmount,
          request.priceUsd,
        )
        .catch(() => null);
      const checked = check && !check.ready ? fundingCodeOf(check.code ?? "") : null;
      if (check && checked) {
        code = checked;
        plain = check.reason ?? reason;
      }
    }
    if (!code) return null;
    const funding =
      payouts?.fundingCheck && request.payoutAmount
        ? await payouts
            .fundingCheck(row.organizationId, {
              near: BigInt(request.payoutAmount),
              priceUsd: request.priceUsd,
            })
            .catch(() => null)
        : null;
    return {
      code,
      reason: plain,
      balanceNear: funding?.balanceNear ?? null,
      neededNear:
        funding?.neededNear ??
        (request.payoutAmount ? atomicToNear(BigInt(request.payoutAmount)) : null),
    };
  }

  async function blockPayout(
    request: CompensationRequestRow,
    row: WorkOrderRow,
    reason: string,
    note: string,
  ): Promise<CompensationRequestRow> {
    const hold = await fundingHoldOf(await mustRequest(request.id), row, reason);
    const blocked = await updateUnpaid(request.id, {
      status: "approved",
      note,
      autoPayBlockedReason: reason,
      autoPayBlockedCode: hold?.code ?? null,
      autoPayBlockedAt: request.autoPayBlockedAt ?? now(),
      autoPayTriedAt: now(),
    });
    if (blocked.status === "approved" && hold && hold.code !== request.autoPayHoldNotified) {
      await announce(row, "request.payout_blocked", { request: blocked, hold });
      await updateUnpaid(request.id, { autoPayHoldNotified: hold.code });
    }
    if (blocked.status === "approved" && !request.autoPayBlockedAt) {
      await notifyManagers(
        row,
        "compensation_request_payout_blocked",
        await payloadOf(row, {
          requestCode: `${row.code}-R${request.seq}`,
          approved: display(request.approvedAmount ?? "0", row.tokenId),
          reason,
        }),
      );
    }
    return blocked;
  }

  async function settleAgentPayout(
    request: CompensationRequestRow,
    row: WorkOrderRow,
    payout: AgentPayoutView,
  ): Promise<CompensationRequestRow> {
    if (payout.status === "paid") return markPaidByAgent(request, row, payout);
    if (payoutRetryable(payout)) {
      const reason = payout.reason ?? payout.status;
      return blockPayout(
        request,
        row,
        reason,
        `The automatic payout didn't go out: ${reason}. It's tried again automatically, or pay it through a DAO proposal.`,
      );
    }
    if (payout.status === "failed" || payout.status === "needs_review") {
      const reason = payout.reason ?? payout.status;
      const review = await updateUnpaid(request.id, {
        status: "approved",
        note: `The automatic payout needs a person to check it: ${reason}. Check the payout agent's history; if nothing went out, reject the request so the builder can request it again.`,
        autoPayBlockedReason: reason,
        autoPayBlockedCode: NEEDS_REVIEW,
        autoPayBlockedAt: null,
      });
      await notifyManagers(
        row,
        "compensation_request_payout_failed",
        await payloadOf(row, {
          requestCode: `${row.code}-R${request.seq}`,
          approved: display(request.approvedAmount ?? "0", row.tokenId),
          reason,
        }),
      );
      return review;
    }
    if (request.status === "paying" && !request.autoPayBlockedAt) return request;
    return updateUnpaid(request.id, {
      status: "paying",
      note: null,
      autoPayBlockedReason: null,
      autoPayBlockedCode: null,
      autoPayBlockedAt: null,
    });
  }

  async function autoPay(
    request: CompensationRequestRow,
    row: WorkOrderRow,
  ): Promise<{ request: CompensationRequestRow; reason: string | null }> {
    const payouts = deps.payouts;
    if (!payouts) return { request, reason: "Automatic payouts aren't set up" };
    if (payoutTokenOf(row) !== NATIVE_TOKEN_ID) {
      return {
        request,
        reason: "Automatic payouts pay in NEAR; this work order pays in another token",
      };
    }
    if (request.daoPaymentStartedAt) return { request, reason: DAO_PAYMENT_NOTE };
    const last = await payouts.latest(request.id);
    if (last && !payoutRetryable(last)) {
      return {
        request,
        reason: unsettledPayoutReason(last),
      };
    }
    const readiness = await payouts.readiness(row.organizationId, row.builderNearAccount);
    if (!readiness.ready) {
      const reason = readiness.reason ?? "The payout agent isn't ready";
      if (reason === NO_AGENT) return { request, reason };
      return {
        request: await blockPayout(
          request,
          row,
          reason,
          `Not paid automatically yet: ${reason}. It's tried again automatically, or pay it through a DAO proposal.`,
        ),
        reason,
      };
    }
    const quote = await priceOf(row, request);
    const [claimed] = await db
      .update(compensationRequests)
      .set({ ...lockedPrice(quote), status: "paying", autoPayTriedAt: now(), updatedAt: now() })
      .where(
        and(
          eq(compensationRequests.id, request.id),
          eq(compensationRequests.status, "approved"),
          isNull(compensationRequests.daoPaymentStartedAt),
        ),
      )
      .returning();
    if (!claimed) {
      return {
        request: await mustRequest(request.id),
        reason: "The request changed before it could be paid",
      };
    }
    let payout: AgentPayoutView;
    try {
      payout = await payouts.send(row.organizationId, {
        requestId: request.id,
        recipient: row.builderNearAccount,
        amount: quote.amount,
      });
    } catch (error) {
      const last = await payouts.latest(request.id).catch(() => undefined);
      if (last !== undefined && !payoutInFlight(last)) await releasePaying(request.id);
      throw error;
    }
    const settled = await settleAgentPayout(await mustRequest(request.id), row, payout);
    return {
      request: settled,
      reason: settled.status === "approved" ? (settled.autoPayBlockedReason ?? settled.note) : null,
    };
  }

  async function tryAutoPay(
    request: CompensationRequestRow,
    row: WorkOrderRow,
  ): Promise<{ request: CompensationRequestRow; reason: string | null }> {
    try {
      return await autoPay(request, row);
    } catch (error) {
      const reason = errorText(error);
      if (reasonOf(error) === "PAYOUT_EXISTS") return { request, reason };
      const fresh = await mustRequest(request.id);
      if (fresh.status !== "approved") return { request: fresh, reason };
      return {
        request: await blockPayout(
          fresh,
          row,
          reason,
          `Not paid automatically yet: ${reason}. It's tried again automatically, or pay it through a DAO proposal.`,
        ),
        reason,
      };
    }
  }

  async function followUpPayouts(counts: Record<string, number>) {
    const payouts = deps.payouts;
    if (!payouts) return;
    const paying = await db
      .select()
      .from(compensationRequests)
      .where(eq(compensationRequests.status, "paying"));
    for (const request of paying) {
      try {
        const latest = await payouts.latest(request.id);
        const started = request.autoPayTriedAt;
        const payout = latest && !(started && latest.createdAt < started) ? latest : null;
        if (!payout) {
          if (now().getTime() - (started ?? request.updatedAt).getTime() > STUCK_PAYING_MS) {
            const reason = "the payout was interrupted before it reached the payout agent";
            await blockPayout(
              request,
              await mustRow(request.workOrderId),
              reason,
              `Not paid automatically yet: ${reason}. It's tried again automatically, or pay it through a DAO proposal.`,
            );
          }
          continue;
        }
        const fresh = await payouts.refresh(payout);
        const settled = await settleAgentPayout(
          await mustRequest(request.id),
          await mustRow(request.workOrderId),
          fresh,
        );
        if (settled.status !== "paying") {
          counts[settled.status] = (counts[settled.status] ?? 0) + 1;
        }
      } catch (error) {
        console.warn(`[API] payout of request ${request.id} couldn't be checked`, error);
      }
    }
  }

  async function retryBlockedPayouts(counts: Record<string, number>) {
    if (!deps.payouts) return;
    const due = new Date(now().getTime() - AUTO_PAY_RETRY_MS);
    const blocked = await db
      .select()
      .from(compensationRequests)
      .where(
        and(
          eq(compensationRequests.status, "approved"),
          isNotNull(compensationRequests.autoPayBlockedAt),
          or(
            isNull(compensationRequests.autoPayTriedAt),
            lt(compensationRequests.autoPayTriedAt, due),
          ),
        ),
      );
    for (const request of blocked) {
      try {
        const row = await mustRow(request.workOrderId);
        if (FINAL.includes(row.status)) {
          await updateRequest(request.id, {
            autoPayBlockedReason: null,
            autoPayBlockedCode: null,
            autoPayBlockedAt: null,
          });
          continue;
        }
        const [claimed] = await db
          .update(compensationRequests)
          .set({ autoPayTriedAt: now() })
          .where(
            and(
              eq(compensationRequests.id, request.id),
              eq(compensationRequests.status, "approved"),
              or(
                isNull(compensationRequests.autoPayTriedAt),
                lt(compensationRequests.autoPayTriedAt, due),
              ),
            ),
          )
          .returning();
        if (!claimed) continue;
        const result = await tryAutoPay(claimed, row);
        counts.retried = (counts.retried ?? 0) + 1;
        if (result.request.status !== "approved") {
          counts[result.request.status] = (counts[result.request.status] ?? 0) + 1;
        }
      } catch (error) {
        console.warn(`[API] payout of request ${request.id} couldn't be retried`, error);
      }
    }
  }

  function refuseTerminated(row: WorkOrderRow) {
    if (FINAL.includes(row.status)) {
      throw badRequest("CLOSED", `Work order ${row.code} is terminated: nothing more can be paid`);
    }
  }

  async function daoPayable(
    scope: TreasuryScope & OrganizationScope,
    requestId: string,
    { linking = false } = {},
  ) {
    const request = await mustRequest(requestId);
    const row = await ownRow(scope, request.workOrderId);
    const { approvedAmount } = request;
    if (request.status !== "approved" || !approvedAmount) {
      throw badRequest("NOT_APPROVED", "Approve the request before paying it through the DAO");
    }
    if (!(linking && request.daoPaymentStartedAt)) refuseTerminated(row);
    await requireSettledPayout(request.id);
    return { request: { ...request, approvedAmount }, row };
  }

  async function requireSettledPayout(requestId: string) {
    const unsettled = await deps.payouts?.latest(requestId);
    if (unsettled && !payoutRetryable(unsettled)) {
      throw badRequest("AGENT_PAYOUT_UNSETTLED", unsettledPayoutReason(unsettled));
    }
  }

  async function refuseChangedRequest(requestId: string): Promise<never> {
    await requireSettledPayout(requestId);
    throw badRequest("NOT_APPROVED", "The request changed meanwhile; reload it and try again");
  }

  async function daoPaymentTransaction(
    scope: TreasuryScope,
    row: WorkOrderRow,
    request: CompensationRequestRow,
    payout: PayoutQuote,
  ) {
    const project = await projectOf(row);
    const link = absolute(adminLink(row.id));
    const description = proposalDescription({
      title: `${row.code}-R${request.seq}: ${row.title}`,
      notes: [
        `Project: ${project?.title ?? UNKNOWN_PROJECT}`,
        `Covers ${request.coversFrom} to ${request.coversTo}`,
        payout.priceUsd
          ? `${display(request.approvedAmount ?? "0", row.tokenId)} at ${payout.priceUsd} USD per ${symbolOf(payout.tokenId)}`
          : null,
        request.reportSha256 ? `Report SHA-256: ${request.reportSha256}` : null,
      ]
        .filter(Boolean)
        .join("; "),
      url: link.startsWith("http") ? link : null,
    });
    return {
      quote: {
        usd: row.tokenId === USD ? request.approvedAmount : null,
        tokenId: payout.tokenId,
        amount: payout.amount,
        priceUsd: payout.priceUsd,
        pricedAt: payout.pricedAt?.toISOString() ?? null,
      },
      daoAccountId: scope.agencyDao,
      method: "add_proposal" as const,
      args: {
        proposal: {
          description,
          kind: {
            Transfer: {
              token_id: payout.tokenId === NATIVE_TOKEN_ID ? "" : payout.tokenId,
              receiver_id: row.builderNearAccount,
              amount: payout.amount,
              msg: null,
            },
          },
        },
      },
      deposit: await deps.proposalBond(scope.agencyDao),
      gas: "100000000000000",
    };
  }

  async function syncPayment(request: CompensationRequestRow): Promise<CompensationRequestRow> {
    if (request.status !== "proposed" || !request.proposalId) return request;
    const row = await mustRow(request.workOrderId);
    const dao = await deps.agencyDaoOf(row.organizationId);
    if (!dao) return request;
    let status: DaoProposal["status"];
    try {
      status = (await deps.proposal(dao, Number(request.proposalId)))?.status ?? "Removed";
    } catch {
      return request;
    }
    const payload = await payloadOf(row, {
      requestCode: `${row.code}-R${request.seq}`,
      amount: display(request.approvedAmount ?? "0", row.tokenId),
      daoAccountId: dao,
      proposalId: request.proposalId,
      status,
    });
    if (status === "Approved") {
      const [paid] = await db
        .update(compensationRequests)
        .set({ status: "paid", paidAt: now(), updatedAt: now() })
        .where(
          and(eq(compensationRequests.id, request.id), eq(compensationRequests.status, "proposed")),
        )
        .returning();
      if (!paid) return mustRequest(request.id);
      const requests = await requestsOf(row.id);
      if (
        amountsOf(row, requests).remaining === 0n &&
        (row.status === "active" || row.status === "ended")
      ) {
        await update(row.id, { status: "exhausted" });
      }
      await notifyBuilder(row, "compensation_request_paid", payload);
      await notifyManagers(row, "compensation_request_paid", payload);
      await announce(row, "request.payout_released", {
        request: paid,
        payout: {
          near: row.builderNearAccount,
          txUrl: `https://trezu.app/${dao}/requests/${request.proposalId}`,
        },
        reportMd: (await requestView(paid, row)).reportMd,
      });
      return paid;
    }
    if (FAILED_PROPOSAL.has(status)) {
      const [failed] = await db
        .update(compensationRequests)
        .set({
          status: "failed",
          note: `Proposal #${request.proposalId} ended as ${status}; nothing was paid.`,
          updatedAt: now(),
        })
        .where(
          and(eq(compensationRequests.id, request.id), eq(compensationRequests.status, "proposed")),
        )
        .returning();
      if (!failed) return mustRequest(request.id);
      await notifyBuilder(row, "compensation_request_failed", payload);
      await notifyManagers(row, "compensation_request_failed", payload);
      await announce(row, "request.needs_review", { request: failed });
      return failed;
    }
    return request;
  }

  async function offerRow(row: WorkOrderRow): Promise<WorkOrderRow> {
    if (row.status !== "draft") {
      throw badRequest(
        "NOT_DRAFT",
        `Work order ${row.code} is ${row.status}: only a draft can be offered`,
      );
    }
    if (parseList(row.repos).length === 0) {
      throw badRequest("NO_REPOS", "Add at least one GitHub repository before offering it");
    }
    if (!row.githubLogin) {
      throw badRequest("NO_GITHUB_LOGIN", "Add the builder's GitHub login before offering it");
    }
    if (deps.esign) {
      const contacts = await contactsOf(
        row,
        await deps.builders.get(row.builderNearAccount).catch(() => null),
      );
      if (!contacts.contractorEmail || !contacts.representativeEmail) {
        throw badRequest(
          "NO_EMAILS",
          "Add the builder's and the representative's email: the signing request goes to both",
        );
      }
    }
    const prepared = await sendForSignature(await prepareOfferDocument(row));
    return update(prepared.id, { status: "offered", offeredAt: now(), esignError: null });
  }

  async function renew(
    parent: WorkOrderRow,
    assessment: RenewalAssessment,
    decidedBy: "auto" | "representative",
    note: string | null,
  ): Promise<WorkOrderRow> {
    const root = parent.renewalRoot ?? parent.code;
    const seq = parent.renewalSeq + 1;
    const code = renewalCode(root, seq);
    const period = nextPeriod(parent.periodEnd);
    const child = await db.transaction(async (tx) => {
      const [taken] = await tx
        .select({ id: workOrders.id })
        .from(workOrders)
        .where(and(eq(workOrders.organizationId, parent.organizationId), eq(workOrders.code, code)))
        .limit(1);
      if (taken) throw badRequest("CODE_TAKEN", `Work order ${code} already exists`);
      const id = crypto.randomUUID();
      const [inserted] = await tx
        .insert(workOrders)
        .values({
          id,
          code,
          organizationId: parent.organizationId,
          projectId: parent.projectId,
          projectTitle: parent.projectTitle,
          projectSlug: parent.projectSlug,
          builderNearAccount: parent.builderNearAccount,
          githubLogin: parent.githubLogin,
          title: parent.title,
          scope: parent.scope,
          repos: parent.repos,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          graceDays: parent.graceDays,
          tokenId: parent.tokenId,
          budgetAmount: parent.budgetAmount,
          payoutTokenId: parent.payoutTokenId,
          autoRenew: true,
          contractorName: parent.contractorName,
          contractorEmail: parent.contractorEmail,
          representativeName: parent.representativeName,
          representativeEmail: parent.representativeEmail,
          ipModel: parent.ipModel,
          customFields: parent.customFields,
          payeeConfirmedAt: parent.payeeConfirmedAt,
          payeeConfirmedBy: parent.payeeConfirmedBy,
          status: "draft",
          renewedFrom: parent.id,
          renewalRoot: root,
          renewalSeq: seq,
          createdBy: "renewal",
          createdAt: now(),
          updatedAt: now(),
        })
        .returning();
      await tx
        .update(workOrders)
        .set({
          renewalStatus: "renewed",
          renewalAssessment: JSON.stringify(assessment),
          renewalDecidedBy: decidedBy,
          renewalDecidedAt: now(),
          renewalNote: note,
          renewedTo: inserted!.id,
          renewalRoot: root,
          updatedAt: now(),
        })
        .where(eq(workOrders.id, parent.id));
      return inserted!;
    });
    const sent = await withSignatureLock(child.id, async () =>
      offerRow(await draftDocument(child)),
    ).catch(async (error: unknown) => {
      const drafted = await mustRow(child.id);
      return update(drafted.id, {
        esignError: `The renewal wasn't sent for signature: ${errorText(error)}`,
      });
    });
    const payload = await payloadOf(parent, {
      nextCode: code,
      period: `${period.periodStart} → ${period.periodEnd}`,
    });
    await notifyBuilder(sent, "work_order_renewed", payload);
    await notifyManagers(sent, "work_order_renewed", payload);
    if (sent.status === "offered" && !sent.esignEnvelopeId) {
      await notifyBuilder(sent, "work_order_offered", await payloadOf(sent));
      await announce(sent, "work_order.offered");
    }
    await announce(sent, "work_order.renewed", {
      renewal: {
        assessment,
        renewedTo: { id: code, periodStart: period.periodStart, periodEnd: period.periodEnd },
        unsent: sent.status === "draft" ? sent.esignError : null,
      },
    });
    return sent;
  }

  async function assessIfDue(initial: WorkOrderRow): Promise<void> {
    let row = initial;
    if (!row.autoRenew || row.renewalStatus !== null) return;
    if (row.status !== "ended" && row.status !== "exhausted") return;
    if (now().getTime() <= Date.parse(windowOfRow(row).to)) return;
    try {
      row = await collect(row);
    } catch (error) {
      console.warn(`[API] renewal check of ${row.code} waits for GitHub`, error);
      return;
    }
    const evidence = (await evidenceOf(row.id)).map(collectedOf);
    const assessment = assessRenewal({
      evidence,
      activity: summarizeActivity(evidence, scopeOf(row)),
      requests: (await requestsOf(row.id)).map((r) => ({
        id: `${row.code}-R${r.seq}`,
        status: r.status,
      })),
      thresholds: deps.thresholds,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      assessedAt: now().toISOString(),
    });
    if (assessment.passed) {
      await renew(row, assessment, "auto", null);
      return;
    }
    const pending = await update(row.id, {
      renewalStatus: "needs_approval",
      renewalAssessment: JSON.stringify(assessment),
    });
    await announce(pending, "work_order.renewal_needs_approval", {
      renewal: { assessment, renewedTo: null },
    });
    await notifyManagers(
      pending,
      "work_order_renewal_needs_approval",
      await payloadOf(pending, {
        missed: assessment.metrics
          .filter((m) => !m.met)
          .map((m) => m.label.toLowerCase())
          .join(", "),
      }),
    );
  }

  async function step(row: WorkOrderRow, counts: Record<string, number>) {
    const end = Date.parse(windowOfRow(row).to);
    const time = now().getTime();
    let current = row;
    if (current.status !== "exhausted" && !(current.status === "ended" && time > end + RECENT_MS)) {
      try {
        current = await collect(current);
        counts.collected = (counts.collected ?? 0) + 1;
      } catch (error) {
        console.warn(`[API] collecting ${current.code} failed`, error);
      }
    }
    const day = today();
    if (
      current.status === "active" &&
      !current.endingSoonAt &&
      day >= addDays(current.periodEnd, -ENDING_SOON_DAYS) &&
      day <= current.periodEnd
    ) {
      current = await update(current.id, { endingSoonAt: now() });
      await notifyBuilder(current, "work_order_ending_soon", await payloadOf(current));
      await announce(current, "work_order.ending_soon");
    }
    if (current.status === "active" && time > end) {
      current = await update(current.id, { status: "ended" });
      counts.ended = (counts.ended ?? 0) + 1;
    }
    const open = (await requestsOf(current.id)).some((r) => OPEN_REQUEST.includes(r.status));
    if (current.status === "ended" && current.autoDraftedFor !== current.periodEnd && !open) {
      const { remaining } = amountsOf(current, await requestsOf(current.id));
      if (remaining > 0n) {
        await draftRequest(current, {}, true);
        counts.drafted = (counts.drafted ?? 0) + 1;
      } else {
        current = await update(current.id, { autoDraftedFor: current.periodEnd });
      }
    }
    await assessIfDue(await mustRow(current.id));
  }

  async function approveAs(
    row: WorkOrderRow,
    request: CompensationRequestRow,
    amount: string,
    actorId: string,
    confirmEvidenceIds?: string[],
  ): Promise<CompensationRequestRow> {
    if (BigInt(amount) <= 0n) throw badRequest("AMOUNT_NOT_POSITIVE", "Approve more than zero");
    const approved = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(workOrders)
        .where(eq(workOrders.id, row.id))
        .for("update");
      if (!locked || !PAYABLE.includes(locked.status)) {
        throw badRequest(
          "NOT_PAYABLE",
          `Work order ${row.code} is ${locked?.status ?? "gone"}: nothing can be approved`,
        );
      }
      const [fresh] = await tx
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.id, request.id))
        .limit(1);
      if (fresh?.status !== "submitted") {
        throw badRequest(
          "NOT_SUBMITTED",
          `Request ${row.code}-R${request.seq} isn't waiting for approval`,
        );
      }
      const others = await tx
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.workOrderId, row.id));
      const { remaining } = amountsOf(locked, others);
      if (BigInt(amount) > remaining) {
        throw badRequest(
          "OVER_BUDGET",
          `Only ${display(remaining, row.tokenId)} of the budget remains`,
        );
      }
      if (confirmEvidenceIds?.length) {
        await tx
          .update(workOrderEvidence)
          .set({ authorized: true, confirmed: true })
          .where(
            and(
              eq(workOrderEvidence.workOrderId, row.id),
              inArray(workOrderEvidence.id, confirmEvidenceIds),
            ),
          );
      }
      const [done] = await tx
        .update(compensationRequests)
        .set({
          status: "approved",
          approvedAmount: amount,
          approvedBy: actorId,
          decidedAt: now(),
          note: null,
          autoPayBlockedReason: null,
          autoPayBlockedCode: null,
          autoPayBlockedAt: null,
          autoPayTriedAt: null,
          updatedAt: now(),
        })
        .where(
          and(
            eq(compensationRequests.id, request.id),
            eq(compensationRequests.status, "submitted"),
          ),
        )
        .returning();
      if (!done) {
        throw badRequest(
          "NOT_SUBMITTED",
          `Request ${row.code}-R${request.seq} isn't waiting for approval`,
        );
      }
      return done;
    });
    await notifyBuilder(
      row,
      "compensation_request_approved",
      await payloadOf(row, {
        requestCode: `${row.code}-R${request.seq}`,
        approved: display(amount, row.tokenId),
      }),
    );
    await announce(row, "request.approved", { request: approved });
    const paid = await tryAutoPay(approved, row);
    return paid.request;
  }

  const autoApproval = createAutoApproval({
    db,
    now,
    consistency: deps.consistency,
    collected: collectedOf,
    approve: (row, request, amount, actorId) => approveAs(row, request, amount, actorId),
    notify: (row, kind, payload) => notifyManagers(row, kind, payload),
    payload: payloadOf,
    display,
  });

  async function claimLock(holder: string, id = LOCK_ID, ms = LOCK_MS): Promise<boolean> {
    const until = new Date(now().getTime() + ms);
    const inserted = await db
      .insert(workOrderJobLock)
      .values({ id, holder, until })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) return true;
    const taken = await db
      .update(workOrderJobLock)
      .set({ holder, until })
      .where(and(eq(workOrderJobLock.id, id), lt(workOrderJobLock.until, now())))
      .returning();
    return taken.length > 0;
  }

  async function releaseLock(holder: string, id = LOCK_ID) {
    await db
      .delete(workOrderJobLock)
      .where(and(eq(workOrderJobLock.id, id), eq(workOrderJobLock.holder, holder)));
  }

  async function deliverOutbox() {
    await deps.outbox
      ?.deliver?.()
      .catch((error: unknown) => console.warn("[API] work order deliveries failed", error));
  }

  async function list(
    scope: OrganizationScope,
    input: {
      status?: WorkOrderStatus;
      projectId?: string;
      builderNearAccount?: string;
      mayNeedAgency?: boolean;
    } = {},
  ) {
    const conditions = [eq(workOrders.organizationId, scope.organizationId)];
    if (input.status) conditions.push(eq(workOrders.status, input.status));
    if (input.projectId) conditions.push(eq(workOrders.projectId, input.projectId));
    if (input.builderNearAccount)
      conditions.push(eq(workOrders.builderNearAccount, input.builderNearAccount));
    if (input.mayNeedAgency) {
      const open = db
        .select({ id: compensationRequests.workOrderId })
        .from(compensationRequests)
        .where(inArray(compensationRequests.status, ["submitted", "approved"]));
      conditions.push(
        or(
          inArray(workOrders.status, ["draft", "offered", "accepted", "active"]),
          eq(workOrders.renewalStatus, "needs_approval"),
          inArray(workOrders.id, open),
        )!,
      );
    }
    const rows = await db
      .select()
      .from(workOrders)
      .where(and(...conditions))
      .orderBy(desc(workOrders.periodStart), desc(workOrders.createdAt));
    const projects = new Map(
      (
        await directory
          .forAgency(scope)
          .list()
          .catch(() => [])
      ).map((p) => [p.id, p]),
    );
    const cache = await viewCacheOf(rows, projects);
    return {
      data: await Promise.all(rows.map(async (row) => adminView(await view(row, cache)))),
    };
  }

  return {
    list,

    needsYouCount: async (scope: OrganizationScope) => {
      const { data } = await list(scope, { mayNeedAgency: true });
      return { count: data.filter((workOrder) => workOrder.progress.needsYou).length };
    },

    get: async (scope: OrganizationScope, input: { id: string }) =>
      adminView(await detail(await syncSignatures(await ownRow(scope, input.id)))),

    activity: async (scope: OrganizationScope, input: { id: string }) => {
      const row = await ownRow(scope, input.id);
      const rows = await db
        .select()
        .from(workOrderOutbox)
        .where(
          and(
            eq(workOrderOutbox.organizationId, row.organizationId),
            eq(workOrderOutbox.workOrderId, row.id),
          ),
        )
        .orderBy(asc(workOrderOutbox.createdAt));
      return {
        emails: rows.map((r) => {
          const email = emailHeaders(r.payload);
          return {
            id: r.id,
            eventType: r.eventType,
            to: email.to,
            subject: email.subject,
            createdAt: r.createdAt.toISOString(),
            deliveredAt: r.deliveredAt?.toISOString() ?? null,
            lastError: r.lastError,
          };
        }),
      };
    },

    nextCode: async (scope: OrganizationScope) => ({ code: await nextCode(scope.organizationId) }),

    githubRepos: async (_scope: OrganizationScope, input: { org: string }) => {
      try {
        return { org: input.org, repos: await orgRepos(input.org) };
      } catch (error) {
        if (error instanceof GitHubError && error.status === 404) {
          throw badRequest("GITHUB_ORG_NOT_FOUND", `GitHub has no organization "${input.org}"`);
        }
        throw badRequest(
          "GITHUB_FAILED",
          `Couldn't load repositories from GitHub: ${errorText(error)}`,
        );
      }
    },

    builderDefaults: async (scope: OrganizationScope, input: { nearAccount: string }) => {
      const nearAccount = input.nearAccount.trim();
      const latestOf = (
        column: typeof workOrders.contractorEmail | typeof workOrders.githubLogin,
      ) =>
        db
          .select({ value: column })
          .from(workOrders)
          .where(
            and(
              eq(workOrders.organizationId, scope.organizationId),
              eq(workOrders.builderNearAccount, nearAccount),
              isNotNull(column),
            ),
          )
          .orderBy(desc(workOrders.createdAt))
          .limit(1)
          .then(([row]) => row?.value ?? null);
      const [builder, remembered, previousEmail, previousLogin] = await Promise.all([
        nearAccount ? deps.builders.get(nearAccount).catch(() => null) : null,
        nearAccount ? rememberedLogin(db, scope.organizationId, nearAccount) : null,
        latestOf(workOrders.contractorEmail),
        latestOf(workOrders.githubLogin),
      ]);
      const accountEmail =
        builder?.userId && deps.userEmail
          ? !!(await deps.userEmail(builder.userId).catch(() => null))
          : false;
      return {
        githubLogin: builder?.githubLogin?.toLowerCase() ?? remembered ?? previousLogin,
        contractorEmail: previousEmail,
        accountEmail,
        needsEmails: !!deps.esign,
      };
    },

    create: async (scope: OrganizationScope, input: WorkOrderFields) => {
      const code = input.code?.trim() || (await nextCode(scope.organizationId));
      const builder = await deps.builders.get(input.builderNearAccount);
      if (!builder) {
        throw badRequest(
          "UNKNOWN_BUILDER",
          `${input.builderNearAccount} has no builder profile on MultiAgency`,
        );
      }
      const fields = {
        ...input,
        code,
        repos: [...new Set(input.repos.map((r) => r.trim()).filter(Boolean))],
        githubLogin:
          optionalText(input.githubLogin)?.replace(/^@/, "").toLowerCase() ??
          builder.githubLogin?.toLowerCase() ??
          (await rememberedLogin(db, scope.organizationId, input.builderNearAccount)),
        contractorEmail: optionalText(input.contractorEmail)?.toLowerCase() ?? null,
        representativeEmail: optionalText(input.representativeEmail)?.toLowerCase() ?? null,
      };
      const project = await validateFields(scope, fields);
      const [row] = await db
        .insert(workOrders)
        .values({
          id: crypto.randomUUID(),
          code,
          organizationId: scope.organizationId,
          projectId: fields.projectId,
          projectTitle: project.title,
          projectSlug: project.slug,
          builderNearAccount: fields.builderNearAccount,
          title: fields.title.trim(),
          scope: fields.scope?.trim() || null,
          repos: JSON.stringify(fields.repos),
          periodStart: fields.periodStart,
          periodEnd: fields.periodEnd,
          graceDays: fields.graceDays ?? 2,
          tokenId: fields.tokenId,
          budgetAmount: fields.budgetAmount,
          payoutTokenId: fields.tokenId === USD ? NATIVE_TOKEN_ID : null,
          autoRenew: fields.autoRenew ?? false,
          githubLogin: fields.githubLogin,
          contractorName:
            optionalText(fields.contractorName) ?? builder.name ?? fields.builderNearAccount,
          contractorEmail: fields.contractorEmail,
          representativeName: optionalText(fields.representativeName),
          representativeEmail: fields.representativeEmail,
          ipModel: optionalText(fields.ipModel),
          customFields: customFieldsText(fields.customFields),
          status: "draft",
          createdBy: scope.actorId,
          createdAt: now(),
          updatedAt: now(),
        })
        .returning();
      await rememberBuilderLogin(
        scope.organizationId,
        fields.builderNearAccount,
        fields.githubLogin,
        builder,
      );
      return adminView(await view(await draftDocument(row!)));
    },

    update: async (scope: OrganizationScope, input: Partial<WorkOrderFields> & { id: string }) => {
      await ownRow(scope, input.id);
      return withSignatureLock(input.id, async () => {
        const row = await ownRow(scope, input.id);
        if (!EDITABLE.includes(row.status)) {
          throw badRequest(
            "NOT_EDITABLE",
            `Work order ${row.code} is ${row.status}: its terms can't change`,
          );
        }
        const next = {
          code: input.code?.trim() || row.code,
          projectId: input.projectId ?? row.projectId,
          builderNearAccount: input.builderNearAccount ?? row.builderNearAccount,
          title: input.title?.trim() ?? row.title,
          scope: input.scope === undefined ? row.scope : input.scope?.trim() || null,
          repos: input.repos
            ? [...new Set(input.repos.map((r) => r.trim()).filter(Boolean))]
            : parseList(row.repos),
          periodStart: input.periodStart ?? row.periodStart,
          periodEnd: input.periodEnd ?? row.periodEnd,
          graceDays: input.graceDays ?? row.graceDays,
          tokenId: input.tokenId ?? row.tokenId,
          budgetAmount: input.budgetAmount ?? row.budgetAmount,
          payoutTokenId: (input.tokenId ?? row.tokenId) === USD ? NATIVE_TOKEN_ID : null,
          autoRenew: input.autoRenew ?? row.autoRenew,
          githubLogin:
            input.githubLogin === undefined
              ? row.githubLogin
              : (optionalText(input.githubLogin)?.replace(/^@/, "").toLowerCase() ?? null),
          contractorName:
            input.contractorName === undefined
              ? row.contractorName
              : optionalText(input.contractorName),
          contractorEmail:
            input.contractorEmail === undefined
              ? row.contractorEmail
              : (optionalText(input.contractorEmail)?.toLowerCase() ?? null),
          representativeName:
            input.representativeName === undefined
              ? row.representativeName
              : optionalText(input.representativeName),
          representativeEmail:
            input.representativeEmail === undefined
              ? row.representativeEmail
              : (optionalText(input.representativeEmail)?.toLowerCase() ?? null),
          ipModel: input.ipModel === undefined ? row.ipModel : optionalText(input.ipModel),
        };
        const project = await validateFields(scope, next, row.id);
        if (
          next.builderNearAccount !== row.builderNearAccount &&
          !(await deps.builders.get(next.builderNearAccount))
        ) {
          throw badRequest(
            "UNKNOWN_BUILDER",
            `${next.builderNearAccount} has no builder profile on MultiAgency`,
          );
        }
        const patch = {
          ...next,
          customFields:
            input.customFields === undefined
              ? row.customFields
              : customFieldsText(input.customFields),
          repos: JSON.stringify(next.repos),
          projectTitle: project.title,
          projectSlug: project.slug,
        };
        const changed = termsHash({ ...row, ...patch }) !== termsHash(row);
        const payeeChanged = next.builderNearAccount !== row.builderNearAccount;
        if (changed) await cancelEnvelope(row, "The terms changed; a new version will be sent");
        const updated = await update(row.id, {
          ...patch,
          ...(changed
            ? {
                status: "draft" as const,
                offeredAt: null,
                acceptedAt: null,
                acceptedByUserId: null,
                acceptedTermsHash: null,
                preparedDocumentUrl: null,
                signatureMethod: null,
                esignEnvelopeId: null,
                esignBuilderUrl: null,
                esignRepresentativeUrl: null,
                esignError: null,
                signers: null,
                signedAt: null,
                documentSha256: null,
                documentUrl: null,
                documentId: null,
                documentFields: null,
                documentWarning: null,
              }
            : {}),
          ...(payeeChanged ? { payeeConfirmedAt: null, payeeConfirmedBy: null } : {}),
        });
        if (next.githubLogin && next.githubLogin !== row.githubLogin) {
          await rememberBuilderLogin(
            scope.organizationId,
            next.builderNearAccount,
            next.githubLogin,
          );
        }
        return adminView(await view(changed ? await draftDocument(updated) : updated));
      });
    },

    setGithubLogin: async (
      scope: OrganizationScope,
      input: { id: string; githubLogin: string },
    ) => {
      const row = await ownRow(scope, input.id);
      if (FINAL.includes(row.status))
        throw badRequest("CLOSED", `Work order ${row.code} is terminated`);
      if (row.githubLogin) {
        throw badRequest(
          "GITHUB_LOGIN_SET",
          "The GitHub login is part of the agreed terms: edit the work order to change it",
        );
      }
      const login = input.githubLogin.trim().replace(/^@/, "").toLowerCase();
      if (!GITHUB_LOGIN.test(login)) {
        throw badRequest("INVALID_GITHUB_LOGIN", `${input.githubLogin} isn't a GitHub login`);
      }
      const keepsAcceptance = row.status === "accepted" && row.acceptedTermsHash === termsHash(row);
      const next = { ...row, githubLogin: login };
      const updated = await update(row.id, {
        githubLogin: login,
        ...(keepsAcceptance ? { acceptedTermsHash: termsHash(next) } : {}),
      });
      await rememberBuilderLogin(scope.organizationId, row.builderNearAccount, login);
      return adminView(await view(await autoActivate(updated)));
    },

    prepareDocument: async (scope: OrganizationScope, input: { id: string }) => {
      const row = await ownRow(scope, input.id);
      if (row.status !== "draft" && row.status !== "offered") {
        throw badRequest(
          "NOT_DRAFT",
          `Work order ${row.code} is ${row.status}: its document is already signed`,
        );
      }
      return adminView(await view(await draftDocument(row, true)));
    },

    checkDrive: async (scope: OrganizationScope) => checkSignedDocuments(scope.organizationId),

    saveSignedToDrive: async (scope: OrganizationScope, input: { id: string }) => {
      const row = await ownRow(scope, input.id);
      if (!row.signedAt || row.signedDriveFileId) return adminView(await view(row));
      if (!(await googleOf(row.organizationId))) {
        throw badRequest("GOOGLE_FAILED", "Connect Google Drive first");
      }
      const saved = await saveSignedToDrive(row);
      if (!saved.signedDriveFileId && saved.signedDriveError) {
        throw badRequest("GOOGLE_FAILED", saved.signedDriveError);
      }
      return adminView(await view(saved));
    },

    requestPayeeConfirmation: async (scope: OrganizationScope, input: { id: string }) => {
      const row = await ownRow(scope, input.id);
      if (row.payeeConfirmedAt) {
        throw badRequest("PAYEE_CONFIRMED", `${row.builderNearAccount} is already confirmed`);
      }
      if (row.status === "draft" || FINAL.includes(row.status)) {
        throw badRequest(
          "NOT_OFFERED",
          "Offer the work order or have it signed before asking for the payout account",
        );
      }
      await announce(row, "work_order.confirm_payee");
      await notifyBuilder(row, "work_order_confirm_payee", await payloadOf(row));
      return adminView(await view(row));
    },

    offer: async (scope: OrganizationScope, input: { id: string }) => {
      await ownRow(scope, input.id);
      return withSignatureLock(input.id, async () => {
        const offered = await offerRow(await ownRow(scope, input.id));
        if (!offered.esignEnvelopeId) {
          await notifyBuilder(offered, "work_order_offered", await payloadOf(offered));
          await announce(offered, "work_order.offered");
        }
        return adminView(await view(offered));
      });
    },

    document: async (scope: OrganizationScope, input: { id: string }) =>
      documentOf(await ownRow(scope, input.id)),

    countersign: async (
      scope: OrganizationScope,
      input: { id: string; name: string },
      meta: { ip?: string | null; userAgent?: string | null } = {},
    ) => {
      const row = await ownRow(scope, input.id);
      const name = input.name.trim();
      if (name.length < 2) throw badRequest("NAME_REQUIRED", "Type your full name to sign");
      if (row.signedAt && row.status !== "draft" && row.status !== "offered") {
        throw badRequest("ALREADY_SIGNED", `Work order ${row.code} is already signed`);
      }
      if (row.status !== "accepted") {
        throw badRequest(
          "NOT_SIGNED_BY_BUILDER",
          `Work order ${row.code} is ${row.status}: the builder signs first`,
        );
      }
      const offered = await latestDocument(row.id, "offered");
      if (!offered || offered.termsHash !== termsHash(row)) {
        throw badRequest(
          "NO_DOCUMENT",
          "There's no signed-by-the-builder document for these terms",
        );
      }
      const signatures = await signaturesOf(row.id, offered.sha256);
      if (!signatures.some((s) => s.role === "contractor")) {
        throw badRequest("NOT_SIGNED_BY_BUILDER", "The builder hasn't signed this document yet");
      }
      if (signatures.some((s) => s.role === "representative")) {
        throw badRequest("ALREADY_SIGNED", "You've already countersigned it");
      }
      const contacts = await contactsOf(row, null);
      await db.insert(workOrderSignatures).values({
        id: crypto.randomUUID(),
        workOrderId: row.id,
        documentSha256: offered.sha256,
        role: "representative",
        name,
        email:
          contacts.representativeEmail ??
          (deps.userEmail ? await deps.userEmail(scope.actorId).catch(() => null) : null),
        userId: scope.actorId,
        nearAccount: null,
        ...clientMeta(meta),
        signedAt: now(),
      });
      return adminView(await view(await finalizeSigned(row, offered)));
    },

    attachDocument: async (
      scope: OrganizationScope,
      input: { id: string; sha256: string; url?: string | null },
    ) => {
      const row = await ownRow(scope, input.id);
      if (FINAL.includes(row.status))
        throw badRequest("CLOSED", `Work order ${row.code} is terminated`);
      return adminView(
        await view(
          await update(row.id, {
            documentSha256: input.sha256.toLowerCase(),
            documentUrl: input.url ?? null,
          }),
        ),
      );
    },

    activate: async (scope: OrganizationScope, input: { id: string }) => {
      const row = await ownRow(scope, input.id);
      if (row.status !== "accepted") {
        throw badRequest(
          "NOT_ACCEPTED",
          `Work order ${row.code} is ${row.status}: the builder must accept it first`,
        );
      }
      const blockers = await blockersOf(row);
      if (blockers.length)
        throw badRequest(
          "ACTIVATION_BLOCKED",
          `Can't activate ${row.code} yet: ${blockers.join("; ")}`,
        );
      return adminView(await view(await activateRow(row, scope.actorId)));
    },

    terminate: async (scope: OrganizationScope, input: { id: string }) => {
      await ownRow(scope, input.id);
      return withSignatureLock(input.id, async () => {
        const row = await ownRow(scope, input.id);
        if (FINAL.includes(row.status))
          throw badRequest("CLOSED", `Work order ${row.code} is already terminated`);
        await cancelEnvelope(row, "The work order was terminated");
        return adminView(await view(await update(row.id, { status: "terminated" })));
      });
    },

    remove: async (scope: OrganizationScope, input: { id: string }) => {
      await ownRow(scope, input.id);
      return withSignatureLock(input.id, async () => {
        const row = await ownRow(scope, input.id);
        if (row.status !== "draft" && row.status !== "offered") {
          throw badRequest(
            "NOT_DRAFT",
            "Only a draft or offered work order can be deleted; terminate it instead",
          );
        }
        const current = await syncEnvelope(row);
        if (current.status !== "draft" && current.status !== "offered") {
          throw badRequest(
            "ALREADY_SIGNED",
            `The builder has already signed ${row.code}; terminate it instead`,
          );
        }
        if (current.esignEnvelopeId && current.esignError) {
          throw badRequest(
            "ESIGN_UNCHECKED",
            `${current.esignError}. ${row.code} wasn't deleted; try again in a moment.`,
          );
        }
        await cancelEnvelope(current, "The work order was withdrawn", true);
        await db.delete(workOrders).where(eq(workOrders.id, current.id));
        return { deleted: true as const };
      });
    },

    collect: async (scope: OrganizationScope, input: { id: string }) =>
      adminView(await detail(await collect(await ownRow(scope, input.id)))),

    draftRequest: async (
      scope: OrganizationScope,
      input: { id: string; coversFrom?: string; coversTo?: string },
    ) => {
      const row = await ownRow(scope, input.id);
      return requestView(await draftRequest(row, input), row);
    },

    approveRequest: async (
      scope: OrganizationScope,
      input: {
        requestId: string;
        amount: string;
        confirmEvidenceIds?: string[];
        allowWithoutEvidence?: boolean;
      },
    ) => {
      const request = await mustRequest(input.requestId);
      const row = await ownRow(scope, request.workOrderId);
      if (!PAYABLE.includes(row.status)) {
        throw badRequest(
          "NOT_PAYABLE",
          `Work order ${row.code} is ${row.status}: nothing can be approved`,
        );
      }
      if (BigInt(input.amount) <= 0n)
        throw badRequest("AMOUNT_NOT_POSITIVE", "Approve more than zero");
      if (
        !input.allowWithoutEvidence &&
        (await authorizedEvidenceOf(row, request, input.confirmEvidenceIds ?? [])) === 0
      ) {
        throw badRequest(
          "NO_EVIDENCE",
          `${row.code}-R${request.seq} has no work the repository owner approved: confirm you want to approve it anyway`,
        );
      }
      const approved = await approveAs(
        row,
        request,
        input.amount,
        scope.actorId,
        input.confirmEvidenceIds,
      );
      return requestView(approved, row);
    },

    payoutReadiness: async (
      scope: OrganizationScope,
      input: { requestId: string; amount: string },
    ) => {
      const request = await mustRequest(input.requestId);
      const row = await ownRow(scope, request.workOrderId);
      const payouts = deps.payouts;
      const result = (
        code: string | null,
        reason: string | null,
        extra: { near?: string; balanceNear?: string | null; priceUsd?: string | null } = {},
      ) => ({
        ready: code === null,
        code,
        reason,
        near: extra.near ?? null,
        balanceNear: extra.balanceNear ?? null,
        priceUsd: extra.priceUsd ?? null,
      });
      if (!payouts) return result("unavailable", "Automatic payouts aren't set up");
      if (payoutTokenOf(row) !== NATIVE_TOKEN_ID) {
        return result(
          "unavailable",
          "Automatic payouts pay in NEAR; this work order pays in another token",
        );
      }
      let priced: { near: bigint; priceUsd: string | null };
      try {
        priced = await nearOf(row, BigInt(input.amount));
      } catch (error) {
        return result("unreachable", `Couldn't get the NEAR price: ${errorText(error)}`);
      }
      const near = atomicToNear(priced.near);
      const check = await payouts.readiness(
        row.organizationId,
        row.builderNearAccount,
        priced.near,
        priced.priceUsd,
      );
      if (check.ready) return result(null, null, { near, priceUsd: priced.priceUsd });
      const code = check.code ?? (check.reason === NO_AGENT ? "no_agent" : "unreachable");
      const funding =
        !NOT_PAYING_NOW.has(code) && payouts.fundingCheck
          ? await payouts
              .fundingCheck(row.organizationId, { near: priced.near, priceUsd: priced.priceUsd })
              .catch(() => null)
          : null;
      return result(code, check.reason ?? "The payout agent isn't ready", {
        near,
        balanceNear: funding?.balanceNear ?? null,
        priceUsd: priced.priceUsd,
      });
    },

    payoutCoverage: async (scope: OrganizationScope, input: { id: string }) => {
      const row = await ownRow(scope, input.id);
      const payouts = deps.payouts;
      if (!payouts?.fundingCheck || FINAL.includes(row.status)) return null;
      if (payoutTokenOf(row) !== NATIVE_TOKEN_ID) return null;
      const { paid } = amountsOf(row, await requestsOf(row.id));
      const budget = BigInt(row.budgetAmount);
      const unpaid = budget > paid ? budget - paid : 0n;
      if (unpaid <= 0n) return null;
      const priced = await nearOf(row, unpaid).catch(() => null);
      if (!priced) return null;
      const check = await payouts
        .fundingCheck(row.organizationId, { near: priced.near, priceUsd: priced.priceUsd })
        .catch(() => null);
      if (!check) return null;
      const overMonthly =
        check.monthlyNeededUsd !== null &&
        check.monthlyRemainingUsd !== null &&
        Number(check.monthlyNeededUsd) > Number(check.monthlyRemainingUsd);
      return {
        covered: !check.lowBalance && !overMonthly,
        unpaid: display(unpaid, row.tokenId),
        balanceNear: check.balanceNear,
        neededNear: check.neededNear,
        shortfallNear: check.shortfallNear,
        lowBalance: check.lowBalance,
        neededUsd: check.monthlyNeededUsd,
        monthlyBudgetUsd: check.monthlyBudgetUsd,
        monthlyRemainingUsd: check.monthlyRemainingUsd,
        overMonthly,
      };
    },

    fundingNeeds: async (scope: OrganizationScope) => {
      const rows = await db
        .select()
        .from(workOrders)
        .where(
          and(
            eq(workOrders.organizationId, scope.organizationId),
            inArray(workOrders.status, ["accepted", "active", "ended"]),
            inArray(workOrders.tokenId, [USD, NATIVE_TOKEN_ID]),
          ),
        )
        .orderBy(asc(workOrders.periodEnd), asc(workOrders.code));
      const decimals = getTokenMetadata(NATIVE_TOKEN_ID)?.decimals ?? 24;
      let quote: PriceQuote | null = null;
      if (rows.some((row) => row.tokenId === USD)) {
        if (!deps.prices) {
          throw badRequest("NO_PRICES", "USD prices aren't available on this server");
        }
        try {
          quote = await deps.prices.price(NATIVE_TOKEN_ID);
        } catch (error) {
          throw badRequest(
            "NO_PRICE",
            `Couldn't get the NEAR price: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      const items: {
        id: string;
        code: string;
        title: string;
        project: string | null;
        builderNearAccount: string;
        periodEnd: string;
        unpaid: string;
        near: string;
      }[] = [];
      for (const row of rows) {
        const { paid } = amountsOf(row, await requestsOf(row.id));
        const budget = BigInt(row.budgetAmount);
        const unpaid = budget > paid ? budget - paid : 0n;
        if (unpaid <= 0n) continue;
        const near =
          row.tokenId === USD && quote ? usdToTokens(unpaid, quote.priceUsd, decimals) : unpaid;
        const project = await projectOf(row);
        items.push({
          id: row.id,
          code: row.code,
          title: row.title,
          project: project?.title ?? null,
          builderNearAccount: row.builderNearAccount,
          periodEnd: row.periodEnd,
          unpaid: display(unpaid, row.tokenId),
          near: near.toString(),
        });
      }
      return {
        items,
        near: items.reduce((total, item) => total + BigInt(item.near), 0n),
        priceUsd: quote?.priceUsd ?? null,
      };
    },

    payNow: async (scope: OrganizationScope, input: { requestId: string }) => {
      const request = await mustRequest(input.requestId);
      const row = await ownRow(scope, request.workOrderId);
      if (request.status !== "approved" || !request.approvedAmount) {
        throw badRequest("NOT_APPROVED", "Only an approved request can be paid");
      }
      refuseTerminated(row);
      const result = await autoPay(request, row);
      if (result.request.status !== "paid" && result.request.status !== "paying") {
        throw badRequest("PAYOUTS_NOT_READY", result.reason ?? "It wasn't paid");
      }
      return requestView(result.request, row);
    },

    rejectRequest: async (scope: OrganizationScope, input: { requestId: string; note: string }) => {
      const request = await mustRequest(input.requestId);
      const row = await ownRow(scope, request.workOrderId);
      if (request.status !== "submitted" && request.status !== "approved") {
        throw badRequest("NOT_SUBMITTED", "Only a submitted or approved request can be rejected");
      }
      const [rejected] = await db
        .update(compensationRequests)
        .set({
          status: "rejected",
          note: input.note.trim(),
          decidedAt: now(),
          approvedAmount: null,
          updatedAt: now(),
        })
        .where(
          and(
            eq(compensationRequests.id, request.id),
            inArray(compensationRequests.status, ["submitted", "approved"]),
          ),
        )
        .returning();
      if (!rejected) {
        throw badRequest("NOT_SUBMITTED", "Only a submitted or approved request can be rejected");
      }
      await notifyBuilder(
        row,
        "compensation_request_rejected",
        await payloadOf(row, {
          requestCode: `${row.code}-R${request.seq}`,
          note: input.note.trim(),
        }),
      );
      await announce(row, "request.needs_review", { request: rejected });
      return requestView(rejected, row);
    },

    linkProposal: async (
      scope: TreasuryScope & OrganizationScope,
      input: { requestId: string; proposalId: string },
    ) => {
      const { request, row } = await daoPayable(scope, input.requestId, { linking: true });
      const id = Number.parseInt(input.proposalId, 10);
      if (!Number.isInteger(id) || id < 0)
        throw badRequest("INVALID_PROPOSAL", "Invalid proposal id");
      const [billed] = await db
        .select({ id: billings.id })
        .from(billings)
        .where(
          and(
            eq(billings.proposalId, String(id)),
            eq(billings.payingDaoAccountId, scope.agencyDao),
          ),
        )
        .limit(1);
      if (billed) {
        throw badRequest(
          "PROPOSAL_ALREADY_BILLED",
          `Proposal ${id} of ${scope.agencyDao} is already recorded as a billing`,
        );
      }
      const proposal = await deps.proposal(scope.agencyDao, id).catch(() => {
        throw badRequest(
          "PROPOSAL_UNAVAILABLE",
          `Couldn't read proposal ${id} of ${scope.agencyDao} from the chain; try again`,
        );
      });
      if (!proposal) throw notFound(`Proposal ${id} of ${scope.agencyDao}`);
      if (proposal.kind.type !== "Transfer") {
        throw badRequest("NOT_TRANSFER", `Proposal ${id} is not a transfer`);
      }
      const kind = proposal.kind;
      const tokenId = kind.tokenId === "" ? NATIVE_TOKEN_ID : kind.tokenId;
      if (kind.receiverId !== row.builderNearAccount) {
        throw badRequest(
          "WRONG_RECEIVER",
          `Proposal ${id} pays ${kind.receiverId}, not ${row.builderNearAccount}`,
        );
      }
      const payoutToken = payoutTokenOf(row);
      if (tokenId !== payoutToken) {
        throw badRequest("WRONG_TOKEN", `Proposal ${id} pays in ${tokenId}, not ${payoutToken}`);
      }
      const expected =
        row.tokenId !== USD
          ? request.approvedAmount
          : request.daoPaymentStartedAt
            ? request.payoutAmount
            : null;
      if (!expected) {
        throw badRequest(
          "NO_QUOTE",
          "Lock the amount first: open the payment, lock it, and create the proposal with exactly that amount",
        );
      }
      if (kind.amount !== expected) {
        throw badRequest(
          "WRONG_AMOUNT",
          row.tokenId === USD
            ? `Proposal ${id} pays ${display(kind.amount, tokenId)}, not the locked ${display(expected, tokenId)} (${display(request.approvedAmount, row.tokenId)} at ${request.priceUsd} USD). The proposal must pay exactly the locked amount.`
            : `Proposal ${id} pays ${display(kind.amount, tokenId)}, not the approved ${display(request.approvedAmount, row.tokenId)}`,
        );
      }
      const linked = await db
        .transaction(async (tx) => {
          const [billing] = await tx
            .insert(billings)
            .values({
              id: crypto.randomUUID(),
              projectId: row.projectId,
              nearAccount: row.builderNearAccount,
              tokenId,
              amount: kind.amount,
              proposalId: String(id),
              payingDaoAccountId: scope.agencyDao,
              note: `Work order ${row.code}, request ${row.code}-R${request.seq}`,
              createdAt: now(),
            })
            .returning();
          const [updated] = await tx
            .update(compensationRequests)
            .set({
              status: "proposed",
              proposalId: String(id),
              billingId: billing!.id,
              note: null,
              updatedAt: now(),
            })
            .where(
              and(
                eq(compensationRequests.id, request.id),
                eq(compensationRequests.status, "approved"),
                noUnsettledPayout(compensationRequests.id),
              ),
            )
            .returning();
          if (!updated) throw badRequest("REQUEST_CHANGED", "The request changed meanwhile");
          return updated;
        })
        .catch((error: unknown) =>
          reasonOf(error) === "REQUEST_CHANGED"
            ? refuseChangedRequest(request.id)
            : Promise.reject(error),
        );
      return requestView(await syncPayment(linked), row);
    },

    paymentProposal: async (
      scope: TreasuryScope & OrganizationScope,
      input: { requestId: string },
    ) => {
      const { request, row } = await daoPayable(scope, input.requestId, { linking: true });
      return daoPaymentTransaction(scope, row, request, await priceOf(row, request));
    },

    startDaoPayment: async (
      scope: TreasuryScope & OrganizationScope,
      input: { requestId: string },
    ) => {
      const { request, row } = await daoPayable(scope, input.requestId);
      const payout = await priceOf(row, request);
      if (request.daoPaymentStartedAt) {
        return daoPaymentTransaction(scope, row, request, payout);
      }
      const [started] = await db
        .update(compensationRequests)
        .set({
          ...lockedPrice(payout),
          daoPaymentStartedAt: now(),
          autoPayBlockedReason: null,
          autoPayBlockedCode: null,
          autoPayBlockedAt: null,
          note: DAO_PAYMENT_NOTE,
          updatedAt: now(),
        })
        .where(
          and(
            eq(compensationRequests.id, request.id),
            eq(compensationRequests.status, "approved"),
            isNull(compensationRequests.daoPaymentStartedAt),
            noUnsettledPayout(compensationRequests.id),
          ),
        )
        .returning();
      if (!started) return refuseChangedRequest(request.id);
      return daoPaymentTransaction(scope, row, started, payout);
    },

    refreshPayment: async (scope: OrganizationScope, input: { requestId: string }) => {
      const request = await mustRequest(input.requestId);
      const row = await ownRow(scope, request.workOrderId);
      return requestView(await syncPayment(request), row);
    },

    decideRenewal: async (
      scope: OrganizationScope,
      input: { id: string; decision: "approve" | "decline"; note?: string | null },
    ) => {
      const row = await ownRow(scope, input.id);
      const assessment = parseJson<RenewalAssessment | null>(row.renewalAssessment, null);
      if (row.renewalStatus !== "needs_approval" || !assessment) {
        throw badRequest(
          "RENEWAL_NOT_PENDING",
          `Work order ${row.code} has no renewal waiting for approval`,
        );
      }
      if (FINAL.includes(row.status))
        throw badRequest("CLOSED", `Work order ${row.code} is terminated`);
      const note = input.note?.trim() || null;
      if (input.decision === "approve") {
        await renew(row, assessment, "representative", note);
      } else {
        const declined = await update(row.id, {
          renewalStatus: "declined",
          renewalDecidedBy: "representative",
          renewalDecidedAt: now(),
          renewalNote: note,
        });
        const payload = await payloadOf(declined);
        await notifyBuilder(declined, "work_order_not_renewed", payload);
        await notifyManagers(declined, "work_order_not_renewed", payload, scope.actorId);
        await announce(declined, "work_order.not_renewed", {
          renewal: { assessment, renewedTo: null },
        });
      }
      return adminView(await view(await mustRow(row.id)));
    },

    report: async (scope: OrganizationScope, input: { requestId: string }) => {
      const request = await mustRequest(input.requestId);
      const row = await ownRow(scope, request.workOrderId);
      return requestView(request, row);
    },

    mine: async (context: PluginContext) => {
      const accounts = nearAccountsOf(context);
      if (accounts.length === 0) return { data: [] };
      const rows = await db
        .select()
        .from(workOrders)
        .where(inArray(workOrders.builderNearAccount, accounts))
        .orderBy(desc(workOrders.periodStart));
      const visible = rows.filter((r) => r.status !== "draft");
      const data = await Promise.all(
        visible.map(async (row) => ({
          ...builderView(await view(row)),
          agencyName: await deps
            .organizationName(row.organizationId)
            .catch(() => row.organizationId),
        })),
      );
      return { data: data.filter((wo) => !wo.signing.awaitingRepresentative) };
    },

    mineGet: async (context: PluginContext, input: { id: string }) => {
      const found = await mustRow(input.id);
      requireBuilder(context, found);
      const row = await syncSignatures(found);
      const mine = builderView(await detail(row));
      return {
        ...mine,
        requests: mine.requests.map((r) => ({ ...r, trust: null })),
        agencyName: await deps.organizationName(row.organizationId).catch(() => row.organizationId),
        termsHash: termsHash(row),
      };
    },

    myDocument: async (context: PluginContext, input: { id: string }) => {
      const row = await mustRow(input.id);
      requireBuilder(context, row);
      return documentOf(row);
    },

    sign: async (
      context: PluginContext,
      input: { id: string; documentSha256: string; name: string },
      meta: { ip?: string | null; userAgent?: string | null } = {},
    ) => {
      const row = await mustRow(input.id);
      requireBuilder(context, row);
      if (row.status !== "offered")
        throw badRequest("NOT_OFFERED", `Work order ${row.code} isn't waiting for your signature`);
      if (row.esignEnvelopeId) {
        throw badRequest(
          "SIGN_IN_DOCUMENSO",
          (await signingOf(row)).awaitingRepresentative
            ? `Work order ${row.code} isn't ready for your signature yet: ${row.representativeName ?? "the agency"} signs it first`
            : `Sign work order ${row.code} with the Documenso link in your email or on the work order page`,
        );
      }
      const name = input.name.trim();
      if (name.length < 2) throw badRequest("NAME_REQUIRED", "Type your full name to sign");
      const offered = await latestDocument(row.id, "offered");
      if (
        !offered ||
        offered.termsHash !== termsHash(row) ||
        offered.sha256 !== input.documentSha256
      ) {
        throw badRequest(
          "DOCUMENT_CHANGED",
          "The document changed since you opened it. Reload and review it again.",
        );
      }
      const contacts = await contactsOf(
        row,
        await deps.builders.get(row.builderNearAccount).catch(() => null),
      );
      const accepted = await db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(workOrders)
          .set({
            status: "accepted",
            acceptedAt: now(),
            acceptedByUserId: context.userId ?? null,
            acceptedTermsHash: termsHash(row),
            signatureMethod: "in_app",
            payeeConfirmedAt: row.payeeConfirmedAt ?? now(),
            payeeConfirmedBy: row.payeeConfirmedBy ?? context.userId ?? row.builderNearAccount,
            updatedAt: now(),
          })
          .where(
            and(
              eq(workOrders.id, row.id),
              eq(workOrders.status, "offered"),
              isNull(workOrders.esignEnvelopeId),
            ),
          )
          .returning();
        if (!claimed) {
          throw badRequest(
            "NOT_OFFERED",
            `Work order ${row.code} isn't waiting for your signature`,
          );
        }
        await tx.insert(workOrderSignatures).values({
          id: crypto.randomUUID(),
          workOrderId: row.id,
          documentSha256: offered.sha256,
          role: "contractor",
          name,
          email: contacts.contractorEmail,
          userId: context.userId ?? null,
          nearAccount: row.builderNearAccount,
          ...clientMeta(meta),
          signedAt: now(),
        });
        return claimed;
      });
      await notifyManagers(accepted, "work_order_accepted", await payloadOf(accepted));
      await announce(accepted, "work_order.builder_signed", { note: name });
      return builderView(await view(accepted));
    },

    confirmPayee: async (context: PluginContext, input: { id: string }) => {
      const row = await mustRow(input.id);
      requireBuilder(context, row);
      if (FINAL.includes(row.status))
        throw badRequest("CLOSED", `Work order ${row.code} is terminated`);
      if (row.payeeConfirmedAt) return builderView(await view(row));
      const confirmed = await update(row.id, {
        payeeConfirmedAt: now(),
        payeeConfirmedBy: context.userId ?? row.builderNearAccount,
      });
      await notifyManagers(confirmed, "work_order_payee_confirmed", await payloadOf(confirmed));
      await announce(confirmed, "work_order.payee_confirmed");
      return builderView(await view(await autoActivate(confirmed)));
    },

    decline: async (context: PluginContext, input: { id: string; note?: string | null }) => {
      requireBuilder(context, await mustRow(input.id));
      return withSignatureLock(input.id, async () => {
        const row = await mustRow(input.id);
        requireBuilder(context, row);
        if (row.status !== "offered")
          throw badRequest("NOT_OFFERED", `Work order ${row.code} isn't waiting for you`);
        await cancelEnvelope(row, "The builder declined");
        const declined = await update(row.id, {
          status: "draft",
          offeredAt: null,
          esignEnvelopeId: null,
          esignBuilderUrl: null,
          esignRepresentativeUrl: null,
        });
        await notifyManagers(
          declined,
          "work_order_declined",
          await payloadOf(declined, { note: input.note?.trim() ?? "" }),
        );
        await announce(declined, "work_order.declined", { note: input.note?.trim() || null });
        return builderView(await view(declined));
      });
    },

    mineDraftRequest: async (
      context: PluginContext,
      input: { id: string; coversFrom?: string; coversTo?: string },
    ) => {
      const row = await mustRow(input.id);
      requireBuilder(context, row);
      return { ...(await requestView(await draftRequest(row, input), row)), trust: null };
    },

    editRequest: async (
      context: PluginContext,
      input: {
        requestId: string;
        assessmentMd?: string;
        manualItems?: ManualItem[];
        requestedAmount?: string;
      },
    ) => {
      const request = await mustRequest(input.requestId);
      const row = await mustRow(request.workOrderId);
      requireBuilder(context, row);
      if (request.status !== "draft")
        throw badRequest("SUBMITTED", "This request was submitted and can't change");
      if (input.requestedAmount !== undefined) {
        const amount = BigInt(input.requestedAmount);
        const { remaining } = amountsOf(row, await requestsOf(row.id));
        if (amount <= 0n) throw badRequest("AMOUNT_NOT_POSITIVE", "Request more than zero");
        if (amount > remaining)
          throw badRequest("OVER_BUDGET", `At most ${display(remaining, row.tokenId)} remains`);
      }
      const manualItems = input.manualItems ?? parseJson<ManualItem[]>(request.manualItems, []);
      const evidence = evidenceFor(
        row,
        await evidenceOf(row.id),
        request.coversFrom,
        request.coversTo,
      );
      const edited = await updateRequest(request.id, {
        ...(input.assessmentMd !== undefined
          ? {
              assessmentMd: input.assessmentMd,
              assessmentEdited:
                input.assessmentMd !== request.assessmentMd || request.assessmentEdited,
            }
          : {}),
        ...(input.manualItems !== undefined
          ? {
              manualItems: JSON.stringify(input.manualItems),
              contributionsMd: contributionsOf(row, evidence, manualItems, request.summary),
            }
          : {}),
        ...(input.requestedAmount !== undefined ? { requestedAmount: input.requestedAmount } : {}),
      });
      return { ...(await requestView(edited, row)), trust: null };
    },

    submitRequest: async (context: PluginContext, input: { requestId: string }) => {
      const request = await mustRequest(input.requestId);
      const row = await mustRow(request.workOrderId);
      requireBuilder(context, row);
      if (request.status !== "draft")
        throw badRequest("SUBMITTED", "This request was already submitted");
      if (FINAL.includes(row.status))
        throw badRequest("CLOSED", `Work order ${row.code} is terminated`);
      const requests = await requestsOf(row.id);
      const { remaining, paid } = amountsOf(row, requests);
      if (BigInt(request.requestedAmount) > remaining) {
        throw badRequest(
          "OVER_BUDGET",
          `At most ${display(remaining, row.tokenId)} remains: lower the amount`,
        );
      }
      const evidence = evidenceFor(
        row,
        await evidenceOf(row.id),
        request.coversFrom,
        request.coversTo,
      );
      const manualItems = parseJson<ManualItem[]>(request.manualItems, []);
      const contributionsMd = contributionsOf(row, evidence, manualItems, request.summary);
      const project = await projectOf(row);
      const builder = await deps.builders.get(row.builderNearAccount).catch(() => null);
      const after = remaining - BigInt(request.requestedAmount);
      const frozen = renderReport({
        requestId: `${row.code}-R${request.seq}`,
        workOrderCode: row.code,
        projectTitle: project?.title ?? UNKNOWN_PROJECT,
        contractor: builder?.name ?? row.builderNearAccount,
        github: row.githubLogin ?? "",
        coversFrom: request.coversFrom,
        coversTo: request.coversTo,
        budget: display(row.budgetAmount, row.tokenId),
        previouslyPaid: display(paid, row.tokenId),
        requested: display(request.requestedAmount, row.tokenId),
        remainingAfter: display(after > 0n ? after : 0n, row.tokenId),
        contributionsMd,
        assessmentMd: request.assessmentMd,
        collectedAt: row.lastCollectedAt?.toISOString() ?? null,
      });
      const [submitted] = await db
        .update(compensationRequests)
        .set({
          status: "submitted",
          contributionsMd,
          evidenceIds: JSON.stringify(evidence.map((e) => e.id)),
          reportMd: frozen,
          reportSha256: sha256Hex(frozen),
          submittedAt: now(),
          updatedAt: now(),
        })
        .where(
          and(eq(compensationRequests.id, request.id), eq(compensationRequests.status, "draft")),
        )
        .returning();
      if (!submitted) throw badRequest("SUBMITTED", "This request was already submitted");
      const submittedPayload = await payloadOf(row, {
        requestCode: `${row.code}-R${request.seq}`,
        requested: display(request.requestedAmount, row.tokenId),
      });
      await announce(row, "request.awaiting_approval", { request: submitted, reportMd: frozen });
      const decided = await autoApproval
        .onSubmitted(row, submitted, submittedPayload)
        .catch((error: unknown) => {
          console.warn(`[API] trust check of request ${submitted.id} failed`, error);
          return false;
        });
      if (!decided) await notifyManagers(row, "compensation_request_submitted", submittedPayload);
      return { ...(await requestView(await mustRequest(submitted.id), row)), trust: null };
    },

    syncPendingSignatures,

    tick: async (holder: string = crypto.randomUUID()) => {
      if (!(await claimLock(holder, TICK_LOCK_ID, TICK_LOCK_MS))) {
        return { ran: false, counts: {} as Record<string, number> };
      }
      const counts: Record<string, number> = {};
      try {
        counts.signaturesChecked = await syncPendingSignatures();
        await activateReady(counts);
        const auto = await autoApproval.due(now());
        counts.autoApproved = auto.approved;
        counts.autoManual = auto.manual;
        await followUpPayouts(counts);
        await retryBlockedPayouts(counts);
        await retryDriveUploads(counts);
        await deliverOutbox();
      } finally {
        await releaseLock(holder, TICK_LOCK_ID);
      }
      return { ran: true, counts };
    },

    stopAutoApproval: async (scope: OrganizationScope, input: { requestId: string }) => {
      const request = await mustRequest(input.requestId);
      const row = await ownRow(scope, request.workOrderId);
      return requestView(await autoApproval.stop(request, scope.actorId), row);
    },

    trustSettings: async (scope: OrganizationScope) => autoApproval.settings(scope.organizationId),

    autoApproveDue: () => autoApproval.due(now()),

    run: async (holder: string = crypto.randomUUID()) => {
      if (!(await claimLock(holder))) return { ran: false, counts: {} as Record<string, number> };
      const counts: Record<string, number> = {};
      try {
        counts.signaturesChecked = await syncPendingSignatures();
        await activateReady(counts);
        const auto = await autoApproval.due(now());
        counts.autoApproved = auto.approved;
        counts.autoManual = auto.manual;
        const rows = await db
          .select()
          .from(workOrders)
          .where(inArray(workOrders.status, ["active", "ended", "exhausted"]));
        for (const row of rows) {
          try {
            await step(row, counts);
          } catch (error) {
            console.warn(`[API] work order ${row.code} step failed`, error);
          }
        }
        const maintained = await deps.payouts?.maintain?.().catch((error: unknown) => {
          console.warn("[API] payout agent upkeep failed", error);
          return null;
        });
        if (maintained) {
          counts.intentsSettled = maintained.intentsSettled;
          for (const { organizationId, expiresAt } of maintained.grantReminders) {
            await deps.notifications
              .notify({
                organizationId,
                kind: "payout_grant_expiring",
                payload: { expiresOn: expiresAt.toISOString().slice(0, 10) },
                link: "/admin/settings",
                email: true,
              })
              .catch((error: unknown) =>
                console.warn("[API] payout permission reminder failed:", error),
              );
          }
        }
        await followUpPayouts(counts);
        await retryBlockedPayouts(counts);
        const proposed = await db
          .select()
          .from(compensationRequests)
          .where(eq(compensationRequests.status, "proposed"));
        for (const request of proposed) {
          const synced = await syncPayment(request).catch(() => request);
          if (synced.status !== "proposed")
            counts[synced.status] = (counts[synced.status] ?? 0) + 1;
        }
        counts.workOrders = rows.length;
        const google = await db
          .select({ organizationId: workOrderIntegrations.organizationId })
          .from(workOrderIntegrations)
          .where(isNotNull(workOrderIntegrations.googleSignedFolderId));
        for (const { organizationId } of google) {
          const checked = await checkSignedDocuments(organizationId).catch(() => null);
          if (checked) counts.signed = (counts.signed ?? 0) + checked.attached;
        }
        await deliverOutbox();
      } finally {
        await releaseLock(holder);
      }
      return { ran: true, counts };
    },
  };
}

export type WorkOrdersService = ReturnType<typeof createWorkOrdersService>;
