# ui

## 1.1.4

### Patch Changes

- e2009a6: Builder profiles say whether their builder wrote them.

  The builders plugin's public route let any signed-in user create a profile for a NEAR account nobody had claimed yet. A new profile now needs the account's owner (signed in with it or having linked it), a platform admin, or the API creating it for an Agency manager's contributor management, calling in-process with `trusted`, which the host never sets on a request.

  Since anyone can start an Agency, a profile someone else wrote is not the builder's word. When the account's owner creates or saves their profile, their user is recorded on it and it is claimed; until then the API reports `claimed: false` and the builder list and profile show it as Unclaimed. An owner signed in through a linked account can now also edit and claim their profile.

## 1.1.3

### Patch Changes

- 01c451e: Tighten agency membership and client access.

  Personal and client workspace owners no longer inherit MultiAgency owner rights from the default DAO. Agency role only counts when the active workspace is an agency.

  Clients must belong to an agency (`agency_dao_account_id` is required). The client portal only lists billings on that client's linked projects. Deleting a project refreshes client pages as well as admin ones.

  The client portal reads agency projects with a read-only role instead of an admin one. Admin data is cached per network, so switching networks no longer shows the other network's projects, billings or budgets. Client budgets refresh after budget or listing changes.
