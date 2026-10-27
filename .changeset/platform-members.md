---
"@everything-dev/builders-plugin": minor
"api": minor
"ui": minor
---

Platform admins get a Members page (`/platform/members`, linked from Workspaces) listing every member of the contribution board, including those with only a testnet account: their verified GitHub login, kind and operator, admission on each network, and whether a services agreement is on file. From there a platform admin records or updates a member's agreement (version, date signed and a private proof that is never shown again). The builders plugin adds a platform-admin-only `listMembersWithAgreements`, and the API adds `members.list` and `members.recordAgreement`, both enforced as platform-admin-only by the plugin.
