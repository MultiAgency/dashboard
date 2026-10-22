# Work orders: n8n for emails and Google Docs/Drive e-signatures

As in accepted-paid, n8n connects each Agency's Google Workspace: it sends the work order emails
from the Agency's Gmail, fills the work order document from a Google Docs template, and brings
e-signed PDFs back from Drive. MultiAgency writes every email (recipients, subject and text) and
puts them in the signed event; n8n only sends them. Each Agency connects its own n8n in
**Settings → Work orders: email and e-signature**.

| File | Trigger | Does |
|---|---|---|
| `work-order-events.json` | MultiAgency POSTs a signed event | Sends the event's `emails` through Gmail. On `work_order.created` it also copies the template, fills it and saves the link on the work order; MultiAgency then sends the "ready to send for signature" email to the representative (again through this workflow). |
| `signed-from-drive.json` | a new PDF in the **Signed** Drive folder | Fingerprints the PDF (SHA-256), has Claude read its terms and signers, and attaches it to the work order with the same code. MultiAgency marks it signed only when the terms match; otherwise the representative gets the differences by email. |

## 1. In MultiAgency

Settings → **Work orders: email and e-signature**:

1. Paste the n8n webhook URL (step 4 below; you can save it later) and press **Connect**.
2. Copy the **token**. It is shown once. **Issue a new token and secret** replaces both.
3. Note the **Callback base URL** and the **webhook signing secret**.

While an Agency has no n8n connected, MultiAgency sends the same emails itself if the server has
`RESEND_API_KEY` and `NOTIFY_FROM_EMAIL`; with n8n connected, only n8n sends them, so nobody gets
two. AI drafts of the report need `ANTHROPIC_API_KEY`. The settings card shows what is on.

## 2. Google Drive and the template

Use the Google Workspace account that has **eSignature**. Suggested folders, both **Restricted**:

```
Work Orders/     ← the template and the filled documents
  Signed/        ← signed PDFs; the intake watches only this folder
```

Placeholders in the template (plain text, replaced everywhere):

| Placeholder | Filled with |
|---|---|
| `{{work_order_id}}` | the work order code, e.g. SI-004 |
| `{{effective_date}}`, `{{period_start}}`, `{{period_end}}` | dates written out |
| `{{contractor_name}}`, `{{representative_name}}` | names from the work order |
| `{{project}}` | project title |
| `{{budget_usd}}` | the budget cap in token units, e.g. 1000 (for USDC this is dollars) |
| `{{ip_assignment}}`, `{{ip_license}}`, `{{ip_open_source}}`, `{{ip_other}}`, `{{ip_other_text}}` | the IP model |
| `{{payee_account}}`, `{{payout_method}}` | the builder's NEAR account; paid by an Agency DAO transfer |
| `{{contractor_github}}`, `{{repos}}` | GitHub login and repositories |
| `{{auto_renew}}`, `{{auto_renew_text}}` | the monthly renewal clause |
| `{{contractor_email}}`, `{{representative_email}}` | emails |

Put the payout account, GitHub login and repositories in the document (e.g. a Schedule A) so the
signed PDF carries every term MultiAgency compares.

## 3. Fill in the placeholders of the workflow files

In both JSON files replace:

- `PASTE_PUBLIC_URL_HERE` → the **Callback base URL** (no trailing slash)
- `PASTE_N8N_WEBHOOK_SECRET_HERE` → the **webhook signing secret** (events workflow only)
- `PASTE_TEMPLATE_DOC_ID_HERE` → the template's id from `docs.google.com/document/d/<id>/edit`

## 4. Credentials and import

| Credential | Type | Used by |
|---|---|---|
| Google | Google Drive OAuth2 + Google Docs OAuth2 | Copy template, Fill placeholders, Drive trigger, Download nodes |
| Gmail | Gmail OAuth2 | Send email (Gmail) |
| Anthropic | Anthropic API | Extract fields (Claude) |
| MultiAgency API | Header Auth: name `Authorization`, value `Bearer <token>` | Save document link, Attach to draft work order |

1. Import `work-order-events.json`, select the credentials, activate it, and copy the
   **Production URL** of "MultiAgency work order events" into MultiAgency (step 1). **Send a test
   event** there to check it.
2. Import `signed-from-drive.json`, point the Drive trigger at **Signed**, select the credentials and
   activate it. It polls every hour.

## The flow

1. Create the work order (draft). The filled document arrives; MultiAgency emails the
   representative its link.
2. Google Docs → Tools → eSignature → Request signature (the builder and the representative).
3. Save the signed PDF in **Signed**. The intake attaches it; the work order becomes **accepted**
   when the terms match.
4. If this Agency hasn't paid the builder's NEAR account before, the builder confirms it by signing
   in with that wallet (they get an email). Accepting the terms in MultiAgency instead of e-signing
   confirms it at the same time.
5. Activate. From then on evidence is collected from GitHub every 6 hours, and the builder gets the
   drafted report at the end of the period.

Every event carries `X-AP-Signature: sha256=<HMAC-SHA256 of the body with the signing secret>` and
`X-AP-Event: <type>`. Each event has a unique `id`; a retry can deliver one twice. Undelivered
events are retried with backoff for 24 hours and listed under Recent deliveries.
