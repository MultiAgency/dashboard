import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const source = readFileSync(
  resolve(
    import.meta.dirname,
    "..",
    "src",
    "routes",
    "_layout",
    "_authenticated",
    "admin",
    "projects",
    "$slug.tsx",
  ),
  "utf8",
);

describe("NearnSubmissionsSection — wiring guarantees", () => {
  test("queries submissions via the adminNearnSubmissionsQueryOptions factory with the listing slug", () => {
    expect(source).toMatch(/useQuery\(adminNearnSubmissionsQueryOptions\(apiClient,\s*slug\)\)/);
  });

  test("error state renders a destructive-border message (no silent return null)", () => {
    expect(source).toMatch(/border-destructive\/60[\s\S]*NEARN submissions not reachable/);
  });

  test("link href goes through safeHttpHref (no raw user-supplied URL)", () => {
    expect(source).toMatch(/safeHttpHref\(s\.link\)/);
    expect(source).toMatch(/import\s*\{\s*safeHttpHref\s*\}\s*from\s*"@\/lib\/url"/);
  });

  test("contributor match uses adminContributorsListQueryOptions + nearAccountId join key", () => {
    expect(source).toMatch(/adminContributorsListQueryOptions\(apiClient\)/);
    expect(source).toMatch(/nearAccountId/);
    expect(source).toMatch(/contributorByNearAccount\.has\(s\.user\.publicKey\)/);
  });

  test("winner count surfaces in the header (sponsorship signal)", () => {
    expect(source).toMatch(/winnerCount\s*=\s*submissions\.filter\(/);
    expect(source).toMatch(/winner\$\{winnerCount === 1 \? "" : "s"\}/);
  });

  test("hides the 'New' label badge to reduce noise", () => {
    expect(source).toMatch(/s\.label\s*!==\s*"New"/);
  });
});

describe("NearnSubmissionsSection — add-contributor CTA", () => {
  test("mutation calls contributors.create", () => {
    expect(source).toMatch(/const\s+addContributorMutation\s*=\s*useMutation/);
    expect(source).toMatch(/apiClient\.contributors\.create\(input\)/);
  });

  test("mutation input pulls name from submission fields with publicKey fallback", () => {
    expect(source).toMatch(
      /name:\s*s\.user\.name\s*\?\?\s*s\.user\.username\s*\?\?\s*s\.user\.publicKey!/,
    );
    expect(source).toMatch(/nearAccountId:\s*s\.user\.publicKey!/);
  });

  test("success path invalidates the contributors list query so the match badge appears", () => {
    expect(source).toMatch(
      /queryClient\.invalidateQueries\(\{\s*queryKey:\s*adminContributorsListQueryKey/,
    );
    expect(source).toMatch(
      /import\s*\{[^}]*adminContributorsListQueryKey[^}]*\}\s*from\s*"@\/lib\/queries"/,
    );
  });

  test("CTA renders only when publicKey is unmatched (mirror of the match badge)", () => {
    expect(source).toMatch(
      /contributorByNearAccount\.has\(s\.user\.publicKey\)\s*\?[\s\S]*?\+ add contributor/,
    );
  });

  test("badge + CTA are both gated on contributorsQuery.isSuccess (no duplicate-create window)", () => {
    expect(source).toMatch(
      /contributorsQuery\.isSuccess\s*&&[\s\S]*?contributorByNearAccount\.has/,
    );
  });

  test("button shows 'adding…' while the mutation for that specific publicKey is in flight", () => {
    expect(source).toMatch(
      /addContributorMutation\.isPending\s*&&[\s\S]*?addContributorMutation\.variables\?\.nearAccountId\s*===\s*s\.user\.publicKey/,
    );
    expect(source).toMatch(/"adding…"/);
  });

  test("error path surfaces a toast (not a silent failure)", () => {
    expect(source).toMatch(/onError:[\s\S]*?toast\.error/);
  });
});
