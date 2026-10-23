import { BAD_REQUEST, FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from "every-plugin/errors";
import { oc } from "every-plugin/orpc";
import { z } from "every-plugin/zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z
  .string()
  .regex(/^\d+$/, "positive integer string in the token's smallest unit")
  .max(80);
const code = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{1,40}$/);
const repo = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/, "owner/name");
const nearAccount = z.string().trim().min(2).max(64);
const status = z.enum([
  "draft",
  "offered",
  "accepted",
  "active",
  "ended",
  "exhausted",
  "terminated",
]);
const requestStatus = z.enum([
  "draft",
  "submitted",
  "approved",
  "paying",
  "proposed",
  "paid",
  "rejected",
  "failed",
]);

const renewalMetric = z.object({
  key: z.enum(["active_weeks", "approved_prs", "issues_done", "unapproved_prs", "requests"]),
  label: z.string(),
  value: z.string(),
  target: z.string(),
  met: z.boolean(),
});

const renewal = z.object({
  status: z.enum(["renewed", "needs_approval", "declined"]),
  assessment: z.object({
    assessedAt: z.string(),
    periodStart: z.string(),
    periodEnd: z.string(),
    passed: z.boolean(),
    metrics: z.array(renewalMetric),
  }),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  note: z.string().nullable(),
  renewedTo: z.string().nullable(),
});

