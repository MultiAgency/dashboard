---
"api": minor
"ui": minor
---

Agencies run work orders end to end under Admin → Work orders, replacing the private work-order tracking for platform admins. A work order names a builder, a Project, a period, GitHub repositories and a budget; it is offered for signature in MultiAgency, through Documenso or through Google Docs and Drive, and each party only sees its own signing link. Once active, the builder files compensation requests backed by GitHub evidence; the Agency approves them (or approves trusted builders automatically after a veto window) and pays them through a DAO proposal or automatically in NEAR through a payout agent on NEAR Intents. The payout agent's owner signs every rule and permission change with their wallet; MultiAgency verifies those signatures before relaying them, and reminds managers before the permission expires. Withdrawn, changed or declined offers cancel their Documenso envelope. Requires the work-order and payout secrets listed in `bos.config.json`; `PAYOUTS_OWNER_PRIVATE_KEY` is no longer used.
