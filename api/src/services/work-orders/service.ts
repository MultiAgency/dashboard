import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
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
  workOrderSignatures,
  workOrders,
} from "../../db/schema";
import { nearAccountsOf, type PluginContext } from "../../lib/organizations";
import type { NotificationKind } from "../notifications";
import type { AgencyScope, OrganizationScope, TreasuryScope } from "../organization-access";
import type { Project, ProjectDirectory } from "../project-directory";
import type { DaoProposal } from "../sputnik";
import { baseUnitsToDisplay, getTokenMetadata, NATIVE_TOKEN_ID } from "../tokens";
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
import type { GhRepoOwnership, GitHubPort } from "./github";
import type { DriveFile, GooglePort } from "./google";
import { type PriceFeed, type PriceQuote, USD, USD_DECIMALS, usdToTokens } from "./prices";
import { assessRenewal, renewalCode } from "./renewal";
import {
  buildContributions,
  paymentSection,
  renderReport,
  servedReport,
  sha256Hex,
  templateAssessment,
} from "./report";
import { fromBase64, sha256Bytes, signedPdf, termsPdf, toBase64 } from "./signing";
import type { Summarizer } from "./summarizer";
import { addDays, dateOf, nextPeriod, startOfDay, windowOf } from "./time";
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
  payouts?: {
    readiness(
      organizationId: string,
      payee: string,
    ): Promise<{ ready: boolean; reason: string | null }>;
    send(
      organizationId: string,
      input: { requestId: string; recipient: string; amount: string },
    ): Promise<AgentPayoutView>;
    refresh(payout: AgentPayoutView): Promise<AgentPayoutView>;
    latest(requestId: string): Promise<AgentPayoutView | null>;
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
  google?: GooglePort | null;
  userEmail?: (userId: string) => Promise<string | null>;
  appOrigin?: string;
  now?: () => Date;
};

export type ExtractedTerms = {
  workOrderId: string;
  project: string;
  contractorName: string;
  representativeName: string;
  periodStart: string;
  periodEnd: string;
  budgetUsd: string;
  payee: string | null;
  contractorGithub: string | null;
  repos: string[] | null;
};

export type SignedDocument = {
  method: "google_esign";
  documentSha256: string;
  documentUrl?: string | null;
  signedAt?: string | null;
  signers?: { name: string; role: "contractor" | "representative"; signedAt: string | null }[];
  extracted: ExtractedTerms;
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
};

type WorkOrderStatus = WorkOrderRow["status"];
type RequestStatus = CompensationRequestRow["status"];

const COMMITTED: readonly RequestStatus[] = ["approved", "paying", "proposed", "paid"];
const OPEN_REQUEST: readonly RequestStatus[] = ["draft", "submitted"];
const EDITABLE: readonly WorkOrderStatus[] = ["draft", "offered", "accepted"];
const PAYABLE: readonly WorkOrderStatus[] = ["active", "ended", "exhausted"];
const FINAL: readonly WorkOrderStatus[] = ["terminated"];
const FAILED_PROPOSAL = new Set(["Rejected", "Removed", "Expired", "Moved", "Failed"]);
const RECENT_MS = 7 * 86_400_000;
const ENDING_SOON_DAYS = 3;
const LOCK_ID = "work-orders";
const LOCK_MS = 15 * 60_000;
const REPO = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
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
  >,
): string {
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
  };
  return createHash("sha256").update(JSON.stringify(terms), "utf8").digest("hex");
}

function normalizeDecimal(value: string): string | null {
  const text = value.replace(/usd[c]?|usdt|near/gi, "").replace(/[\s$]/g, "");
  const grouped = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text);
  if (!grouped && text.includes(",")) return null;
  const plain = text.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(plain)) return null;
  const [whole = "0", fraction = ""] = plain.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return `${whole.replace(/^0+(?=\d)/, "")}${trimmed ? `.${trimmed}` : ""}`;
}

