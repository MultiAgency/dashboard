---
name: work-order
description: Plain-English summary of the per-project work order — what each engagement specifies and how the work order pairs with the master services agreement. The signable template lives outside the dashboard. Read before sending a work order, before negotiating scope or amount, or before recording a billing.
---

# Work order

> **Not legal or tax advice.** These pages describe how MultiAgency LLC is structured and operates — one working example, not a prescription. Entity types, tax treatment, and worker-classification rules vary by jurisdiction and change over time. Before forking this model, get qualified legal and tax counsel in the jurisdiction where your agency and contributors operate. This is an early draft, published to gather feedback — expect it to change.

A work order is the **per-project, per-engagement scope** for a contributor. It pairs with the [services agreement](/docs/services-agreement): the master sets the rules; the work order names what is actually being built, for how much, by when, with what IP terms.

The executable template is **stored outside the dashboard** (Drive, Notion, GitHub raw — wherever the LLC keeps its operational documents) and sent by email. This page describes what the template contains. It is a description, not the work order — where the two differ, the signed document controls.

One work order per engagement. Reusing a work order across projects is a mistake — each engagement gets its own.

## Fields

### 1. Reference to the master agreement

Names the master services agreement between the parties (date signed) and states that this work order incorporates and is subject to it. Anything not specified here defaults to the master.

### 2. Project identifier

The **project slug** as it appears in the dashboard (e.g. `agency-dashboard-template`). Lets the work order, the dashboard project, and any later billings line up cleanly.

### 3. Deliverables

A **clear, finite list** of what the contributor will deliver. Not "ongoing maintenance," not "general help." Specific artifacts: a PR merged, a doc published, a feature shipped, a report submitted. Acceptance criteria where it matters.

### 4. Amount and structure

**Fixed amount** (paid on delivery) or **milestone amounts** (paid per milestone). State the **NEAR token** (`NEAR`, `USDC`, `wNEAR`, etc.) and the amount in token units.

For multi-milestone work orders, list each milestone with its own deliverable, amount, and target date.

### 5. Timeline

Target date(s) for each deliverable / milestone. May include intermediate checkpoints.

### 6. IP terms (per-project)

Names which IP regime from the master agreement applies to this engagement:

- **Work-for-hire / assignment** — IP transfers to the LLC on payment.
- **License-back** — contributor retains IP, grants the LLC a license (state license terms).
- **Open-source under [license]** — work is contributed under a named OSS license (e.g. MIT, Apache-2.0, AGPL-3.0).

Every work order must name one — there is no implied default.

### 7. Acceptance

How the LLC accepts a deliverable: PR merged, written sign-off by email, demo, report received. Default to a low-friction objective trigger ("PR merged into main").

### 8. Payment trigger

States that the LLC records a billing in the dashboard, authors a Sputnik DAO Transfer proposal in [Trezu](/docs/trezu) (or via [NEARN](/docs/nearn) if listed there), and that the proposal — once approved on-chain — pays the contributor's stated NEAR account.

Names the **NEAR account** the contributor is to be paid at. This must match the account on file in the dashboard contributor record.

### 9. Termination of this work order

States that termination of this work order does not terminate the master, and vice versa. Pro-rata payment for accepted milestones; written notice required.

### 10. Signatures

Counter-signed by the LLC and the contributor. Email signature (PDF or DocuSign) for most engagements; wet signature for high-stakes ones if either party prefers.

## What the work order does NOT do

- It doesn't replace the master agreement — it incorporates it.
- It doesn't authorize payment by itself. The dashboard records the billing; the Sputnik DAO proposal authorizes the transfer; the on-chain vote executes it.
- It doesn't cover work outside its named deliverables. New scope = new work order.

## Related

- [Services agreement](/docs/services-agreement) — master agreement that each work order references
- [Contributors](/docs/contributors) — onboarding flow that delivers the master + sets up the work-order cadence
- [Trezu](/docs/trezu) — treasury layer that executes the on-chain transfer
- [NEARN](/docs/nearn) — sourcing layer that can author the proposal directly