export const workOrder = z.object({
  id: z.string(),
  code: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  projectTitle: z.string(),
  projectSlug: z.string().nullable(),
  builder: z.object({
    nearAccount: z.string(),
    name: z.string().nullable(),
    githubLogin: z.string().nullable(),
    profileGithubLogin: z.string().nullable(),
  }),
  contractorName: z.string().nullable(),
  contractorEmail: z.string().nullable(),
  representativeName: z.string().nullable(),
  representativeEmail: z.string().nullable(),
  ipModel: z.string().nullable(),
  payee: z.object({
    account: z.string(),
    confirmedAt: z.string().nullable(),
    paidBefore: z.boolean().nullable(),
    needsConfirmation: z.boolean(),
  }),
  signing: z.object({
    documentSha256: z.string().nullable(),
    builder: z.object({ name: z.string(), signedAt: z.string() }).nullable(),
    representative: z.object({ name: z.string(), signedAt: z.string() }).nullable(),
    needsCountersign: z.boolean(),
    esign: z
      .object({
        provider: z.literal("documenso"),
        sent: z.boolean(),
        builderUrl: z.string().nullable(),
        representativeUrl: z.string().nullable(),
        error: z.string().nullable(),
      })
      .nullable(),
  }),
  signature: z.object({
    method: z.enum(["in_app", "google_esign", "documenso"]).nullable(),
    signedAt: z.string().nullable(),
    signers: z.array(
      z.object({
        name: z.string(),
        role: z.enum(["contractor", "representative"]),
        signedAt: z.string().nullable(),
      }),
    ),
    preparedDocumentUrl: z.string().nullable(),
  }),
  title: z.string(),
  scope: z.string().nullable(),
  repos: z.array(z.string()),
  periodStart: z.string(),
  periodEnd: z.string(),
  graceDays: z.number().int(),
  timeZone: z.string(),
  tokenId: z.string(),
  payoutTokenId: z.string(),
  budgetAmount: z.string(),
  committedAmount: z.string(),
  paidAmount: z.string(),
  remainingAmount: z.string(),
  autoRenew: z.boolean(),
  status,
  offeredAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  termsChanged: z.boolean(),
  documentSha256: z.string().nullable(),
  documentUrl: z.string().nullable(),
  activatedAt: z.string().nullable(),
  activationBlockers: z.array(z.string()),
  lastCollectedAt: z.string().nullable(),
  waiting: z.number().int(),
  renewedFrom: z.string().nullable(),
  renewal: renewal.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const workOrderDocument = z.object({
  kind: z.enum(["offered", "signed"]),
  fileName: z.string(),
  sha256: z.string(),
  pdfBase64: z.string(),
  driveUrl: z.string().nullable(),
  current: z.boolean(),
});

const evidence = z.object({
  id: z.string(),
  kind: z.enum(["assigned_issue", "merged_pr", "unlinked_pr", "review", "manual"]),
  repo: z.string().nullable(),
  number: z.number().int().nullable(),
  url: z.string(),
  title: z.string(),
  state: z.string(),
  occurredAt: z.string().nullable(),
  assignedAt: z.string().nullable(),
  assignedBy: z.string().nullable(),
  authorized: z.boolean(),
  flags: z.array(z.string()),
  links: z.array(z.string()),
});

const manualItem = z.object({
  title: z.string().trim().min(1).max(300),
  url: z.url().max(2000),
  date: day.nullable(),
  note: z.string().trim().max(500).nullable(),
});

const trustDecision = z.enum(["manual", "veto_window", "auto_pay"]);

export const trustMode = z.enum(["off", "suggest", "auto"]);

const requestTrust = z.object({
  tier: z.enum(["new", "established", "trusted"]),
  score: z.number(),
  reasons: z.array(z.string()),
  blockers: z.array(z.string()),
  decision: trustDecision,
  suggested: trustDecision,
  aiVerdict: z.enum(["consistent", "concerns", "inconsistent"]).nullable(),
  aiConcerns: z.array(z.string()),
  autoApproveAt: z.string().nullable(),
  stopped: z.boolean(),
  approvedAutomatically: z.boolean(),
});

export const trustSettings = z.object({
  mode: trustMode,
  vetoHours: z.number().int().min(1).max(168),
});

export const compensationRequest = z.object({
  id: z.string(),
  workOrderId: z.string(),
  code: z.string(),
  seq: z.number().int(),
  coversFrom: z.string(),
  coversTo: z.string(),
  status: requestStatus,
  requestedAmount: z.string(),
  approvedAmount: z.string().nullable(),
  approvedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  note: z.string().nullable(),
  contributionsMd: z.string(),
  assessmentMd: z.string(),
  assessmentIsDraft: z.boolean(),
  manualItems: z.array(manualItem),
  reportMd: z.string().nullable(),
  reportSha256: z.string().nullable(),
  overlaps: z.array(z.string()),
  authorizedEvidence: z.number().int(),
  autoPayBlocked: z
    .object({ reason: z.string(), since: z.string(), triedAt: z.string().nullable() })
    .nullable(),
  agentPayout: z
    .object({
      status: z.enum([
        "sending",
        "queued",
        "processing",
        "paid",
        "failed",
        "refused",
        "uncertain",
        "needs_review",
      ]),
      amount: z.string(),
      txUrl: z.string().nullable(),
      reason: z.string().nullable(),
    })
    .nullable(),
  payout: z
    .object({
      tokenId: z.string(),
      amount: z.string(),
      priceUsd: z.string().nullable(),
      pricedAt: z.string().nullable(),
    })
    .nullable(),
  submittedAt: z.string().nullable(),
  trust: requestTrust.nullable(),
  proposalId: z.string().nullable(),
  payingDaoAccountId: z.string().nullable(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const activity = z.object({
  weeksActive: z.number().int(),
  weeksInPeriod: z.number().int(),
  prsMerged: z.number().int(),
  issuesClosed: z.number().int(),
  reviews: z.number().int(),
  additions: z.number().int(),
  deletions: z.number().int(),
});

const repoOwner = z.object({
  repo: z.string(),
  owner: z.string().nullable(),
  ownerType: z.enum(["User", "Organization"]).nullable(),
  approvers: z.array(z.string()),
  error: z.string().nullable(),
});

export const workOrderDetail = workOrder.extend({
  evidence: z.array(evidence),
  activity,
  requests: z.array(compensationRequest),
  repoOwners: z.array(repoOwner),
});

const fields = {
  code: code.optional(),
  projectId: z.string().min(1),
  builderNearAccount: nearAccount,
  title: z.string().trim().min(1).max(200),
  scope: z.string().max(4000).nullable().optional(),
  repos: z.array(repo).max(20),
  periodStart: day,
  periodEnd: day,
  graceDays: z.number().int().min(0).max(30).optional(),
  tokenId: z.string().min(1).max(80),
  budgetAmount: amount,
  payoutTokenId: z.string().min(1).max(80).nullable().optional(),
  autoRenew: z.boolean().optional(),
  githubLogin: z.string().trim().max(40).nullable().optional(),
  contractorName: z.string().trim().max(200).nullable().optional(),
  contractorEmail: z.string().trim().max(320).nullable().optional(),
  representativeName: z.string().trim().max(200).nullable().optional(),
  representativeEmail: z.string().trim().max(320).nullable().optional(),
  ipModel: z.string().trim().max(200).nullable().optional(),
};

const byId = z.object({ id: z.string().min(1) });
const byRequest = z.object({ requestId: z.string().min(1) });
const range = { coversFrom: day.optional(), coversTo: day.optional() };
const errors = { UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST };
const CONFLICT = { status: 409, message: "Conflict" } as const;

const payoutAgent = z.object({
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
  settings: z
    .object({ ownerAccountId: z.string(), monthlyBudgetUsd: z.string(), maxPayoutNear: z.string() })
    .nullable(),
  agentId: z.string().nullable(),
  grantExpiresAt: z.string().nullable(),
  grantValid: z.boolean(),
  grantExpiringSoon: z.boolean(),
  serverSigning: z.object({
    configured: z.boolean(),
    active: z.boolean(),
    warning: z.string().nullable(),
  }),
  policy: z
    .object({
      status: z.string(),
      frozen: z.boolean(),
      ownerApproval: z.boolean(),
      payees: z.array(z.string()),
      monthlyLimitUsd: z.string().nullable(),
      monthlySpentUsd: z.string().nullable(),
      monthlyRemainingUsd: z.string().nullable(),
      monthlyResetsAt: z.string().nullable(),
      policyChangeAvailableAt: z.string().nullable(),
    })
    .nullable(),
  changes: z.array(z.string()),
  balance: z.object({ near: z.string(), usd: z.string().nullable() }).nullable(),
  ready: z.boolean(),
  blockers: z.array(z.string()),
  error: z.string().nullable(),
});

const delivery = z.object({
  id: z.string(),
  channel: z.enum(["email", "n8n"]),
  eventType: z.string(),
  attempts: z.number().int(),
  deliveredAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});

const integration = z.object({
  connected: z.boolean(),
  webhookUrl: z.string().nullable(),
  webhookSecret: z.string().nullable(),
  hasInboundToken: z.boolean(),
  emailEnabled: z.boolean(),
  aiDraftsEnabled: z.boolean(),
  callbackBaseUrl: z.string(),
  deliveries: z.array(delivery),
  google: z.object({
    available: z.boolean(),
    serviceAccountEmail: z.string().nullable(),
    templateUrl: z.string().nullable(),
    documentsFolderUrl: z.string().nullable(),
    signedFolderUrl: z.string().nullable(),
    checkedAt: z.string().nullable(),
    lastError: z.string().nullable(),
    files: z.array(
      z.object({
        fileId: z.string(),
        name: z.string(),
        url: z.string().nullable(),
        workOrderId: z.string().nullable(),
        outcome: z.enum(["attached", "mismatch", "unmatched", "error"]),
        note: z.string().nullable(),
        processedAt: z.string(),
      }),
    ),
  }),
});

export const workOrdersContract = {
  list: oc
    .route({ method: "GET", path: "/admin/work-orders" })
    .input(
      z.object({
        status: status.optional(),
        projectId: z.string().optional(),
        builderNearAccount: z.string().optional(),
      }),
    )
    .output(z.object({ data: z.array(workOrder) }))
    .errors({ UNAUTHORIZED, FORBIDDEN }),

  get: oc
    .route({ method: "GET", path: "/admin/work-orders/{id}" })
    .input(byId)
    .output(workOrderDetail)
    .errors(errors),

  create: oc
    .route({ method: "POST", path: "/admin/work-orders" })
    .input(z.object(fields))
    .output(workOrder)
    .errors(errors),

  update: oc
    .route({ method: "PATCH", path: "/admin/work-orders/{id}" })
    .input(
      z.object({
        id: z.string().min(1),
        code: fields.code,
        projectId: fields.projectId.optional(),
        builderNearAccount: fields.builderNearAccount.optional(),
        title: fields.title.optional(),
        scope: fields.scope,
        repos: fields.repos.optional(),
        periodStart: day.optional(),
        periodEnd: day.optional(),
        graceDays: fields.graceDays,
        tokenId: fields.tokenId.optional(),
        budgetAmount: amount.optional(),
        payoutTokenId: fields.payoutTokenId,
        autoRenew: fields.autoRenew,
        githubLogin: fields.githubLogin,
        contractorName: fields.contractorName,
        contractorEmail: fields.contractorEmail,
        representativeName: fields.representativeName,
        representativeEmail: fields.representativeEmail,
        ipModel: fields.ipModel,
      }),
    )
    .output(workOrder)
    .errors(errors),

  delete: oc
    .route({ method: "DELETE", path: "/admin/work-orders/{id}" })
    .input(byId)
    .output(z.object({ deleted: z.literal(true) }))
    .errors(errors),

  offer: oc
    .route({ method: "POST", path: "/admin/work-orders/{id}/offer" })
    .input(byId)
    .output(workOrder)
    .errors(errors),

  document: oc
    .route({ method: "GET", path: "/admin/work-orders/{id}/document" })
    .input(byId)
    .output(workOrderDocument)
    .errors(errors),

  countersign: oc
    .route({ method: "POST", path: "/admin/work-orders/{id}/countersign" })
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(2).max(200),
        agree: z.literal(true),
      }),
    )
    .output(workOrder)
    .errors(errors),

  activate: oc
    .route({ method: "POST", path: "/admin/work-orders/{id}/activate" })
    .input(byId)
    .output(workOrder)
    .errors(errors),

  terminate: oc
    .route({ method: "POST", path: "/admin/work-orders/{id}/terminate" })
    .input(byId)
    .output(workOrder)
    .errors(errors),

  attachDocument: oc
    .route({ method: "POST", path: "/admin/work-orders/{id}/document" })
    .input(
      z.object({
        id: z.string().min(1),
        sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, "a SHA-256 hex digest"),
        url: z.url().max(2000).nullable().optional(),
      }),
    )
    .output(workOrder)
    .errors(errors),

  collect: oc
    .route({ method: "POST", path: "/admin/work-orders/{id}/collect" })
    .input(byId)
    .output(workOrderDetail)
    .errors(errors),

  draftRequest: oc
    .route({ method: "POST", path: "/admin/work-orders/{id}/requests" })
    .input(z.object({ id: z.string().min(1), ...range }))
    .output(compensationRequest)
    .errors(errors),

  approveRequest: oc
    .route({ method: "POST", path: "/admin/work-order-requests/{requestId}/approve" })
    .input(
      z.object({
        requestId: z.string().min(1),
        amount,
        confirmEvidenceIds: z.array(z.string()).max(500).optional(),
        allowWithoutEvidence: z.boolean().optional(),
      }),
    )
    .output(compensationRequest)
    .errors(errors),

  rejectRequest: oc
    .route({ method: "POST", path: "/admin/work-order-requests/{requestId}/reject" })
    .input(z.object({ requestId: z.string().min(1), note: z.string().trim().min(1).max(2000) }))
    .output(compensationRequest)
    .errors(errors),

  linkProposal: oc
    .route({ method: "POST", path: "/admin/work-order-requests/{requestId}/proposal" })
    .input(z.object({ requestId: z.string().min(1), proposalId: z.string().regex(/^\d+$/) }))
    .output(compensationRequest)
    .errors(errors),

  paymentProposal: oc
    .route({ method: "GET", path: "/admin/work-order-requests/{requestId}/proposal" })
    .input(byRequest)
    .output(
      z.object({
        quote: z.object({
          usd: z.string().nullable(),
          tokenId: z.string(),
          amount: z.string(),
          priceUsd: z.string().nullable(),
          pricedAt: z.string().nullable(),
        }),
        daoAccountId: z.string(),
        method: z.literal("add_proposal"),
        args: z.object({
          proposal: z.object({
            description: z.string(),
            kind: z.object({
              Transfer: z.object({
                token_id: z.string(),
                receiver_id: z.string(),
                amount: z.string(),
                msg: z.null(),
              }),
            }),
          }),
        }),
        deposit: z.string(),
        gas: z.string(),
      }),
    )
    .errors(errors),

  payNow: oc
    .route({ method: "POST", path: "/admin/work-order-requests/{requestId}/pay" })
    .input(byRequest)
    .output(compensationRequest)
    .errors(errors),

  stopAutoApproval: oc
    .route({
      method: "POST",
      path: "/admin/work-order-requests/{requestId}/stop-auto-approval",
    })
    .input(byRequest)
    .output(compensationRequest)
    .errors(errors),

  trustSettings: oc
    .route({ method: "GET", path: "/admin/work-order-trust" })
    .input(z.object({}))
    .output(trustSettings)
    .errors({ UNAUTHORIZED, FORBIDDEN }),

  saveTrustSettings: oc
    .route({ method: "POST", path: "/admin/work-order-trust" })
    .input(trustSettings)
    .output(trustSettings)
    .errors(errors),

  payoutAgent: oc
    .route({ method: "GET", path: "/admin/payout-agent" })
    .input(z.object({}))
    .output(payoutAgent)
    .errors({ UNAUTHORIZED, FORBIDDEN }),

  savePayoutAgent: oc
    .route({ method: "PUT", path: "/admin/payout-agent" })
    .input(
      z.object({
        ownerAccountId: z.string().trim().min(2).max(64),
        monthlyBudgetUsd: z
          .string()
          .trim()
          .regex(/^\d+(\.\d+)?$/),
        maxPayoutNear: z
          .string()
          .trim()
          .regex(/^\d+(\.\d+)?$/),
      }),
    )
    .output(payoutAgent)
    .errors(errors),

  preparePayoutAction: oc
    .route({ method: "POST", path: "/admin/payout-agent/prepare" })
    .input(
      z.object({
        action: z.enum(["create_agent", "issue_grant", "sync_policy", "freeze", "unfreeze"]),
        publicKey: z.string().max(200).nullable().optional(),
      }),
    )
    .output(
      z.object({
        correlationId: z.string(),
        action: z.string(),
        intent: z.record(z.string(), z.unknown()),
        signerAccountId: z.string(),
        summary: z.string().nullable(),
        expiresAt: z.string(),
      }),
    )
    .errors(errors),

  submitPayoutAction: oc
    .route({ method: "POST", path: "/admin/payout-agent/submit" })
    .input(
      z.object({ correlationId: z.string().min(1), signedData: z.record(z.string(), z.unknown()) }),
    )
    .output(z.object({ status: z.string(), failureCode: z.string().nullable(), view: payoutAgent }))
    .errors(errors),

  signPayoutActionOnServer: oc
    .route({ method: "POST", path: "/admin/payout-agent/server-sign" })
    .input(z.object({ action: z.enum(["sync_policy", "issue_grant"]) }))
    .output(z.object({ status: z.string(), failureCode: z.string().nullable(), view: payoutAgent }))
    .errors(errors),

  allowPayees: oc
    .route({ method: "POST", path: "/admin/payout-agent/allow-payees" })
    .input(z.object({}))
    .output(
      z.object({
        ok: z.boolean(),
        reason: z.string().nullable(),
        needsSignature: z.boolean(),
        view: payoutAgent,
      }),
    )
    .errors(errors),

  payoutFunding: oc
    .route({ method: "GET", path: "/admin/payout-agent/funding" })
    .input(z.object({}))
    .output(
      z.object({
        items: z.array(
          z.object({
            id: z.string(),
            code: z.string(),
            title: z.string(),
            project: z.string().nullable(),
            builderNearAccount: z.string(),
            periodEnd: z.string(),
            unpaid: z.string(),
            near: z.string(),
          }),
        ),
        priceUsd: z.string().nullable(),
        bufferPercent: z.number(),
        neededNear: z.string(),
        balanceNear: z.string().nullable(),
        topUpNear: z.string(),
        lowBalance: z.boolean(),
        monthlyBudgetUsd: z.string().nullable(),
        monthlyNeededUsd: z.string().nullable(),
        suggestedBudgetUsd: z.string().nullable(),
        budgetTooLow: z.boolean(),
      }),
    )
    .errors(errors),

  payoutTopUp: oc
    .route({ method: "POST", path: "/admin/payout-agent/top-up" })
    .input(
      z.object({
        amountNear: z
          .string()
          .trim()
          .regex(/^\d+(\.\d+)?$/),
      }),
    )
    .output(
      z.object({
        address: z.string(),
        memo: z.string().nullable(),
        minAmount: z.string().nullable(),
        daoAccountId: z.string(),
        method: z.literal("add_proposal"),
        args: z.record(z.string(), z.unknown()),
        deposit: z.string(),
        gas: z.string(),
      }),
    )
    .errors(errors),

  refreshPayment: oc
    .route({ method: "POST", path: "/admin/work-order-requests/{requestId}/refresh" })
    .input(byRequest)
    .output(compensationRequest)
    .errors(errors),

  setGithubLogin: oc
    .route({ method: "POST", path: "/admin/work-orders/{id}/github" })
    .input(z.object({ id: z.string().min(1), githubLogin: z.string().trim().min(1).max(40) }))
    .output(workOrder)
    .errors(errors),

  prepareDocument: oc
    .route({ method: "POST", path: "/admin/work-orders/{id}/document" })
    .input(byId)
    .output(workOrder)
    .errors(errors),

  requestPayeeConfirmation: oc
    .route({ method: "POST", path: "/admin/work-orders/{id}/payee-confirmation" })
    .input(byId)
    .output(workOrder)
    .errors(errors),

  integration: oc
    .route({ method: "GET", path: "/admin/work-order-integration" })
    .input(z.object({}))
    .output(integration)
    .errors({ UNAUTHORIZED, FORBIDDEN }),

  saveIntegration: oc
    .route({ method: "PUT", path: "/admin/work-order-integration" })
    .input(z.object({ webhookUrl: z.url().max(2000).nullable() }))
    .output(integration.extend({ inboundToken: z.string().nullable() }))
    .errors(errors),

  rotateIntegration: oc
    .route({ method: "POST", path: "/admin/work-order-integration/rotate" })
    .input(z.object({}))
    .output(integration.extend({ inboundToken: z.string().nullable() }))
    .errors(errors),

  saveGoogle: oc
    .route({ method: "PUT", path: "/admin/work-order-integration/google" })
    .input(
      z.object({
        templateUrl: z.string().trim().max(2000).nullable(),
        documentsFolderUrl: z.string().trim().max(2000).nullable(),
        signedFolderUrl: z.string().trim().max(2000).nullable(),
      }),
    )
    .output(integration)
    .errors(errors),

  checkDrive: oc
    .route({ method: "POST", path: "/admin/work-order-integration/google/check" })
    .input(z.object({}))
    .output(
      integration.extend({
        result: z.object({
          checked: z.number().int(),
          attached: z.number().int(),
          mismatch: z.number().int(),
          unmatched: z.number().int(),
          error: z.number().int(),
        }),
      }),
    )
    .errors(errors),

  testIntegration: oc
    .route({ method: "POST", path: "/admin/work-order-integration/test" })
    .input(z.object({}))
    .output(integration)
    .errors(errors),

  decideRenewal: oc
    .route({ method: "POST", path: "/admin/work-orders/{id}/renewal" })
    .input(
      z.object({
        id: z.string().min(1),
        decision: z.enum(["approve", "decline"]),
        note: z.string().max(2000).nullable().optional(),
      }),
    )
    .output(workOrder)
    .errors(errors),

  run: oc
    .route({ method: "POST", path: "/work-orders/run" })
    .input(z.object({}))
    .output(z.object({ ran: z.boolean(), counts: z.record(z.string(), z.number()) }))
    .errors({ UNAUTHORIZED }),
};

const myWorkOrder = workOrder.extend({ agencyName: z.string() });

export const myWorkOrdersContract = {
  list: oc
    .route({ method: "GET", path: "/me/work-orders" })
    .input(z.object({}))
    .output(z.object({ data: z.array(myWorkOrder) }))
    .errors({ UNAUTHORIZED }),

  get: oc
    .route({ method: "GET", path: "/me/work-orders/{id}" })
    .input(byId)
    .output(workOrderDetail.extend({ agencyName: z.string(), termsHash: z.string() }))
    .errors(errors),

  document: oc
    .route({ method: "GET", path: "/me/work-orders/{id}/document" })
    .input(byId)
    .output(workOrderDocument)
    .errors(errors),

  sign: oc
    .route({ method: "POST", path: "/me/work-orders/{id}/sign" })
    .input(
      z.object({
        id: z.string().min(1),
        documentSha256: z.string().regex(/^[0-9a-f]{64}$/),
        name: z.string().trim().min(2).max(200),
        agree: z.literal(true),
      }),
    )
    .output(workOrder)
    .errors(errors),

  decline: oc
    .route({ method: "POST", path: "/me/work-orders/{id}/decline" })
    .input(z.object({ id: z.string().min(1), note: z.string().max(2000).nullable().optional() }))
    .output(workOrder)
    .errors(errors),

  confirmPayee: oc
    .route({ method: "POST", path: "/me/work-orders/{id}/confirm-payee" })
    .input(byId)
    .output(workOrder)
    .errors(errors),

  draftRequest: oc
    .route({ method: "POST", path: "/me/work-orders/{id}/requests" })
    .input(z.object({ id: z.string().min(1), ...range }))
    .output(compensationRequest)
    .errors(errors),

  editRequest: oc
    .route({ method: "PATCH", path: "/me/work-order-requests/{requestId}" })
    .input(
      z.object({
        requestId: z.string().min(1),
        assessmentMd: z.string().max(20_000).optional(),
        manualItems: z.array(manualItem).max(50).optional(),
        requestedAmount: amount.optional(),
      }),
    )
    .output(compensationRequest)
    .errors(errors),

  submitRequest: oc
    .route({ method: "POST", path: "/me/work-order-requests/{requestId}/submit" })
    .input(byRequest)
    .output(compensationRequest)
    .errors(errors),
};

const signer = z.object({
  name: z.string().trim().min(1).max(200),
  role: z.enum(["contractor", "representative"]),
  signedAt: z.string().max(64).nullable(),
});

export const workOrderIntakeContract = {
  preparedDocument: oc
    .route({ method: "PATCH", path: "/work-orders/{code}" })
    .input(z.object({ code, preparedDocumentUrl: z.url().max(2000) }))
    .output(z.object({ id: z.string(), status, preparedDocumentUrl: z.string() }))
    .errors(errors),

  signedDocument: oc
    .route({ method: "POST", path: "/work-orders/{code}/signed-document" })
    .input(
      z.object({
        code,
        method: z.literal("google_esign"),
        documentSha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
        documentUrl: z.url().max(2000).nullable().optional(),
        signedAt: z.string().max(64).nullable().optional(),
        signers: z.array(signer).max(10).optional(),
        extracted: z.object({
          workOrderId: z.string().max(80),
          project: z.string().max(300),
          contractorName: z.string().max(200),
          representativeName: z.string().max(200),
          periodStart: z.string().max(40),
          periodEnd: z.string().max(40),
          budgetUsd: z.string().max(80),
          payee: z.string().max(80).nullable(),
          contractorGithub: z.string().max(80).nullable(),
          repos: z.array(z.string().max(200)).max(20).nullable(),
        }),
      }),
    )
    .output(z.object({ id: z.string(), status, mismatches: z.array(z.string()) }))
    .errors({ ...errors, CONFLICT }),
};
