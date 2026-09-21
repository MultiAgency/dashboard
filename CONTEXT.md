# MultiAgency Dashboard

Platform where every Organization runs as an Agency and hires other Agencies as their Client: agreeing budgets, reviewing reports, and using shared AI agents. MultiAgency is the first Agency on it.

## Language

### Agencies and people

**Organization**:
A team of people with roles. Every Organization is an Agency for its own Projects; it is also a Client toward each Agency it hires. There is no Organization type.
_Avoid_: workspace, tenant, client org, agency org

**Agency**:
What every Organization is: it owns its Projects and does or directs the work on them. In an Engagement it is the Agency when it does the work for the other side. It may have an Agency DAO, but does not need one; an independent contributor can run an Agency.
_Avoid_: org, workspace

**Agency DAO**:
The Sputnik DAO account that holds an Agency's treasury, usually managed through Trezu and possibly with a single member. An Organization has at most one. An Agency needs one to hold Prepayments, keep Budget entries or make Billings; its network (mainnet/testnet) follows the account suffix.
_Avoid_: orgAccountId, daoAccountId (code names, not domain terms)

**Client**:
An Organization on the customer side of an Engagement. Being a Client is a role toward a specific Agency, not a kind of Organization; an Agency that hands work to another Agency is that Agency's Client; a single person who hires an Agency is still an Organization.
_Avoid_: customer, client account, client wallet

**Engagement**:
The relationship in which an Agency does work for a Client, covering the Projects shared between them. Each party sees only what is shared through its own Engagement. It is active or ended; an ended Engagement keeps its history visible to the Client but takes no new work. There is at most one active Engagement per Agency and Client.
_Avoid_: contract (clashes with smart contracts), work order (a contributor document), client relationship

**Subcontractor**:
An Agency doing work on a Project for another Agency, which is its Client. It works, reports, assigns its own Contributors and pays from its own Agency DAO.
_Avoid_: sub-agency, partner

**Contributor**:
A NEAR account assigned to a Project with a role.
_Avoid_: assignee

**Builder**:
A person's public profile in the builders directory; a Contributor usually has one.

### Work

**Project**:
A unit of agency work with a kind (project, idea, scope, result), status and visibility. A Project is owned by the Agency that created it and can be shared with several Clients, each of whom sees the whole Project; internal Projects have none. When shared with a Subcontractor, only the owning Agency may change the Project itself. Projects are owned by the projects plugin, not by this app.

**Listing**:
A published call for work on a Project, carrying a reward token and amount. A Project has at most one NEARN Listing and one internal Listing; the NEARN one wins when both exist.
_Avoid_: bounty (a Listing type, not the concept)

**Listing lifecycle**:
The stage of an internal Listing: draft, published, winners announced, archived.

### Money

**Budget entry**:
A signed amount of one token set aside for a Project. Allocations are positive; deallocations and outgoing transfers are negative entries. Every entry records the Agency DAO it comes from. An entry funded by a Client's Prepayment is attributed to that Client and comes only from the Allocation plan or an approved Change order.
_Avoid_: allocation (that word means Listing reward reserved, see below)

**Prepayment**:
Money a Client pays an Agency upfront to reserve capacity, recorded against their Engagement. It already sits in the Agency DAO when recorded; any part not put into Projects rolls over.
_Avoid_: retainer, deposit, capacity (the thing bought, not the money)

**Prepaid balance**:
A Client's Prepayments minus the Budget entries attributed to them; what that Client can still put into Projects.
_Avoid_: available (that term is the Agency's treasury view), remaining (a Rollup term)

**Allocation plan**:
The agreed amount of a Client's Prepayment that goes to each Project every period (roughly monthly). It is applied as Budget entries when the Agency records that period's Prepayment, and it changes only through a Change order. It is what the Agency makes commitments against.
_Avoid_: buckets, schedule

**Change order**:
A request by either side of an Engagement to change the Allocation plan or move unspent Client budget between Projects or back to the Prepaid balance. The other side approves or rejects it. By default it takes effect from the next period; if both agree, it can take effect now.
_Avoid_: reallocation, amendment

**Billing**:
A DAO transfer proposal recorded against a Project, optionally for a Contributor. Billings are made from the treasury of the Agency that pays, not by Clients, and are visible to every Client of the Project. Its status comes from the DAO proposal.
_Avoid_: invoice, payment

**Project Ledger**:
Everything that bears on a Project's money: its Budget entries, Billings with their proposal status, and its active Listing.

**Rollup**:
Per-token totals derived from a Project Ledger:
- **Budget**: sum of Budget entries.
- **Allocated**: reward of an active Listing whose winners are not yet announced.
- **Committed**: Billings still in progress, plus the reward of an announced Listing that has no Billings yet.
- **Paid**: Billings whose proposal was approved.
- **Remaining**: Budget − Allocated − Committed − Paid.

**Available**:
Treasury balance minus Budget not yet Paid; what the Agency DAO can still assign.