export function compareTerms(
  row: Pick<
    WorkOrderRow,
    | "code"
    | "contractorName"
    | "representativeName"
    | "periodStart"
    | "periodEnd"
    | "builderNearAccount"
    | "githubLogin"
    | "repos"
  > & { projectTitle: string; budgetDecimal: string },
  extracted: ExtractedTerms,
): string[] {
  const out: string[] = [];
  const name = (v: string | null | undefined) =>
    (v ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  const check = (label: string, draft: string, pdf: string, same: boolean) => {
    if (!same)
      out.push(`${label}: draft ${JSON.stringify(draft)}, signed PDF ${JSON.stringify(pdf)}`);
  };
  check(
    "work order id",
    row.code,
    extracted.workOrderId,
    extracted.workOrderId.trim().toLowerCase() === row.code.toLowerCase(),
  );
  check(
    "project",
    row.projectTitle,
    extracted.project,
    name(extracted.project) === name(row.projectTitle),
  );
  check(
    "contractor",
    row.contractorName ?? "",
    extracted.contractorName,
    name(extracted.contractorName) === name(row.contractorName),
  );
  check(
    "representative",
    row.representativeName ?? "",
    extracted.representativeName,
    name(extracted.representativeName) === name(row.representativeName),
  );
  check(
    "period start",
    row.periodStart,
    extracted.periodStart,
    extracted.periodStart.trim() === row.periodStart,
  );
  check(
    "period end",
    row.periodEnd,
    extracted.periodEnd,
    extracted.periodEnd.trim() === row.periodEnd,
  );
  const budget = normalizeDecimal(extracted.budgetUsd);
  if (budget === null || budget !== normalizeDecimal(row.budgetDecimal)) {
    out.push(`budget: draft ${row.budgetDecimal}, signed PDF ${extracted.budgetUsd}`);
  }
  if (extracted.payee !== null) {
    check(
      "payout account",
      row.builderNearAccount,
      extracted.payee,
      extracted.payee.trim().toLowerCase() === row.builderNearAccount.toLowerCase(),
    );
  }
  if (extracted.contractorGithub !== null) {
    check(
      "GitHub login",
      row.githubLogin ?? "",
      extracted.contractorGithub,
      extracted.contractorGithub.trim().replace(/^@/, "").toLowerCase() ===
        (row.githubLogin ?? "").toLowerCase(),
    );
  }
  if (extracted.repos !== null) {
    const set = (list: string[]) =>
      [...new Set(list.map((r) => r.trim().toLowerCase()))].sort().join(", ");
    const repos = parseList(row.repos);
    check(
      "repositories",
      repos.join(", "),
      extracted.repos.join(", "),
      set(extracted.repos) === set(repos),
    );
  }
  return out;
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
  const now = () => deps.now?.() ?? new Date();
  const today = () => dateOf(now());
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

  async function quotePayout(row: WorkOrderRow, request: CompensationRequestRow) {
    const tokenId = payoutTokenOf(row);
    if (row.tokenId !== USD) {
      return { tokenId, amount: request.approvedAmount ?? "0", priceUsd: null, pricedAt: null };
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
    const pricedAt = now();
    await updateRequest(request.id, {
      payoutTokenId: tokenId,
      payoutAmount: amount.toString(),
      priceUsd: quote.priceUsd,
      pricedAt,
    });
    return { tokenId, amount: amount.toString(), priceUsd: quote.priceUsd, pricedAt };
  }

  type Announcement = {
    request?: CompensationRequestRow | null;
    payout?: { txUrl: string | null; near: string } | null;
    reportMd?: string | null;
    mismatches?: string[] | null;
    renewal?: WorkOrderEvent["renewal"];
    note?: string | null;
    document?: string | null;
  };

  async function contactsOf(row: WorkOrderRow, builder: BuilderProfile | null) {
    const lookup = async (userId: string | null | undefined) =>
      userId && deps.userEmail ? await deps.userEmail(userId).catch(() => null) : null;
    const creator = row.createdBy !== "renewal" ? row.createdBy : null;
    return {
      contractorEmail: row.contractorEmail ?? (await lookup(builder?.userId)),
      representativeEmail: row.representativeEmail ?? (await lookup(creator)),
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
          project: project?.title ?? row.projectId,
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
    return signed;
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

  async function fillGoogleDocument(row: WorkOrderRow): Promise<WorkOrderRow | null> {
    const google = deps.google;
    const settings = google ? await integrationOf(row.organizationId) : null;
    if (!google || !settings?.googleTemplateId || !settings.googleDocumentsFolderId) return null;
    const [project, agencyName, builder] = await Promise.all([
      projectOf(row),
      deps.organizationName(row.organizationId).catch(() => row.organizationId),
      deps.builders.get(row.builderNearAccount).catch(() => null),
    ]);
    const contacts = await contactsOf(row, builder);
    const values = documentFields({
      code: row.code,
      project: project?.title ?? row.projectId,
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
    const copy = await google.copy(settings.googleTemplateId, {
      name: `Work Order ${row.code}: ${row.title}`,
      parentId: settings.googleDocumentsFolderId,
    });
    const occurrences = await google.fill(copy.id, values);
    const url = copy.webViewLink ?? `https://docs.google.com/document/d/${copy.id}/edit`;
    const updated = await update(row.id, {
      documentId: copy.id,
      preparedDocumentUrl: url,
      documentFields: JSON.stringify(requiredFields(values, occurrences)),
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
    const google = deps.google;
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
      ["Project", project?.title ?? row.projectId],
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
    const google = deps.google;
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
    const sha256 = sha256Bytes(final);
    const fileName = `Work Order ${row.code} (signed).pdf`;
    let driveFileId: string | null = null;
    let driveUrl: string | null = null;
    const google = deps.google;
    const settings = google ? await integrationOf(row.organizationId) : null;
    if (google && settings?.googleSignedFolderId) {
      try {
        const uploaded = await google.upload({
          folderId: settings.googleSignedFolderId,
          name: fileName,
          bytes: final,
          mimeType: "application/pdf",
        });
        driveFileId = uploaded.id;
        driveUrl = uploaded.webViewLink;
        await recordDriveFile({
          organizationId: row.organizationId,
          fileId: uploaded.id,
          name: fileName,
          url: uploaded.webViewLink,
          sha256,
          workOrderId: row.id,
          outcome: "attached",
          note: "Signed in MultiAgency",
        });
      } catch (error) {
        await recordGoogle(
          row.organizationId,
          `Couldn't save the signed PDF of ${row.code} to Drive: ${errorText(error)}`,
        );
      }
    }
    await db.insert(workOrderDocuments).values({
      id: crypto.randomUUID(),
      workOrderId: row.id,
      kind: "signed",
      fileName,
      pdf: toBase64(final),
      sha256,
      termsHash: offered.termsHash,
      driveFileId,
      driveUrl,
      createdAt: completedAt,
    });
    const signed = await update(row.id, {
      signatureMethod: "in_app",
      signedAt: completedAt,
      signers: JSON.stringify(
        ordered.map((s) => ({ name: s.name, role: s.role, signedAt: s.signedAt.toISOString() })),
      ),
      documentSha256: sha256,
      documentUrl: driveUrl,
    });
    const payload = await payloadOf(signed);
    await notifyManagers(signed, "work_order_signed", payload);
    await notifyBuilder(signed, "work_order_signed", payload);
    await announce(signed, "work_order.signed", {
      document: driveUrl ?? absolute(builderLink(row.id)),
    });
    return signed;
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

  async function payeeOf(row: WorkOrderRow) {
    if (row.payeeConfirmedAt) {
      return {
        account: row.builderNearAccount,
        confirmedAt: row.payeeConfirmedAt.toISOString(),
        paidBefore: null as boolean | null,
        needsConfirmation: false,
      };
    }
    const known = EDITABLE.includes(row.status) ? await paidBefore(row) : null;
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

  async function rowByCode(organizationId: string, code: string): Promise<WorkOrderRow> {
    const [row] = await db
      .select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.organizationId, organizationId),
          eq(sql`lower(${workOrders.code})`, code.trim().toLowerCase()),
        ),
      )
      .limit(1);
    if (!row) throw notFound(`Work order ${code}`);
    return row;
  }

  async function ownRow(scope: OrganizationScope, id: string): Promise<WorkOrderRow> {
    const row = await mustRow(id);
    if (row.organizationId !== scope.organizationId) throw notFound();
    return row;
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

  async function signingOf(row: WorkOrderRow) {
    const offered = await latestDocument(row.id, "offered");
    if (!offered || offered.termsHash !== termsHash(row)) {
      return { documentSha256: null, builder: null, representative: null, needsCountersign: false };
    }
    const signatures = await signaturesOf(row.id, offered.sha256);
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
    };
  }

  function scopeOf(row: WorkOrderRow): WorkOrderScope {
    const activated = row.activatedAt ? dateOf(row.activatedAt) : null;
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
    };
  }

  function activationBlockers(
    row: WorkOrderRow,
    builder: BuilderProfile | null,
    payeeNeedsConfirmation: boolean,
    needsCountersign = false,
  ): string[] {
    if (row.status !== "draft" && row.status !== "offered" && row.status !== "accepted") return [];
    const out: string[] = [];
    if (row.status === "draft") {
      out.push("Offer it to the builder, or have the work order document e-signed");
    }
    if (row.status === "offered") {
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
  ) {
    const others = siblings ?? (await requestsOf(row.id));
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
            paidOn: request.paidAt ? dateOf(request.paidAt) : today(),
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
                      reason: p.reason,
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
      proposalId: request.proposalId,
      payingDaoAccountId: daoAccountId,
      paidAt: request.paidAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    };
  }

  async function view(row: WorkOrderRow, cache?: { projects?: Map<string, Project> }) {
    const [requests, builder] = await Promise.all([
      requestsOf(row.id),
      deps.builders.get(row.builderNearAccount).catch(() => null),
    ]);
    const project = cache?.projects?.get(row.projectId) ?? (await projectOf(row));
    const payee = await payeeOf(row);
    const signing = await signingOf(row);
    const { committed, paid, remaining } = amountsOf(row, requests);
    const renewal = parseJson<RenewalAssessment | null>(row.renewalAssessment, null);
    return {
      id: row.id,
      code: row.code,
      organizationId: row.organizationId,
      projectId: row.projectId,
      projectTitle: project?.title ?? row.projectId,
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
      },
      title: row.title,
      scope: row.scope,
      repos: parseList(row.repos),
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      graceDays: row.graceDays,
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
      activationBlockers: activationBlockers(
        row,
        builder,
        payee.needsConfirmation,
        signing.needsCountersign,
      ),
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
      requests: await Promise.all(requests.map((r) => requestView(r, row, requests))),
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
      projectTitle: project?.title ?? row.projectId,
      agencyName,
      builderName: builder?.name ?? row.builderNearAccount,
      budget: display(row.budgetAmount, row.tokenId),
      period: `${row.periodStart} → ${row.periodEnd}`,
      periodEnd: row.periodEnd,
      ...extra,
    };
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
    await db.transaction(async (tx) => {
      const stale = existing.filter(
        (e) => e.kind !== "manual" && !(e.repo && keep.has(e.repo.toLowerCase())),
      );
      if (stale.length) {
        await tx.delete(workOrderEvidence).where(
          inArray(
            workOrderEvidence.id,
            stale.map((e) => e.id),
          ),
        );
      }
      const fresh = collected.filter((c) => !(c.repo && keep.has(c.repo.toLowerCase())));
      for (const item of fresh) {
        const isConfirmed = confirmed.has(item.url);
        await tx
          .insert(workOrderEvidence)
          .values({
            id: crypto.randomUUID(),
            workOrderId: row.id,
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
          })
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
    const from = startOfDay(coversFrom);
    const to = startOfDay(addDays(coversTo, grace + 1)) - 1;
    return evidence.filter((e) => {
      if (e.kind === "assigned_issue") return true;
      if (!e.occurredAt) return false;
      const at = e.occurredAt.getTime();
      return at >= from && at <= to;
    });
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

  async function draftRequest(
    row: WorkOrderRow,
    input: { coversFrom?: string; coversTo?: string },
    auto = false,
  ): Promise<CompensationRequestRow> {
    if (row.status !== "active" && row.status !== "ended") {
      throw badRequest("NOT_OPEN", `Work order ${row.code} is ${row.status}: no new requests`);
    }
    const requests = await requestsOf(row.id);
    if (requests.some((r) => r.status === "draft")) {
      throw badRequest("DRAFT_EXISTS", "A draft request already exists for this work order");
    }
    const { remaining } = amountsOf(row, requests);
    if (remaining <= 0n) throw badRequest("BUDGET_USED", "The work order budget is used up");
    const coversFrom = input.coversFrom ?? row.periodStart;
    const coversTo = input.coversTo ?? row.periodEnd;
    if (coversFrom > coversTo || coversFrom < row.periodStart || coversTo > row.periodEnd) {
      throw badRequest("INVALID_PERIOD", "The covered dates must lie inside the work order period");
    }
    const evidence = evidenceFor(row, await evidenceOf(row.id), coversFrom, coversTo);
    const seq = (requests.at(-1)?.seq ?? 0) + 1;
    const project = await projectOf(row);
    const draft =
      deps.summarizer && evidence.length > 0
        ? await deps.summarizer
            .draftReport({
              workOrderCode: row.code,
              project: project?.title ?? row.projectId,
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
        requestedAmount: remaining.toString(),
        summary: draft?.summary ?? null,
        contributionsMd,
        assessmentMd,
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
          updatedAt: now(),
        })
        .where(eq(compensationRequests.id, request.id))
        .returning();
      return updated!;
    });
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
      payout: { near: row.builderNearAccount, txUrl: payout.txUrl },
      reportMd: (await requestView(paid, row)).reportMd,
    });
    return paid;
  }

  async function settleAgentPayout(
    request: CompensationRequestRow,
    row: WorkOrderRow,
    payout: AgentPayoutView,
  ): Promise<CompensationRequestRow> {
    if (payout.status === "paid") return markPaidByAgent(request, row, payout);
    if (payout.status === "refused" || (payout.status === "failed" && payout.provenUnsent)) {
      return updateRequest(request.id, {
        status: "approved",
        note: `The automatic payout didn't go out: ${payout.reason ?? payout.status}. Pay it again or through a DAO proposal.`,
      });
    }
    if (payout.status === "failed" || payout.status === "needs_review") {
      return updateRequest(request.id, {
        status: "paying",
        note: `The automatic payout needs a person to check it: ${payout.reason ?? payout.status}.`,
      });
    }
    return request.status === "paying" ? request : updateRequest(request.id, { status: "paying" });
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
    const readiness = await payouts.readiness(row.organizationId, row.builderNearAccount);
    if (!readiness.ready) return { request, reason: readiness.reason };
    const quote = await quotePayout(row, request);
    const payout = await payouts.send(row.organizationId, {
      requestId: request.id,
      recipient: row.builderNearAccount,
      amount: quote.amount,
    });
    return {
      request: await settleAgentPayout(await mustRequest(request.id), row, payout),
      reason: null,
    };
  }

  async function syncPayment(request: CompensationRequestRow): Promise<CompensationRequestRow> {
    if (request.status !== "proposed" || !request.proposalId) return request;
    const row = await mustRow(request.workOrderId);
    const dao = await deps.agencyDaoOf(row.organizationId);
    if (!dao) return request;
    const proposal = await deps.proposal(dao, Number(request.proposalId)).catch(() => null);
    if (!proposal) return request;
    const payload = await payloadOf(row, {
      requestCode: `${row.code}-R${request.seq}`,
      amount: display(request.approvedAmount ?? "0", row.tokenId),
      daoAccountId: dao,
      proposalId: request.proposalId,
      status: proposal.status,
    });
    if (proposal.status === "Approved") {
      const paid = await updateRequest(request.id, { status: "paid", paidAt: now() });
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
    if (FAILED_PROPOSAL.has(proposal.status)) {
      const failed = await updateRequest(request.id, {
        status: "failed",
        note: `Proposal #${request.proposalId} ended as ${proposal.status}; nothing was paid.`,
      });
      await notifyBuilder(row, "compensation_request_failed", payload);
      await notifyManagers(row, "compensation_request_failed", payload);
      await announce(row, "request.needs_review", { request: failed });
      return failed;
    }
    return request;
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
      const base = {
        ...parent,
        id: crypto.randomUUID(),
        code,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
      };
      const [inserted] = await tx
        .insert(workOrders)
        .values({
          id: base.id,
          code,
          organizationId: parent.organizationId,
          projectId: parent.projectId,
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
          signatureMethod: parent.signatureMethod,
          signers: parent.signers,
          signedAt: parent.signedAt,
          payeeConfirmedAt: parent.payeeConfirmedAt,
          payeeConfirmedBy: parent.payeeConfirmedBy,
          status: "active",
          offeredAt: parent.offeredAt,
          acceptedAt: parent.acceptedAt,
          acceptedByUserId: parent.acceptedByUserId,
          acceptedTermsHash: termsHash(base),
          documentSha256: parent.documentSha256,
          documentUrl: parent.documentUrl,
          activatedAt: new Date(startOfDay(period.periodStart)),
          activatedBy: decidedBy === "auto" ? "renewal" : parent.activatedBy,
          renewedFrom: parent.id,
          renewalRoot: root,
          renewalSeq: seq,
          createdBy: "renewal",
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
    const payload = await payloadOf(parent, {
      nextCode: code,
      period: `${period.periodStart} → ${period.periodEnd}`,
    });
    await notifyBuilder(child, "work_order_renewed", payload);
    await notifyManagers(child, "work_order_renewed", payload);
    await announce(parent, "work_order.renewed", {
      renewal: {
        assessment,
        renewedTo: { id: code, periodStart: period.periodStart, periodEnd: period.periodEnd },
      },
    });
    return child;
  }

  async function assessIfDue(initial: WorkOrderRow): Promise<void> {
    let row = initial;
    if (!row.autoRenew || row.renewalStatus !== null) return;
    if (row.status !== "ended" && row.status !== "exhausted") return;
    if (now().getTime() <= Date.parse(windowOf(row).to)) return;
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
    const end = Date.parse(windowOf(row).to);
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

  async function claimLock(holder: string): Promise<boolean> {
    const until = new Date(now().getTime() + LOCK_MS);
    const inserted = await db
      .insert(workOrderJobLock)
      .values({ id: LOCK_ID, holder, until })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) return true;
    const taken = await db
      .update(workOrderJobLock)
      .set({ holder, until })
      .where(and(eq(workOrderJobLock.id, LOCK_ID), lt(workOrderJobLock.until, now())))
      .returning();
    return taken.length > 0;
  }

  async function releaseLock(holder: string) {
    await db
      .delete(workOrderJobLock)
      .where(and(eq(workOrderJobLock.id, LOCK_ID), eq(workOrderJobLock.holder, holder)));
  }

  return {
    list: async (
      scope: OrganizationScope,
      input: { status?: WorkOrderStatus; projectId?: string; builderNearAccount?: string } = {},
    ) => {
      const conditions = [eq(workOrders.organizationId, scope.organizationId)];
      if (input.status) conditions.push(eq(workOrders.status, input.status));
      if (input.projectId) conditions.push(eq(workOrders.projectId, input.projectId));
      if (input.builderNearAccount)
        conditions.push(eq(workOrders.builderNearAccount, input.builderNearAccount));
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
      return { data: await Promise.all(rows.map((row) => view(row, { projects }))) };
    },

    get: async (scope: OrganizationScope, input: { id: string }) =>
      detail(await ownRow(scope, input.id)),

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
          null,
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
          status: "draft",
          createdBy: scope.actorId,
        })
        .returning();
      return view(await draftDocument(row!));
    },

    update: async (scope: OrganizationScope, input: Partial<WorkOrderFields> & { id: string }) => {
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
        repos: JSON.stringify(next.repos),
        projectTitle: project.title,
        projectSlug: project.slug,
      };
      const changed = termsHash({ ...row, ...patch }) !== termsHash(row);
      const payeeChanged = next.builderNearAccount !== row.builderNearAccount;
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
              signers: null,
              signedAt: null,
              documentSha256: null,
              documentUrl: null,
              documentId: null,
              documentFields: null,
            }
          : {}),
        ...(payeeChanged ? { payeeConfirmedAt: null, payeeConfirmedBy: null } : {}),
      });
      return view(changed ? await draftDocument(updated) : updated);
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
      return view(
        await update(row.id, {
          githubLogin: login,
          ...(keepsAcceptance ? { acceptedTermsHash: termsHash(next) } : {}),
        }),
      );
    },

    prepareDocument: async (scope: OrganizationScope, input: { id: string }) => {
      const row = await ownRow(scope, input.id);
      if (row.status !== "draft" && row.status !== "offered") {
        throw badRequest(
          "NOT_DRAFT",
          `Work order ${row.code} is ${row.status}: its document is already signed`,
        );
      }
      return view(await draftDocument(row, true));
    },

    checkDrive: async (scope: OrganizationScope) => checkSignedDocuments(scope.organizationId),

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
      return view(row);
    },

    offer: async (scope: OrganizationScope, input: { id: string }) => {
      const row = await ownRow(scope, input.id);
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
      const prepared = await prepareOfferDocument(row);
      const offered = await update(prepared.id, { status: "offered", offeredAt: now() });
      await notifyBuilder(offered, "work_order_offered", await payloadOf(offered));
      await announce(offered, "work_order.offered");
      return view(offered);
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
      return view(await finalizeSigned(row, offered));
    },

    attachDocument: async (
      scope: OrganizationScope,
      input: { id: string; sha256: string; url?: string | null },
    ) => {
      const row = await ownRow(scope, input.id);
      if (FINAL.includes(row.status))
        throw badRequest("CLOSED", `Work order ${row.code} is terminated`);
      return view(
        await update(row.id, {
          documentSha256: input.sha256.toLowerCase(),
          documentUrl: input.url ?? null,
        }),
      );
    },

    activate: async (scope: OrganizationScope, input: { id: string }) => {
      const row = await ownRow(scope, input.id);
      const builder = await deps.builders.get(row.builderNearAccount).catch(() => null);
      if (row.status !== "accepted") {
        throw badRequest(
          "NOT_ACCEPTED",
          `Work order ${row.code} is ${row.status}: the builder must accept it first`,
        );
      }
      const payee = await payeeOf(row);
      const signing = await signingOf(row);
      const blockers = activationBlockers(
        row,
        builder,
        payee.needsConfirmation,
        signing.needsCountersign,
      );
      if (blockers.length)
        throw badRequest(
          "ACTIVATION_BLOCKED",
          `Can't activate ${row.code} yet: ${blockers.join("; ")}`,
        );
      const activated = await update(row.id, {
        status: "active",
        activatedAt: now(),
        activatedBy: scope.actorId,
      });
      await notifyBuilder(activated, "work_order_activated", await payloadOf(activated));
      await announce(activated, "work_order.active");
      return view(activated);
    },

    terminate: async (scope: OrganizationScope, input: { id: string }) => {
      const row = await ownRow(scope, input.id);
      if (FINAL.includes(row.status))
        throw badRequest("CLOSED", `Work order ${row.code} is already terminated`);
      return view(await update(row.id, { status: "terminated" }));
    },

    remove: async (scope: OrganizationScope, input: { id: string }) => {
      const row = await ownRow(scope, input.id);
      if (row.status !== "draft" && row.status !== "offered") {
        throw badRequest(
          "NOT_DRAFT",
          "Only a draft or offered work order can be deleted; terminate it instead",
        );
      }
      await db.delete(workOrders).where(eq(workOrders.id, row.id));
      return { deleted: true as const };
    },

    collect: async (scope: OrganizationScope, input: { id: string }) =>
      detail(await collect(await ownRow(scope, input.id))),

    draftRequest: async (
      scope: OrganizationScope,
      input: { id: string; coversFrom?: string; coversTo?: string },
    ) => {
      const row = await ownRow(scope, input.id);
      return requestView(await draftRequest(row, input), row);
    },

    approveRequest: async (
      scope: OrganizationScope,
      input: { requestId: string; amount: string; confirmEvidenceIds?: string[] },
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
      const approved = await db.transaction(async (tx) => {
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
        const { remaining } = amountsOf(row, others);
        if (BigInt(input.amount) > remaining) {
          throw badRequest(
            "OVER_BUDGET",
            `Only ${display(remaining, row.tokenId)} of the budget remains`,
          );
        }
        if (input.confirmEvidenceIds?.length) {
          await tx
            .update(workOrderEvidence)
            .set({ authorized: true, confirmed: true })
            .where(
              and(
                eq(workOrderEvidence.workOrderId, row.id),
                inArray(workOrderEvidence.id, input.confirmEvidenceIds),
              ),
            );
        }
        const [done] = await tx
          .update(compensationRequests)
          .set({
            status: "approved",
            approvedAmount: input.amount,
            approvedBy: scope.actorId,
            decidedAt: now(),
            note: null,
            updatedAt: now(),
          })
          .where(eq(compensationRequests.id, request.id))
          .returning();
        return done!;
      });
      await notifyBuilder(
        row,
        "compensation_request_approved",
        await payloadOf(row, {
          requestCode: `${row.code}-R${request.seq}`,
          approved: display(input.amount, row.tokenId),
        }),
      );
      await announce(row, "request.approved", { request: approved });
      const paid = await autoPay(approved, row).catch((error: unknown) => ({
        request: approved,
        reason: error instanceof Error ? error.message : String(error),
      }));
      return requestView(paid.request, row);
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
      const result = await autoPay(request, row);
      if (result.reason && result.request.status === "approved") {
        throw badRequest("PAYOUTS_NOT_READY", result.reason);
      }
      return requestView(result.request, row);
    },

    rejectRequest: async (scope: OrganizationScope, input: { requestId: string; note: string }) => {
      const request = await mustRequest(input.requestId);
      const row = await ownRow(scope, request.workOrderId);
      if (request.status !== "submitted" && request.status !== "approved") {
        throw badRequest("NOT_SUBMITTED", "Only a submitted or approved request can be rejected");
      }
      const rejected = await updateRequest(request.id, {
        status: "rejected",
        note: input.note.trim(),
        decidedAt: now(),
        approvedAmount: null,
      });
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
      const request = await mustRequest(input.requestId);
      const row = await ownRow(scope, request.workOrderId);
      if (request.status !== "approved" || !request.approvedAmount) {
        throw badRequest("NOT_APPROVED", "Approve the request before linking its payment proposal");
      }
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
      const proposal = await deps.proposal(scope.agencyDao, id);
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
      const expected = row.tokenId === USD ? request.payoutAmount : request.approvedAmount;
      if (!expected) {
        throw badRequest(
          "NO_QUOTE",
          "Get a quote first: open the payment and use the amount it shows",
        );
      }
      if (kind.amount !== expected) {
        throw badRequest(
          "WRONG_AMOUNT",
          row.tokenId === USD
            ? `Proposal ${id} pays ${display(kind.amount, tokenId)}, not the quoted ${display(expected, tokenId)} (${display(request.approvedAmount, row.tokenId)} at ${request.priceUsd} USD). Refresh the quote or fix the proposal.`
            : `Proposal ${id} pays ${display(kind.amount, tokenId)}, not the approved ${display(request.approvedAmount, row.tokenId)}`,
        );
      }
      const linked = await db.transaction(async (tx) => {
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
            updatedAt: now(),
          })
          .where(
            and(
              eq(compensationRequests.id, request.id),
              eq(compensationRequests.status, "approved"),
            ),
          )
          .returning();
        if (!updated) throw badRequest("NOT_APPROVED", "The request changed meanwhile");
        return updated;
      });
      return requestView(await syncPayment(linked), row);
    },

    paymentProposal: async (
      scope: TreasuryScope & OrganizationScope,
      input: { requestId: string },
    ) => {
      const request = await mustRequest(input.requestId);
      const row = await ownRow(scope, request.workOrderId);
      if (request.status !== "approved" || !request.approvedAmount) {
        throw badRequest(
          "NOT_APPROVED",
          "Approve the request before creating its payment proposal",
        );
      }
      const project = await projectOf(row);
      const payout = await quotePayout(row, request);
      const description = [
        `${row.code}-R${request.seq}: ${row.title}`,
        `Project: ${project?.title ?? row.projectId}`,
        `Covers ${request.coversFrom} to ${request.coversTo}`,
        payout.priceUsd
          ? `${display(request.approvedAmount, row.tokenId)} at ${payout.priceUsd} USD per ${symbolOf(payout.tokenId)}`
          : null,
        request.reportSha256 ? `Report SHA-256: ${request.reportSha256}` : null,
      ]
        .filter(Boolean)
        .join("\n");
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
      return view(await mustRow(row.id));
    },

    report: async (scope: OrganizationScope, input: { requestId: string }) => {
      const request = await mustRequest(input.requestId);
      const row = await ownRow(scope, request.workOrderId);
      return requestView(request, row);
    },

    preparedDocument: async (
      organizationId: string,
      input: { code: string; preparedDocumentUrl: string },
    ) => {
      const row = await rowByCode(organizationId, input.code);
      if (FINAL.includes(row.status))
        throw badRequest("CLOSED", `Work order ${row.code} is terminated`);
      const url = input.preparedDocumentUrl.trim();
      if (!/^https:\/\/\S+$/.test(url))
        throw badRequest("INVALID_URL", "The document link must be https");
      const updated = await update(row.id, { preparedDocumentUrl: url });
      if (row.preparedDocumentUrl !== url) {
        await announce(updated, "work_order.document_ready", { document: url });
      }
      return { id: updated.code, status: updated.status, preparedDocumentUrl: url };
    },

    attachSignedDocument: async (
      organizationId: string,
      input: SignedDocument & { code: string },
    ) => {
      const row = await rowByCode(organizationId, input.code);
      const sha = input.documentSha256.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(sha)) {
        throw badRequest("INVALID_SHA256", "documentSha256 must be the SHA-256 of the PDF in hex");
      }
      if (row.signatureMethod === "google_esign" && row.documentSha256 === sha) {
        return { id: row.code, status: row.status, mismatches: [] as string[] };
      }
      if (row.status !== "draft" && row.status !== "offered") {
        throw badRequest(
          "NOT_DRAFT",
          `Work order ${row.code} is ${row.status}: a signed document can only be attached before it's accepted`,
        );
      }
      const project = await projectOf(row);
      const mismatches = compareTerms(
        {
          ...row,
          projectTitle: project?.title ?? row.projectId,
          budgetDecimal: decimalOf(row.budgetAmount, row.tokenId),
        },
        input.extracted,
      );
      if (mismatches.length > 0) {
        await announce(row, "work_order.signature_mismatch", {
          mismatches,
          document: input.documentUrl ?? null,
        });
        throw new ORPCError("CONFLICT", {
          message: "The signed PDF's terms don't match the draft",
          data: { reason: "TERMS_MISMATCH", mismatches },
        });
      }
      const signed = await markSigned(row, {
        sha,
        documentUrl: input.documentUrl?.trim() || null,
        signedAt: isoOrNull(input.signedAt) ?? now(),
        signers: (input.signers ?? []).map((signer) => ({
          name: signer.name.trim(),
          role: signer.role,
          signedAt: isoOrNull(signer.signedAt)?.toISOString() ?? null,
        })),
      });
      return { id: signed.code, status: signed.status, mismatches: [] as string[] };
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
      return {
        data: await Promise.all(
          visible.map(async (row) => ({
            ...(await view(row)),
            agencyName: await deps
              .organizationName(row.organizationId)
              .catch(() => row.organizationId),
          })),
        ),
      };
    },

    mineGet: async (context: PluginContext, input: { id: string }) => {
      const row = await mustRow(input.id);
      requireBuilder(context, row);
      return {
        ...(await detail(row)),
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
      await db.insert(workOrderSignatures).values({
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
      const accepted = await update(row.id, {
        status: "accepted",
        acceptedAt: now(),
        acceptedByUserId: context.userId ?? null,
        acceptedTermsHash: termsHash(row),
        signatureMethod: "in_app",
        payeeConfirmedAt: row.payeeConfirmedAt ?? now(),
        payeeConfirmedBy: row.payeeConfirmedBy ?? context.userId ?? row.builderNearAccount,
      });
      await notifyManagers(accepted, "work_order_accepted", await payloadOf(accepted));
      await announce(accepted, "work_order.builder_signed", { note: name });
      return view(accepted);
    },

    confirmPayee: async (context: PluginContext, input: { id: string }) => {
      const row = await mustRow(input.id);
      requireBuilder(context, row);
      if (FINAL.includes(row.status))
        throw badRequest("CLOSED", `Work order ${row.code} is terminated`);
      if (row.payeeConfirmedAt) return view(row);
      const confirmed = await update(row.id, {
        payeeConfirmedAt: now(),
        payeeConfirmedBy: context.userId ?? row.builderNearAccount,
      });
      await notifyManagers(confirmed, "work_order_payee_confirmed", await payloadOf(confirmed));
      await announce(confirmed, "work_order.payee_confirmed");
      return view(confirmed);
    },

    decline: async (context: PluginContext, input: { id: string; note?: string | null }) => {
      const row = await mustRow(input.id);
      requireBuilder(context, row);
      if (row.status !== "offered")
        throw badRequest("NOT_OFFERED", `Work order ${row.code} isn't waiting for you`);
      const declined = await update(row.id, { status: "draft", offeredAt: null });
      await notifyManagers(
        declined,
        "work_order_declined",
        await payloadOf(declined, { note: input.note?.trim() ?? "" }),
      );
      await announce(declined, "work_order.declined", { note: input.note?.trim() || null });
      return view(declined);
    },

    mineDraftRequest: async (
      context: PluginContext,
      input: { id: string; coversFrom?: string; coversTo?: string },
    ) => {
      const row = await mustRow(input.id);
      requireBuilder(context, row);
      return requestView(await draftRequest(row, input), row);
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
      return requestView(edited, row);
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
        projectTitle: project?.title ?? row.projectId,
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
      const submitted = await updateRequest(request.id, {
        status: "submitted",
        contributionsMd,
        evidenceIds: JSON.stringify(evidence.map((e) => e.id)),
        reportMd: frozen,
        reportSha256: sha256Hex(frozen),
        submittedAt: now(),
      });
      await notifyManagers(
        row,
        "compensation_request_submitted",
        await payloadOf(row, {
          requestCode: `${row.code}-R${request.seq}`,
          requested: display(request.requestedAmount, row.tokenId),
        }),
      );
      await announce(row, "request.awaiting_approval", { request: submitted, reportMd: frozen });
      return requestView(submitted, row);
    },

    run: async (holder: string = crypto.randomUUID()) => {
      if (!(await claimLock(holder))) return { ran: false, counts: {} as Record<string, number> };
      const counts: Record<string, number> = {};
      try {
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
        if (deps.payouts) {
          const paying = await db
            .select()
            .from(compensationRequests)
            .where(eq(compensationRequests.status, "paying"));
          for (const request of paying) {
            try {
              const payout = await deps.payouts.latest(request.id);
              if (!payout) continue;
              const fresh = await deps.payouts.refresh(payout);
              const settled = await settleAgentPayout(
                request,
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
        await deps.outbox
          ?.deliver?.()
          .catch((error: unknown) => console.warn("[API] work order deliveries failed", error));
      } finally {
        await releaseLock(holder);
      }
      return { ran: true, counts };
    },
  };
}

export type WorkOrdersService = ReturnType<typeof createWorkOrdersService>;
