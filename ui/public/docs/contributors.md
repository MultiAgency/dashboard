---
name: contributors
description: End-to-end contributor onboarding flow for MultiAgency — Apply → email exchange → admin marks complete → eligible for work orders and payouts. Read when adding a new contributor, when reviewing a billing, or when a contributor asks "what happens after I apply?".
---

# Contributors

> **Not legal or tax advice.** These pages describe how MultiAgency LLC is structured and operates — one working example, not a prescription. Entity types, tax treatment, and worker-classification rules vary by jurisdiction and change over time. Before forking this model, get qualified legal and tax counsel in the jurisdiction where your agency and contributors operate. This is an early draft, published to gather feedback — expect it to change.

## The flow at a glance

```
1. Apply        →  /apply form (name, email, NEAR account, message)
2. Email back   →  admin sends master services agreement + tax form
3. Counter-sign →  contributor returns signed agreement + W-9 or W-8BEN
4. Mark ready   →  admin sets onboarding status to "complete"
5. Work order   →  per project, before work starts
6. Pay          →  Sputnik DAO proposal → on-chain transfer
```

No paperwork is uploaded into the dashboard. The dashboard tracks **status**, not artifacts. Documents live in email and the admin's chosen filing system (Drive, Notion, etc.).

## Step 1 — Apply

Contributor fills `/apply`.

## Step 2 — Email exchange

The admin replies by email with two attachments:

- **Master services agreement** — the standing contract between MultiAgency LLC and the contributor. Covers IP defaults, payment in NEAR, termination, the independent-contractor relationship the LLC intends, governing law. Sent once per contributor; reused across all future work orders. See [services agreement](/docs/services-agreement).
- **Tax form** — W-9 (US person) or W-8BEN (non-US individual). Required before any payout. The LLC keeps the form on file; it is not stored in the dashboard.

## Step 3 — Counter-sign

Contributor returns the signed agreement and the completed tax form by email. The admin files both.

## Step 4 — Mark ready

In the admin contributor row, the admin marks onboarding `complete`. There are three states:

- **pending** — applied or invited but no signed agreement on file
- **complete** — signed agreement and tax form received; eligible for work orders and payouts
- **expired** — agreement on file is stale (e.g. tax form needs refresh) and must be re-sent

A contributor at `pending` or `expired` triggers a warning when an admin records a billing for them — see "safe-by-default" below.

## Step 5 — Work order

Before any work begins on a specific project, the admin sends a **per-project work order** by email. The work order names the project, the deliverables, the fixed or milestone-based amount, the NEAR token, the IP terms for that engagement, and the due date(s). The contributor counter-signs and returns. See [work order](/docs/work-order).

The work order references the master services agreement; everything not stated in the work order falls back to the master.

## Step 6 — Pay

When a deliverable is accepted, the admin records a billing in the dashboard. The dashboard does not send the payment — the actual transfer is a Sputnik DAO proposal authored in [Trezu](/docs/trezu) (or via [NEARN](/docs/nearn)'s "Pay with NEAR Treasury" helper).

## Safe-by-default

Two guardrails:

1. **Onboarding warning at billing time.** When an admin records a billing for a contributor whose status is not `complete`, the dashboard surfaces a warning at the create form: *"Contributor onboarding not complete. Confirm signed services agreement + tax form received before recording a payout."*
2. **Audit log on allocations.** Every treasury allocation change records the actor's NEAR account and a timestamp — a clear record of who authorized each payment and when.

## Related

- [Entity](/docs/entity) — what MultiAgency LLC is
- [Services agreement](/docs/services-agreement) — clauses in the master agreement
- [Work order](/docs/work-order) — per-project scope template
