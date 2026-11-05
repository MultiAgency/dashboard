# Work order trust tiers and the AI consistency check

Builders who have been paid cleanly before should need fewer manual steps. Two modules decide how much
manual review a submitted compensation request needs:

- `api/src/services/work-orders/trust.ts`: deterministic trust scoring (`assessTrust`, `trustHistoryOf`)
- `api/src/services/work-orders/consistency.ts`: an AI check that compares the report with the evidence (`createConsistencyChecker`)

Neither module writes to the database or approves anything. The approval flow calls them and acts on the result.

## Tiers

A **clean period** is a compensation request that:

- is `paid`
- has at least one authorized work item (issue, PR or manual item; reviews don't count)
- has no merged PRs flagged "not approved by the repository owner"
- doesn't overlap the covered dates of a `rejected` or `failed` request on the same work order

| Tier | Rule (defaults) | Decision when there are no blockers |
| --- | --- | --- |
| `new` | fewer than 2 clean periods, or any rejected/failed request in the last 90 days | `manual` |
| `established` | at least 2 clean periods | `veto_window` (24h) |
| `trusted` | at least 4 clean periods, 60+ days since the first work order started, no flagged evidence in the last 3 paid periods | `auto_pay` |

History is scoped to one agency (organization) and one builder NEAR account.

`score` (0 to 100) is for display only. The tier comes from the rules above, not from the score.

## Hard blockers

If any blocker applies, the decision is `manual` whatever the tier:

- no authorized evidence for the period
- the requested amount is above the prorated cap for the covered dates, or above the remaining budget
- the covered dates overlap another committed request (`approved`, `paying`, `proposed`, `paid`)
- merged PRs not approved by the repository owner, or PRs that close only self-assigned issues
- the payee account has never been paid by this agency, or isn't confirmed
- the AI check returned anything other than `consistent` with confidence of at least 0.6
- the AI check is unavailable and the tier requires it (required for `established` by default)

## The AI's role: it can only slow things down

The consistency checker never approves, prices or recommends payment. It only says whether the report's claims
are backed by the evidence. In `assessTrust`, the AI result is used in only two ways:

- it adds blockers (a non-`consistent` verdict, low confidence, or unavailability when required)
- when it's unavailable for a `trusted` builder, `auto_pay` becomes `veto_window`

No AI result can raise a tier or remove a blocker. A `new` builder stays `manual` even with a perfect verdict.

Prompt-injection hardening: the report and evidence go into `<untrusted_data id="<random>">` blocks.
The random id is removed from the data so the data can't close its own block. The system prompt says to ignore
instructions inside the data. Emails and token-shaped strings are redacted. The output must be one JSON object,
validated with zod. Lists are capped and confidence is clamped to 0..1. Any failure (no key, HTTP error,
truncated output, malformed JSON, timeout) returns `null`, which counts as "unavailable".

## Config

```ts
type TrustConfig = {
  mode: "off" | "suggest" | "auto";
  establishedMinCleanPeriods: number;
  trustedMinCleanPeriods: number;
  trustedMinTenureDays: number;
  trustedFlagFreePeriods: number;
  troubleWindowDays: number;
  vetoHours: number;
  requireAi: { established: boolean; trusted: boolean };
  minAiConfidence: number;
};

const DEFAULT_TRUST = {
  mode: "suggest",
  establishedMinCleanPeriods: 2,
  trustedMinCleanPeriods: 4,
  trustedMinTenureDays: 60,
  trustedFlagFreePeriods: 3,
  troubleWindowDays: 90,
  vetoHours: 24,
  requireAi: { established: true, trusted: false },
  minAiConfidence: 0.6,
};
```

`assessTrust` takes a partial config (`TrustConfigInput`) and merges it over the defaults.

- `off`: the decision is always `manual`
- `suggest` (default): `suggested` holds what `auto` would do; `decision` stays `manual`
- `auto`: `decision` equals `suggested`

## Wiring it into the approval flow

On `submitRequest`, after the request is frozen as `submitted`:

1. `const history = await trustHistoryOf(db, organizationId, builderNearAccount, { excludeRequestId: request.id })`
2. Build `CurrentRequestFacts`:
   - `amount`: the requested amount
   - `proratedCap`: the cap for the covered dates
   - `remaining`: from `amountsOf`
   - `evidence`: `evidenceFacts(frozenEvidence)`
   - `overlaps`: the request view's `overlaps`, or `committedOverlaps(...)`
   - `payeeConfirmed`: `!!workOrder.payeeConfirmedAt`
   - `payeeNewToAgency`: optional; `!history.payeePaidBefore` is used either way
3. `const ai = await checker.check({ ...report, amountToCapRatio, budgetUsedRatio, evidence: consistencyEvidenceOf(frozenEvidence) })`. Skip the call (pass `null`) when the tier can't reach automation, for example `mode === "off"`.
4. `const result = assessTrust(history, facts, ai, agencyConfig)`. Store `tier`, `score`, `reasons`, `blockers`, `suggested` and the AI verdict on the request so admins can see them.
5. Act on `result.decision`:
   - `manual`: notify admins as today, showing the suggestion and blockers
   - `veto_window`: set the request to auto-approve at `now + vetoHours`, and notify admins with a Stop action. A job approves it when the time passes unless an admin stopped it. Re-run `assessTrust` just before approving, and fall back to manual if anything changed.
   - `auto_pay`: approve with the requested amount and start the payout agent's auto-pay immediately. Notify admins after the fact.

Keep the payout agent's own limits (monthly budget, max per payout) as a separate, independent check.
