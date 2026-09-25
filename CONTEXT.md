# Domain vocabulary

Code, docs and issues use these words with these meanings. The UI may say "allocate", but code and docs say Budget entry, because "Allocated" in a Project rollup means a reserved Listing reward.

| Term | Meaning |
| --- | --- |
| **Organization** | The only tenant on the platform: a Better-Auth organization with members and roles (owner, admin, member, contributor). Every user also has a personal Organization, which never acts as an Agency or Client. |
| **Agency** | Any Organization, for the Projects it owns and the work it runs. Agency is a role, not a type. |
| **Client** | An Organization in its role as the customer of an Agency, through an Engagement. The same Organization can be an Agency for its own Projects and a Client of another Agency. |
| **Engagement** | The relationship between an Agency and a Client (proposed, active, declined or ended). Projects are shared with the Client through it, and Engagement-level money flows through it. At most one active Engagement per Agency and Client. |
| **Subcontractor** | An Agency hired by another Agency to work on a shared Project. It assigns and pays its own Contributors but cannot change the Project or the hiring Agency's budget. |
| **Agency DAO** | The Sputnik DAO treasury (for example a single-member Trezu treasury) an Organization uses for money features. At most one per Organization, and a DAO belongs to at most one Organization. It identifies the treasury, not the Agency. |
| **Prepayment** | Money a Client paid an Agency to reserve capacity for a period (a calendar month), recorded against their Engagement. |
| **Prepaid balance** | Per Engagement and token: Prepayments minus the Budget entries attributed to that Engagement. It rolls over between periods. |
| **Budget entry** | A signed ledger row that gives a Project budget in a token, funded from an Agency DAO and optionally attributed to an Engagement. |
| **Billing** | A payout on a Project, recorded against a transfer proposal of the paying Agency DAO. Its status comes from the chain. |
| **Allocation plan** | The agreed amount per Project per period that recording a Prepayment turns into Budget entries. |
| **Change order** | A proposal by either side of an Engagement to change the Allocation plan or move budget, approved by the other side. |
| **Idea** | Work a Client member suggests to an Agency through an active Engagement. It is a private Project of kind idea owned by the Agency and created by that member; the Agency accepts it (turning it into a Project or scope) or declines it. |
| **Agent link** | A labelled link to an agent a Client can use through its Engagement, managed by the Agency. |
| **Saved report** | A generated report kept with its note and date range, visible to the members of the Organization that generated it. |
