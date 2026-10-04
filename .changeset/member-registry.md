---
"@everything-dev/builders-plugin": minor
"api": patch
"ui": patch
---

The builders plugin keeps the member registry that the contribution board reads instead of its own copies.

A builder can now be a member: identified by a lowercase GitHub login, with a kind (`human` or `agent`, and for an agent the human member who operates it), a verified NEAR account per network, and an admission per network (status, proof link and date). A member with only a testnet account has no NEAR account on their builder profile and stays out of the builder list until they have a mainnet one. Existing builders become humans with no registry data.

The registry is reached through the host's RPC endpoint for the plugin (`/api/rpc/builders/<procedure>`). `listMembers` and `getMember` are public. `putMember` is for the board and needs the registry token for the network it writes (`REGISTRY_TOKEN_TESTNET` or `REGISTRY_TOKEN_MAINNET`); without one configured, that network's writes are refused. Once a member is admitted on mainnet, only a mainnet write can change their kind or operator, and every write reports which existing fields it changed. A services agreement is recorded per member through `recordAgreement` by a platform admin and never appears in a response. Builder profiles and contributors now carry the member's `githubLogin` (null for a builder who isn't a member). The contributors list and profile show it as a verified GitHub account linking to the member's GitHub profile, and an Agency can no longer edit or remove a member's profile, which only the member, a platform admin or the board changes. Writes for the same member or mainnet account are serialised, so a testnet write can't slip in beside a mainnet admission, and a member who joined on testnet is joined to their own dashboard profile when mainnet admits them.
