---
name: services-agreement
description: Plain-English summary of the master services agreement between MultiAgency LLC and an independent contributor — what each clause does. The signable template lives outside the dashboard. Read before sending an agreement, before negotiating terms, or before answering a contributor's "what am I actually signing?".
---

# Services agreement

> **Not legal or tax advice.** These pages describe how MultiAgency LLC is structured and operates — one working example, not a prescription. Entity types, tax treatment, and worker-classification rules vary by jurisdiction and change over time. Before forking this model, get qualified legal and tax counsel in the jurisdiction where your agency and contributors operate. This is an early draft, published to gather feedback — expect it to change.

The master services agreement is a **single standing contract** between MultiAgency LLC and a contributor. One per contributor, signed once, reused across every project they take on. Specific scope, deliverables, and amounts live in the per-project [work order](/docs/work-order); the master sets the rules of the relationship.

The executable template (the document with blanks to fill in) is **stored outside the dashboard** — kept in the LLC's document system and sent by email. This page describes what the template contains. It is a description, not the agreement — where the two differ, the signed document controls.

## Clause-by-clause

### 1. Parties

Identifies **MultiAgency LLC** (the contracting party, with its registered address) and the **contributor** (legal name, address, country of tax residence). Contributor signs as themselves, not as an entity, unless they have one.

### 2. Scope by work order

States that the master agreement does **not** itself commit either party to any work. Work is defined in **separately signed work orders**, each one referenced to this master.

### 3. Independent contractor relationship

States explicitly that the contributor is an **independent contractor**, not an employee, partner, joint venturer, or agent. Contributor controls the manner and means of work. No benefits, no withholding, no PTO. Classification ultimately turns on facts and local law, not the label.

### 4. Payment in NEAR

Payment is made in **NEAR-network tokens** to the contributor's stated NEAR account, via a Sputnik DAO Transfer proposal. Amount and token are specified per work order. The contributor accepts the FX/volatility risk between proposal time and receipt.

### 5. Tax forms and reporting

Contributor agrees to provide a **W-9** (US person) or **W-8BEN** (non-US individual) before any payout, and to keep it current. The LLC issues a 1099-NEC as required. Contributor is responsible for their own taxes; nothing is withheld.

### 6. Intellectual property

**Set per project**, named in each work order:

- **Work-for-hire / assignment** — IP transfers to the LLC on payment. Typical for proprietary or commissioned work.
- **License-back** — contributor retains IP, grants the LLC a license. Typical for open-source contributions where the contributor is the upstream author.
- **Open-source under [license]** — both parties acknowledge the work is contributed under a named OSS license; no exclusive transfer.

### 7. Confidentiality

Standard mutual confidentiality on non-public information shared during the engagement. Carve-outs for what's already public, what's independently developed, and what's required to be disclosed by law.

### 8. Termination

Either party may terminate **with notice** (e.g. 14 days). On termination, the LLC pays for accepted deliverables to date; the contributor delivers any work-in-progress as agreed. Survival clauses (IP already transferred, confidentiality, etc.) carry forward.

### 9. Limitation of liability

Caps each party's liability and carves out the usual exclusions (gross negligence, willful misconduct, IP infringement, confidentiality breach).

### 10. Governing law and venue

Names a single state's law and a single venue. Includes a brief arbitration clause for low-value disputes.

### 11. Entire agreement, amendments, assignment

Standard boilerplate: this agreement plus signed work orders are the whole deal; amendments must be in writing; the contributor can't assign their obligations without consent.

## What the agreement does NOT do

- It doesn't promise any work — that's the work order.
- It doesn't transfer IP for past work — only IP created under signed work orders that say so.
- It doesn't survive a fork: if MultiAgency LLC is replaced by a successor entity, contributors should sign with the new entity, not assume the master rolls over.

## Related

- [Entity](/docs/entity) — what MultiAgency LLC is
- [Contributors](/docs/contributors) — onboarding flow that delivers + collects this agreement
- [Work order](/docs/work-order) — per-project scope, paired with this master
