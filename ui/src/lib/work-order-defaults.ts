const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function lastDayOfMonth(year: number, month: number): string {
  return formatDay(new Date(Date.UTC(year, month + 1, 0)));
}

function localDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  if (!timeZone) return localDay(now);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return localDay(now);
  }
}

export function defaultPeriod(today: string): { start: string; end: string } {
  const date = parseDay(today);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const end = lastDayOfMonth(year, month);
  const daysLeft = Math.round((parseDay(end).getTime() - date.getTime()) / 86_400_000);
  if (daysLeft < 3) {
    return {
      start: formatDay(new Date(Date.UTC(year, month + 1, 1))),
      end: lastDayOfMonth(year, month + 1),
    };
  }
  return { start: today, end };
}

function monthLabels(day: string): string[] {
  const date = parseDay(day);
  const name = MONTHS[date.getUTCMonth()] ?? "";
  const year = date.getUTCFullYear();
  return [`${name} ${year}`, `${name.slice(0, 3)} ${year}`, `${day.slice(0, 7)}`];
}

export function duplicateTitle(title: string, fromStart: string, toStart: string): string {
  const trimmed = title.trim().replace(/\s*\(copy\)$/i, "");
  const from = monthLabels(fromStart);
  const to = monthLabels(toStart);
  for (const [index, label] of from.entries()) {
    if (trimmed.toLowerCase().endsWith(label.toLowerCase())) {
      return `${trimmed.slice(0, trimmed.length - label.length)}${to[index]}`;
    }
  }
  return trimmed;
}

export type BudgetChoice = { tokenId: string; budgetAmount: string };

export function recentBudgets(
  workOrders: readonly (BudgetChoice & { createdAt: string })[],
  limit = 3,
): BudgetChoice[] {
  const seen = new Set<string>();
  const choices: BudgetChoice[] = [];
  const newest = [...workOrders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const { tokenId, budgetAmount } of newest) {
    const key = `${tokenId}:${budgetAmount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({ tokenId, budgetAmount });
    if (choices.length === limit) break;
  }
  return choices;
}

export const GITHUB_REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function repoFromProject(repository: string | null | undefined): string {
  if (!repository) return "";
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/#?\s]+)\/([^/#?\s]+)/i.exec(
    repository.trim(),
  );
  if (!match) return "";
  const repo = `${match[1]}/${match[2]?.replace(/\.git$/i, "")}`;
  return GITHUB_REPO.test(repo) ? repo : "";
}

export type SendCheck = {
  githubLogin: string;
  contractorEmail: string;
  representativeEmail: string;
  needsEmails: boolean;
  accountEmail: boolean;
};

export type SendBlocker = { reason: string; inDetails: boolean };

export function sendBlocker(check: SendCheck): SendBlocker | null {
  if (!check.githubLogin.trim()) {
    return { reason: "Add the builder's GitHub login to send it.", inDetails: false };
  }
  if (!check.needsEmails) return null;
  if (!check.contractorEmail.trim() && !check.accountEmail) {
    return {
      reason: "Add the builder's email: the signing request goes to them.",
      inDetails: false,
    };
  }
  if (!check.representativeEmail.trim()) {
    return { reason: "Add the representative's email under Details.", inDetails: true };
  }
  return null;
}
