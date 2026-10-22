# Spec — How the dashboard consumes Treasury, Payables and Invoices

**Status:** draft for review (issue #78). No code depends on this yet.
**Decision needed:** one option for this week, one for later.
**Related:** #79 (Intents balance on `/treasury`), `MultiAgency/treasury#1`, `#2`, `#3`,
`MultiAgency/agentic-treasury#1`–`#4`.

## Problem

Treasury, Payables and Invoices now live in separate repos. The dashboard has no defined way to use
them. Today `/treasury` reads only the public balances of the agency Sputnik DAO.

## What is true today

Dashboard (`main`):

- Module Federation app (`bos.config.json`: `ui`, `api`, `auth`, `plugins`), own auth
  (better-near-auth), own Postgres.
- `api/src/services/treasury.ts` reads public balances through Sputnik RPC
  (`getTreasuryBalances`, `getDaoTokenIds` in `api/src/services/sputnik.ts`). Nothing reads NEAR
  Intents, so agent-held funds are missing from `/treasury` and from the `budgets` rollups.
- Money-sensitive endpoints are manager-gated: `ROLE_MATRIX.manage = ["owner", "admin"]`
  (`api/src/services/organization-access.ts`).
- `billings` is unique on `(payingDaoAccountId, proposalId)`, not on `proposalId` alone as
  issue #78 states. `budgets` carries `fundingDaoAccountId`.

Treasury / platform (`MultiAgency/treasury`, `MultiAgency/agentic-treasury`):

- Treasury is a standalone SPA (`web/rsbuild.config.ts`, no federation). It is served by Proto's
  gateway under a product host and calls only `/gw/*` and `/a/<agent>/rpc/<procedure>`.
- Sessions are host-bound: wallet sign-in (`/gw/challenge` → NEP-413 `signMessage` →
  `/gw/session`), no cross-origin cookies, no CORS relaxation
  (`docs/shared-frontend-integration.md`).
- The gateway host list is a fixed enum (`demo`: showcase / payables / treasury / invoices,
  `src/gateway/config.ts`). A new area needs a reviewed Proto change (`docs/integration-path.md`).
- `@multiagency/sdk` is not installable; consumers vendor a tarball (agentic-treasury#2).
- There is no read-only summary endpoint; reads go through owner RPC procedures built for the
  Treasury UI (agentic-treasury#4).

## Options

| | A. Link out | B. Embed | C. API |
|---|---|---|---|
| What | Dashboard links to the product hosts | Treasury/Payables become Module Federation remotes loaded in the dashboard | Dashboard calls a read-only summary through `@multiagency/sdk`; keeps its own UI |
| Sign-in | Second sign-in (host-bound session) | Must work inside the host; the host has to hand over the account | Server-to-server credential; the user signs in once, in the dashboard |
| Shared data | None | Same page, separate data | Dashboard can show Treasury data next to its own |
| Treasury work | None | treasury#1, #2 (rebuild as remote, embedded mode) | agentic-treasury#2, #3, #4; treasury#3 for DAO delegation |
| Dashboard work | A link | Load remote, pin URL and integrity in `bos.config.json`, extend deploy | New service beside `treasury.ts`, UI section (#79) |
| Money actions | In Treasury, unchanged | In Treasury UI, owner signature stays | None. Read-only. |
| Main risk | Poor UX, two accounts | Auth inside the host; two build/deploy pipelines coupled | Depends on SDK publish and a gateway change landing first |

## Recommendation

**This week: C for reads, A as the fallback link.** **Later: B, only if a Treasury task has to
live inside the dashboard page.**

Why:

1. The one concrete dashboard need (#79) is read-only: show agent-held balances next to Sputnik
   balances. C meets it without rebuilding either frontend.
2. B couples two pipelines. Dashboard CI/deploy (`ci.yml` → `deploy.yml` → Zephyr/Railway) and
   Treasury (no CI, Railway via `Dockerfile.dashboard`) have nothing in common today.
3. B inherits the hardest problem, sign-in inside a host, before any of the SDK work exists.
4. A is available immediately and costs nothing, so it covers the gap while C lands.

Until agentic-treasury#2–#4 land, #79 is built against an `unavailable | balances` interface so
it can ship and be tested without the live source.

## Answers to the questions in #78

**Which option now, and which later?** C now (A as the link), B later if needed. See above.

**How does one login work?** Under C the user signs in to the dashboard only. The dashboard API
talks to Treasury with a credential it holds, scoped to the agency's treasury, never with the
user's session. This needs a way to authorize the dashboard or an agent for a DAO-owned treasury;
that is agentic-treasury#3 and treasury#3 (today DAO machine delegation is refused). *Open:* the
exact credential type must be confirmed against `docs/machine-api.md` in the Treasury repo
before implementation.

**System of record for payments?** The dashboard keeps `billings` and `budgets` as the record of
agency accounting. Treasury and Payables hold execution records. The dashboard must not copy
Treasury state into `billings`; it reads Treasury through the summary and shows the source.
Reconciling the two (matching a `billings` row to an executed operation) is out of scope here and
needs its own issue.

**Which roles may see Treasury data?** Reuse the existing split. Public Sputnik balances keep
their current visibility. Agent-held (Intents) balances and any held payments follow the
manager gate: `owner` and `admin` only, like `/admin/treasury/*`. `member` and below get no
Intents data until someone decides otherwise.

## Rules that apply whatever we choose

- Treasury money actions (strategy, plans, shielding, signing) stay in Treasury and need the
  owner's explicit signature. The dashboard never triggers them.
- Never fold Intents balances into the public Sputnik total. Show them separately, with their
  source and last-updated time (#79).
- If the Treasury data cannot be read, show "unavailable", never zero.
- Rollups and "available" figures must say which sources they include.

## Follow-ups to open once this is accepted

| Repo | Issue |
|---|---|
| dashboard | #79 build against the `unavailable | balances` interface, then wire the real call |
| dashboard | Service beside `treasury.ts` that calls Treasury through the SDK (blocked by agentic-treasury#2, #4) |
| dashboard | Reconcile `billings` with Treasury operations (needs design) |
| treasury | CI: run `pnpm verify` on pull requests |
| treasury | #1, #2 stay open but are deferred unless B is chosen |

## Open questions

1. Which credential does the dashboard API use for a DAO-owned treasury? (agentic-treasury#3,
   treasury#3.)
2. Does the summary endpoint (agentic-treasury#4) return confidential balances, or only
   what the credential's scope allows?
3. Payables and Invoices: this spec only fixes the approach for Treasury. They share the same
   gateway, so C should extend to them, but nothing here verifies their APIs.
4. Is a role below `admin` ever allowed to see Intents balances?
