# ui

## 1.1.3

### Patch Changes

- 01c451e: Tighten agency membership and client access.

  Personal and client workspace owners no longer inherit MultiAgency owner rights from the default DAO. Agency role only counts when the active workspace is an agency.

  Clients must belong to an agency (`agency_dao_account_id` is required). The client portal only lists billings on that client's linked projects. Deleting a project refreshes client pages as well as admin ones.

  The client portal reads agency projects with a read-only role instead of an admin one. Admin data is cached per network, so switching networks no longer shows the other network's projects, billings or budgets. Client budgets refresh after budget or listing changes.
