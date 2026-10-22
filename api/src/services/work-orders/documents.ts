import { extractText, getDocumentProxy } from "unpdf";

export const CHECKED_FIELDS: Record<string, string> = {
  work_order_id: "work order id",
  project: "project",
  contractor_name: "contractor",
  representative_name: "representative",
  period_start: "period start",
  period_end: "period end",
  budget_usd: "budget",
  payee_account: "payout account",
  contractor_github: "GitHub login",
  repos: "repositories",
};

const IP_KNOWN = ["assignment", "license", "open_source"];

export function longDate(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function documentFields(input: {
  code: string;
  project: string;
  contractorName: string;
  contractorEmail: string | null;
  representativeName: string;
  representativeEmail: string | null;
  periodStart: string;
  periodEnd: string;
  budgetDecimal: string;
  budget: string;
  ipModel: string | null;
  payee: string;
  github: string;
  repos: string[];
  autoRenew: boolean;
  scope: string | null;
}): Record<string, string> {
  const box = (on: boolean) => (on ? "☑" : "☐");
  const ip = (input.ipModel ?? "").toLowerCase();
  const other = ip !== "" && !IP_KNOWN.includes(ip);
  return {
    work_order_id: input.code,
    effective_date: longDate(input.periodStart),
    contractor_name: input.contractorName,
    project: input.project,
    services_agreement_date: "",
    representative_name: input.representativeName,
    budget_usd: input.budgetDecimal,
    budget: input.budget,
    period_start: longDate(input.periodStart),
    period_end: longDate(input.periodEnd),
    ip_assignment: box(ip === "assignment"),
    ip_license: box(ip === "license"),
    ip_open_source: box(ip === "open_source"),
    ip_other: box(other),
    ip_other_text: other ? (input.ipModel ?? "") : "",
    payee_account: input.payee,
    payout_method: "Transfer from the Agency DAO to the NEAR account",
    contractor_github: input.github,
    repos: input.repos.join(", "),
    auto_renew: box(input.autoRenew),
    auto_renew_text: input.autoRenew
      ? "This work order renews monthly, with the same terms, while the base metrics are met; otherwise the representative decides whether it renews."
      : "",
    contractor_email: input.contractorEmail ?? "",
    representative_email: input.representativeEmail ?? "",
    scope: input.scope ?? "",
  };
}

export function requiredFields(
  values: Record<string, string>,
  occurrences: Record<string, number>,
): Record<string, string> {
  return Object.fromEntries(
    Object.keys(CHECKED_FIELDS)
      .filter((key) => (occurrences[key] ?? 0) > 0 && (values[key] ?? "").trim() !== "")
      .map((key) => [key, values[key] ?? ""]),
  );
}

export async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/­/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function contains(normalized: string, value: string): boolean {
  const needle = normalizeText(value);
  if (!needle) return true;
  return new RegExp(`(?<![\\w.@-])${escapeRegExp(needle)}(?![\\w@-])`).test(normalized);
}

export function codeIn(text: string, code: string): boolean {
  return contains(normalizeText(text), code);
}

export function missingFields(text: string, required: Record<string, string>): string[] {
  const normalized = normalizeText(text);
  const out: string[] = [];
  for (const [key, value] of Object.entries(required)) {
    const parts = key === "repos" ? value.split(",").map((v) => v.trim()) : [value];
    const absent = parts.filter((part) => !contains(normalized, part));
    if (absent.length > 0) {
      out.push(`${CHECKED_FIELDS[key] ?? key}: "${absent.join(", ")}" isn't in the signed PDF`);
    }
  }
  return out;
}
