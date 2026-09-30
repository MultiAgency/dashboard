---
"api": patch
"ui": patch
"@everything-dev/builders-plugin": patch
---

Builder profiles say whether their builder wrote them.

The builders plugin's public route let any signed-in user create a profile for a NEAR account nobody had claimed yet. A new profile now needs the account's owner (signed in with it or having linked it), a platform admin, or the API creating it for an Agency manager's contributor management, calling in-process with `trusted`, which the host never sets on a request.

Since anyone can start an Agency, a profile someone else wrote is not the builder's word. When the account's owner creates or saves their profile, their user is recorded on it and it is claimed; until then the API reports `claimed: false` and the builder list and profile show it as Unclaimed. An owner signed in through a linked account can now also edit and claim their profile.
